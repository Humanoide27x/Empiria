"use strict";

const pool = require("../../db/pool");
const { getPayrollConfig } = require("../../data/payroll_config");
const { calculatePayrollDeductionBase } = require("../../utils/payroll-deductions");
const {
  dateOnly,
  getEmployeeLaborStartDate,
  getEmployeeLaborEndDate,
  employeeAppliesToPayrollPeriod,
  calculatePayrollWorkedDays,
  laborDateNoveltiesForPeriod,
  payrollInclusionStatus,
} = require("../../utils/payroll-period-eligibility");

// ── Caché de grupos de nómina (TTL 120s) ─────────────────────────────────────
const _groupCache = new Map();
const GROUP_CACHE_TTL = 120_000;

function _groupCacheGet(id) {
  const e = _groupCache.get(id);
  if (!e) return null;
  if (Date.now() - e.ts > GROUP_CACHE_TTL) { _groupCache.delete(id); return null; }
  return e.data;
}
function _groupCacheSet(id, data) { _groupCache.set(id, { ts: Date.now(), data }); }
function _groupCacheInvalidate(id) { _groupCache.delete(id); }
function clearGroupCache() { _groupCache.clear(); }

const OPERARIO_POSITION = "OPERARIO MANIPULADOR DE ALIMENTOS";

// ── Normalización de texto para comparaciones de reemplazo ───────────────────
function nStr(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// DÍAS DE SEGURIDAD SOCIAL (ss_days)
// Lógica independiente de los días laborados. Determina cuántos días del
// período cubren seguridad social para cada empleado, considerando motivos
// de retiro y coincidencia de reemplazos.
// ─────────────────────────────────────────────────────────────────────────────

function findReplacementForRetiro(retiringItem, allGroupItems, novsByItem) {
  for (const candidate of allGroupItems) {
    if (Number(candidate.id) === Number(retiringItem.id)) continue;

    const matchInst = (candidate.institution_id && retiringItem.institution_id)
      ? Number(candidate.institution_id) === Number(retiringItem.institution_id)
      : nStr(candidate.institution_name) === nStr(retiringItem.institution_name);
    if (!matchInst) continue;

    const matchSite = (candidate.site_id && retiringItem.site_id)
      ? Number(candidate.site_id) === Number(retiringItem.site_id)
      : nStr(candidate.site_name) === nStr(retiringItem.site_name);
    if (!matchSite) continue;

    if (nStr(candidate.modality) !== nStr(retiringItem.modality)) continue;
    if (nStr(candidate.operational_position) !== nStr(retiringItem.operational_position)) continue;

    const candidateNovs = novsByItem.get(Number(candidate.id)) || [];
    const ingresoNov = candidateNovs.find((nv) => nv.novelty_type === "FECHA_INGRESO");
    if (ingresoNov) return { item: candidate, nov: ingresoNov };
  }
  return null;
}

function computeSocialSecurityDays(filteredItems, allNovelties, allGroupItems) {
  const PERIOD = 30;

  // Index ALL novelties by payroll_item_id (numeric key)
  const novsByItem = new Map();
  for (const nov of allNovelties) {
    const key = Number(nov.payroll_item_id);
    if (!key) continue;
    if (!novsByItem.has(key)) novsByItem.set(key, []);
    novsByItem.get(key).push(nov);
  }

  return filteredItems.map((item) => {
    const itemNovs  = novsByItem.get(Number(item.id)) || [];
    const retiroNov   = itemNovs.find((nv) => nv.novelty_type === "FECHA_RETIRO");
    const ingresoNov  = itemNovs.find((nv) => nv.novelty_type === "FECHA_INGRESO");
    const corrSsNov   = itemNovs.find((nv) => nv.novelty_type === "CORRECCION_SEGURIDAD_SOCIAL");

    let ssDays               = PERIOD;
    let retirementReason     = null;
    let requiresReplacement  = null;
    let replacementFound     = null;
    let replacementEmpName   = null;
    let replacementEmpId     = null;

    if (retiroNov) {
      retirementReason = retiroNov.retirement_reason || null;
      const dateStr  = String(retiroNov.end_date || retiroNov.start_date || "").slice(0, 10);
      const retiroDay = dateStr ? new Date(dateStr + "T00:00:00Z").getUTCDate() : PERIOD;

      if (retirementReason === "disminucion_cupos") {
        requiresReplacement = false;
        ssDays = retiroDay;
      } else if (retirementReason === "renuncia" || retirementReason === "terminacion_contrato") {
        requiresReplacement = true;
        const repl = findReplacementForRetiro(item, allGroupItems, novsByItem);
        if (repl) {
          replacementFound  = true;
          replacementEmpName = repl.item.employee_name;
          replacementEmpId  = repl.item.employee_id;
          const ingrStr = String(repl.nov.start_date || "").slice(0, 10);
          const ingresoDay = ingrStr ? new Date(ingrStr + "T00:00:00Z").getUTCDate() : retiroDay + 1;
          ssDays = ingresoDay > retiroDay + 1 ? ingresoDay - 1 : retiroDay;
        } else {
          replacementFound = false;
          ssDays = retiroDay;
        }
      } else {
        // Sin motivo especificado: tratar como sin reemplazo
        requiresReplacement = false;
        ssDays = retiroDay;
      }
    } else if (ingresoNov) {
      const ingrStr = String(ingresoNov.start_date || "").slice(0, 10);
      const ingresoDay = ingrStr ? new Date(ingrStr + "T00:00:00Z").getUTCDate() : 1;
      ssDays = Math.max(1, PERIOD - ingresoDay + 1);
    }

    // CORRECCION_SEGURIDAD_SOCIAL: reemplaza la fecha de ingreso para el cálculo SS
    // sin afectar días laborados, salario ni ninguna otra deducción.
    // Solo aplica cuando NO hay FECHA_RETIRO (el retiro es siempre la fecha dominante en SS).
    if (corrSsNov && !retiroNov) {
      const corrStr  = String(corrSsNov.start_date || "").slice(0, 10);
      const corrDay  = corrStr ? new Date(corrStr + "T00:00:00Z").getUTCDate() : 1;
      ssDays = Math.max(1, PERIOD - corrDay + 1);
    }

    if (retiroNov || ingresoNov || corrSsNov) {
      console.log("[payroll social security days]", {
        employeeId:            item.employee_id,
        employeeName:          item.employee_name,
        noveltyType:           retiroNov ? "FECHA_RETIRO" : ingresoNov ? "FECHA_INGRESO" : "CORRECCION_SEGURIDAD_SOCIAL",
        retirementDate:        retiroNov ? (retiroNov.end_date || retiroNov.start_date) : null,
        retirementReason,
        requiresReplacement,
        replacementEmployeeId:   replacementEmpId,
        replacementEmployeeName: replacementEmpName,
        replacementEntryDate:  retiroNov && replacementFound
          ? (findReplacementForRetiro(item, allGroupItems, novsByItem)?.nov?.start_date || null) : null,
        corrSsDate:            corrSsNov ? corrSsNov.start_date : null,
        workedDays:            item.worked_days,
        socialSecurityDays:    ssDays,
      });
    }

    return {
      ...item,
      ss_days:                  ssDays,
      retirement_reason:        retirementReason,
      requires_replacement:     requiresReplacement,
      replacement_found:        replacementFound,
      replacement_employee_name: replacementEmpName,
      replacement_employee_id:  replacementEmpId,
    };
  });
}

// Tarifas externas fijas por categoría (NO usar salario interno / 30)
const TURN_TARIFFS_BY_OPERATIONAL_CATEGORY = Object.freeze({
  CAARES_TC: 119600,
  CAARES_MT: 71100,
  CAA1:      113200,
  CAA2:      85000,
  RI:        56700,
});

const TURN_TARIFF_CATEGORY_ALIASES = Object.freeze({
  CAARESTC: "CAARES_TC",
  CAARESMT: "CAARES_MT",
  CAARES1:  "CAARES_TC",
  CAARES2:  "CAARES_MT",
  CAARES3:  "CAARES_TC",
  CAARES4:  "CAARES_MT",
  CAA1:     "CAA1",
  CAA2:     "CAA2",
  RI:       "RI",
});

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS OFICIALES DE NOVEDAD (12 tipos canónicos de EMPIRIA)
// ─────────────────────────────────────────────────────────────────────────────
const OFFICIAL_NOVELTY_CODES = Object.freeze([
  "DIAS_NO_CLASE",
  "CITA_MEDICA",
  "INCAPACIDAD_MEDICA",
  "INCAPACIDAD_ACCIDENTE_LABORAL",
  "CALAMIDAD_FAMILIAR",
  "LUTO",
  "PERMISOS_NO_REMUNERADOS",
  "CITACIONES_OFICIALES",
  "LICENCIA_MATERNIDAD_PATERNIDAD",
  "SUSPENSION",
  "FECHA_INGRESO",
  "FECHA_RETIRO",
  "CITA_MEDICA_FAMILIAR",
  "CAMBIO_OPERATIVO_COBERTURA",
  "CORRECCION_SEGURIDAD_SOCIAL",
]);

// Novedades que reducen salario devengado (pro-rata días no pagados)
const SALARY_AFFECTING = new Set([
  "PERMISOS_NO_REMUNERADOS",
  "SUSPENSION",
  "FECHA_INGRESO",   // ajusta inicio del período
  "FECHA_RETIRO",    // ajusta fin del período
]);

// Novedades que reducen auxilio de transporte
const TRANSPORT_AFFECTING = new Set([
  "DIAS_NO_CLASE",
  "CITA_MEDICA",
  "CITA_MEDICA_FAMILIAR",
  "INCAPACIDAD_MEDICA",
  "INCAPACIDAD_ACCIDENTE_LABORAL",
  "CALAMIDAD_FAMILIAR",
  "LUTO",
  "CITACIONES_OFICIALES",
  "LICENCIA_MATERNIDAD_PATERNIDAD",
  "PERMISOS_NO_REMUNERADOS",
  "SUSPENSION",
]);

// Novedades que reducen recargos/adicionales
const ADDITIONAL_AFFECTING = new Set([
  "INCAPACIDAD_MEDICA",
  "INCAPACIDAD_ACCIDENTE_LABORAL",
  "CALAMIDAD_FAMILIAR",
  "LUTO",
  "LICENCIA_MATERNIDAD_PATERNIDAD",
  "PERMISOS_NO_REMUNERADOS",
  "SUSPENSION",
  "CITA_MEDICA_FAMILIAR",
]);

// Novedades cuya duración puede abarcar más de un período de nómina.
// Solo tipos con rango de fechas explícito (start_date … end_date).
const CROSS_PERIOD_TYPES = new Set([
  "INCAPACIDAD_MEDICA",
  "INCAPACIDAD_ACCIDENTE_LABORAL",
  "PERMISOS_NO_REMUNERADOS",
  "SUSPENSION",
  "LICENCIA_MATERNIDAD_PATERNIDAD",
  "CALAMIDAD_FAMILIAR",
]);

// Documentos de soporte requeridos por tipo de novedad
const SUPPORT_REQUIREMENTS = Object.freeze({
  CITA_MEDICA:                    ["COMPROBANTE_CITA_MEDICA"],
  CITA_MEDICA_FAMILIAR:           ["COMPROBANTE_CITA_MEDICA"],
  INCAPACIDAD_MEDICA:             ["HISTORIA_CLINICA", "INCAPACIDAD_MEDICA_DOC"],
  INCAPACIDAD_ACCIDENTE_LABORAL:  ["HISTORIA_CLINICA", "INCAPACIDAD_MEDICA_DOC"],
  PERMISOS_NO_REMUNERADOS:        ["AUTORIZACION_DESCUENTO"],
  CITACIONES_OFICIALES:           ["COMPROBANTE_CITACION"],
  CALAMIDAD_FAMILIAR:             ["COMPROBANTE_CALAMIDAD"],
  LUTO:                           ["ACTA_DEFUNCION"],
  LICENCIA_MATERNIDAD_PATERNIDAD: ["HISTORIA_CLINICA", "INCAPACIDAD_MEDICA_DOC"],
  DIAS_NO_CLASE:                  [],
  SUSPENSION:                     [],
  FECHA_INGRESO:                  [],
  FECHA_RETIRO:                   [],
  CORRECCION_SEGURIDAD_SOCIAL:    [],
});

const SUPPORT_TYPE_LABELS = Object.freeze({
  COMPROBANTE_CITA_MEDICA:  "Comprobante de asistencia a la cita",
  HISTORIA_CLINICA:         "Historia Clínica",
  INCAPACIDAD_MEDICA_DOC:   "Incapacidad Médica",
  INCAPACIDAD_MEDICA:       "Incapacidad Médica",
  AUTORIZACION_DESCUENTO:   "Autorización de Descuento",
  COMPROBANTE_CITACION:     "Soporte de Citación",
  COMPROBANTE_ASISTENCIA:   "Soporte de Citación",
  COMPROBANTE_CALAMIDAD:    "Soporte de la Calamidad",
  ACTA_DEFUNCION:           "Acta de Defunción",
  CEDULA_CIUDADANIA:        "Cédula de Ciudadanía",
  CUENTA_COBRO:             "Cuenta de Cobro",
  CERTIFICACION_BANCARIA:   "Certificación Bancaria",
});

const MEDICAL_INCAPACITY_TYPES = new Set([
  "INCAPACIDAD_MEDICA",
  "INCAPACIDAD_ACCIDENTE_LABORAL",
]);

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────
function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function id(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function norm(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeCategoryLabel(value) {
  return norm(value)
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCategoryLabel(value) {
  return normalizeCategoryLabel(value).replace(/\s+/g, "");
}

function hasCategoryWord(value, word) {
  return normalizeCategoryLabel(value).split(" ").filter(Boolean).includes(String(word || "").toUpperCase());
}

function isOperario(position) {
  return norm(position) === norm(OPERARIO_POSITION);
}

function normalizeOperationalPayrollItem(item) {
  if (!item || typeof item !== "object") return item;

  const baseSalary = n(item.base_salary);
  const totalDevengado = n(item.total_devengado);
  const deduccionSalud = calculatePayrollDeductionBase(baseSalary);
  const deduccionPension = calculatePayrollDeductionBase(baseSalary);
  const calc = item.calculation && typeof item.calculation === "object" ? item.calculation : {};
  const turnCoverDiscount = n(calc.turn_cover_discount);
  const totalDeducciones = deduccionSalud + deduccionPension + turnCoverDiscount;
  const netoPagar = Math.max(0, totalDevengado - totalDeducciones);

  // display_worked_days: si ya fue calculado y guardado en el snapshot de cálculo, usarlo.
  // Si no (items calculados antes de esta versión), derivarlo de worked_days - salary_discount_days.
  const displayWorkedDays = calc.display_worked_days != null
    ? n(calc.display_worked_days)
    : Math.max(0, n(calc.worked_days || item.worked_days || 30) - n(calc.salary_discount_days || 0));

  const calculation = {
    ...calc,
    deduccion_salud:     deduccionSalud,
    deduccion_pension:   deduccionPension,
    turn_cover_discount: turnCoverDiscount,
    display_worked_days: displayWorkedDays,
  };

  return {
    ...item,
    total_deducciones:   totalDeducciones,
    neto_pagar:          netoPagar,
    display_worked_days: displayWorkedDays,
    calculation,
  };
}

function isMedicalIncapacity(code) {
  return MEDICAL_INCAPACITY_TYPES.has(text(code).toUpperCase());
}

function validateTurnTariffCatalog() {
  const expected = {
    CAARES_TC: 119600,
    CAARES_MT: 71100,
    CAA1:      113200,
    CAA2:      85000,
    RI:        56700,
  };

  for (const [category, amount] of Object.entries(expected)) {
    if (TURN_TARIFFS_BY_OPERATIONAL_CATEGORY[category] !== amount) {
      throw new Error(`Catalogo de tarifas de turnos invalido para ${category}`);
    }
  }

  const seenAmounts = new Map();
  for (const [category, amount] of Object.entries(TURN_TARIFFS_BY_OPERATIONAL_CATEGORY)) {
    if (seenAmounts.has(amount)) {
      throw new Error(`Tarifa duplicada entre categorias operativas: ${seenAmounts.get(amount)} y ${category}`);
    }
    seenAmounts.set(amount, category);
  }
}

function resolveTurnTariffCategory(source = {}, { strict = false } = {}) {
  const salaryCategory = text(source.salary_category || source.salaryCategory);
  const modality = text(source.modality);
  const workTimeType = text(source.work_time_type || source.workTimeType);

  const directCategory = TURN_TARIFF_CATEGORY_ALIASES[compactCategoryLabel(salaryCategory)];
  if (directCategory) return directCategory;

  if (hasCategoryWord(salaryCategory, "RI") || hasCategoryWord(modality, "RI")) {
    return "RI";
  }

  if (hasCategoryWord(salaryCategory, "CAARES") || hasCategoryWord(modality, "CAARES")) {
    return workTimeKind(salaryCategory || workTimeType || modality) === "MT" ? "CAARES_MT" : "CAARES_TC";
  }

  if (hasCategoryWord(salaryCategory, "CAA") || hasCategoryWord(modality, "CAA")) {
    return workTimeKind(salaryCategory || workTimeType || modality) === "MT" ? "CAA2" : "CAA1";
  }

  if (strict) {
    throw new Error(
      `No se pudo resolver la categoria operativa del turno desde salary_category="${salaryCategory}" modalidad="${modality}" jornada="${workTimeType}".`
    );
  }

  return null;
}

function getTurnTariffDailyValue(source = {}, options = {}) {
  const operationalCategory = resolveTurnTariffCategory(source, options);
  return operationalCategory ? n(TURN_TARIFFS_BY_OPERATIONAL_CATEGORY[operationalCategory]) : 0;
}

validateTurnTariffCatalog();

// ─────────────────────────────────────────────────────────────────────────────
// RECORTE DE NOVEDADES AL PERÍODO (cross-period clipping)
// Cuando una novedad tiene start_date..end_date que cruza el límite del período,
// solo se deben contar los días que caen dentro del período actual.
// Ejemplo: Incapacidad 25/05→03/06 → Mayo: 6 días | Junio: 3 días.
// Las continuaciones (is_continuation=true) ya traen los días correctos almacenados.
// ─────────────────────────────────────────────────────────────────────────────
function clipNoveltiesByPeriod(novelties, periodStart, periodEnd) {
  if (!periodStart || !periodEnd || !Array.isArray(novelties)) return novelties;
  const pStartMs = new Date(periodStart + "T00:00:00Z").getTime();
  const pEndMs   = new Date(periodEnd   + "T00:00:00Z").getTime();

  return novelties.map((nov) => {
    const nStartStr = String(nov.start_date || "").slice(0, 10);
    const nEndStr   = String(nov.end_date   || "").slice(0, 10);

    // Novedades de un solo día o sin rango de fechas: no necesitan recorte
    if (!nStartStr || !nEndStr || nStartStr === nEndStr) return nov;

    const nStartMs = new Date(nStartStr + "T00:00:00Z").getTime();
    const nEndMs   = new Date(nEndStr   + "T00:00:00Z").getTime();

    // Sin solapamiento con el período (caso edge, no debería ocurrir con los filtros actuales)
    if (nEndMs < pStartMs || nStartMs > pEndMs) {
      return { ...nov, days: 0, period_days: 0, original_days: Number(nov.days || 0) };
    }

    // Intersección con el período
    const clippedStartMs = Math.max(nStartMs, pStartMs);
    const clippedEndMs   = Math.min(nEndMs,   pEndMs);
    const periodDays     = Math.max(0, Math.round((clippedEndMs - clippedStartMs) / 86400000) + 1);
    const originalDays   = Number(nov.days || 0);

    // Si los días ya son correctos (continuación ya recortada), solo agregar metadato
    if (periodDays === originalDays) {
      return { ...nov, period_days: originalDays, original_days: originalDays };
    }

    // Devolver con days = días del período y original_days = total almacenado
    return { ...nov, days: periodDays, period_days: periodDays, original_days: originalDays };
  });
}

// Tarifas fijas diarias para turnos EXTERNOS por categoría salarial.
// NO usar fórmula proporcional interna (salario/30) para externos.
function getExternalCoverDailyValue(category) {
  return getTurnTariffDailyValue({ salary_category: category }, { strict: true });
}

function resolveOfficialExternalTurnAmounts(row = {}) {
  const quantity = n(row.covered_days ?? row.days ?? row.novelty_days ?? row.nov_days ?? 0);
  const storedValuePerDay = n(row.value_per_day ?? row.calculated_day_value);
  const storedTotalValue = n(row.total_value);
  const fallback = {
    tariff_category: "",
    quantity,
    value_per_day: storedValuePerDay,
    total_value: storedTotalValue || (quantity * storedValuePerDay),
  };

  if (norm(row.cover_type || "") !== "EXTERNA") return fallback;

  try {
    const source = {
      salary_category: row.origin_category || row.origin_salary_category || row.covered_salary_category || row.salary_category,
      modality: row.modality || row.work_modality || row.origin_modality,
      work_time_type: row.work_time_type || row.origin_work_time_type || row.workTimeType,
    };
    const tariffCategory = resolveTurnTariffCategory(source, { strict: true });
    const valuePerDay = getTurnTariffDailyValue(source, { strict: true });
    return {
      tariff_category: tariffCategory,
      quantity,
      value_per_day: valuePerDay,
      total_value: quantity * valuePerDay,
    };
  } catch {
    return fallback;
  }
}

function applyOfficialExternalTurnAmounts(row = {}) {
  const official = resolveOfficialExternalTurnAmounts(row);
  return {
    ...row,
    tariff_category: official.tariff_category || row.tariff_category || "",
    covered_days: official.quantity,
    days: row.days ?? official.quantity,
    calculated_day_value: official.value_per_day,
    value_per_day: official.value_per_day,
    total_value: official.total_value,
    official_value_per_day: official.value_per_day,
    official_total_value: official.total_value,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZACIÓN DE TIPO DE NOVEDAD
// Convierte labels visibles o variantes al código canónico oficial.
// ─────────────────────────────────────────────────────────────────────────────
const _NOVELTY_LABEL_MAP = {
  "DIAS NO CLASE":                      "DIAS_NO_CLASE",
  "DIAS DE NO CLASE":                   "DIAS_NO_CLASE",
  "DIA NO CLASE":                       "DIAS_NO_CLASE",
  "DIA DE NO CLASE":                    "DIAS_NO_CLASE",
  "CITA MEDICA":                        "CITA_MEDICA",
  "INCAPACIDAD MEDICA":                 "INCAPACIDAD_MEDICA",
  "INCAPACIDAD POR ACCIDENTE LABORAL":  "INCAPACIDAD_ACCIDENTE_LABORAL",
  "INCAPACIDAD ACCIDENTE LABORAL":      "INCAPACIDAD_ACCIDENTE_LABORAL",
  "ACCIDENTE LABORAL":                  "INCAPACIDAD_ACCIDENTE_LABORAL",
  "CALAMIDAD FAMILIAR":                 "CALAMIDAD_FAMILIAR",
  "LUTO":                               "LUTO",
  "PERMISOS NO REMUNERADOS":            "PERMISOS_NO_REMUNERADOS",
  "PERMISO NO REMUNERADO":              "PERMISOS_NO_REMUNERADOS",
  "CITACION COLEGIO":                   "CITACIONES_OFICIALES",
  "CITACION EN COLEGIO":                "CITACIONES_OFICIALES",
  "CITACIONES OFICIALES":               "CITACIONES_OFICIALES",
  "CITACION OFICIAL":                   "CITACIONES_OFICIALES",
  "LICENCIA MATERNIDAD PATERNIDAD":     "LICENCIA_MATERNIDAD_PATERNIDAD",
  "LICENCIA DE MATERNIDAD PATERNIDAD":  "LICENCIA_MATERNIDAD_PATERNIDAD",
  "LICENCIA MATERNIDAD":                "LICENCIA_MATERNIDAD_PATERNIDAD",
  "SUSPENSION":                         "SUSPENSION",
  "FECHA INGRESO":                      "FECHA_INGRESO",
  "FECHA DE INGRESO":                   "FECHA_INGRESO",
  "FECHA RETIRO":                       "FECHA_RETIRO",
  "FECHA DE RETIRO":                    "FECHA_RETIRO",
  "CAMBIO OPERATIVO COBERTURA":         "CAMBIO_OPERATIVO_COBERTURA",
  "CAMBIO OPERATIVO DE COBERTURA":      "CAMBIO_OPERATIVO_COBERTURA",
  "CORRECCION SEGURIDAD SOCIAL":        "CORRECCION_SEGURIDAD_SOCIAL",
  "CORRECCION DE SEGURIDAD SOCIAL":     "CORRECCION_SEGURIDAD_SOCIAL",
  "CORRECCION SS":                      "CORRECCION_SEGURIDAD_SOCIAL",
};

function normalizeNoveltyType(raw) {
  const v = text(raw);
  // Try direct code match first (underscore-separated, accent-insensitive)
  const asCode = norm(v).replace(/\s+/g, "_");
  if (OFFICIAL_NOVELTY_CODES.includes(asCode)) return asCode;
  // Try label match (replace underscores with spaces, strip accents)
  const asLabel = norm(v).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (_NOVELTY_LABEL_MAP[asLabel]) return _NOVELTY_LABEL_MAP[asLabel];
  throw new Error(
    `Tipo de novedad no válido: "${v}". Use uno de: ${OFFICIAL_NOVELTY_CODES.filter((c) => c !== "CAMBIO_OPERATIVO_COBERTURA").join(", ")}`
  );
}

function workTimeKind(value) {
  const v = norm(value);
  if (["MT", "MEDIO TIEMPO", "MEDIA JORNADA", "HALF TIME"].some((x) => v.includes(x))) return "MT";
  return "TC";
}

function statusIsActive(value) {
  const v = norm(value);
  return !["RETIRADO", "RETIRADA", "INACTIVO", "INACTIVA"].includes(v);
}

async function upsertLaborDateNovelty(db, item, novelty, userId = null) {
  if (!item?.id || !novelty?.novelty_type || !novelty.start_date) return null;
  const observations = novelty.novelty_type === "FECHA_RETIRO"
    ? "Novedad de retiro sincronizada desde Personal"
    : "Novedad de ingreso sincronizada desde Personal";

  const existingWhere = novelty.novelty_type === "FECHA_RETIRO"
    ? `payroll_period_id = $1 AND employee_id = $2 AND novelty_type = 'FECHA_RETIRO'`
    : `payroll_item_id = $1 AND employee_id = $2 AND novelty_type = $8`;
  const { rows: existing } = await db.query(
    `UPDATE payroll_novelties
        SET payroll_item_id = $3,
            start_date = $4::date,
            end_date = $5::date,
            days = $6,
            observations = $7,
            description = $7,
            extra_data = COALESCE(extra_data, '{}'::jsonb) || $9::jsonb,
            updated_at = NOW()
      WHERE ${existingWhere}
      RETURNING *`,
    [
      novelty.novelty_type === "FECHA_RETIRO" ? item.period_id : item.id,
      item.employee_id,
      item.id,
      novelty.start_date,
      novelty.end_date,
      novelty.days,
      observations,
      novelty.novelty_type,
      JSON.stringify({ source: novelty.source || "PERSONAL", synced_at: new Date().toISOString() }),
    ]
  );
  if (existing[0]) return existing[0];

  const { rows } = await db.query(
    `INSERT INTO payroll_novelties (
       payroll_item_id, payroll_period_id, employee_id, employee_name, document_number,
       company_id, contract_id, municipality_id, institution_id, site_id,
       operational_position, novelty_type, start_date, end_date, days,
       value, observations, description, support_required, support_status, status,
       extra_data, created_by_user_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             0,$16,$16,false,'aprobado','PENDIENTE',$17,$18)
     RETURNING *`,
    [
      item.id, item.period_id, item.employee_id, item.employee_name, item.document_number,
      item.company_id, item.contract_id, item.municipality_id, item.institution_id, item.site_id,
      item.operational_position, novelty.novelty_type, novelty.start_date, novelty.end_date, novelty.days,
      observations,
      JSON.stringify({ source: novelty.source || "PERSONAL", synced_at: new Date().toISOString() }),
      id(userId),
    ]
  );
  return rows[0] || null;
}

async function syncRetirementToEmployee(employeeId, retirementDate, userId = null, db = pool) {
  const cleanDate = dateOnly(retirementDate);
  if (!employeeId || !cleanDate) return null;

  const { rows: empRows } = await db.query(
    `SELECT id, labor_start_date, start_date, coverage_start_date, labor_end_date, status
       FROM employees
      WHERE id = $1
      LIMIT 1`,
    [employeeId]
  );
  const employee = empRows[0];
  if (!employee) return null;

  const start = getEmployeeLaborStartDate(employee);
  if (start && cleanDate < start) {
    const err = new Error("La fecha de retiro no puede ser anterior a la fecha de ingreso.");
    err.httpStatus = 400;
    throw err;
  }

  const { rows } = await db.query(
    `UPDATE employees
        SET labor_end_date = $2::date,
            employment_status = 'RETIRADO',
            status = CASE
              WHEN UPPER(BTRIM(COALESCE(status, ''))) IN ('ACTIVO','PREINGRESO','REGISTRO INCOMPLETO') THEN 'RETIRADO'
              ELSE status
            END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, labor_end_date, status`,
    [employeeId, cleanDate]
  );

  try {
    await db.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, payload)
       VALUES ('payroll', 'employee', $1, 'SYNC_RETIREMENT_FROM_PAYROLL', $2, $3)`,
      [String(employeeId), id(userId), JSON.stringify({ retirement_date: cleanDate })]
    );
  } catch (_) {
    // auditoria best-effort
  }

  return rows[0] || null;
}

function pendingNoveltySupportSql(noveltyAlias = "pn") {
  return `COALESCE(${noveltyAlias}.support_required, false) = true
    AND (
      NOT EXISTS (
        SELECT 1
          FROM novelty_supports ns_missing
         WHERE ns_missing.novelty_id = ${noveltyAlias}.id
      )
      OR EXISTS (
        SELECT 1
          FROM novelty_supports ns_pending
         WHERE ns_pending.novelty_id = ${noveltyAlias}.id
           AND COALESCE(ns_pending.required, true) = true
           AND ns_pending.status <> 'aprobado'
      )
    )`;
}

async function syncNoveltySupportStatus(noveltyId, db = pool) {
  const noveltyDbId = id(noveltyId);
  if (!noveltyDbId) return null;

  const { rows } = await db.query(
    `WITH support_agg AS (
       SELECT
         COUNT(*) FILTER (WHERE COALESCE(required, true))::int                        AS required_count,
         COUNT(*) FILTER (WHERE COALESCE(required, true) AND status = 'aprobado')::int AS approved_required_count,
         BOOL_OR(COALESCE(required, true) AND status = 'rechazado')                   AS has_rejected,
         BOOL_OR(COALESCE(required, true) AND status IN ('cargado', 'aprobado'))     AS has_uploaded
         FROM novelty_supports
        WHERE novelty_id = $1
     )
     UPDATE payroll_novelties pn
        SET support_status = CASE
          WHEN COALESCE(pn.support_required, false) = false THEN 'aprobado'
          WHEN COALESCE(sa.required_count, 0) = 0 THEN 'pendiente'
          WHEN COALESCE(sa.approved_required_count, 0) = COALESCE(sa.required_count, 0) THEN 'aprobado'
          WHEN COALESCE(sa.has_rejected, false) THEN 'rechazado'
          WHEN COALESCE(sa.has_uploaded, false) THEN 'cargado'
          ELSE 'pendiente'
        END,
        updated_at = NOW()
       FROM support_agg sa
      WHERE pn.id = $1
      RETURNING pn.*`,
    [noveltyDbId]
  );

  return rows[0] || null;
}

async function listSupportRows(filters = {}) {
  const values = [];
  const supportWhere = [];
  const noveltyWhere = [];

  if (filters.periodId) {
    values.push(id(filters.periodId));
    supportWhere.push(`ns.payroll_period_id = $${values.length}`);
    noveltyWhere.push(`pn.payroll_period_id = $${values.length}`);
  }
  if (filters.municipalityId) {
    values.push(id(filters.municipalityId));
    // Usar pn.municipality_id (de la novedad) en lugar de COALESCE(ns.municipality_id, pn.municipality_id).
    // Si el registro de novelty_supports tiene un municipality_id incorrecto, el COALESCE
    // lo usaría antes que el correcto de la novedad, excluyendo la fila indebidamente.
    // Filtrar siempre por el municipio de la novedad es más robusto.
    supportWhere.push(`pn.municipality_id = $${values.length}`);
    noveltyWhere.push(`pn.municipality_id = $${values.length}`);
  }
  if (filters.groupId) {
    values.push(id(filters.groupId));
    supportWhere.push(`pn.payroll_item_id IN (SELECT id FROM payroll_items WHERE group_id = $${values.length})`);
    noveltyWhere.push(`pn.payroll_item_id IN (SELECT id FROM payroll_items WHERE group_id = $${values.length})`);
  }
  if (filters.status) {
    values.push(text(filters.status));
    supportWhere.push(`ns.status = $${values.length}`);
    noveltyWhere.push(`$${values.length} = 'pendiente'`);
  }

  const supportClause = supportWhere.length ? `WHERE ${supportWhere.join(" AND ")}` : "";
  const noveltyClause = noveltyWhere.length ? ` AND ${noveltyWhere.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT sup.*,
            m.name AS municipality_name,
            u.username AS reviewed_by_name
       FROM (
         SELECT
           pn.id AS novelty_id,
           ns.id AS id,
           ns.id AS support_id,
           COALESCE(pn.employee_name, '') AS employee_name,
           COALESCE(pn.document_number, '') AS document_number,
           pn.novelty_type,
           COALESCE(ns.status, 'pendiente') AS status,
           COALESCE(ns.status, 'pendiente') AS support_status,
           COALESCE(ns.municipality_id, pn.municipality_id) AS municipality_id,
           COALESCE(pn.start_date, pn.end_date, pn.created_at::date) AS novelty_date,
           COALESCE(ns.support_type, '') AS support_type,
           COALESCE(ns.file_name, '') AS file_name,
           COALESCE(ns.file_url, '') AS file_url,
           COALESCE(ns.observations, pn.observations, pn.description, '') AS observations,
           ns.reviewed_by,
           ns.reviewed_at,
           COALESCE(pi.institution_name, '') AS institution_name,
           ns.created_at,
           ns.updated_at,
           'support'::text AS row_source
          FROM novelty_supports ns
          JOIN payroll_novelties pn ON pn.id = ns.novelty_id
          LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
          ${supportClause}

         UNION ALL

         SELECT
           pn.id AS novelty_id,
           NULL::integer AS id,
           NULL::integer AS support_id,
           COALESCE(pn.employee_name, '') AS employee_name,
           COALESCE(pn.document_number, '') AS document_number,
           pn.novelty_type,
           'pendiente'::text AS status,
           'pendiente'::text AS support_status,
           pn.municipality_id AS municipality_id,
           COALESCE(pn.start_date, pn.end_date, pn.created_at::date) AS novelty_date,
           ''::text AS support_type,
           ''::text AS file_name,
           ''::text AS file_url,
           COALESCE(pn.observations, pn.description, '') AS observations,
           NULL::integer AS reviewed_by,
           NULL::timestamptz AS reviewed_at,
           COALESCE(pi.institution_name, '') AS institution_name,
           pn.created_at,
           pn.updated_at,
           'novelty'::text AS row_source
          FROM payroll_novelties pn
          LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
         WHERE COALESCE(pn.support_required, false) = true
           AND NOT EXISTS (
             SELECT 1
               FROM novelty_supports ns_existing
              WHERE ns_existing.novelty_id = pn.id
           )
           ${noveltyClause}
       ) sup
       LEFT JOIN municipalities m ON m.id = sup.municipality_id
       LEFT JOIN users u ON u.id = sup.reviewed_by
      ORDER BY sup.novelty_date DESC NULLS LAST,
               UPPER(sup.employee_name),
               sup.novelty_id DESC,
               sup.support_id DESC NULLS LAST`,
    values
  );

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASIFICACIÓN POR CATEGORÍA SALARIAL (basada en site_id, no en texto)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Clasifica un empleado en su categoría salarial interna:
 * CAA1, CAA2, CAARES1, CAARES2, CAARES3, CAARES4, RI
 *
 * La clasificación CAARES depende del número de TCs en la misma sede+modalidad.
 * Se usa site_id (no texto) para contar peers correctamente.
 */
function classifySiteModality(employee, allPeriodEmployees) {
  const mod  = normalizeCategoryLabel(employee.modality);
  const wtk  = workTimeKind(employee.work_time_type);
  const siteId = employee.site_id;

  if (hasCategoryWord(mod, "RI")) return "RI";

  if (hasCategoryWord(mod, "CAARES")) {
    // Contar TC en misma sede con modalidad CAARES (usando site_id)
    const peersCAARES = allPeriodEmployees.filter((p) => {
      const pm = normalizeCategoryLabel(p.modality);
      return (
        p.site_id === siteId &&
        hasCategoryWord(pm, "CAARES")
      );
    });
    const tcCount = peersCAARES.filter((p) => workTimeKind(p.work_time_type) === "TC").length;

    if (wtk === "TC") return tcCount <= 1 ? "CAARES1" : "CAARES3";
    return tcCount <= 1 ? "CAARES2" : "CAARES4";
  }

  if (hasCategoryWord(mod, "CAA")) {
    return wtk === "TC" ? "CAA1" : "CAA2";
  }

  // Default — CAA si no reconoce la modalidad
  return wtk === "TC" ? "CAA1" : "CAA2";
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN SALARIAL: DB → fallback archivo JSON
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Devuelve mapa { categoryCode → { base_salary, transport_allowance, other_recargos } }
 * Primero busca en payroll_salary_categories; si no hay filas usa payroll_config.json.
 */
/**
 * Prioridad de fuente salarial:
 *  1. payroll_salary_categories (configuración explícita por contrato)
 *  2. contract_settings.salary_config (Calculadora de Salario)
 *  3. payroll_config.json (fallback global)
 */
async function getSalaryCategories(contractId) {
  // ── Fuente 2: contract_settings.salary_config (Calculadora de Salario) ─
  // Se lee SIEMPRE porque es la fuente canónica de other_recargos/adicionales.
  const { rows: cfgRows } = await pool.query(
    `SELECT COALESCE(salary_config, '{}'::jsonb) AS salary_config
       FROM contract_settings
      WHERE contract_id = $1`,
    [contractId]
  );
  const salCfg     = cfgRows[0]?.salary_config || {};
  const modalities = salCfg.modalities || {};
  const auxTransporte = Number(salCfg.aux_transporte || salCfg.transportAllowance || 0);

  // Construir mapa base desde la Calculadora (other_recargos viene de adicionales)
  const fromCalculator = {};
  for (const [code, v] of Object.entries(modalities)) {
    if (!v || Number(v.salary) <= 0) continue;
    const adicionales = Array.isArray(v.adicionales)
      ? v.adicionales.reduce((s, a) => s + Number(a.value || 0), 0)
      : 0;
    fromCalculator[code] = {
      base_salary:         Number(v.salary),
      transport_allowance: auxTransporte,
      other_recargos:      adicionales,
    };
  }

  // ── Fuente 1: tabla payroll_salary_categories (anula base + transporte si existe) ─
  // other_recargos de esta tabla solo se usa si es explícitamente > 0 (override intencional).
  const { rows } = await pool.query(
    `SELECT category_code, base_salary, transport_allowance, other_recargos
       FROM payroll_salary_categories
      WHERE contract_id = $1 AND active = true`,
    [contractId]
  );

  if (rows.length > 0) {
    return Object.fromEntries(
      rows.map((r) => {
        const code = r.category_code;
        // other_recargos: si la tabla tiene valor > 0, úsalo; si no, tomar de Calculadora
        const recargosFromTable = Number(r.other_recargos);
        const recargosFromCalc  = fromCalculator[code]?.other_recargos ?? 0;
        return [
          code,
          {
            base_salary:         Number(r.base_salary),
            transport_allowance: Number(r.transport_allowance),
            other_recargos:      recargosFromTable > 0 ? recargosFromTable : recargosFromCalc,
          },
        ];
      })
    );
  }

  // ── Fuente 2 como resultado directo si no hay filas en Fuente 1 ───────
  if (Object.keys(fromCalculator).length > 0) {
    return fromCalculator;
  }

  // ── Fuente 3: payroll_config.json ────────────────────────────────────
  const cfg = getPayrollConfig();
  const sal  = cfg.modalitySalaries || {};
  return Object.fromEntries(
    Object.entries(sal).map(([code, base]) => [
      code,
      {
        base_salary:         Number(base),
        transport_allowance: Number(cfg.transportAllowance || 0),
        other_recargos:      0,
      },
    ])
  );
}

async function upsertSalaryCategory(contractId, categoryCode, values) {
  const { rows } = await pool.query(
    `INSERT INTO payroll_salary_categories
       (contract_id, category_code, base_salary, transport_allowance, other_recargos, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (contract_id, category_code) DO UPDATE SET
       base_salary         = EXCLUDED.base_salary,
       transport_allowance = EXCLUDED.transport_allowance,
       other_recargos      = EXCLUDED.other_recargos,
       updated_at          = NOW()
     RETURNING *`,
    [
      contractId,
      String(categoryCode).toUpperCase(),
      n(values.base_salary),
      n(values.transport_allowance),
      n(values.other_recargos),
    ]
  );
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN SALARIAL INDIVIDUAL (Gestores, Auxiliares, Equipo Mínimo…)
// No aplica a OPERARIO MANIPULADOR DE ALIMENTOS.
// ─────────────────────────────────────────────────────────────────────────────
async function listEmployeeSalaryConfig(employeeId) {
  const { rows } = await pool.query(
    `SELECT epc.*, u.username AS created_by_name
       FROM employee_payroll_config epc
       LEFT JOIN users u ON u.id = epc.created_by
      WHERE epc.employee_id = $1
      ORDER BY epc.effective_date DESC, epc.id DESC`,
    [id(employeeId)]
  );
  return rows;
}

async function createEmployeeSalaryConfig(employeeId, payload = {}, userId) {
  const empId = id(employeeId);
  if (!empId) throw new Error("employeeId inválido");
  const effectiveDate = text(payload.effective_date || payload.effectiveDate || new Date().toISOString().slice(0, 10));
  if (!effectiveDate) throw new Error("effective_date es obligatorio");
  const { rows } = await pool.query(
    `INSERT INTO employee_payroll_config
       (employee_id, base_salary, transport_allowance, salary_type, effective_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      empId,
      n(payload.base_salary ?? payload.baseSalary),
      n(payload.transport_allowance ?? payload.transportAllowance ?? 0),
      text(payload.salary_type || payload.salaryType || "mensual"),
      effectiveDate,
      text(payload.notes || ""),
      id(userId),
    ]
  );
  return rows[0];
}

async function deleteEmployeeSalaryConfig(configId) {
  const cId = id(configId);
  if (!cId) throw new Error("configId inválido");
  const { rows } = await pool.query(
    `DELETE FROM employee_payroll_config WHERE id = $1 RETURNING *`,
    [cId]
  );
  if (!rows.length) throw Object.assign(new Error("Configuración no encontrada"), { httpStatus: 404 });
  return rows[0];
}

// Carga masiva de configs vigentes para un conjunto de empleados en una fecha dada.
// Usa DISTINCT ON para devolver solo la config más reciente por empleado.
async function getEmployeePayrollConfigs(employeeIds, periodStart) {
  if (!employeeIds.length || !periodStart) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (employee_id) *
       FROM employee_payroll_config
      WHERE employee_id = ANY($1::integer[])
        AND effective_date <= $2::date
      ORDER BY employee_id, effective_date DESC`,
    [employeeIds, periodStart]
  );
  return new Map(rows.map((r) => [String(r.employee_id), r]));
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS OFICIALES (desde DB)
// ─────────────────────────────────────────────────────────────────────────────
async function getOfficialNoveltyTypes() {
  const { rows } = await pool.query(
    `SELECT * FROM payroll_novelty_types WHERE active = true ORDER BY id`
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁLCULO DE MONTOS POR EMPLEADO (nuevo motor con tipos oficiales)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Fórmula base:
 *   valor_dia = (salario + transporte + otros) / 30
 *
 * Novedades que afectan SALARIO (PERMISOS_NO_REMUNERADOS, SUSPENSION):
 *   descuento_salario += (salario / 30) * dias_novedad
 *
 * Novedades FECHA_INGRESO / FECHA_RETIRO:
 *   Ajustan worked_days (pro-rata del período, no descuento directo)
 *
 * Novedades que afectan TRANSPORTE (resto de los 8 tipos):
 *   descuento_transporte += (transporte / 30) * dias_novedad
 *
 * Deducciones: 4% salud + 4% pensión sobre salario_base (sin descuentos de novedad)
 * Turnos cubiertos internos: se suman a otros_devengados del empleado que cubrió
 */
function calculateEmployeeAmounts(employee, salaryConfig, novelties = [], covers = []) {
  const sal = salaryConfig || { base_salary: 0, transport_allowance: 0, other_recargos: 0 };

  const fullBase      = n(sal.base_salary);
  const fullTransport = n(sal.transport_allowance);
  const fullOther     = n(sal.other_recargos);

  // ── Período: 30 días ──────────────────────────────────────────────────────
  let workedDays = 30;

  // FECHA_INGRESO: empezó en el período (días desde su ingreso hasta fin de mes)
  const ingresoNov = novelties.find((nov) => nov.novelty_type === "FECHA_INGRESO");
  if (ingresoNov && ingresoNov.start_date) {
    const day = new Date(ingresoNov.start_date).getUTCDate();
    workedDays = Math.max(1, Math.min(30, 30 - (day - 1)));
  }

  // FECHA_RETIRO: retirado en el período (días desde inicio hasta retiro)
  const retiroNov = novelties.find((nov) => nov.novelty_type === "FECHA_RETIRO");
  if (retiroNov && retiroNov.start_date) {
    const day = new Date(retiroNov.start_date).getUTCDate();
    workedDays = Math.max(1, Math.min(workedDays, day));
  }

  // ── Tarifas diarias ───────────────────────────────────────────────────────
  const dailySalary    = fullBase      / 30;
  const dailyTransport = fullTransport / 30;
  const dailyOther     = fullOther     / 30;

  // ── Base proporcional a días trabajados ───────────────────────────────────
  let baseSalary    = Math.round(dailySalary    * workedDays);
  let auxTransporte = Math.round(dailyTransport * workedDays);
  let otherEarnings = Math.round(dailyOther     * workedDays);

  // ── Descuentos por novedades que afectan SALARIO ─────────────────────────
  let salaryDiscount = 0;
  let salaryDiscountDays = 0;
  const salaryNoveltyDetail = [];

  for (const nov of novelties) {
    if (!SALARY_AFFECTING.has(nov.novelty_type)) continue;
    if (nov.novelty_type === "FECHA_INGRESO" || nov.novelty_type === "FECHA_RETIRO") continue; // ya ajustado vía workedDays
    const days   = Math.min(n(nov.days), workedDays);
    const amount = Math.round(dailySalary * days);
    salaryDiscount += amount;
    salaryDiscountDays += days;
    salaryNoveltyDetail.push({ code: nov.novelty_type, days, amount });
  }

  // ── Descuentos por novedades que afectan TRANSPORTE ──────────────────────
  let transportDiscount = 0;
  let transportDiscountDays = 0;
  const transportNoveltyDetail = [];

  for (const nov of novelties) {
    if (!TRANSPORT_AFFECTING.has(nov.novelty_type)) continue;
    const days   = Math.min(n(nov.days), workedDays);
    const amount = Math.round(dailyTransport * days);
    transportDiscount += amount;
    transportDiscountDays += days;
    transportNoveltyDetail.push({ code: nov.novelty_type, days, amount });
  }

  // ── Descuentos por novedades que afectan ADICIONALES (recargos) ─────────
  let otherDiscount = 0;
  const otherNoveltyDetail = [];
  for (const nov of novelties) {
    if (!ADDITIONAL_AFFECTING.has(nov.novelty_type)) continue;
    const days   = Math.min(n(nov.days), workedDays);
    const amount = Math.round(dailyOther * days);
    otherDiscount += amount;
    otherNoveltyDetail.push({ code: nov.novelty_type, days, amount });
  }

  // ── Coberturas internas (suman a este empleado si él cubrió a otro) ───────
  const internalCoverValue = covers
    .filter(
      (c) =>
        c.cover_type === "INTERNA" &&
        String(c.internal_employee_id) === String(employee.employee_id)
    )
    .reduce((sum, c) => sum + n(c.total_value), 0);
  const internalCoverDays = covers
    .filter(
      (c) =>
        c.cover_type === "INTERNA" &&
        String(c.internal_employee_id) === String(employee.employee_id)
    )
    .reduce((sum, c) => sum + n(c.days), 0);
  const coveredTurnDiscount = covers
    .filter((c) => String(c.affected_employee_id) === String(employee.employee_id))
    .reduce((sum, c) => sum + n(c.total_value), 0);
  const coveredTurnDiscountDays = covers
    .filter((c) => String(c.affected_employee_id) === String(employee.employee_id))
    .reduce((sum, c) => sum + n(c.days), 0);

  // ── Totales ───────────────────────────────────────────────────────────────
  const effectiveSalary    = Math.max(0, baseSalary    - salaryDiscount);
  const effectiveTransport = Math.max(0, auxTransporte - transportDiscount);
  const effectiveOther     = Math.max(0, otherEarnings - otherDiscount) + internalCoverValue;

  const totalDevengado = effectiveSalary + effectiveTransport + effectiveOther;

  // Deducciones: misma fórmula que Calculadora de Salario — ceil al 100 sobre salario efectivo
  const deduccionSalud   = calculatePayrollDeductionBase(effectiveSalary);
  const deduccionPension = calculatePayrollDeductionBase(effectiveSalary);
  const totalDeducciones = deduccionSalud + deduccionPension + coveredTurnDiscount;

  const netoPagar = Math.max(0, totalDevengado - totalDeducciones);

  const displayWorkedDays = Math.max(0, workedDays - salaryDiscountDays);

  return {
    base_salary:          effectiveSalary,
    transport_allowance:  effectiveTransport,
    other_earnings:       effectiveOther,
    total_devengado:      totalDevengado,
    total_deducciones:    totalDeducciones,
    neto_pagar:           netoPagar,
    worked_days:          workedDays,
    display_worked_days:  displayWorkedDays,
    calculation: {
      salary_category:         employee.salary_category || "",
      worked_days:             workedDays,
      display_worked_days:     displayWorkedDays,
      full_base_salary:        fullBase,
      full_transport:          fullTransport,
      full_other:              fullOther,
      daily_salary:            dailySalary,
      daily_transport:         dailyTransport,
      daily_other:             dailyOther,
      other_recargos_value:    otherEarnings,
      salary_discount:         salaryDiscount,
      salary_discount_days:    salaryDiscountDays,
      salary_novelties:        salaryNoveltyDetail,
      transport_discount:      transportDiscount,
      transport_discount_days: transportDiscountDays,
      transport_novelties:     transportNoveltyDetail,
      other_discount:          otherDiscount,
      other_novelties:         otherNoveltyDetail,
      internal_cover_value:    internalCoverValue,
      replacement_amount:      internalCoverValue,
      replacement_days:        internalCoverDays,
      turn_cover_discount:     coveredTurnDiscount,
      turn_cover_discount_days: coveredTurnDiscountDays,
      deduccion_salud:         deduccionSalud,
      deduccion_pension:       deduccionPension,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁLCULO CON CAMBIO OPERATIVO DE COBERTURA (proporción de días)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Cuando existe una novedad CAMBIO_OPERATIVO_COBERTURA para el empleado,
 * el período de 30 días se divide en dos tramos:
 *   tramo original: días con categoría/condición anterior
 *   tramo nuevo:    días con la nueva categoría/condición
 *
 * Otras novedades de descuento se aplican proporcional al tramo correspondiente
 * (se descuentan del tramo original salvo que start_date caiga en el tramo nuevo).
 */
function calculateAmountsWithCambio(employee, salConfigOriginal, allNovelties, covers, cambioNov, salaryCategories) {
  const extra = (cambioNov.extra_data && typeof cambioNov.extra_data === "object")
    ? cambioNov.extra_data
    : {};

  const daysNew      = Math.max(1, Math.min(29, n(extra.days_new  || cambioNov.days || 15)));
  const daysOriginal = Math.max(1, 30 - daysNew);

  const newCatCode = text(extra.new_salary_category || "CAA1").toUpperCase();
  const salNew = salaryCategories[newCatCode] || { base_salary: 0, transport_allowance: 0, other_recargos: 0 };

  // ── Tarifas diarias para cada tramo ───────────────────────────────────────
  const dSalOrig  = n(salConfigOriginal.base_salary)         / 30;
  const dTransOrig= n(salConfigOriginal.transport_allowance) / 30;
  const dOtherOrig= n(salConfigOriginal.other_recargos)      / 30;

  const dSalNew   = n(salNew.base_salary)         / 30;
  const dTransNew = n(salNew.transport_allowance) / 30;
  const dOtherNew = n(salNew.other_recargos)      / 30;

  // ── Proporcional base ─────────────────────────────────────────────────────
  let baseOrig  = Math.round(dSalOrig   * daysOriginal);
  let transOrig = Math.round(dTransOrig * daysOriginal);
  let otherOrig = Math.round(dOtherOrig * daysOriginal);

  let baseNew   = Math.round(dSalNew   * daysNew);
  let transNew  = Math.round(dTransNew * daysNew);
  let otherNew  = Math.round(dOtherNew * daysNew);

  // ── Descuentos de otras novedades sobre tramo original ────────────────────
  // (Se asignan al tramo original por defecto; si start_date > daysOriginal → tramo nuevo)
  let salaryDiscount     = 0;
  let salaryDiscountDays = 0;
  let transportDiscount  = 0;
  const salaryNoveltyDetail    = [];
  const transportNoveltyDetail = [];

  for (const nov of allNovelties) {
    if (nov.novelty_type === "CAMBIO_OPERATIVO_COBERTURA") continue;
    if (nov.novelty_type === "FECHA_INGRESO" || nov.novelty_type === "FECHA_RETIRO") continue;

    const novDay = nov.start_date ? new Date(nov.start_date).getUTCDate() : 1;
    const inNewTranche = novDay > daysOriginal;
    const days = Math.min(n(nov.days), inNewTranche ? daysNew : daysOriginal);

    if (SALARY_AFFECTING.has(nov.novelty_type)) {
      const rate   = inNewTranche ? dSalNew : dSalOrig;
      const amount = Math.round(rate * days);
      salaryDiscount     += amount;
      salaryDiscountDays += days;
      salaryNoveltyDetail.push({ code: nov.novelty_type, days, amount });
    } else if (TRANSPORT_AFFECTING.has(nov.novelty_type)) {
      const rate   = inNewTranche ? dTransNew : dTransOrig;
      const amount = Math.round(rate * days);
      transportDiscount += amount;
      transportNoveltyDetail.push({ code: nov.novelty_type, days, amount });
    }
  }

  // ── Cobertura interna (este empleado cubrió a otro) ───────────────────────
  const internalCoverValue = covers
    .filter((c) => c.cover_type === "INTERNA" && String(c.internal_employee_id) === String(employee.employee_id))
    .reduce((sum, c) => sum + n(c.total_value), 0);
  const internalCoverDays = covers
    .filter((c) => c.cover_type === "INTERNA" && String(c.internal_employee_id) === String(employee.employee_id))
    .reduce((sum, c) => sum + n(c.days), 0);
  const coveredTurnDiscount = covers
    .filter((c) => String(c.affected_employee_id) === String(employee.employee_id))
    .reduce((sum, c) => sum + n(c.total_value), 0);
  const coveredTurnDiscountDays = covers
    .filter((c) => String(c.affected_employee_id) === String(employee.employee_id))
    .reduce((sum, c) => sum + n(c.days), 0);

  // ── Efectivos ─────────────────────────────────────────────────────────────
  const totalBase   = Math.max(0, (baseOrig  + baseNew)  - salaryDiscount);
  const totalTrans  = Math.max(0, (transOrig + transNew) - transportDiscount);
  const totalOther  = (otherOrig + otherNew) + internalCoverValue;
  const totalDevengado = totalBase + totalTrans + totalOther;

  const deduccionSalud   = calculatePayrollDeductionBase(totalBase);
  const deduccionPension = calculatePayrollDeductionBase(totalBase);
  const totalDeducciones = deduccionSalud + deduccionPension + coveredTurnDiscount;
  const netoPagar = Math.max(0, totalDevengado - totalDeducciones);

  const displayWorkedDaysCambio = Math.max(0, 30 - salaryDiscountDays);

  return {
    base_salary:          totalBase,
    transport_allowance:  totalTrans,
    other_earnings:       totalOther,
    total_devengado:      totalDevengado,
    total_deducciones:    totalDeducciones,
    neto_pagar:           netoPagar,
    worked_days:          30,
    display_worked_days:  displayWorkedDaysCambio,
    calculation: {
      salary_category:         employee.salary_category || "",
      worked_days:             30,
      display_worked_days:     displayWorkedDaysCambio,
      cambio_operativo:        true,
      original_category:       text(extra.original_salary_category || employee.salary_category),
      new_category:            newCatCode,
      days_original:           daysOriginal,
      days_new:                daysNew,
      base_original:           baseOrig,
      base_new:                baseNew,
      transport_original:      transOrig,
      transport_new:           transNew,
      other_original:          otherOrig,
      other_new:               otherNew,
      full_other:              otherOrig + otherNew,
      other_recargos_value:    otherOrig + otherNew,
      internal_cover_value:    internalCoverValue,
      replacement_amount:      internalCoverValue,
      replacement_days:        internalCoverDays,
      turn_cover_discount:     coveredTurnDiscount,
      turn_cover_discount_days: coveredTurnDiscountDays,
      salary_discount:         salaryDiscount,
      salary_discount_days:    salaryDiscountDays,
      salary_novelties:        salaryNoveltyDetail,
      transport_discount:      transportDiscount,
      transport_novelties:     transportNoveltyDetail,
      deduccion_salud:         deduccionSalud,
      deduccion_pension:       deduccionPension,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPLEADOS APLICABLES AL PERÍODO
// ─────────────────────────────────────────────────────────────────────────────
function rowEmployee(row) {
  return {
    employee_id:        row.employee_id,
    full_name:          row.employee_name || "",
    document_number:    row.document_number || "",
    real_position:      row.operational_position || "",
    work_time_type:     row.work_time_type || "",
    municipality_id:    row.municipality_id,
    municipality_name:  row.municipality_name || "",
    institution_id:     row.institution_id,
    institution_name:   row.institution_name || "",
    site_id:            row.site_id,
    site_name:          row.site_name || "",
    modality:           row.modality || "",
  };
}

async function activeEmployeesForPeriod(periodId) {
  const { rows } = await pool.query(
    `SELECT e.id AS employee_id, e.full_name AS employee_name, e.document_number,
            e.company_id, e.contract_id, e.municipality_id, m.name AS municipality_name,
            e.institution_id, i.name AS institution_name, e.site_id, s.name AS site_name,
            e.modality, e.workday_type AS work_time_type,
            e.real_position AS operational_position, e.status,
            COALESCE(e.labor_start_date, e.start_date, e.coverage_start_date) AS labor_start_date,
            e.labor_end_date,
            e.termination_reason,
            pp.period_start,
            pp.period_end
       FROM payroll_periods pp
       JOIN employees e ON e.contract_id = pp.contract_id
       LEFT JOIN municipalities m ON m.id = e.municipality_id
       LEFT JOIN institutions i   ON i.id = e.institution_id
       LEFT JOIN educational_sites s ON s.id = e.site_id
      WHERE pp.id = $1
        AND NULLIF(BTRIM(e.real_position), '') IS NOT NULL
        AND e.municipality_id IS NOT NULL
      ORDER BY UPPER(e.real_position), m.name NULLS LAST, e.full_name`,
    [periodId]
  );
  return rows.filter((r) => employeeAppliesToPayrollPeriod(r, r.period_start, r.period_end));
}

// ─────────────────────────────────────────────────────────────────────────────
// PERÍODOS OPERACIONALES
// ─────────────────────────────────────────────────────────────────────────────
async function listOperationalPeriods(filters = {}) {
  const values = [];
  const where  = [];
  if (filters.companyId)  { values.push(id(filters.companyId));  where.push(`pp.company_id = $${values.length}`); }
  if (filters.contractId) { values.push(id(filters.contractId)); where.push(`pp.contract_id = $${values.length}`); }

  const { rows } = await pool.query(
    `WITH item_stats AS (
       SELECT
         pi.period_id,
         COUNT(DISTINCT pi.employee_id)::int          AS employee_count,
         COALESCE(SUM(pi.total_devengado), 0)::bigint AS total_devengado,
         COALESCE(SUM(pi.total_deducciones), 0)::bigint AS total_deducciones,
         COALESCE(SUM(pi.neto_pagar), 0)::bigint      AS total_neto
        FROM payroll_items pi
       GROUP BY pi.period_id
     ),
     novelty_stats AS (
       SELECT
         pn.payroll_period_id AS period_id,
         COUNT(DISTINCT pn.id)::int AS novelty_count,
         COUNT(DISTINCT pn.id) FILTER (WHERE pn.reviewed = true)::int AS reviewed_count,
         COUNT(DISTINCT pn.id) FILTER (WHERE ${pendingNoveltySupportSql("pn")})::int AS pending_supports
        FROM payroll_novelties pn
       WHERE pn.payroll_period_id IS NOT NULL
       GROUP BY pn.payroll_period_id
     )
     SELECT pp.*,
            COALESCE(is1.employee_count, 0)    AS employee_count,
            COALESCE(is1.total_devengado, 0)   AS total_devengado,
            COALESCE(is1.total_deducciones, 0) AS total_deducciones,
            COALESCE(is1.total_neto, 0)        AS total_neto,
            COALESCE(ns1.novelty_count, 0)     AS novelty_count,
            COALESCE(ns1.reviewed_count, 0)    AS reviewed_count,
            COALESCE(ns1.pending_supports, 0)  AS pending_supports
       FROM payroll_periods pp
       LEFT JOIN item_stats is1    ON is1.period_id = pp.id
       LEFT JOIN novelty_stats ns1 ON ns1.period_id = pp.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY pp.period_start DESC`,
    values
  );
  return rows;
}

async function createOperationalPeriod(payload = {}, userId) {
  const companyId  = id(payload.companyId  || payload.company_id);
  const contractId = id(payload.contractId || payload.contract_id);
  const rawPeriod  = text(payload.period || payload.periodMonth || payload.period_month);
  const start      = payload.periodStart || payload.period_start || (rawPeriod ? `${rawPeriod}-01` : "");
  if (!companyId || !contractId || !start) throw new Error("Empresa, contrato y periodo son obligatorios");

  const [year, month] = String(start).slice(0, 7).split("-");
  const periodStart = `${year}-${month}-01`;
  const periodEnd   = `${year}-${month}-30`;
  const label       = text(payload.label) || `${month}/${year}`;

  const { rows } = await pool.query(
    `INSERT INTO payroll_periods (company_id, contract_id, period_start, period_end, label, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'BORRADOR', $6)
     ON CONFLICT (company_id, contract_id, period_start)
     DO UPDATE SET label = EXCLUDED.label
     RETURNING *`,
    [companyId, contractId, periodStart, periodEnd, label, id(userId)]
  );
  await ensurePayrollGroups(rows[0].id);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// GRUPOS DE NÓMINA
// ─────────────────────────────────────────────────────────────────────────────
async function ensurePayrollGroups(periodId) {
  const employees = await activeEmployeesForPeriod(periodId);
  if (!employees.length) return;

  // Eliminar grupos municipales de cargos no-OPERARIO sin items revisados.
  // Esto convierte automáticamente períodos existentes al modelo consolidado
  // y evita que reaparezcan al llamar a ensurePayrollGroups varias veces.
  await pool.query(
    `DELETE FROM payroll_groups pg
      WHERE pg.period_id = $1
        AND pg.municipality_id IS NOT NULL
        AND UPPER(BTRIM(pg.operational_position)) != $2
        AND NOT EXISTS (
          SELECT 1 FROM payroll_items pi
            WHERE pi.group_id = pg.id AND pi.reviewed = true
        )`,
    [periodId, String(OPERARIO_POSITION).trim().toUpperCase()]
  );

  // Una sola query para saber qué grupos ya existen en este período
  const { rows: existing } = await pool.query(
    `SELECT COALESCE(municipality_id, 0)::text AS muni_key,
            UPPER(BTRIM(operational_position))  AS pos_key
       FROM payroll_groups WHERE period_id = $1`,
    [periodId]
  );
  const existingKeys = new Set(existing.map((r) => `${r.muni_key}|${r.pos_key}`));

  // Filtrar combinaciones únicas que aún no existen.
  // OPERARIO: un grupo por municipio (group_type='MUNICIPAL').
  // Otros cargos: un único grupo consolidado por cargo (municipality_id=NULL, group_type='CONSOLIDATED').
  const toInsert = new Map();
  for (const emp of employees) {
    const posNorm = String(emp.operational_position || "").trim().toUpperCase();
    const muniKey = isOperario(posNorm) ? (emp.municipality_id || 0) : 0;
    const key = `${muniKey}|${posNorm}`;
    if (!existingKeys.has(key) && !toInsert.has(key)) toInsert.set(key, emp);
  }
  if (!toInsert.size) return;

  // Un solo INSERT en lote para todos los grupos faltantes
  const entries = [...toInsert.values()];
  const values  = [];
  const placeholders = entries.map((emp, i) => {
    const b = i * 6;
    const muniId  = isOperario(emp.operational_position) ? emp.municipality_id : null;
    const grpType = isOperario(emp.operational_position) ? "MUNICIPAL" : "CONSOLIDATED";
    values.push(periodId, emp.company_id, emp.contract_id, muniId, emp.operational_position, grpType);
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`;
  }).join(",");

  await pool.query(
    `INSERT INTO payroll_groups (period_id, company_id, contract_id, municipality_id, operational_position, group_type)
     VALUES ${placeholders}
     ON CONFLICT (period_id, contract_id, (COALESCE(municipality_id, 0)), (UPPER(BTRIM(operational_position)))) DO NOTHING`,
    values
  );
}

async function getGroup(groupId) {
  const cached = _groupCacheGet(groupId);
  if (cached) return cached;
  const { rows } = await pool.query(`SELECT * FROM payroll_groups WHERE id = $1`, [groupId]);
  const result = rows[0] || null;
  if (result) _groupCacheSet(groupId, result);
  return result;
}

async function listPayrollGroups(periodId) {
  await ensurePayrollGroups(periodId);
  const activeEmployees = await activeEmployeesForPeriod(periodId);

  const activeCountByGroup = new Map();
  for (const emp of activeEmployees) {
    // No-OPERARIO: agrupar bajo muniKey=0 para coincidir con el grupo consolidado
    const muniKey = isOperario(emp.operational_position) ? (emp.municipality_id || 0) : 0;
    const key = `${emp.contract_id}|${muniKey}|${norm(emp.operational_position)}`;
    activeCountByGroup.set(key, (activeCountByGroup.get(key) || 0) + 1);
  }

  const { rows } = await pool.query(
    `WITH item_stats AS (
       SELECT
         pi.group_id,
         COUNT(DISTINCT pi.employee_id)::int          AS employees,
         COUNT(DISTINCT pi.id) FILTER (WHERE pi.reviewed = true)::int AS items_reviewed,
         COALESCE(SUM(pi.total_devengado), 0)::bigint AS total_devengado,
         COALESCE(SUM(pi.total_deducciones), 0)::bigint AS total_deducciones,
         COALESCE(SUM(pi.neto_pagar), 0)::bigint      AS neto
        FROM payroll_items pi
       GROUP BY pi.group_id
     ),
     novelty_stats AS (
       SELECT
         pi.group_id,
         COUNT(DISTINCT pn.id)::int AS novelties,
         COUNT(DISTINCT pn.id) FILTER (WHERE pn.reviewed = true)::int AS reviewed,
         COUNT(DISTINCT pn.id) FILTER (WHERE ${pendingNoveltySupportSql("pn")})::int AS pending_supports
        FROM payroll_items pi
        LEFT JOIN payroll_novelties pn ON pn.payroll_item_id = pi.id
       GROUP BY pi.group_id
     )
     SELECT pg.*, m.name AS municipality_name,
            COALESCE(is1.employees, 0)         AS employees,
            COALESCE(ns1.novelties, 0)         AS novelties,
            COALESCE(ns1.reviewed, 0)          AS reviewed,
            COALESCE(ns1.pending_supports, 0)  AS pending_supports,
            COALESCE(is1.items_reviewed, 0)    AS items_reviewed,
            COALESCE(is1.total_devengado, 0)   AS total_devengado,
            COALESCE(is1.total_deducciones, 0) AS total_deducciones,
            COALESCE(is1.neto, 0)              AS neto,
            COALESCE(pms.is_complete, false)   AS municipality_reviewed,
            pms.completed_by_name              AS municipality_reviewed_by,
            pms.completed_at                   AS municipality_reviewed_at
       FROM payroll_groups pg
       LEFT JOIN municipalities m ON m.id = pg.municipality_id
       LEFT JOIN item_stats is1   ON is1.group_id = pg.id
       LEFT JOIN novelty_stats ns1 ON ns1.group_id = pg.id
       LEFT JOIN LATERAL (
                   SELECT *
                     FROM payroll_municipality_status pms_l
                    WHERE pms_l.period_id = pg.period_id
                      AND (
                            (pms_l.municipality_id IS NOT NULL AND pms_l.municipality_id = pg.municipality_id)
                         OR (pms_l.municipality_id IS NULL     AND pms_l.municipality    = COALESCE(m.name, ''))
                          )
                    ORDER BY pms_l.municipality_id DESC NULLS LAST
                    LIMIT 1
                 ) pms ON true
      WHERE pg.period_id = $1
      ORDER BY UPPER(pg.operational_position), m.name NULLS LAST`,
    [periodId]
  );

  // Excluir grupos municipales de cargos no-OPERARIO del listado visual.
  // Para esos cargos solo debe mostrarse el grupo consolidado (municipality_id IS NULL).
  // Los grupos municipales de OPERARIO se muestran normalmente.
  const visibleRows = rows.filter((row) =>
    row.municipality_id === null || isOperario(row.operational_position)
  );

  const positions = new Map();
  for (const row of visibleRows) {
    const key = row.operational_position;
    if (!positions.has(key)) {
      positions.set(key, {
        position:          key,
        isOperario:        isOperario(key),
        employees:         0,
        novelties:         0,
        reviewed:          0,
        items_reviewed:    0,
        pending_supports:  0,
        total_devengado:   0,
        total_deducciones: 0,
        neto:              0,
        municipalities:    [],
      });
    }
    const isConsolidated = row.group_type === "CONSOLIDATED";
    const activeKey = `${row.contract_id}|${row.municipality_id || 0}|${norm(row.operational_position)}`;
    const item = {
      id:                row.id,
      municipality_id:   row.municipality_id,
      municipality_name: isConsolidated ? "Consolidado" : (row.municipality_name || "Sin municipio"),
      is_consolidated:   isConsolidated,
      status:            row.status,
      employees:         Number(row.employees || activeCountByGroup.get(activeKey) || 0),
      novelties:         Number(row.novelties || 0),
      reviewed:          Number(row.reviewed || 0),
      items_reviewed:    Number(row.items_reviewed || 0),
      pending_supports:  Number(row.pending_supports || 0),
      total_devengado:       Number(row.total_devengado || 0),
      total_deducciones:     Number(row.total_deducciones || 0),
      neto:                  Number(row.neto || 0),
      municipality_reviewed: Boolean(row.municipality_reviewed),
      municipality_reviewed_by:  row.municipality_reviewed_by || null,
      municipality_reviewed_at:  row.municipality_reviewed_at || null,
    };
    const pos = positions.get(key);
    pos.employees         += item.employees;
    pos.novelties         += item.novelties;
    pos.reviewed          += item.reviewed;
    pos.items_reviewed    += item.items_reviewed;
    pos.pending_supports  += item.pending_supports;
    pos.total_devengado   += item.total_devengado;
    pos.total_deducciones += item.total_deducciones;
    pos.neto              += item.neto;
    pos.municipalities.push(item);
  }
  return { positions: Array.from(positions.values()), groups: visibleRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULAR GRUPO DE NÓMINA
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE CICLO DE VIDA
// ─────────────────────────────────────────────────────────────────────────────
const EDITABLE_STATUSES = new Set(["DRAFT", "IN_REVIEW", "REOPENED", "pendiente", "en_revision", "revisada"]);
const CLOSED_STATUS     = "CLOSED";

function assertGroupEditable(group) {
  if (!group) throw Object.assign(new Error("Grupo de nómina no encontrado"), { httpStatus: 404 });
  if (!EDITABLE_STATUSES.has(group.status)) {
    const err = new Error("Esta nómina está cerrada. Reabrirla para realizar cambios.");
    err.httpStatus = 403;
    throw err;
  }
}

async function markNeedsRecalculation(groupId) {
  if (!groupId) return;
  await pool.query(
    `UPDATE payroll_groups SET needs_recalculation = true, updated_at = NOW() WHERE id = $1`,
    [groupId]
  );
  _groupCacheInvalidate(groupId);
}

async function getGroupIdForItem(itemId) {
  const { rows } = await pool.query(
    `SELECT group_id FROM payroll_items WHERE id = $1`,
    [itemId]
  );
  return rows[0]?.group_id || null;
}

async function getGroupIdForNovelty(noveltyId) {
  const { rows } = await pool.query(
    `SELECT pi.group_id
       FROM payroll_novelties pn
       LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
      WHERE pn.id = $1`,
    [noveltyId]
  );
  return rows[0]?.group_id || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPAGACIÓN DE NOVEDADES MULTI-PERÍODO
// Detecta novedades padre de períodos anteriores que se extienden al período
// actual (original_end_date >= period_start) y crea los registros de
// continuación en los payroll_items correspondientes.
// Se invoca desde calculatePayrollGroup; es idempotente (no duplica registros).
// ─────────────────────────────────────────────────────────────────────────────
async function propagateCrossPeriodNovelties(periodId, contractId) {
  const { rows: periodRows } = await pool.query(
    `SELECT * FROM payroll_periods WHERE id = $1`, [periodId]
  );
  const period = periodRows[0];
  if (!period) return;

  const cId         = contractId || period.contract_id;
  const periodStart = String(period.period_start).slice(0, 10);
  const periodEnd   = String(period.period_end).slice(0, 10);

  // Buscar todas las novedades padre (de cualquier período anterior) cuya
  // original_end_date llegue al período actual o más allá.
  const { rows: crossNovs } = await pool.query(
    `SELECT pn.*, pi.employee_id
       FROM payroll_novelties pn
       JOIN payroll_items pi ON pi.id = pn.payroll_item_id
       JOIN payroll_periods pp ON pp.id = pn.payroll_period_id
      WHERE pp.contract_id = $1
        AND pn.original_end_date >= $2::date
        AND pn.is_continuation = false
        AND pn.parent_novelty_id IS NULL
        AND pp.period_end < $2::date`,
    [cId, periodStart]
  );
  if (!crossNovs.length) return;

  for (const nov of crossNovs) {
    const origEnd    = String(nov.original_end_date).slice(0, 10);
    const continEnd  = origEnd <= periodEnd ? origEnd : periodEnd;
    const continDays = Math.max(1,
      Math.round((new Date(continEnd) - new Date(periodStart)) / 86400000) + 1
    );

    // Idempotente: no crear si ya existe continuación para este período
    const { rows: existing } = await pool.query(
      `SELECT id FROM payroll_novelties
        WHERE parent_novelty_id = $1 AND payroll_period_id = $2 LIMIT 1`,
      [nov.id, periodId]
    );
    if (existing.length > 0) continue;

    // Buscar el payroll_item del empleado en este período
    const { rows: items } = await pool.query(
      `SELECT pi.*, pg.id AS grp_id
         FROM payroll_items pi
         JOIN payroll_groups pg ON pg.id = pi.group_id
        WHERE pi.employee_id = $1 AND pg.period_id = $2
        LIMIT 1`,
      [nov.employee_id, periodId]
    );
    if (!items.length) continue;
    const item = items[0];

    await pool.query(
      `INSERT INTO payroll_novelties (
         parent_novelty_id, is_continuation,
         payroll_item_id, payroll_period_id, employee_id, employee_name, document_number,
         company_id, contract_id, municipality_id, institution_id, site_id,
         operational_position, novelty_type,
         start_date, end_date, days,
         original_start_date, original_end_date,
         value, observations, description,
         support_required, support_status, status, created_by_user_id
       )
       VALUES ($1,true,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               0,$19,$19,false,'aprobado','PENDIENTE',$20)`,
      [
        nov.id, item.id, periodId,
        nov.employee_id, nov.employee_name, nov.document_number,
        nov.company_id, nov.contract_id, nov.municipality_id, nov.institution_id, nov.site_id,
        nov.operational_position, nov.novelty_type,
        periodStart, continEnd, continDays,
        String(nov.original_start_date || nov.start_date || "").slice(0, 10),
        nov.original_end_date,
        text(nov.observations || nov.description || ""),
        nov.created_by_user_id,
      ]
    );

    await recalculatePayrollItem(item.id);
    await markNeedsRecalculation(item.grp_id);
  }
}

async function calculatePayrollGroup(groupId) {
  const group = await getGroup(groupId);
  assertGroupEditable(group);

  // Propagar novedades de períodos anteriores que lleguen a este período
  await propagateCrossPeriodNovelties(group.period_id, group.contract_id);

  // Todos los empleados activos del período (para contar peers CAARES por site_id)
  const allPeriodEmployees = await activeEmployeesForPeriod(group.period_id);

  // Empleados de este grupo específico.
  // Grupos OPERARIO (municipales): filtrar por municipio exacto.
  // Grupos consolidados (no-OPERARIO): todos los empleados con ese cargo sin importar municipio.
  const groupEmployees = allPeriodEmployees.filter((emp) => {
    if (emp.contract_id !== group.contract_id) return false;
    if (norm(emp.operational_position) !== norm(group.operational_position)) return false;
    if (group.municipality_id !== null) return emp.municipality_id === group.municipality_id;
    return true;
  });

  console.log("[payroll municipality filter]", {
    groupId,
    selectedMunicipalityId:   group.municipality_id,
    selectedMunicipalityName: groupEmployees[0]?.municipality_name || "(sin empleados)",
    totalPeriodEmployees:     allPeriodEmployees.length,
    groupEmployeeCount:       groupEmployees.length,
    employees: groupEmployees.map((e) => ({
      employeeId:            e.employee_id,
      employeeName:          e.employee_name,
      employeeMunicipalityId:   e.municipality_id,
      employeeMunicipalityName: e.municipality_name,
    })),
  });

  // Configuración salarial desde DB (o fallback JSON)
  const salaryCategories = await getSalaryCategories(group.contract_id);

  // Novedades, coberturas y fechas del período en paralelo
  const noveltyPromise = group.municipality_id !== null
    ? pool.query(
        `SELECT * FROM payroll_novelties
          WHERE payroll_period_id = $1 AND municipality_id = $2`,
        [group.period_id, group.municipality_id]
      )
    : groupEmployees.length > 0
      ? pool.query(
          `SELECT * FROM payroll_novelties
            WHERE payroll_period_id = $1 AND employee_id = ANY($2::integer[])`,
          [group.period_id, groupEmployees.map((e) => e.employee_id)]
        )
      : Promise.resolve({ rows: [] });

  const [novResult, coversResult, pResult] = await Promise.all([
    noveltyPromise,
    // Solo coberturas INTERNAS — las externas no afectan ningún payroll_item
    pool.query(
      `SELECT ptc.*, pn.employee_id AS affected_employee_id
         FROM payroll_turn_covers ptc
         JOIN payroll_novelties pn ON pn.id = ptc.novelty_id
        WHERE ptc.payroll_period_id = $1`,
      [group.period_id]
    ),
    // Fechas del período para recorte multi-período y salarios individuales
    pool.query(
      `SELECT period_start, period_end FROM payroll_periods WHERE id = $1`,
      [group.period_id]
    ),
  ]);

  let novelties    = novResult.rows;
  const covers     = coversResult.rows;
  const periodStart = pResult.rows[0] ? String(pResult.rows[0].period_start).slice(0, 10) : null;
  const periodEnd   = pResult.rows[0] ? String(pResult.rows[0].period_end).slice(0, 10)   : null;

  // Recortar novedades al período actual.
  // Si una novedad cubre 25/05→03/06, en Mayo solo se contabilizan los días hasta el 30/05.
  if (periodStart && periodEnd) {
    novelties = clipNoveltiesByPeriod(novelties, periodStart, periodEnd);
  }

  // Para grupos consolidados: cargar salario individual de cada empleado
  // según su configuración vigente en la fecha de inicio del período.
  let empPayrollConfigs = new Map();
  if (group.municipality_id === null && groupEmployees.length > 0) {
    if (periodStart) {
      empPayrollConfigs = await getEmployeePayrollConfigs(
        groupEmployees.map((e) => e.employee_id), periodStart
      );
    }
  }

  const cfg = getPayrollConfig();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.time(`[payroll recalculation] group=${groupId}`);

    // Eliminar items de empleados que ya no pertenecen a este grupo (no revisados).
    // Esto evita que cambios de municipio o correcciones previas dejen datos stale
    // que aparezcan mezclados con los empleados correctos del grupo.
    if (groupEmployees.length > 0) {
      const activeIds = groupEmployees.map((e) => String(e.employee_id));
      await client.query(
        `DELETE FROM payroll_items
          WHERE group_id = $1
            AND reviewed IS NOT TRUE
            AND employee_id::text != ALL($2)`,
        [group.id, activeIds]
      );
    } else {
      await client.query(
        `DELETE FROM payroll_items WHERE group_id = $1 AND reviewed IS NOT TRUE`,
        [group.id]
      );
    }

    // Calcular montos de todos los empleados en JS (puro, sin round-trips)
    for (const emp of groupEmployees) {
      const categoryCode = classifySiteModality(emp, allPeriodEmployees);
      emp.salary_category = categoryCode;

      // Grupos consolidados (no-OPERARIO): usar salario individual si está configurado.
      // Grupos OPERARIO (municipales): usar tarifa por categoría salarial.
      let salConfig;
      if (group.municipality_id === null) {
        const empCfg = empPayrollConfigs.get(String(emp.employee_id));
        if (empCfg) {
          salConfig = {
            base_salary:         Number(empCfg.base_salary),
            transport_allowance: Number(empCfg.transport_allowance),
            other_recargos:      0,
          };
        }
      }
      if (!salConfig) {
        salConfig = salaryCategories[categoryCode] || {
          base_salary:         n(cfg.modalitySalaries?.[categoryCode] || cfg.smlmv || 0),
          transport_allowance: n(cfg.transportAllowance || 0),
          other_recargos:      0,
        };
      }

      // DEBUG: por empleado
      console.log(`[PAYROLL CATEGORY] ${emp.employee_name} → ${categoryCode}`, salConfig);

      const laborNovelties = laborDateNoveltiesForPeriod(emp, group.period_start, group.period_end);
      const fechaIngresoAplicada = getEmployeeLaborStartDate(emp);
      const fechaRetiroAplicada = getEmployeeLaborEndDate(emp);
      const diasLaboradosCalculados = calculatePayrollWorkedDays(emp, group.period_start, group.period_end);
      const inclusionStatus = payrollInclusionStatus(emp, group.period_start, group.period_end);

      // Novedades del empleado
      const empNovelties = novelties.filter(
        (x) => String(x.employee_id) === String(emp.employee_id)
      );
      const laborNoveltyTypes = new Set(laborNovelties.map((x) => x.novelty_type));
      const effectiveNovelties = [
        ...empNovelties.filter((x) => !laborNoveltyTypes.has(x.novelty_type)),
        ...laborNovelties,
      ];

      // Cambio operativo: usa cálculo proporcional si existe la novedad
      const cambioNov = effectiveNovelties.find((x) => x.novelty_type === "CAMBIO_OPERATIVO_COBERTURA");
      const amounts = cambioNov
        ? calculateAmountsWithCambio(emp, salConfig, effectiveNovelties, covers, cambioNov, salaryCategories)
        : calculateEmployeeAmounts(emp, salConfig, effectiveNovelties, covers);

      const { rows: itemRows } = await client.query(
        `INSERT INTO payroll_items (
           group_id, period_id, employee_id, employee_name, document_number,
           company_id, contract_id, municipality_id, municipality_name,
           institution_id, institution_name, site_id, site_name,
           modality, operational_position, work_time_type,
           salary_category, worked_days,
           base_salary, transport_allowance, other_earnings,
           total_devengado, total_deducciones, neto_pagar,
           calculation, fecha_ingreso_aplicada, fecha_retiro_aplicada,
           dias_laborados_calculados, source_fecha_retiro, payroll_inclusion_status,
           updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,NOW())
         ON CONFLICT (group_id, employee_id) DO UPDATE SET
           employee_name      = EXCLUDED.employee_name,
           document_number    = EXCLUDED.document_number,
           municipality_name  = EXCLUDED.municipality_name,
           institution_id     = EXCLUDED.institution_id,
           institution_name   = EXCLUDED.institution_name,
           site_id            = EXCLUDED.site_id,
           site_name          = EXCLUDED.site_name,
           modality           = EXCLUDED.modality,
           work_time_type     = EXCLUDED.work_time_type,
           salary_category    = EXCLUDED.salary_category,
           worked_days        = EXCLUDED.worked_days,
           base_salary        = EXCLUDED.base_salary,
           transport_allowance= EXCLUDED.transport_allowance,
           other_earnings     = EXCLUDED.other_earnings,
           total_devengado    = EXCLUDED.total_devengado,
           total_deducciones  = EXCLUDED.total_deducciones,
           neto_pagar         = EXCLUDED.neto_pagar,
           calculation        = EXCLUDED.calculation,
           fecha_ingreso_aplicada = EXCLUDED.fecha_ingreso_aplicada,
           fecha_retiro_aplicada  = EXCLUDED.fecha_retiro_aplicada,
           dias_laborados_calculados = EXCLUDED.dias_laborados_calculados,
           source_fecha_retiro = EXCLUDED.source_fecha_retiro,
           payroll_inclusion_status = EXCLUDED.payroll_inclusion_status,
           updated_at         = NOW()
         WHERE payroll_items.reviewed IS NOT TRUE
         RETURNING *`,
        [
          group.id, group.period_id, emp.employee_id, emp.employee_name, emp.document_number,
          emp.company_id, emp.contract_id, emp.municipality_id, emp.municipality_name,
          emp.institution_id, emp.institution_name, emp.site_id, emp.site_name,
          emp.modality, emp.operational_position, emp.work_time_type,
          categoryCode, amounts.worked_days,
          amounts.base_salary, amounts.transport_allowance, amounts.other_earnings,
          amounts.total_devengado, amounts.total_deducciones, amounts.neto_pagar,
          JSON.stringify(amounts.calculation),
          fechaIngresoAplicada, fechaRetiroAplicada, diasLaboradosCalculados,
          fechaRetiroAplicada ? "PERSONAL" : null, inclusionStatus,
        ]
      );
      const persistedItem = itemRows[0];
      if (persistedItem) {
        for (const novelty of laborNovelties) {
          await upsertLaborDateNovelty(client, persistedItem, novelty, null);
        }
      }
    }

    await client.query(
      `UPDATE payroll_groups
          SET status = 'IN_REVIEW', needs_recalculation = false, updated_at = NOW()
        WHERE id = $1`,
      [group.id]
    );
    await client.query("COMMIT");
    console.timeEnd(`[payroll recalculation] group=${groupId}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  _groupCacheInvalidate(groupId);
  return getPayrollGroupDetail(group.period_id, group.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// TURNOS DEL GRUPO (una fila por payroll_turn_covers.id)
// ─────────────────────────────────────────────────────────────────────────────
async function listGroupTurnCovers(groupId) {
  const { rows } = await pool.query(
    `SELECT
       ptc.id            AS turn_cover_id,
       ptc.novelty_id,
       ptc.cover_type,
       ptc.internal_employee_id,
       ptc.external_worker_id,
       ptc.days,
       ptc.value_per_day,
       ptc.total_value,
       ptc.created_at    AS cover_created_at,
       -- Empleado origen (cuya novedad generó el turno)
       pn.novelty_type,
       pnt.name          AS novelty_type_name,
       pn.employee_name  AS origin_employee_name,
       pn.document_number AS origin_document,
       pn.start_date     AS novelty_start,
       pn.end_date       AS novelty_end,
       pn.days           AS novelty_days,
       -- Ubicación
       pi.municipality_id,
       m.name            AS municipality_name,
       pi.institution_name,
       pi.site_name,
       pi.modality       AS origin_modality,
       pi.salary_category AS origin_category,
       -- Cobertura interna: empleado del mismo grupo
       pi_int.employee_name   AS internal_cover_name,
       pi_int.document_number AS internal_cover_doc,
       -- Cobertura externa
       etw.full_name          AS external_worker_name,
       etw.document_number    AS external_worker_doc,
       etw.bank               AS external_bank,
       etw.account_number     AS external_account
     FROM payroll_turn_covers ptc
     JOIN payroll_novelties pn      ON pn.id = ptc.novelty_id
     JOIN payroll_items pi           ON pi.id = ptc.payroll_item_id
     LEFT JOIN payroll_novelty_types pnt ON pnt.code = pn.novelty_type
     LEFT JOIN municipalities m      ON m.id = pi.municipality_id
     LEFT JOIN external_turn_workers etw ON etw.id = ptc.external_worker_id
     LEFT JOIN payroll_items pi_int
            ON pi_int.period_id = ptc.payroll_period_id
           AND pi_int.employee_id = ptc.internal_employee_id
    WHERE pi.group_id = $1
    ORDER BY ptc.created_at DESC`,
    [groupId]
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// DETALLE DE GRUPO (items + novedades + soportes)
// ─────────────────────────────────────────────────────────────────────────────
async function getPayrollGroupDetail(periodId, groupId, filters = {}) {
  const group = await getGroup(groupId);
  if (!group || Number(group.period_id) !== Number(periodId)) {
    throw new Error("Grupo de nomina no encontrado");
  }

  // Build filtered items query
  const itemParams = [groupId];
  const itemWhere = ["pi.group_id = $1"];
  const itemHaving = [];

  if (filters.institution_id) {
    itemParams.push(Number(filters.institution_id));
    itemWhere.push(`pi.institution_id = $${itemParams.length}`);
  }
  if (filters.site_id) {
    itemParams.push(Number(filters.site_id));
    itemWhere.push(`pi.site_id = $${itemParams.length}`);
  }
  if (filters.modality) {
    itemParams.push(String(filters.modality));
    itemWhere.push(`UPPER(pi.modality) = UPPER($${itemParams.length})`);
  }
  if (filters.reviewed === true)  itemWhere.push("pi.reviewed = true");
  if (filters.reviewed === false) itemWhere.push("pi.reviewed = false");
  if (filters.has_novelties === true)
    itemHaving.push("COUNT(DISTINCT pn.id) FILTER (WHERE pn.novelty_type <> 'CAMBIO_OPERATIVO_COBERTURA') > 0");
  if (filters.has_novelties === false)
    itemHaving.push("COUNT(DISTINCT pn.id) FILTER (WHERE pn.novelty_type <> 'CAMBIO_OPERATIVO_COBERTURA') = 0");
  if (filters.support_status === "pending")
    itemHaving.push(`COUNT(DISTINCT pn.id) FILTER (WHERE ${pendingNoveltySupportSql("pn")}) > 0`);
  if (filters.support_status === "complete")
    itemHaving.push(`COUNT(DISTINCT pn.id) FILTER (WHERE ${pendingNoveltySupportSql("pn")}) = 0`);
  if (filters.cargo) {
    itemParams.push(String(filters.cargo));
    itemWhere.push(`UPPER(COALESCE(pi.operational_position, '')) = UPPER($${itemParams.length})`);
  }

  const sortMap = {
    documento:  "pi.document_number",
    institucion:"pi.institution_name",
    sede:       "pi.site_name",
    modalidad:  "pi.modality",
    cargo:      "pi.operational_position",
    devengado:  "pi.total_devengado",
    neto:       "pi.neto_pagar",
    novedades:  "novelty_count",
  };
  const sortCol = sortMap[filters.sort_by] || "pi.employee_name";
  const sortDir = filters.sort_dir === "desc" ? "DESC" : "ASC";
  const havingSql = itemHaving.length ? `HAVING ${itemHaving.join(" AND ")}` : "";

  console.time(`[payroll novelties load] group=${groupId}`);
  const [
    { rows: items },
    { rows: rawNovelties },
    supports,
    { rows: periodCovers },
    covers,
    salaryCategories,
    { rows: allGroupItemsForSS },
    { rows: periodDateRows },
  ] = await Promise.all([
    pool.query(
      `SELECT pi.*,
              COUNT(DISTINCT pn.id)::int                                   AS novelty_count,
              COUNT(DISTINCT pn.id) FILTER (WHERE pn.reviewed = true)::int AS reviewed_count,
              COUNT(DISTINCT pn.id) FILTER (WHERE ${pendingNoveltySupportSql("pn")})::int AS pending_supports
         FROM payroll_items pi
         LEFT JOIN payroll_novelties pn ON pn.payroll_item_id = pi.id
        WHERE ${itemWhere.join(" AND ")}
        GROUP BY pi.id
        ${havingSql}
        ORDER BY ${sortCol} ${sortDir}`,
      itemParams
    ),
    pool.query(
      `SELECT DISTINCT ON (pn.id)
              pn.*, pi.employee_name, pi.document_number, pi.reviewed AS item_reviewed,
              pnt.name AS novelty_name,
              pnt.affects_salary, pnt.affects_transport, pnt.requires_turn_cover,
              ptc.id AS turn_cover_id,
              ptc.cover_type,
              ptc.internal_employee_id AS replacement_employee_id,
              ptc.days AS covered_days,
              ptc.total_value AS replacement_amount,
              ptc.value_per_day AS replacement_value_per_day,
              pi.employee_id AS affected_employee_id,
              pi.salary_category AS origin_salary_category,
              repl.full_name AS replacement_employee_name
         FROM payroll_novelties pn
         LEFT JOIN payroll_items pi          ON pi.id = pn.payroll_item_id
         LEFT JOIN payroll_novelty_types pnt ON pnt.code = pn.novelty_type
         LEFT JOIN payroll_turn_covers ptc   ON ptc.novelty_id = pn.id
         LEFT JOIN employees repl            ON repl.id = ptc.internal_employee_id
        WHERE pn.payroll_period_id = $1
          AND pn.payroll_item_id IN (SELECT id FROM payroll_items WHERE group_id = $2)
        ORDER BY pn.id DESC`,
      [periodId, groupId]
    ),
    // No pasar municipalityId: el groupId ya acota al municipio correcto
    // via payroll_items.group_id. Pasar ambos causaba que soportes con
    // municipality_id incorrecto en novelty_supports quedaran excluidos.
    listSupportRows({ periodId, groupId }),
    pool.query(
      `SELECT ptc.*, pn.employee_id AS affected_employee_id
         FROM payroll_turn_covers ptc
         JOIN payroll_novelties pn ON pn.id = ptc.novelty_id
        WHERE ptc.payroll_period_id = $1`,
      [periodId]
    ),
    listGroupTurnCovers(groupId),
    getSalaryCategories(group.contract_id),
    // Todos los items del grupo (sin filtros) para emparejar reemplazos en SS
    pool.query(
      `SELECT id, employee_id, employee_name, institution_id, institution_name,
              site_id, site_name, modality, operational_position, work_time_type
         FROM payroll_items WHERE group_id = $1`,
      [groupId]
    ),
    // Fechas del período para el recorte de novedades multi-período
    pool.query(
      `SELECT period_start, period_end FROM payroll_periods WHERE id = $1`, [periodId]
    ),
  ]);
  console.timeEnd(`[payroll novelties load] group=${groupId}`);

  // Recortar novedades al período actual: si una novedad cubre 25/05→03/06,
  // en Mayo se aplican solo los días hasta el 30/05 (y en Junio los del 01→03/06).
  const periodStart = periodDateRows[0] ? String(periodDateRows[0].period_start).slice(0, 10) : null;
  const periodEnd   = periodDateRows[0] ? String(periodDateRows[0].period_end).slice(0, 10)   : null;
  const novelties   = (periodStart && periodEnd)
    ? clipNoveltiesByPeriod(rawNovelties, periodStart, periodEnd)
    : rawNovelties;

  // ── Índice de novedades por item ─────────────────────────────────────────
  const novByItem = {};
  for (const nov of novelties) {
    if (!nov.payroll_item_id) continue;
    const key = String(nov.payroll_item_id);
    if (!novByItem[key]) novByItem[key] = [];
    novByItem[key].push(nov);
  }

  // ── Cálculo en vivo: misma lógica que Calculadora de Salario ─────────────
  // Items revisados conservan valores almacenados (bloqueados por revisión).
  const normalizedItems = items.map((item) => {
    if (item.reviewed) return normalizeOperationalPayrollItem(item);

    let salConfig = salaryCategories[item.salary_category];
    if (!salConfig) {
      const c = (item.calculation && typeof item.calculation === "object") ? item.calculation : {};
      salConfig = {
        base_salary:         n(c.full_base_salary || 0) || n(item.base_salary || 0),
        transport_allowance: n(c.full_transport   || 0) || n(item.transport_allowance || 0),
        other_recargos:      n(c.full_other       || 0),
      };
    }

    const emp = {
      employee_id:     item.employee_id,
      modality:        item.modality,
      work_time_type:  item.work_time_type,
      site_id:         item.site_id,
      salary_category: item.salary_category,
    };

    const itemNovs = novByItem[String(item.id)] || [];
    const cambioNov = itemNovs.find((x) => x.novelty_type === "CAMBIO_OPERATIVO_COBERTURA");
    const amounts = cambioNov
      ? calculateAmountsWithCambio(emp, salConfig, itemNovs, periodCovers, cambioNov, salaryCategories)
      : calculateEmployeeAmounts(emp, salConfig, itemNovs, periodCovers);

    return {
      ...item,
      base_salary:          amounts.base_salary,
      transport_allowance:  amounts.transport_allowance,
      other_earnings:       amounts.other_earnings,
      total_devengado:      amounts.total_devengado,
      total_deducciones:    amounts.total_deducciones,
      neto_pagar:           amounts.neto_pagar,
      worked_days:          amounts.worked_days,
      display_worked_days:  amounts.display_worked_days,
      calculation:          amounts.calculation,
    };
  });

  const calcByItem = new Map(normalizedItems.map((item) => [String(item.id), item.calculation || {}]));
  for (const nov of novelties) {
    const calc = calcByItem.get(String(nov.payroll_item_id)) || {};
    const days = Math.min(n(nov.days), n(calc.worked_days) || 30);
    const code = text(nov.novelty_type);
    const coverAmount = n(nov.replacement_amount);
    const salaryAmount = SALARY_AFFECTING.has(code) && code !== "FECHA_INGRESO" && code !== "FECHA_RETIRO"
      ? Math.round(n(calc.daily_salary || 0) * days)
      : 0;
    const transportAmount = TRANSPORT_AFFECTING.has(code)
      ? Math.round(n(calc.daily_transport || 0) * days)
      : 0;
    nov.affected_employee_id = nov.affected_employee_id || nov.employee_id;
    nov.affected_amount = coverAmount > 0 ? coverAmount : salaryAmount + transportAmount;
    nov.computed_impact = nov.affected_amount;
    nov.impact_type = coverAmount > 0 ? "turn_cover" : salaryAmount ? "salary" : transportAmount ? "transport" : null;
  }

  // ── Calcular Días SS (lógica independiente de días laborados) ───────────────
  const itemsWithSS = computeSocialSecurityDays(normalizedItems, novelties, allGroupItemsForSS);

  const totals = itemsWithSS.reduce(
    (acc, item) => {
      acc.employees         += 1;
      acc.total_devengado   += n(item.total_devengado);
      acc.total_deducciones += n(item.total_deducciones);
      acc.neto              += n(item.neto_pagar);
      acc.novelties         += n(item.novelty_count);
      acc.reviewed          += n(item.reviewed_count);
      acc.pending_supports  += n(item.pending_supports);
      acc.items_reviewed    += item.reviewed ? 1 : 0;
      acc.items_pending     += item.reviewed ? 0 : 1;
      return acc;
    },
    { employees: 0, total_devengado: 0, total_deducciones: 0, neto: 0, novelties: 0, reviewed: 0, pending_supports: 0, items_reviewed: 0, items_pending: 0 }
  );

  return { group, items: itemsWithSS, novelties, supports, covers, totals };
}

// ─────────────────────────────────────────────────────────────────────────────
// RECALCULAR ITEM TRAS CAMBIO DE NOVEDAD
// Actualiza base_salary, transport_allowance, total_devengado, neto_pagar, etc.
// en payroll_items aplicando todas las novedades actuales del empleado.
// ─────────────────────────────────────────────────────────────────────────────
async function recalculatePayrollItem(itemId) {
  console.time(`[payroll recalculation] item=${itemId}`);
  const { rows: itemRows } = await pool.query(
    `SELECT * FROM payroll_items WHERE id = $1`,
    [itemId]
  );
  const item = itemRows[0];
  if (!item || item.reviewed) { console.timeEnd(`[payroll recalculation] item=${itemId}`); return item; }

  const salaryCategories = await getSalaryCategories(item.contract_id);

  // Usar la categoría almacenada; fallback a cálculo guardado
  let salConfig = salaryCategories[item.salary_category];
  if (!salConfig) {
    const c = (item.calculation && typeof item.calculation === "object") ? item.calculation : {};
    salConfig = {
      base_salary:         n(c.full_base_salary  || 0),
      transport_allowance: n(c.full_transport    || 0),
      other_recargos:      n(c.full_other        || 0),
    };
  }

  const emp = {
    employee_id:     item.employee_id,
    modality:        item.modality,
    work_time_type:  item.work_time_type,
    site_id:         item.site_id,
    salary_category: item.salary_category,
  };

  const { rows: novelties } = await pool.query(
    `SELECT * FROM payroll_novelties WHERE payroll_item_id = $1`,
    [itemId]
  );
  // Solo coberturas INTERNAS realizadas POR este empleado — externas no afectan su cálculo
  const { rows: covers } = await pool.query(
    `SELECT ptc.*, pn.employee_id AS affected_employee_id
       FROM payroll_turn_covers ptc
       JOIN payroll_novelties pn ON pn.id = ptc.novelty_id
      WHERE ptc.payroll_period_id = $1
        AND (
          (ptc.cover_type = 'INTERNA' AND ptc.internal_employee_id = $2)
          OR pn.employee_id = $2
        )`,
    [item.period_id, item.employee_id]
  );

  const cambioNov = novelties.find((x) => x.novelty_type === "CAMBIO_OPERATIVO_COBERTURA");
  const amounts = cambioNov
    ? calculateAmountsWithCambio(emp, salConfig, novelties, covers, cambioNov, salaryCategories)
    : calculateEmployeeAmounts(emp, salConfig, novelties, covers);

  const { rows: updated } = await pool.query(
    `UPDATE payroll_items
        SET base_salary         = $2,
            transport_allowance = $3,
            other_earnings      = $4,
            total_devengado     = $5,
            total_deducciones   = $6,
            neto_pagar          = $7,
            worked_days         = $8,
            calculation         = $9,
            updated_at          = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      itemId,
      amounts.base_salary,
      amounts.transport_allowance,
      amounts.other_earnings,
      amounts.total_devengado,
      amounts.total_deducciones,
      amounts.neto_pagar,
      amounts.worked_days,
      JSON.stringify(amounts.calculation),
    ]
  );
  console.timeEnd(`[payroll recalculation] item=${itemId}`);
  return updated[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// SINCRONIZACIÓN: FECHA_RETIRO → estado del empleado en Personal
// Consulta el retiro más reciente activo en nómina y actualiza employees.
// Si no quedan novedades de retiro activas, restaura el empleado a ACTIVO.
// Diseño deliberado: no lanza excepción — si falla no bloquea la operación
// de nómina principal, y el error se loguea.
// ─────────────────────────────────────────────────────────────────────────────
async function syncEmployeeRetirement(employeeId) {
  const empId = id(employeeId);
  if (!empId) return;

  try {
    const { rows } = await pool.query(
      `SELECT MAX(COALESCE(start_date, end_date)) AS latest_retiro
         FROM payroll_novelties
        WHERE employee_id = $1
          AND novelty_type = 'FECHA_RETIRO'`,
      [empId]
    );
    const latestRetiro = rows[0]?.latest_retiro || null;

    if (latestRetiro) {
      await pool.query(
        `UPDATE employees
            SET status = 'INACTIVO',
                retirement_date = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [empId, String(latestRetiro).slice(0, 10)]
      );
    } else {
      await pool.query(
        `UPDATE employees
            SET status = 'ACTIVO',
                retirement_date = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [empId]
      );
    }
  } catch (err) {
    console.error("[syncEmployeeRetirement] error al sincronizar estado de empleado:", empId, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR NOVEDAD
// ─────────────────────────────────────────────────────────────────────────────
async function createNoveltyForItem(itemId, payload = {}, userId) {
  const { rows: itemRows } = await pool.query(`SELECT * FROM payroll_items WHERE id = $1`, [itemId]);
  const item = itemRows[0];
  if (!item) throw new Error("Empleado de nomina no encontrado");
  const group = await getGroup(item.group_id);
  assertGroupEditable(group);
  if (item.reviewed) {
    const err = new Error("Registro de nómina bloqueado por revisión.");
    err.httpStatus = 403;
    throw err;
  }

  // Normalizar y validar tipo oficial
  const rawInput = text(payload.novelty_type || payload.noveltyType || "");
  let typeRaw;
  try {
    typeRaw = normalizeNoveltyType(rawInput);
  } catch (validationErr) {
    throw new Error(validationErr.message);
  }
  if (typeRaw === "CAMBIO_OPERATIVO_COBERTURA") {
    throw new Error("Use el endpoint /payroll/items/:id/cambio-operativo para registrar cambios operativos de cobertura");
  }

  // Auto-calcular días desde fechas si no se proveen
  let startDate = text(payload.novelty_date || payload.noveltyDate || payload.start_date || payload.startDate) || null;
  let endDate   = text(payload.end_date || payload.endDate) || null;
  let days = n(payload.days);

  // CORRECCION_SEGURIDAD_SOCIAL: fecha que reemplaza la de ingreso solo para el cálculo SS.
  // No afecta días laborados, salario ni transporte.
  if (typeRaw === "CORRECCION_SEGURIDAD_SOCIAL") {
    if (!startDate) {
      const err = new Error("La corrección SS requiere la fecha de corrección (fecha_correccion_ss).");
      err.httpStatus = 400;
      throw err;
    }

    // Validar que la fecha esté dentro del período
    const { rows: periodRowsCorr } = await pool.query(
      `SELECT period_start, period_end FROM payroll_periods WHERE id = $1`,
      [item.period_id]
    );
    const periodCorr = periodRowsCorr[0];
    if (periodCorr) {
      const corrStr  = String(startDate).slice(0, 10);
      const perStart = String(periodCorr.period_start).slice(0, 10);
      const perEnd   = String(periodCorr.period_end).slice(0, 10);
      if (corrStr < perStart || corrStr > perEnd) {
        const err = new Error(
          `La fecha de corrección SS (${corrStr}) debe estar dentro del período (${perStart} — ${perEnd}).`
        );
        err.httpStatus = 400;
        throw err;
      }
    }

    // Validar que no sea posterior a la FECHA_INGRESO registrada para este item
    const { rows: ingresoRowsCorr } = await pool.query(
      `SELECT start_date FROM payroll_novelties
       WHERE payroll_item_id = $1 AND novelty_type = 'FECHA_INGRESO'
       ORDER BY created_at DESC LIMIT 1`,
      [item.id]
    );
    if (ingresoRowsCorr[0]) {
      const ingresoDate = String(ingresoRowsCorr[0].start_date).slice(0, 10);
      const corrDate    = String(startDate).slice(0, 10);
      if (corrDate > ingresoDate) {
        const err = new Error(
          `La fecha de corrección SS (${corrDate}) no puede ser posterior a la fecha de ingreso laboral (${ingresoDate}).`
        );
        err.httpStatus = 400;
        throw err;
      }
    }

    // Solo una corrección SS activa por item de nómina
    const { rows: existingCorrRows } = await pool.query(
      `SELECT id FROM payroll_novelties
       WHERE payroll_item_id = $1 AND novelty_type = 'CORRECCION_SEGURIDAD_SOCIAL'
       LIMIT 1`,
      [item.id]
    );
    if (existingCorrRows.length > 0) {
      const err = new Error(
        "Ya existe una corrección de seguridad social para este empleado en este período. Elimine la existente antes de crear una nueva."
      );
      err.httpStatus = 409;
      throw err;
    }

    startDate = String(startDate).slice(0, 10);
    endDate   = startDate;
    days      = 0; // No descuenta días laborados ni afecta salario
  } else if (typeRaw === "FECHA_INGRESO" || typeRaw === "FECHA_RETIRO") {
    // INGRESO / RETIRO: requieren fecha exacta dentro del período y calculan días automáticamente
    if (!startDate) {
      const label = typeRaw === "FECHA_INGRESO" ? "ingreso" : "retiro";
      const err = new Error(`La novedad de ${label} requiere la fecha exacta de ${label}.`);
      err.httpStatus = 400;
      throw err;
    }
    const { rows: periodRows } = await pool.query(
      `SELECT period_start, period_end FROM payroll_periods WHERE id = $1`,
      [item.period_id]
    );
    const period = periodRows[0];
    if (period) {
      const novStr   = String(startDate).slice(0, 10);
      const perStart = String(period.period_start).slice(0, 10);
      const perEnd   = String(period.period_end).slice(0, 10);
      if (novStr < perStart || novStr > perEnd) {
        const label = typeRaw === "FECHA_INGRESO" ? "ingreso" : "retiro";
        const err = new Error(
          `La fecha de ${label} (${novStr}) debe estar dentro del período (${perStart} — ${perEnd}).`
        );
        err.httpStatus = 400;
        throw err;
      }
    }
    startDate = String(startDate).slice(0, 10);
    endDate   = startDate;
    const day = new Date(startDate + "T00:00:00Z").getUTCDate();
    days = typeRaw === "FECHA_INGRESO"
      ? Math.max(1, Math.min(30, 30 - (day - 1)))
      : Math.max(1, Math.min(30, day));
  } else if (!days && startDate && endDate) {
    const diff = (new Date(endDate) - new Date(startDate)) / 86400000;
    days = Math.max(1, Math.round(diff) + 1);
  }

  // CORRECCION_SEGURIDAD_SOCIAL usa days = 0 (no descuenta días laborados).
  // Todos los demás tipos deben tener al menos 1 día.
  if (days <= 0 && typeRaw !== "CORRECCION_SEGURIDAD_SOCIAL") {
    throw new Error("Los días de la novedad deben ser mayor a 0");
  }

  // ── Detección de novedad que cruza al siguiente período ─────────────────────
  // Si end_date > period_end se recorta al período actual y se guardan las
  // fechas originales para propagar la continuación al calcular el período siguiente.
  let originalStartDate = null;
  let originalEndDate   = null;

  if (CROSS_PERIOD_TYPES.has(typeRaw) && startDate && endDate && endDate > startDate) {
    const { rows: pRows } = await pool.query(
      `SELECT period_end FROM payroll_periods WHERE id = $1`, [item.period_id]
    );
    const pEnd = pRows[0] ? String(pRows[0].period_end).slice(0, 10) : null;
    if (pEnd && endDate > pEnd) {
      originalStartDate = startDate;
      originalEndDate   = endDate;
      endDate           = pEnd;
      days              = Math.max(1, Math.round((new Date(pEnd) - new Date(startDate)) / 86400000) + 1);
    }
  }

  // Obtener metadatos del tipo de novedad desde DB
  const { rows: typeRows } = await pool.query(
    `SELECT * FROM payroll_novelty_types WHERE code = $1`,
    [typeRaw]
  );
  const noveltyTypeMeta = typeRows[0] || {};
  const supportRequired  = Boolean(payload.support_required ?? payload.supportRequired ?? noveltyTypeMeta.requires_support ?? false);

  // Validar duplicado exacto: mismo empleado, período, tipo y fechas
  if (typeRaw === "FECHA_RETIRO") {
    const { rows: existingRetiro } = await pool.query(
      `UPDATE payroll_novelties
          SET payroll_item_id = $2,
              start_date = $3::date,
              end_date = $4::date,
              days = $5,
              observations = $6,
              description = $7,
              extra_data = COALESCE(extra_data, '{}'::jsonb) || $8::jsonb,
              updated_at = NOW()
        WHERE payroll_period_id = $1
          AND employee_id = $9
          AND novelty_type = 'FECHA_RETIRO'
        RETURNING *`,
      [
        item.period_id,
        item.id,
        startDate,
        endDate,
        days,
        text(payload.observations || payload.description),
        text(payload.description || payload.observations),
        JSON.stringify({ source: "NOMINA", synced_at: new Date().toISOString() }),
        item.employee_id,
      ]
    );
    if (existingRetiro[0]) {
      await syncRetirementToEmployee(item.employee_id, startDate, userId);
      await recalculatePayrollItem(item.id);
      await markNeedsRecalculation(item.group_id);
      return existingRetiro[0];
    }
  }

  // Validar duplicado exacto: mismo empleado, período, tipo y fechas
  const { rows: dupCheck } = await pool.query(
    `SELECT id FROM payroll_novelties
      WHERE payroll_item_id = $1
        AND novelty_type    = $2
        AND (start_date IS NOT DISTINCT FROM $3::date)
        AND (end_date   IS NOT DISTINCT FROM $4::date)
      LIMIT 1`,
    [item.id, typeRaw, startDate, endDate]
  );
  if (dupCheck.length > 0) {
    const err = new Error("Ya existe una novedad igual para este empleado con el mismo tipo y fechas.");
    err.httpStatus = 409;
    throw err;
  }

  const retirementReason = typeRaw === "FECHA_RETIRO"
    ? (text(payload.retirement_reason || payload.retirementReason) || null)
    : null;

  const { rows: inserted } = await pool.query(
    `INSERT INTO payroll_novelties (
       payroll_item_id, payroll_period_id, employee_id, employee_name, document_number,
       company_id, contract_id, municipality_id, institution_id, site_id,
       operational_position, novelty_type, start_date, end_date, days,
       value, observations, description, support_required, support_status, status,
       created_by_user_id, retirement_reason,
       original_start_date, original_end_date
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'PENDIENTE',$21,$22,$23,$24)
     RETURNING *`,
    [
      item.id, item.period_id, item.employee_id, item.employee_name, item.document_number,
      item.company_id, item.contract_id, item.municipality_id, item.institution_id, item.site_id,
      item.operational_position, typeRaw, startDate, endDate, days,
      n(payload.value), text(payload.observations || payload.description),
      text(payload.description || payload.observations),
      supportRequired, supportRequired ? "pendiente" : "aprobado",
      id(userId), retirementReason,
      originalStartDate, originalEndDate,
    ]
  );

  if (typeRaw === "FECHA_RETIRO") {
    await syncRetirementToEmployee(item.employee_id, startDate, userId);
  }

  if (supportRequired) {
    const requiredDocs = SUPPORT_REQUIREMENTS[typeRaw];
    if (requiredDocs && requiredDocs.length > 0) {
      // Create one support record per specific document type required
      for (const docType of requiredDocs) {
        await createSupport(
          {
            novelty_id:        inserted[0].id,
            employee_id:       item.employee_id,
            payroll_period_id: item.period_id,
            municipality_id:   item.municipality_id,
            support_type:      docType,
            required:          true,
            status:            "pendiente",
            observations:      SUPPORT_TYPE_LABELS[docType] || docType,
          },
          userId
        );
      }
    } else {
      // Fallback: one generic support record using the novelty type code
      await createSupport(
        {
          novelty_id:        inserted[0].id,
          employee_id:       item.employee_id,
          payroll_period_id: item.period_id,
          municipality_id:   item.municipality_id,
          support_type:      typeRaw,
          required:          true,
          status:            "pendiente",
          observations:      "Soporte requerido por novedad",
        },
        userId
      );
    }
  }

  // Recalcular el item inmediatamente para reflejar el impacto de la novedad
  await recalculatePayrollItem(item.id);
  await markNeedsRecalculation(item.group_id);

  // Sincronizar estado en Personal cuando se registra un retiro
  if (typeRaw === "FECHA_RETIRO") await syncEmployeeRetirement(item.employee_id);

  return inserted[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMBIO OPERATIVO DE COBERTURA (novedad especializada)
// ─────────────────────────────────────────────────────────────────────────────
async function createCambioOperativo(itemId, payload = {}, userId) {
  const { rows: itemRows } = await pool.query(
    `SELECT * FROM payroll_items WHERE id = $1`, [itemId]
  );
  const item = itemRows[0];
  if (!item) throw new Error("Empleado de nómina no encontrado");
  const group = await getGroup(item.group_id);
  assertGroupEditable(group);
  if (item.reviewed) {
    const err = new Error("Registro de nómina bloqueado por revisión.");
    err.httpStatus = 403;
    throw err;
  }

  // Validar que no exista ya una novedad CAMBIO_OPERATIVO para este item
  const { rows: existing } = await pool.query(
    `SELECT id FROM payroll_novelties
      WHERE payroll_item_id = $1 AND novelty_type = 'CAMBIO_OPERATIVO_COBERTURA'`,
    [itemId]
  );
  if (existing.length > 0) {
    throw new Error("Ya existe un cambio operativo registrado para este empleado en el período. Edite o elimine el existente.");
  }

  // Nueva categoría
  const validCats = ["CAA1", "CAA2", "CAARES1", "CAARES2", "CAARES3", "CAARES4", "RI"];
  const newCat = text(payload.new_salary_category || "CAA1").toUpperCase();
  if (!validCats.includes(newCat)) throw new Error(`Categoría nueva inválida: ${newCat}`);

  // Fechas y días
  const startDate = payload.start_date || null;
  const endDate   = payload.end_date   || null;
  let daysNew = n(payload.days);
  if (!daysNew && startDate && endDate) {
    daysNew = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
  }
  if (daysNew < 1 || daysNew > 29) throw new Error("Los días del cambio deben estar entre 1 y 29");

  const daysOriginal = 30 - daysNew;
  const isDefinitive = Boolean(payload.is_definitive);

  // Valores salariales para preview (no se persiste el cálculo aquí; se recalcula en calculatePayrollGroup)
  const categories  = await getSalaryCategories(item.contract_id);
  const origCatCode = text(item.salary_category || "CAA1");
  const salOrig     = categories[origCatCode] || { base_salary: 0, transport_allowance: 0, other_recargos: 0 };
  const salNew      = categories[newCat]       || { base_salary: 0, transport_allowance: 0, other_recargos: 0 };

  const valueOriginal = Math.round(
    (n(salOrig.base_salary) + n(salOrig.transport_allowance) + n(salOrig.other_recargos)) / 30 * daysOriginal
  );
  const valueNew = Math.round(
    (n(salNew.base_salary) + n(salNew.transport_allowance) + n(salNew.other_recargos)) / 30 * daysNew
  );

  const extraData = {
    original_salary_category: origCatCode,
    new_salary_category:      newCat,
    new_modality:             text(payload.new_modality        || ""),
    new_work_time_type:       text(payload.new_work_time_type  || ""),
    new_institution_id:       payload.new_institution_id  ? Number(payload.new_institution_id)  : null,
    new_institution_name:     text(payload.new_institution_name  || ""),
    new_site_id:              payload.new_site_id          ? Number(payload.new_site_id)          : null,
    new_site_name:            text(payload.new_site_name         || ""),
    new_municipality_id:      payload.new_municipality_id  ? Number(payload.new_municipality_id)  : null,
    new_municipality_name:    text(payload.new_municipality_name || ""),
    is_definitive:            isDefinitive,
    update_employee_record:   Boolean(payload.update_employee_record),
    days_original:            daysOriginal,
    days_new:                 daysNew,
    value_original:           valueOriginal,
    value_new:                valueNew,
    salary_original:          n(salOrig.base_salary),
    transport_original:       n(salOrig.transport_allowance),
    other_recargos_original:  n(salOrig.other_recargos),
    salary_new:               n(salNew.base_salary),
    transport_new:            n(salNew.transport_allowance),
    other_recargos_new:       n(salNew.other_recargos),
  };

  const { rows: inserted } = await pool.query(
    `INSERT INTO payroll_novelties (
       payroll_item_id, payroll_period_id, employee_id, employee_name, document_number,
       company_id, contract_id, municipality_id, institution_id, site_id,
       operational_position, novelty_type, start_date, end_date, days,
       value, observations, description, support_required, support_status,
       status, extra_data, created_by_user_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,'CAMBIO_OPERATIVO_COBERTURA',$12,$13,$14,
             $15,$16,$17,false,'aprobado','PENDIENTE',$18,$19)
     RETURNING *`,
    [
      item.id, item.period_id, item.employee_id, item.employee_name, item.document_number,
      item.company_id, item.contract_id, item.municipality_id, item.institution_id, item.site_id,
      item.operational_position, startDate, endDate, daysNew,
      valueOriginal + valueNew,
      text(payload.observations || ""),
      text(payload.observations || `Cambio de ${origCatCode} a ${newCat}`),
      JSON.stringify(extraData),
      userId ? Number(userId) : null,
    ]
  );

  // Validar que institución pertenezca al municipio (si se suministran IDs)
  if (extraData.new_municipality_id && extraData.new_institution_id) {
    const { rows: instCheck } = await pool.query(
      `SELECT id FROM institutions WHERE id = $1 AND municipality_id = $2 LIMIT 1`,
      [extraData.new_institution_id, extraData.new_municipality_id]
    );
    if (!instCheck.length) throw new Error("La institución seleccionada no pertenece al municipio indicado");
  }

  // Validar que sede pertenezca a institución
  if (extraData.new_institution_id && extraData.new_site_id) {
    const { rows: siteCheck } = await pool.query(
      `SELECT id FROM educational_sites WHERE id = $1 AND institution_id = $2 LIMIT 1`,
      [extraData.new_site_id, extraData.new_institution_id]
    );
    if (!siteCheck.length) throw new Error("La sede seleccionada no pertenece a la institución indicada");
  }

  // Si se marcó "actualizar datos del empleado": actualizar con todos los campos (usa workday_type)
  if (payload.update_employee_record && (extraData.new_municipality_id || extraData.new_institution_id || extraData.new_site_id)) {
    const empUpdates  = [];
    const empValues   = [item.employee_id];
    if (extraData.new_municipality_id) { empValues.push(extraData.new_municipality_id); empUpdates.push(`municipality_id = $${empValues.length}`); }
    if (extraData.new_institution_id)  { empValues.push(extraData.new_institution_id);  empUpdates.push(`institution_id  = $${empValues.length}`); }
    if (extraData.new_site_id)         { empValues.push(extraData.new_site_id);          empUpdates.push(`site_id         = $${empValues.length}`); }
    if (extraData.new_modality)        { empValues.push(extraData.new_modality);         empUpdates.push(`modality        = $${empValues.length}`); }
    if (extraData.new_work_time_type)  { empValues.push(extraData.new_work_time_type);   empUpdates.push(`workday_type    = $${empValues.length}`); }
    if (empUpdates.length) {
      empValues.push(new Date().toISOString());
      empUpdates.push(`updated_at = $${empValues.length}`);
      await pool.query(
        `UPDATE employees SET ${empUpdates.join(", ")} WHERE id = $1`,
        empValues
      );
    }
  }

  await markNeedsRecalculation(item.group_id);
  return inserted[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// EDITAR NOVEDAD (bloqueada si está revisada)
// ─────────────────────────────────────────────────────────────────────────────
async function patchNovelty(noveltyId, payload = {}, userId) {
  const { rows: current } = await pool.query(
    `SELECT pn.*, pi.group_id, pi.reviewed AS item_reviewed
       FROM payroll_novelties pn
       LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
      WHERE pn.id = $1`,
    [noveltyId]
  );
  const novelty = current[0];
  if (!novelty) throw new Error("Novedad no encontrada");
  if (novelty.group_id) {
    const group = await getGroup(novelty.group_id);
    assertGroupEditable(group);
  }
  if (novelty.reviewed) {
    throw new Error(
      "Esta novedad ya fue revisada. Para modificarla debe quitar primero la marca de revisada."
    );
  }
  if (novelty.item_reviewed) {
    const err = new Error("Registro de nómina bloqueado por revisión.");
    err.httpStatus = 403;
    throw err;
  }

  const updates = [];
  const values  = [noveltyId];

  // INGRESO / RETIRO: si cambia la fecha, validar dentro del período y recalcular días
  const effectiveType = text(payload.novelty_type || novelty.novelty_type).toUpperCase();
  const incomingDate  = text(payload.novelty_date || payload.noveltyDate || payload.start_date || payload.startDate || "");
  if ((effectiveType === "FECHA_INGRESO" || effectiveType === "FECHA_RETIRO") && incomingDate) {
    const { rows: periodRows } = await pool.query(
      `SELECT pp.period_start, pp.period_end
         FROM payroll_periods pp
         JOIN payroll_items pi ON pi.period_id = pp.id
        WHERE pi.id = $1`,
      [novelty.payroll_item_id]
    );
    const period = periodRows[0];
    if (period) {
      const novStr   = String(incomingDate).slice(0, 10);
      const perStart = String(period.period_start).slice(0, 10);
      const perEnd   = String(period.period_end).slice(0, 10);
      if (novStr < perStart || novStr > perEnd) {
        const label = effectiveType === "FECHA_INGRESO" ? "ingreso" : "retiro";
        const err = new Error(
          `La fecha de ${label} (${novStr}) debe estar dentro del período (${perStart} — ${perEnd}).`
        );
        err.httpStatus = 400;
        throw err;
      }
    }
    const cleanDate = String(incomingDate).slice(0, 10);
    const day = new Date(cleanDate + "T00:00:00Z").getUTCDate();
    payload.start_date = cleanDate;
    payload.end_date   = cleanDate;
    payload.days = effectiveType === "FECHA_INGRESO"
      ? Math.max(1, Math.min(30, 30 - (day - 1)))
      : Math.max(1, Math.min(30, day));
  }

  const allowed = {
    novelty_type:       (v) => text(v).toUpperCase(),
    start_date:         (v) => v || null,
    end_date:           (v) => v || null,
    days:               n,
    value:              n,
    observations:       text,
    description:        text,
    support_required:   Boolean,
    support_status:     text,
    retirement_reason:  (v) => text(v) || null,
  };

  for (const [key, transform] of Object.entries(allowed)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (payload[key] !== undefined || payload[camel] !== undefined) {
      values.push(transform(payload[key] ?? payload[camel]));
      updates.push(`${key} = $${values.length}`);
    }
  }

  // Recalcular días si se cambiaron fechas y no se envió days explícito
  if (
    (payload.start_date || payload.end_date) &&
    payload.days === undefined &&
    payload.startDate === undefined
  ) {
    const s = payload.start_date || payload.startDate || novelty.start_date;
    const e = payload.end_date   || payload.endDate   || novelty.end_date;
    if (s && e) {
      const autodays = Math.max(1, Math.round((new Date(e) - new Date(s)) / 86400000) + 1);
      values.push(autodays);
      updates.push(`days = $${values.length}`);
    }
  }

  if (!updates.length) return novelty;

  const { rows } = await pool.query(
    `UPDATE payroll_novelties
        SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    values
  );

  if (rows[0]?.novelty_type === "FECHA_RETIRO" && rows[0]?.start_date) {
    await syncRetirementToEmployee(rows[0].employee_id, rows[0].start_date, userId);
  }

  // Recalcular el item para reflejar el nuevo impacto
  if (novelty.payroll_item_id) {
    await recalculatePayrollItem(novelty.payroll_item_id);
  }
  if (novelty.group_id) await markNeedsRecalculation(novelty.group_id);

  // ── Cascade multi-período: si cambia la fecha fin de una novedad padre ────
  // Solo aplica si era una novedad multi-período (tenía original_end_date) y
  // el usuario cambió la fecha fin (end_date en el payload).
  const intendedEnd = text(payload.end_date || payload.endDate || payload.novelty_date || "");
  if (
    !novelty.is_continuation &&
    novelty.original_end_date &&
    intendedEnd &&
    intendedEnd.slice(0, 10) !== String(novelty.original_end_date).slice(0, 10)
  ) {
    const newOrigEnd = intendedEnd.slice(0, 10);

    // Obtener el límite del período actual
    const { rows: pRows } = await pool.query(
      `SELECT pp.period_end FROM payroll_periods pp
       JOIN payroll_items pi ON pi.period_id = pp.id
       WHERE pi.id = $1 LIMIT 1`,
      [novelty.payroll_item_id]
    );
    const pEnd = pRows[0] ? String(pRows[0].period_end).slice(0, 10) : null;

    if (pEnd && newOrigEnd <= pEnd) {
      // Ya no cruza período — eliminar original_end_date
      await pool.query(
        `UPDATE payroll_novelties SET original_end_date = NULL, original_start_date = NULL WHERE id = $1`,
        [noveltyId]
      );
    } else if (pEnd && newOrigEnd > pEnd) {
      // Sigue cruzando — actualizar original_end_date y re-recortar end_date
      const newStart = String(rows[0]?.start_date || novelty.start_date || "").slice(0, 10);
      const newDays  = Math.max(1, Math.round((new Date(pEnd) - new Date(newStart)) / 86400000) + 1);
      await pool.query(
        `UPDATE payroll_novelties SET original_end_date = $2, end_date = $3, days = $4 WHERE id = $1`,
        [noveltyId, newOrigEnd, pEnd, newDays]
      );
    }

    // Eliminar continuaciones — se re-propagarán en el próximo calculatePayrollGroup
    const { rows: continuations } = await pool.query(
      `SELECT payroll_item_id FROM payroll_novelties WHERE parent_novelty_id = $1`,
      [noveltyId]
    );
    if (continuations.length > 0) {
      await pool.query(`DELETE FROM payroll_novelties WHERE parent_novelty_id = $1`, [noveltyId]);
      for (const c of continuations) {
        if (!c.payroll_item_id) continue;
        await recalculatePayrollItem(c.payroll_item_id);
        const { rows: gr } = await pool.query(
          `SELECT group_id FROM payroll_items WHERE id = $1`, [c.payroll_item_id]
        );
        if (gr[0]?.group_id) await markNeedsRecalculation(gr[0].group_id);
      }
    }
  }

  // Sincronizar estado en Personal si la novedad es (o era) un retiro
  if (
    (effectiveType === "FECHA_RETIRO" || novelty.novelty_type === "FECHA_RETIRO") &&
    novelty.employee_id
  ) {
    await syncEmployeeRetirement(novelty.employee_id);
  }

  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK DE REVISIÓN
// ─────────────────────────────────────────────────────────────────────────────
async function setNoveltyReviewed(noveltyId, reviewed, payload = {}, user = {}) {
  const reviewerId   = id(user.id);
  const reviewerName = text(user.full_name || user.name || user.username);
  const reason       = text(payload.reason || payload.motivo);

  const { rows: current } = await pool.query(
    `SELECT pn.*, pg.status AS group_status
       FROM payroll_novelties pn
       LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
       LEFT JOIN payroll_groups pg ON pg.id = pi.group_id
      WHERE pn.id = $1`,
    [noveltyId]
  );
  if (!current[0]) throw new Error("Novedad no encontrada");

  // No permitir cambiar revisión si el grupo está cerrado
  if (!EDITABLE_STATUSES.has(current[0].group_status || "IN_REVIEW")) {
    const err = new Error("Esta nómina está cerrada. Reabrirla para realizar cambios.");
    err.httpStatus = 403;
    throw err;
  }
  if (!reviewed && !reason) throw new Error("Debe indicar el motivo para quitar la revisión");

  const { rows } = await pool.query(
    `UPDATE payroll_novelties
        SET reviewed             = $2::boolean,
            reviewed_by          = CASE WHEN $2::boolean THEN $3::integer ELSE NULL::integer END,
            reviewed_at          = CASE WHEN $2::boolean THEN NOW() ELSE NULL::timestamptz END,
            updated_at           = NOW()
      WHERE id = $1
      RETURNING *`,
    [noveltyId, Boolean(reviewed), reviewerId]
  );

  const action = reviewed ? "REVIEW_PAYROLL_NOVELTY" : "UNREVIEW_PAYROLL_NOVELTY";
  try {
    await pool.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, user_name, reason, payload)
       VALUES ('payroll', 'payroll_novelty', $1, $2, $3, $4, $5, $6)`,
      [String(noveltyId), action, reviewerId, reviewerName, reason || null, JSON.stringify(current[0])]
    );
  } catch (_) { /* audit es best-effort */ }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// COBERTURA DE TURNO (interno / externo)
// ─────────────────────────────────────────────────────────────────────────────
async function createTurnCover(noveltyId, payload = {}, userId) {
  const { rows: novRows } = await pool.query(
    `SELECT pn.*, pi.group_id
       FROM payroll_novelties pn
       LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
      WHERE pn.id = $1`,
    [noveltyId]
  );
  const novelty = novRows[0];
  if (!novelty) throw new Error("Novedad no encontrada");

  // ── Verificar permiso considerando el tipo de cobertura ─────────────────────
  // Regla: la nómina cerrada NO bloquea operaciones documentales/administrativas.
  // Coberturas EXTERNAS = proceso documental → permitido aunque esté cerrada.
  // Coberturas INTERNAS = afectan liquidación del empleado cubridor → bloqueado.
  if (novelty.group_id) {
    const isRemoveOp = payload.remove === true || payload.remove === "true"
      || payload.cover_type === null || payload.coverType === null;
    let isExternalOp = norm(payload.cover_type || payload.coverType || "") === "EXTERNA";

    if (isRemoveOp && !isExternalOp) {
      // Remove sin tipo explícito: verificar tipo de la cobertura existente
      const { rows: existingCover } = await pool.query(
        `SELECT cover_type FROM payroll_turn_covers WHERE novelty_id = $1 LIMIT 1`,
        [noveltyId]
      );
      isExternalOp = existingCover[0]?.cover_type === "EXTERNA";
    }

    if (!isExternalOp) {
      const group = await getGroup(novelty.group_id);
      assertGroupEditable(group);
    }
  }

  if (novelty.reviewed) {
    throw new Error(
      "Esta novedad ya fue revisada. Para modificarla debe quitar primero la marca de revisada."
    );
  }
  if (novelty.payroll_item_id) {
    const { rows: itemRows } = await pool.query(
      `SELECT reviewed FROM payroll_items WHERE id = $1`,
      [novelty.payroll_item_id]
    );
    if (itemRows[0]?.reviewed) {
      const err = new Error("Registro de nómina bloqueado por revisión.");
      err.httpStatus = 403;
      throw err;
    }
  }

  const { rows: previousCoverRows } = await pool.query(
    `SELECT * FROM payroll_turn_covers WHERE novelty_id = $1`,
    [novelty.id]
  );
  const previousCover = previousCoverRows[0] || null;

  if (payload.remove === true || payload.remove === "true" || payload.cover_type === null || payload.coverType === null) {
    await pool.query(`DELETE FROM payroll_turn_covers WHERE novelty_id = $1`, [novelty.id]);
    await pool.query(
      `UPDATE payroll_novelties SET cover_type = NULL, updated_at = NOW() WHERE id = $1`,
      [novelty.id]
    );
    if (novelty.payroll_item_id) await recalculatePayrollItem(novelty.payroll_item_id);
    if (previousCover?.cover_type === "INTERNA" && previousCover.internal_employee_id) {
      const { rows: previousItemRows } = await pool.query(
        `SELECT id FROM payroll_items WHERE period_id = $1 AND employee_id = $2 LIMIT 1`,
        [novelty.payroll_period_id, previousCover.internal_employee_id]
      );
      if (previousItemRows[0]) await recalculatePayrollItem(previousItemRows[0].id);
    }
    return {
      removed: true,
      affected_employee_id: novelty.employee_id,
      replacement_employee_id: previousCover?.internal_employee_id || null,
      affected_amount: 0,
      replacement_amount: 0,
    };
  }

  const coverType = norm(payload.cover_type || payload.coverType) === "EXTERNA" ? "EXTERNA" : "INTERNA";
  const days      = n(payload.days || novelty.days || 1) || 1;
  const incapacityDays = n(novelty.days || 0);
  if (days <= 0) throw new Error("Los días cubiertos deben ser mayores a cero");
  if (incapacityDays > 0 && days > incapacityDays) {
    throw new Error("Los días cubiertos no pueden ser mayores que los días de la novedad");
  }

  // Obtener valor_dia — lógica diferente para EXTERNA (tarifa fija) e INTERNA (proporcional)
  const { rows: originItemRows } = await pool.query(
    `SELECT salary_category, modality, work_time_type
       FROM payroll_items
      WHERE id = $1`,
    [novelty.payroll_item_id]
  );
  const originItem = originItemRows[0];
  const turnTariffCategory = resolveTurnTariffCategory(originItem, { strict: true });
  const resolvedValuePerDay = getExternalCoverDailyValue(originItem?.salary_category || turnTariffCategory);
  const requestedValuePerDay = n(payload.value_per_day || payload.valueDay || payload.valor_dia);
  if (requestedValuePerDay && requestedValuePerDay !== resolvedValuePerDay) {
    throw new Error(
      `La tarifa del turno para ${turnTariffCategory} es ${resolvedValuePerDay} y no puede modificarse manualmente.`
    );
  }
  const valuePerDay = resolvedValuePerDay;
  /* legacy manual/fallback valuation removed: tariff is resolved exclusively
     from the operational category of the covered shift */
  if (false) {
    const { rows: originItemRows } = await pool.query(
      `SELECT salary_category, modality FROM payroll_items WHERE id = $1`,
      [novelty.payroll_item_id]
    );
    const originItem = originItemRows[0];
    const empMod = text(payload.modality || payload.modalidad || originItem?.modality || "");
    const category = originItem?.salary_category || (empMod.toUpperCase() === "RI" ? "RI" : "CAA1");

    if (coverType === "EXTERNA") {
      // EXTERNOS: tarifa fija diaria por categoría — no usar fórmula proporcional interna
      valuePerDay = getExternalCoverDailyValue(category);
      if (!valuePerDay) valuePerDay = getExternalCoverDailyValue("CAA1"); // fallback mínimo
    } else {
      // INTERNOS: fórmula proporcional sobre la categoría del empleado origen
      const categories = await getSalaryCategories(novelty.contract_id);
      const sal = categories[category] || { base_salary: 0, transport_allowance: 0, other_recargos: 0 };
      valuePerDay = isMedicalIncapacity(novelty.novelty_type)
        ? Math.round(n(sal.base_salary) / 30)
        : Math.round((n(sal.base_salary) + n(sal.transport_allowance) + n(sal.other_recargos)) / 30);
    }
  }

  let externalWorkerId  = null;
  let internalEmployeeId = null;

  if (coverType === "INTERNA") {
    internalEmployeeId = id(payload.internal_employee_id || payload.employee_id || payload.employeeId);
    if (!internalEmployeeId) throw new Error("Debe seleccionar el empleado interno que cubrio la novedad");
    if (String(internalEmployeeId) === String(novelty.employee_id)) {
      throw new Error("El empleado que cubre no puede ser el mismo empleado afectado");
    }
  } else {
    // EXTERNA
    const document = text(payload.document_number || payload.documentNumber || payload.documento);
    if (!document) throw new Error("El documento del trabajador externo es obligatorio");
    const fullName = text(payload.full_name || payload.name || payload.nombre);
    if (!fullName) throw new Error("El nombre completo del trabajador externo es obligatorio");

    const { rows: wRows } = await pool.query(
      `INSERT INTO external_turn_workers
         (full_name, document_number, phone, bank, account_type, account_number,
          municipality_id, site_id, modality, value_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (document_number) DO UPDATE SET
         full_name        = EXCLUDED.full_name,
         phone            = EXCLUDED.phone,
         bank             = EXCLUDED.bank,
         account_type     = EXCLUDED.account_type,
         account_number   = EXCLUDED.account_number,
         municipality_id  = EXCLUDED.municipality_id,
         site_id          = EXCLUDED.site_id,
         modality         = EXCLUDED.modality,
         value_day        = EXCLUDED.value_day,
         updated_at       = NOW()
       RETURNING id`,
      [
        fullName, document,
        text(payload.phone  || payload.telefono),
        text(payload.bank   || payload.banco),
        text(payload.account_type || payload.tipoCuenta || "AHORROS").toUpperCase(),
        text(payload.account_number || payload.cuenta),
        id(payload.municipality_id || novelty.municipality_id),
        id(payload.site_id         || novelty.site_id),
        text(payload.modality      || payload.modalidad || originItem?.modality),
        valuePerDay,
      ]
    );
    externalWorkerId = wRows[0].id;
  }

  const { rows: coverRows } = await pool.query(
    `INSERT INTO payroll_turn_covers
       (novelty_id, payroll_item_id, payroll_period_id, cover_type,
        internal_employee_id, external_worker_id, days, value_per_day, total_value, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (novelty_id) DO UPDATE SET
       cover_type            = EXCLUDED.cover_type,
       internal_employee_id  = EXCLUDED.internal_employee_id,
       external_worker_id    = EXCLUDED.external_worker_id,
       days                  = EXCLUDED.days,
       value_per_day         = EXCLUDED.value_per_day,
       total_value           = EXCLUDED.total_value
     RETURNING *`,
    [
      novelty.id, novelty.payroll_item_id, novelty.payroll_period_id,
      coverType, internalEmployeeId, externalWorkerId,
      days, valuePerDay, days * valuePerDay, id(userId),
    ]
  );

  await pool.query(
    `UPDATE payroll_novelties SET cover_type = $2, updated_at = NOW() WHERE id = $1`,
    [novelty.id, coverType]
  );

  // Recalcular el item del empleado origen (Sandra) para reflejar la novedad actualizada
  if (novelty.payroll_item_id) {
    await recalculatePayrollItem(novelty.payroll_item_id);
  }

  // Recalcular el item del empleado que cubrió (Carmenza) para sumar su ingreso por cobertura
  if (coverType === "INTERNA" && internalEmployeeId) {
    const { rows: coveringItemRows } = await pool.query(
      `SELECT id FROM payroll_items WHERE period_id = $1 AND employee_id = $2 LIMIT 1`,
      [novelty.payroll_period_id, internalEmployeeId]
    );
    if (coveringItemRows[0]) {
      await recalculatePayrollItem(coveringItemRows[0].id);
    }
  }
  if (
    previousCover?.cover_type === "INTERNA" &&
    previousCover.internal_employee_id &&
    String(previousCover.internal_employee_id) !== String(internalEmployeeId)
  ) {
    const { rows: previousItemRows } = await pool.query(
      `SELECT id FROM payroll_items WHERE period_id = $1 AND employee_id = $2 LIMIT 1`,
      [novelty.payroll_period_id, previousCover.internal_employee_id]
    );
    if (previousItemRows[0]) {
      await recalculatePayrollItem(previousItemRows[0].id);
    }
  }

  // Crear soportes requeridos para externos
  if (coverType === "EXTERNA") {
    for (const supportType of ["cedula", "certificacion_bancaria", "cuenta_cobro"]) {
      await createSupport(
        {
          novelty_id:        novelty.id,
          employee_id:       novelty.employee_id,
          payroll_period_id: novelty.payroll_period_id,
          municipality_id:   novelty.municipality_id,
          support_type:      supportType,
          required:          true,
          status:            "pendiente",
          observations:      "Soporte de turno externo. No bloquea la nomina.",
        },
        userId
      );
    }
  }

  if (novelty.group_id) await markNeedsRecalculation(novelty.group_id);
  return {
    ...coverRows[0],
    external_worker_id: externalWorkerId,
    affected_employee_id: novelty.employee_id,
    replacement_employee_id: internalEmployeeId,
    affected_amount: days * valuePerDay,
    replacement_amount: days * valuePerDay,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EDICIÓN BANCARIA DE COBERTURA EXTERNA (sin recalcular nómina ni desbloquear)
// ─────────────────────────────────────────────────────────────────────────────
async function updateTurnCoverBankInfo(coverId, payload = {}, user = {}) {
  const { rows: coverRows } = await pool.query(
    `SELECT ptc.id, ptc.cover_type, ptc.external_worker_id,
            etw.bank AS prev_bank, etw.account_type AS prev_account_type,
            etw.account_number AS prev_account_number
       FROM payroll_turn_covers ptc
       JOIN external_turn_workers etw ON etw.id = ptc.external_worker_id
      WHERE ptc.id = $1`,
    [coverId]
  );
  const cover = coverRows[0];
  if (!cover) throw new Error("Cobertura no encontrada");
  if (cover.cover_type !== "EXTERNA") {
    const err = new Error("Solo se pueden editar datos bancarios de coberturas externas.");
    err.httpStatus = 400;
    throw err;
  }

  const newBank    = text(payload.banco || payload.bank || "");
  const newType    = text(payload.tipoCuenta || payload.account_type || "AHORROS").toUpperCase();
  const newAccount = text(payload.numeroCuenta || payload.account_number || "");
  const obs        = text(payload.observacion || payload.observations || "");

  if (!["AHORROS", "CORRIENTE"].includes(newType)) {
    throw new Error("Tipo de cuenta inválido. Debe ser AHORROS o CORRIENTE.");
  }

  await pool.query(
    `UPDATE external_turn_workers
        SET bank           = COALESCE(NULLIF($2, ''), bank),
            account_type   = $3,
            account_number = COALESCE(NULLIF($4, ''), account_number),
            updated_at     = NOW()
      WHERE id = $1`,
    [cover.external_worker_id, newBank, newType, newAccount]
  );

  try {
    await pool.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, user_name, reason, payload)
       VALUES ('payroll', 'external_turn_worker', $1, 'UPDATE_BANK_INFO', $2, $3, $4, $5)`,
      [
        String(cover.external_worker_id),
        id(user.id),
        text(user.full_name || user.name || user.username),
        obs || "Actualización de datos bancarios para cuenta de cobro",
        JSON.stringify({
          cover_id:            coverId,
          external_worker_id:  cover.external_worker_id,
          prev_bank:           cover.prev_bank,
          new_bank:            newBank,
          prev_account_type:   cover.prev_account_type,
          new_account_type:    newType,
          prev_account_number: cover.prev_account_number,
          new_account_number:  newAccount,
          observations:        obs,
        }),
      ]
    );
  } catch (_) { /* audit best-effort — no bloquear la operación */ }

  const { rows: updated } = await pool.query(
    `SELECT etw.bank, etw.account_type, etw.account_number
       FROM external_turn_workers etw WHERE etw.id = $1`,
    [cover.external_worker_id]
  );
  return { ok: true, cover_id: coverId, ...updated[0] };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF HTML: CUENTA DE COBRO CONSOLIDADA (todos los turnos del trabajador en el período)
// Se invoca con cualquier coverId de ese trabajador; consolida automáticamente.
// ─────────────────────────────────────────────────────────────────────────────
async function buildChargeAccountHtml(coverId) {
  // 1. Obtener worker_id y period_id desde el cover indicado
  const { rows: anchorRows } = await pool.query(
    `SELECT ptc.external_worker_id, ptc.payroll_period_id
       FROM payroll_turn_covers ptc
      WHERE ptc.id = $1 AND ptc.cover_type = 'EXTERNA'
      LIMIT 1`,
    [coverId]
  );
  const anchor = anchorRows[0];
  if (!anchor) throw new Error("Cuenta de cobro no encontrada o el turno no es externo");

  // 2. Traer TODOS los turnos de ese trabajador en ese período
  const { rows } = await pool.query(
    `SELECT ptc.*,
            pn.novelty_type, pn.start_date, pn.end_date, pn.days AS nov_days,
            pnt.name AS novelty_type_name,
            etw.full_name, etw.document_number, etw.bank,
            etw.account_type, etw.account_number,
            m.name AS municipality_name,
            i.name AS institution_name,
            s.name AS site_name,
            pi.modality,
            pi.employee_name AS origin_employee_name,
            pi.document_number AS origin_doc,
            pp.label AS period_label, pp.period_start, pp.period_end,
            emp.gestor_zona
       FROM payroll_turn_covers ptc
       JOIN payroll_novelties pn       ON pn.id  = ptc.novelty_id
       JOIN external_turn_workers etw  ON etw.id = ptc.external_worker_id
       JOIN payroll_items pi            ON pi.id  = ptc.payroll_item_id
       JOIN payroll_periods pp          ON pp.id  = ptc.payroll_period_id
       LEFT JOIN payroll_novelty_types pnt ON pnt.code = pn.novelty_type
       LEFT JOIN municipalities m       ON m.id = pi.municipality_id
       LEFT JOIN institutions i         ON i.id = pi.institution_id
       LEFT JOIN educational_sites s    ON s.id = pi.site_id
       LEFT JOIN employees emp          ON emp.id = pi.employee_id
      WHERE ptc.external_worker_id = $1
        AND ptc.payroll_period_id  = $2
        AND ptc.cover_type = 'EXTERNA'
      ORDER BY COALESCE(pn.start_date, ptc.created_at)`,
    [anchor.external_worker_id, anchor.payroll_period_id]
  );

  if (!rows.length) throw new Error("No se encontraron turnos externos para este trabajador en el período");
  const w = rows[0]; // datos del beneficiario (iguales en todos los registros)
  if (!w.full_name || !w.document_number) {
    throw new Error("Datos incompletos para generar la cuenta de cobro (nombre o cédula faltante)");
  }

  const normalizedRows = rows.map((row) => applyOfficialExternalTurnAmounts(row));
  const wNorm = normalizedRows[0];

  const fmt = (v) =>
    Number(v || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

  const today = new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
  const totalAPagar = normalizedRows.reduce((s, r) => s + Number(r.total_value || 0), 0);
  const totalDias   = normalizedRows.reduce((s, r) => s + Number(r.covered_days || r.days || r.nov_days || 0), 0);

  const introText = normalizedRows.length === 1
    ? `cubrimiento de <strong>1 turno externo</strong>`
    : `cubrimiento de <strong>${normalizedRows.length} turnos externos</strong>`;

  const detailRows = normalizedRows.map((r, i) => `
  <tr>
    <td style="text-align:center;font-weight:700">${i + 1}</td>
    <td>${r.origin_employee_name || "—"}<br><small style="color:#6B7280">CC ${r.origin_doc || "—"}</small></td>
    <td>${r.municipality_name || "—"}<br><small style="color:#6B7280">${r.institution_name || ""} · ${r.site_name || ""}</small></td>
    <td>${r.modality || "—"}</td>
    <td>${r.novelty_type_name || r.novelty_type || "—"}</td>
    <td>${r.start_date ? String(r.start_date).slice(0,10) : "—"}<br><small style="color:#6B7280">al ${r.end_date ? String(r.end_date).slice(0,10) : "—"}</small></td>
    <td style="text-align:center">${Number(r.covered_days || r.days || r.nov_days || 0)}</td>
    <td style="text-align:right">${fmt(r.value_per_day)}</td>
    <td style="text-align:right;font-weight:700">${fmt(r.total_value)}</td>
  </tr>`).join("");

  const gestorName = (wNorm.gestor_zona || "").trim().toUpperCase();
  const gestorBlock = gestorName
    ? `<p><strong>${gestorName}</strong></p><p>Gestor de Zona</p>`
    : `<p><strong>GESTOR DE ZONA</strong></p>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cuenta de Cobro — ${wNorm.full_name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;padding:30px;max-width:820px;margin:auto}
  h1{font-size:22px;text-align:center;font-weight:900;letter-spacing:1px;margin-bottom:4px}
  .sub{text-align:center;font-size:12px;color:#555;margin-bottom:14px}
  .parrafo{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;margin-bottom:16px;font-size:13px;line-height:1.7}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  td,th{padding:7px 10px;border:1px solid #d1d5db;vertical-align:top}
  th{background:#f3f4f6;font-weight:700;text-align:left}
  .th-w{width:38%}
  .total-row td{font-weight:700;font-size:15px;background:#d1fae5;border-color:#6ee7b7;text-align:right}
  .sec-title{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#374151;padding:6px 0 4px}
  .firma{margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:48px}
  .firma-box{border-top:2px solid #374151;padding-top:8px;text-align:center;font-size:12px;line-height:1.9}
  @media print{body{padding:10px}.no-print{display:none}}
</style>
</head>
<body>
<div class="no-print" style="margin-bottom:16px">
  <button onclick="window.print()" style="padding:8px 16px;cursor:pointer;background:#0F766E;color:#fff;border:none;border-radius:6px;font-size:13px">
    Imprimir / Guardar como PDF
  </button>
</div>

<h1>CUENTA DE COBRO</h1>
<div class="sub">Fecha de generación: ${today} &nbsp;·&nbsp; Período: ${w.period_label || ""}</div>

<div class="parrafo">
  Yo, <strong>${w.full_name}</strong>, identificado(a) con cédula de ciudadanía No.&nbsp;<strong>${w.document_number}</strong>,
  presento cuenta de cobro por concepto de ${introText} en el
  Programa de Alimentación Escolar (PAE), correspondiente al período
  <strong>${w.period_label || ""}</strong>.
</div>

<div class="sec-title">Datos del beneficiario</div>
<table>
  <tr><th class="th-w">Nombre completo</th><td>${w.full_name}</td></tr>
  <tr><th class="th-w">Cédula de ciudadanía</th><td>${w.document_number}</td></tr>
  <tr><th class="th-w">Banco</th><td>${w.bank || "—"}</td></tr>
  <tr><th class="th-w">Tipo de cuenta</th><td>${w.account_type || "—"}</td></tr>
  <tr><th class="th-w">Número de cuenta</th><td>${w.account_number || "—"}</td></tr>
</table>

<div class="sec-title">Detalle de servicios prestados</div>
<table>
  <thead>
    <tr>
      <th style="width:30px;text-align:center">#</th>
      <th>Empleado reemplazado</th>
      <th>Municipio / Sede</th>
      <th>Modalidad</th>
      <th>Tipo de novedad</th>
      <th>Fechas</th>
      <th style="text-align:center">Días</th>
      <th style="text-align:right">Valor día</th>
      <th style="text-align:right">Subtotal</th>
    </tr>
  </thead>
  <tbody>
    ${detailRows}
  </tbody>
  <tfoot>
    <tr class="total-row">
      <td colspan="6" style="text-align:left;font-weight:700">TOTAL A PAGAR</td>
      <td style="text-align:center;font-weight:700">${totalDias}</td>
      <td></td>
      <td style="text-align:right;font-weight:700">${fmt(totalAPagar)}</td>
    </tr>
  </tfoot>
</table>

<div class="firma">
  <div class="firma-box">
    <p>&nbsp;</p>
    <p>&nbsp;</p>
    <p><strong>${w.full_name}</strong></p>
    <p>C.C. ${w.document_number}</p>
    <p>Firma del beneficiario</p>
  </div>
  <div class="firma-box">
    <p>&nbsp;</p>
    <p>&nbsp;</p>
    ${gestorBlock}
    <p>Firma y sello del contratante</p>
  </div>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOPORTES DOCUMENTALES
// ─────────────────────────────────────────────────────────────────────────────
async function listSupports(filters = {}) {
  return listSupportRows(filters);
}

async function createSupport(payload = {}, userId) {
  const supportId = id(payload.id);
  if (supportId) {
    const { rows } = await pool.query(
      `UPDATE novelty_supports SET
         status       = COALESCE(NULLIF($2,''), status),
         file_url     = COALESCE(NULLIF($3,''), file_url),
         file_name    = COALESCE(NULLIF($4,''), file_name),
         observations = COALESCE(NULLIF($5,''), observations),
         uploaded_by  = CASE WHEN NULLIF($3,'') IS NOT NULL THEN $6 ELSE uploaded_by END,
         uploaded_at  = CASE WHEN NULLIF($3,'') IS NOT NULL THEN NOW() ELSE uploaded_at END,
         reviewed_by  = CASE WHEN $2 IN ('aprobado','rechazado') THEN $6 ELSE reviewed_by END,
         reviewed_at  = CASE WHEN $2 IN ('aprobado','rechazado') THEN NOW() ELSE reviewed_at END,
         updated_at   = NOW()
       WHERE id = $1
       RETURNING *`,
      [supportId, text(payload.status), text(payload.file_url || payload.fileUrl),
       text(payload.file_name || payload.fileName), text(payload.observations), id(userId)]
    );
    if (rows[0]?.novelty_id) await syncNoveltySupportStatus(rows[0].novelty_id);
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO novelty_supports (
       novelty_id, employee_id, payroll_period_id, municipality_id, support_type,
       required, status, file_url, file_name, observations, uploaded_by,
       uploaded_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
       CASE WHEN NULLIF($8,'') IS NOT NULL THEN NOW() ELSE NULL END)
     RETURNING *`,
    [
      id(payload.novelty_id || payload.noveltyId),
      id(payload.employee_id || payload.employeeId),
      id(payload.payroll_period_id || payload.periodId),
      id(payload.municipality_id || payload.municipalityId),
      text(payload.support_type || payload.supportType || "otros"),
      payload.required !== false,
      text(payload.status || "pendiente"),
      text(payload.file_url || payload.fileUrl),
      text(payload.file_name || payload.fileName),
      text(payload.observations),
      id(userId),
    ]
  );
  if (rows[0]?.novelty_id) await syncNoveltySupportStatus(rows[0].novelty_id);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// DESPRENDIBLE POR ITEM (detalle individual del empleado en el período)
// ─────────────────────────────────────────────────────────────────────────────
async function getItemPayslip(itemId) {
  const { rows: itemRows } = await pool.query(
    `SELECT pi.*,
            m.name AS municipality_name,
            i.name AS institution_name,
            s.name AS site_name,
            pp.label AS period_label, pp.period_start, pp.period_end,
            co.name AS active_company_name,
            co.nit  AS active_company_nit,
            ct.name AS contract_name,
            ct.code AS contract_code
       FROM payroll_items pi
       LEFT JOIN municipalities m      ON m.id = pi.municipality_id
       LEFT JOIN institutions i        ON i.id = pi.institution_id
       LEFT JOIN educational_sites s   ON s.id = pi.site_id
       LEFT JOIN contracts ct          ON ct.id = pi.contract_id
       LEFT JOIN companies co          ON co.id = COALESCE(ct.company_id, pi.company_id)
       JOIN payroll_periods pp         ON pp.id = pi.period_id
      WHERE pi.id = $1`,
    [itemId]
  );
  if (!itemRows[0]) throw new Error("Item de nómina no encontrado");
  const item = itemRows[0];

  const [{ rows: novRows }, { rows: calcCovers }] = await Promise.all([
    pool.query(
      `SELECT pn.*, pnt.name AS novelty_name, pnt.affects_salary, pnt.affects_transport
         FROM payroll_novelties pn
         LEFT JOIN payroll_novelty_types pnt ON pnt.code = pn.novelty_type
        WHERE pn.payroll_item_id = $1
        ORDER BY pn.created_at`,
      [itemId]
    ),
    pool.query(
      `SELECT ptc.*,
              pn.employee_id AS affected_employee_id,
              pn.days AS novelty_days,
              pi_origin.employee_name AS covered_employee_name,
              pi_origin.salary_category AS covered_salary_category
         FROM payroll_turn_covers ptc
         JOIN payroll_novelties pn        ON pn.id  = ptc.novelty_id
         JOIN payroll_items pi_origin     ON pi_origin.id = ptc.payroll_item_id
        WHERE ptc.payroll_period_id = $1
          AND (
            (ptc.cover_type = 'INTERNA' AND ptc.internal_employee_id = $2)
            OR pn.employee_id = $2
          )`,
      [item.period_id, item.employee_id]
    ),
  ]);

  const myCovers = calcCovers.filter(
    (cover) => cover.cover_type === "INTERNA" && String(cover.internal_employee_id) === String(item.employee_id)
  );
  const receivedCovers = calcCovers.filter(
    (cover) => String(cover.affected_employee_id) === String(item.employee_id)
  );

  // ── Configuración salarial canónica (igual que recalculatePayrollItem) ────
  const salaryCategories = await getSalaryCategories(item.contract_id);
  let salConfig = salaryCategories[item.salary_category];
  if (!salConfig) {
    const storedCalc = (item.calculation && typeof item.calculation === "object") ? item.calculation : {};
    salConfig = {
      base_salary:         n(storedCalc.full_base_salary || 0) || n(item.base_salary || 0),
      transport_allowance: n(storedCalc.full_transport   || 0) || n(item.transport_allowance || 0),
      other_recargos:      n(storedCalc.full_other       || 0),
    };
  }

  const emp = {
    employee_id:     item.employee_id,
    modality:        item.modality,
    work_time_type:  item.work_time_type,
    site_id:         item.site_id,
    salary_category: item.salary_category,
  };

  // ── Cálculo en vivo — misma lógica que la Calculadora de Salario ─────────
  const cambioNov = novRows.find((x) => x.novelty_type === "CAMBIO_OPERATIVO_COBERTURA");
  const liveAmounts = cambioNov
    ? calculateAmountsWithCambio(emp, salConfig, novRows, calcCovers, cambioNov, salaryCategories)
    : calculateEmployeeAmounts(emp, salConfig, novRows, calcCovers);
  const liveCalc = liveAmounts.calculation;

  // ── Tasas diarias para enriquecimiento de novedades individuales ─────────
  // daily_salary / daily_transport vienen del cálculo regular; para cambio operativo
  // se usa la tasa del tramo original como aproximación.
  const dailySal   = liveCalc.daily_salary    || (n(salConfig.base_salary)         / 30);
  const dailyTrans = liveCalc.daily_transport || (n(salConfig.transport_allowance) / 30);
  const workedDays = liveAmounts.worked_days || 30;

  const enrichedNovelties = novRows.map((nov) => {
    let computed_impact = 0, impact_type = null;
    const novDays = Math.min(n(nov.days), workedDays);
    const code    = text(nov.novelty_type);
    if (SALARY_AFFECTING.has(code) && code !== "FECHA_INGRESO" && code !== "FECHA_RETIRO") {
      computed_impact = Math.round(dailySal   * novDays);
      impact_type     = "salary";
    } else if (TRANSPORT_AFFECTING.has(code)) {
      computed_impact = Math.round(dailyTrans * novDays);
      impact_type     = "transport";
    }
    return { ...nov, computed_impact, impact_type };
  });

  // ── Datos estructurados para el desprendible rediseñado ──────────────────
  const salaryNovs    = enrichedNovelties.filter((nov) =>
    nov.affects_salary && nov.novelty_type !== "CAMBIO_OPERATIVO_COBERTURA"
  );
  const transportNovs = enrichedNovelties.filter((nov) =>
    nov.affects_transport && nov.novelty_type !== "CAMBIO_OPERATIVO_COBERTURA"
  );

  const salaryDiscountDays    = (liveCalc.salary_novelties    || []).reduce((s, x) => s + n(x.days), 0);
  const transportDiscountDays = (liveCalc.transport_novelties || []).reduce((s, x) => s + n(x.days), 0);
  const salaryPaidDays        = Math.max(0, workedDays - salaryDiscountDays);
  const transportPaidDays     = Math.max(0, workedDays - transportDiscountDays);

  return {
    item,
    company: {
      name:          item.active_company_name || "",
      nit:           item.active_company_nit || "",
      contract_name: item.contract_name || "",
      contract_code: item.contract_code || "",
    },
    period: {
      label:        item.period_label,
      period_start: item.period_start,
      period_end:   item.period_end,
    },
    employee: {
      name:         item.employee_name,
      document:     item.document_number,
      municipality: item.municipality_name,
      institution:  item.institution_name,
      site:         item.site_name,
      modality:     item.modality,
      position:     item.operational_position,
      work_time:    item.work_time_type,
    },
    earnings: {
      base_salary:          liveAmounts.base_salary,
      transport_allowance:  liveAmounts.transport_allowance,
      other_earnings:       liveAmounts.other_earnings,
      other_recargos_value: Math.max(0, liveAmounts.other_earnings - n(liveCalc.internal_cover_value)),
      internal_cover_value: n(liveCalc.internal_cover_value),
      total_devengado:      liveAmounts.total_devengado,
    },
    deductions: {
      salud:             n(liveCalc.deduccion_salud),
      pension:           n(liveCalc.deduccion_pension),
      turn_cover_discount: n(liveCalc.turn_cover_discount),
      total_deducciones: liveAmounts.total_deducciones,
    },
    cambio_operativo: liveCalc.cambio_operativo ? {
      original_category:  liveCalc.original_category  || "",
      new_category:       liveCalc.new_category        || "",
      days_original:      n(liveCalc.days_original),
      days_new:           n(liveCalc.days_new),
      base_original:      n(liveCalc.base_original),
      base_new:           n(liveCalc.base_new),
      transport_original: n(liveCalc.transport_original),
      transport_new:      n(liveCalc.transport_new),
      other_original:     n(liveCalc.other_original),
      other_new:          n(liveCalc.other_new),
    } : null,
    net:             liveAmounts.neto_pagar,
    worked_days:     workedDays,
    salary_category: item.salary_category || "",
    novelties:        enrichedNovelties,
    covers:           receivedCovers,
    performed_covers: myCovers,
    calculation:      liveCalc,
    payslip: {
      worked_days:               workedDays,
      salary_paid_days:          salaryPaidDays,
      transport_paid_days:       transportPaidDays,
      salary_affecting_novelties: salaryNovs.map((nov) => ({
        name: nov.novelty_name || nov.novelty_type,
        days: n(nov.days),
      })),
      transport_affecting_novelties: transportNovs.map((nov) => ({
        name: nov.novelty_name || nov.novelty_type,
        days: n(nov.days),
      })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ELIMINAR NOVEDAD
// ─────────────────────────────────────────────────────────────────────────────
async function deleteNovelty(noveltyId, user = {}) {
  const reviewerId   = id(user.id);
  const reviewerName = text(user.full_name || user.name || user.username);

  const { rows: current } = await pool.query(
    `SELECT pn.*, pi.reviewed AS item_reviewed, pi.group_id
       FROM payroll_novelties pn
       LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
      WHERE pn.id = $1`,
    [noveltyId]
  );
  const novelty = current[0];
  if (!novelty) throw new Error("Novedad no encontrada");
  if (novelty.group_id) {
    const group = await getGroup(novelty.group_id);
    assertGroupEditable(group);
  }

  if (novelty.reviewed) {
    const err = new Error("La novedad ya fue revisada y no puede eliminarse.");
    err.httpStatus = 403;
    throw err;
  }
  if (novelty.item_reviewed) {
    const err = new Error("Este registro de nómina está bloqueado por revisión.");
    err.httpStatus = 403;
    throw err;
  }

  // Auditoría antes de eliminar
  try {
    await pool.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, user_name, payload)
       VALUES ('payroll', 'payroll_novelty', $1, 'DELETE_PAYROLL_NOVELTY', $2, $3, $4)`,
      [
        String(noveltyId), reviewerId, reviewerName,
        JSON.stringify({
          novelty_type:    novelty.novelty_type,
          employee_id:     novelty.employee_id,
          employee_name:   novelty.employee_name,
          payroll_item_id: novelty.payroll_item_id,
          municipality_id: novelty.municipality_id,
          days:            novelty.days,
          value:           novelty.value,
          observations:    novelty.observations,
        }),
      ]
    );
  } catch (_) { /* audit es best-effort */ }

  // Recoger continuaciones ANTES de borrar (CASCADE las elimina)
  const { rows: continuations } = await pool.query(
    `SELECT payroll_item_id FROM payroll_novelties WHERE parent_novelty_id = $1`,
    [noveltyId]
  );

  // Eliminar novedad (cascadea: novelty_supports, payroll_turn_covers, continuaciones)
  await pool.query(`DELETE FROM payroll_novelties WHERE id = $1`, [noveltyId]);

  // Recalcular el item afectado
  if (novelty.payroll_item_id) {
    await recalculatePayrollItem(novelty.payroll_item_id);
  }
  if (novelty.group_id) await markNeedsRecalculation(novelty.group_id);

  // Recalcular items de continuaciones que quedaron sin la novedad
  for (const c of continuations) {
    if (!c.payroll_item_id) continue;
    await recalculatePayrollItem(c.payroll_item_id);
    const { rows: gr } = await pool.query(
      `SELECT group_id FROM payroll_items WHERE id = $1`, [c.payroll_item_id]
    );
    if (gr[0]?.group_id) await markNeedsRecalculation(gr[0].group_id);
  }

  // Revertir estado en Personal si era un retiro (la fila ya fue borrada)
  if (novelty.novelty_type === "FECHA_RETIRO" && novelty.employee_id) {
    await syncEmployeeRetirement(novelty.employee_id);
  }

  return { deleted: true, payroll_item_id: novelty.payroll_item_id };
}

// ─────────────────────────────────────────────────────────────────────────────
// REVISIÓN COMPLETA DEL REGISTRO DE NÓMINA (payroll_item)
// ─────────────────────────────────────────────────────────────────────────────
async function setItemReviewed(itemId, reviewed, payload = {}, user = {}) {
  const reviewerId   = id(user.id);
  const reviewerName = text(user.full_name || user.name || user.username);
  const reason       = text(payload.reason || payload.motivo);

  const { rows: current } = await pool.query(
    `SELECT pi.*, pg.status AS group_status
       FROM payroll_items pi
       LEFT JOIN payroll_groups pg ON pg.id = pi.group_id
      WHERE pi.id = $1`,
    [itemId]
  );
  const item = current[0];
  if (!item) throw new Error("Registro de nómina no encontrado");

  // No permitir cambiar revisión si el grupo está cerrado
  if (!EDITABLE_STATUSES.has(item.group_status || "IN_REVIEW")) {
    const err = new Error("Esta nómina está cerrada. Reabrirla para realizar cambios.");
    err.httpStatus = 403;
    throw err;
  }
  if (!reviewed && !reason) throw new Error("Debe indicar el motivo para desbloquear el registro");

  const { rows } = await pool.query(
    `UPDATE payroll_items
        SET reviewed    = $2::boolean,
            reviewed_by = CASE WHEN $2::boolean THEN $3::integer ELSE NULL::integer END,
            reviewed_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL::timestamptz END,
            updated_at  = NOW()
      WHERE id = $1
      RETURNING *`,
    [itemId, Boolean(reviewed), reviewerId]
  );

  const action = reviewed ? "REVIEW_PAYROLL_ITEM" : "UNREVIEW_PAYROLL_ITEM";
  try {
    await pool.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, user_name, reason, payload)
       VALUES ('payroll', 'payroll_item', $1, $2, $3, $4, $5, $6)`,
      [
        String(itemId), action, reviewerId, reviewerName,
        reason || null,
        JSON.stringify({
          employee_id:       item.employee_id,
          employee_name:     item.employee_name,
          municipality_id:   item.municipality_id,
          municipality_name: item.municipality_name,
          period_id:         item.period_id,
        }),
      ]
    );
  } catch (_) { /* audit es best-effort */ }

  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// COBERTURA PARA EL RESUMEN DE NÓMINA (TC/MT requerido vs contratado)
// ─────────────────────────────────────────────────────────────────────────────
async function getCoverageStatsForGroup(contractId, municipalityId) {
  if (!contractId || !municipalityId) return null;
  const [{ rows: required }, { rows: contracted }] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE UPPER(BTRIM(COALESCE(workday_type,''))) IN ('TC','TIEMPO COMPLETO','TIEMPOCOMPLETO')) AS tc_required,
         COUNT(*) FILTER (WHERE UPPER(BTRIM(COALESCE(workday_type,''))) IN ('MT','MEDIO TIEMPO','MEDIOTIEMPO'))      AS mt_required
       FROM contract_positions
       WHERE contract_id = $1 AND municipality_id = $2 AND active = true AND counts_for_coverage = true`,
      [contractId, municipalityId]
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE UPPER(BTRIM(COALESCE(workday_type,''))) IN ('TC','TIEMPO COMPLETO','TIEMPOCOMPLETO')) AS tc_contracted,
         COUNT(*) FILTER (WHERE UPPER(BTRIM(COALESCE(workday_type,''))) IN ('MT','MEDIO TIEMPO','MEDIOTIEMPO'))      AS mt_contracted
       FROM employees
       WHERE contract_id = $1 AND municipality_id = $2
         AND UPPER(BTRIM(COALESCE(status,'ACTIVO'))) NOT IN ('RETIRADO','RETIRADA','INACTIVO','INACTIVA')`,
      [contractId, municipalityId]
    ),
  ]);
  const r = required[0] || {};
  const c = contracted[0] || {};
  const tcReq  = Number(r.tc_required  || 0);
  const mtReq  = Number(r.mt_required  || 0);
  const tcCon  = Number(c.tc_contracted || 0);
  const mtCon  = Number(c.mt_contracted || 0);
  return {
    tc_requerido:    tcReq,
    tc_contratado:   tcCon,
    mt_requerido:    mtReq,
    mt_contratado:   mtCon,
    diferencia_tc:   tcCon - tcReq,
    diferencia_mt:   mtCon - mtReq,
    estado_cobertura: tcCon >= tcReq && mtCon >= mtReq ? "Completa" : "Incompleta",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CERRAR GRUPO DE NÓMINA (genera snapshot inmutable)
// ─────────────────────────────────────────────────────────────────────────────
async function closePayrollGroup(groupId, user = {}) {
  const group = await getGroup(groupId);
  if (!group) throw new Error("Grupo de nómina no encontrado");
  if (group.status === CLOSED_STATUS) throw new Error("Este grupo ya está cerrado.");

  // Verificar que todos los items estén revisados
  const { rows: counts } = await pool.query(
    `SELECT
       COUNT(*)::int                                            AS total,
       COUNT(*) FILTER (WHERE reviewed = true)::int            AS reviewed_count
       FROM payroll_items WHERE group_id = $1`,
    [groupId]
  );
  const { total, reviewed_count } = counts[0] || {};
  if (!total || total === 0) throw new Error("No hay empleados calculados. Calcule la nómina antes de cerrar.");
  if (reviewed_count < total) {
    throw new Error(`Faltan ${total - reviewed_count} empleado(s) por revisar antes de cerrar.`);
  }

  const reviewerId   = id(user.id);
  const reviewerName = text(user.full_name || user.name || user.username);
  const newVersion   = Number(group.version_number || 1);

  // Snapshot del estado actual (inmutable)
  const detail = await getPayrollGroupDetail(group.period_id, groupId);
  const snapshotData = {
    version:     newVersion,
    closed_by:   reviewerName,
    closed_at:   new Date().toISOString(),
    group:       { id: group.id, period_id: group.period_id, municipality_id: group.municipality_id,
                   operational_position: group.operational_position, contract_id: group.contract_id },
    items:       detail.items,
    novelties:   detail.novelties,
    totals:      detail.totals,
  };

  const { rows } = await pool.query(
    `UPDATE payroll_groups
        SET status = 'CLOSED', closed_by = $2, closed_at = NOW(),
            needs_recalculation = false, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [groupId, reviewerId]
  );

  try {
    await pool.query(
      `INSERT INTO payroll_group_snapshots (group_id, version_number, closed_by, closed_by_name, snapshot_data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (group_id, version_number) DO NOTHING`,
      [groupId, newVersion, reviewerId, reviewerName, JSON.stringify(snapshotData)]
    );
  } catch (_) { /* snapshot best-effort */ }

  try {
    await pool.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, user_name, payload)
       VALUES ('payroll', 'payroll_group', $1, 'CLOSE_PAYROLL', $2, $3, $4)`,
      [String(groupId), reviewerId, reviewerName,
       JSON.stringify({ group_id: groupId, municipality_id: group.municipality_id,
                        period_id: group.period_id, version: newVersion })]
    );
  } catch (_) { /* audit best-effort */ }

  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// REABRIR GRUPO DE NÓMINA
// ─────────────────────────────────────────────────────────────────────────────
async function reopenPayrollGroup(groupId, user = {}, reason = "", observations = "") {
  const group = await getGroup(groupId);
  if (!group) throw new Error("Grupo de nómina no encontrado");
  if (group.status !== CLOSED_STATUS) throw new Error("Solo se puede reabrir una nómina cerrada.");
  if (!reason || !reason.trim()) throw new Error("Debe indicar el motivo de reapertura.");

  const userId    = id(user.id);
  const userName  = text(user.full_name || user.name || user.username);
  const prevStatus = group.status;
  const newVersion = Number(group.version_number || 1) + 1;

  const { rows } = await pool.query(
    `UPDATE payroll_groups
        SET status = 'REOPENED', reopened_by = $2, reopened_at = NOW(),
            reopen_reason = $3, version_number = $4,
            needs_recalculation = true, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [groupId, userId, text(reason), newVersion]
  );

  try {
    await pool.query(
      `INSERT INTO payroll_reopen_logs
         (payroll_group_id, municipality_id, period_id, previous_status, new_status,
          reason, observations, reopened_by, reopened_by_name, closed_by, closed_at)
       VALUES ($1,$2,$3,$4,'REOPENED',$5,$6,$7,$8,$9,$10)`,
      [groupId, group.municipality_id, group.period_id, prevStatus,
       text(reason), text(observations), userId, userName,
       group.closed_by || null, group.closed_at || null]
    );
  } catch (_) { /* log best-effort */ }

  try {
    await pool.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, user_name, reason, payload)
       VALUES ('payroll', 'payroll_group', $1, 'REOPEN_PAYROLL', $2, $3, $4, $5)`,
      [String(groupId), userId, userName, text(reason),
       JSON.stringify({ group_id: groupId, municipality_id: group.municipality_id,
                        period_id: group.period_id, new_version: newVersion, reason })]
    );
  } catch (_) { /* audit best-effort */ }

  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL DE CICLO DE VIDA DEL GRUPO
// ─────────────────────────────────────────────────────────────────────────────
async function getGroupHistory(groupId) {
  const group = await getGroup(groupId);
  if (!group) throw new Error("Grupo de nómina no encontrado");

  const [{ rows: logs }, { rows: snapshots }] = await Promise.all([
    pool.query(
      `SELECT * FROM payroll_reopen_logs WHERE payroll_group_id = $1 ORDER BY reopened_at DESC`,
      [groupId]
    ),
    pool.query(
      `SELECT id, group_id, version_number, closed_by, closed_by_name, closed_at, created_at
         FROM payroll_group_snapshots WHERE group_id = $1 ORDER BY version_number DESC`,
      [groupId]
    ),
  ]);

  return { group, logs, snapshots };
}

// ─────────────────────────────────────────────────────────────────────────────
// TURNOS CUBIERTOS POR GRUPO
// ─────────────────────────────────────────────────────────────────────────────
async function listGroupTurns(groupId) {
  const group = await getGroup(groupId);
  if (!group) throw new Error("Grupo no encontrado");

  const { rows } = await pool.query(
    `SELECT
       ptc.id,
       ptc.cover_type,
       ptc.days                   AS covered_days,
       ptc.value_per_day          AS calculated_day_value,
       ptc.total_value,
       ptc.created_at,
       pn.id                      AS novelty_id,
       pn.novelty_type,
       pn.start_date              AS novelty_start,
       pn.end_date                AS novelty_end,
       pn.days                    AS novelty_days,
       pn.observations            AS novelty_observations,
       pi.employee_name           AS origin_employee_name,
       pi.document_number         AS origin_document,
       pi.operational_position    AS origin_position,
       pi.municipality_id,
       pi.municipality_name,
       pi.institution_name,
       pi.site_name,
       pi.modality,
       pi.work_time_type,
       pi.salary_category        AS origin_category,
       repl.id                    AS internal_employee_id,
       repl.full_name             AS internal_employee_name,
       repl.document_number       AS internal_document,
       repl.real_position         AS internal_position,
       repl_pi.id                 AS internal_payroll_item_id,
       etw.id                     AS external_worker_id,
       etw.full_name              AS external_worker_name,
       etw.document_number        AS external_document,
       etw.phone                  AS external_phone,
       etw.bank                   AS external_bank,
       etw.account_type           AS external_account_type,
       etw.account_number         AS external_account_number,
       etw.cedula_url,
       etw.cert_bancaria_url,
       etw.cuenta_cobro_url
     FROM payroll_turn_covers ptc
     JOIN payroll_novelties pn        ON pn.id   = ptc.novelty_id
     JOIN payroll_items pi            ON pi.id   = ptc.payroll_item_id
     LEFT JOIN employees repl         ON repl.id = ptc.internal_employee_id
     LEFT JOIN payroll_items repl_pi  ON repl_pi.period_id   = pi.period_id
                                     AND repl_pi.employee_id = ptc.internal_employee_id
     LEFT JOIN external_turn_workers etw ON etw.id = ptc.external_worker_id
    WHERE pi.group_id = $1
    ORDER BY COALESCE(pn.start_date, ptc.created_at) DESC, ptc.created_at DESC`,
    [groupId]
  );
  return { group, turns: rows.map((row) => applyOfficialExternalTurnAmounts(row)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTOS DE TRABAJADOR EXTERNO (cédula, cert. bancaria, cta. cobro firmada)
// ─────────────────────────────────────────────────────────────────────────────
async function updateExternalWorkerDocs(workerId, docs = {}) {
  const wId = id(workerId);
  if (!wId) throw new Error("ID de trabajador externo inválido");
  const fields = [];
  const params = [wId];
  const allowed = ["cedula_url", "cert_bancaria_url", "cuenta_cobro_url"];
  for (const col of allowed) {
    if (docs[col] !== undefined) {
      params.push(docs[col] || null);
      fields.push(`${col} = $${params.length}`);
    }
  }
  if (!fields.length) return;
  await pool.query(
    `UPDATE external_turn_workers SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $1`,
    params
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTACIÓN COMPLETA DEL PERÍODO — todos los items + novedades + totales
// Usada por handlePeriodFullExport para el workbook de todos los municipios.
// ─────────────────────────────────────────────────────────────────────────────
async function getPeriodItemsForExport(periodId) {
  const periodDbId = id(periodId);
  if (!periodDbId) throw new Error("ID de período inválido");

  const [{ rows: items }, { rows: novelties }, { rows: periodRows }, { rows: totRows }, { rows: turnRows }] = await Promise.all([
    pool.query(
      `SELECT pi.*,
              COUNT(DISTINCT pn.id)::int AS novelty_count
         FROM payroll_items pi
         LEFT JOIN payroll_novelties pn
                ON pn.payroll_item_id = pi.id
               AND pn.novelty_type <> 'CAMBIO_OPERATIVO_COBERTURA'
        WHERE pi.period_id = $1
        GROUP BY pi.id
        ORDER BY pi.municipality_name, pi.employee_name`,
      [periodDbId]
    ),
    pool.query(
      `SELECT pn.*, pnt.name AS novelty_name
         FROM payroll_novelties pn
         LEFT JOIN payroll_novelty_types pnt ON pnt.code = pn.novelty_type
        WHERE pn.payroll_item_id IN (
          SELECT id FROM payroll_items WHERE period_id = $1
        )
          AND pn.novelty_type <> 'CAMBIO_OPERATIVO_COBERTURA'`,
      [periodDbId]
    ),
    pool.query(`SELECT label FROM payroll_periods WHERE id = $1`, [periodDbId]),
    pool.query(
      `SELECT
         COUNT(DISTINCT pi.id)::int                        AS employees,
         COUNT(DISTINCT pi.id) FILTER (WHERE pi.reviewed)::int AS items_reviewed,
         COALESCE(SUM(pi.total_devengado),   0)::bigint    AS total_devengado,
         COALESCE(SUM(pi.total_deducciones), 0)::bigint    AS total_deducciones,
         COALESCE(SUM(pi.neto_pagar),        0)::bigint    AS neto,
         COUNT(DISTINCT pn.id)::int                        AS novelties
       FROM payroll_items pi
       LEFT JOIN payroll_novelties pn ON pn.payroll_item_id = pi.id
      WHERE pi.period_id = $1`,
      [periodDbId]
    ),
    pool.query(
      `SELECT
         ptc.id,
         ptc.cover_type,
         ptc.days                   AS covered_days,
         ptc.value_per_day          AS calculated_day_value,
         ptc.total_value,
         ptc.created_at,
         pn.id                      AS novelty_id,
         pn.novelty_type,
         pn.start_date              AS novelty_start,
         pn.end_date                AS novelty_end,
         pn.days                    AS novelty_days,
         pn.observations            AS novelty_observations,
         pi.employee_name           AS origin_employee_name,
         pi.document_number         AS origin_document,
         pi.operational_position    AS origin_position,
         pi.municipality_id,
         pi.municipality_name,
         pi.institution_name,
         pi.site_name,
         pi.modality,
         pi.work_time_type,
         pi.salary_category         AS origin_category,
         etw.id                     AS external_worker_id,
         etw.full_name              AS external_worker_name,
         etw.document_number        AS external_document,
         etw.bank                   AS external_bank,
         etw.account_type           AS external_account_type,
         etw.account_number         AS external_account_number
       FROM payroll_turn_covers ptc
       JOIN payroll_novelties pn        ON pn.id = ptc.novelty_id
       JOIN payroll_items pi            ON pi.id = ptc.payroll_item_id
       LEFT JOIN external_turn_workers etw ON etw.id = ptc.external_worker_id
      WHERE pi.period_id = $1
      ORDER BY COALESCE(pn.start_date, ptc.created_at), ptc.created_at`,
      [periodDbId]
    ),
  ]);

  return {
    periodLabel: periodRows[0]?.label || String(periodId),
    items,
    novelties,
    turns: turnRows.map((row) => applyOfficialExternalTurnAmounts(row)),
    totals: { ...totRows[0], items_pending: Number(totRows[0]?.employees || 0) - Number(totRows[0]?.items_reviewed || 0) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTACIÓN FORMATO VARIABLES DE NÓMINA
// Una fila por empleado×municipio con días de cada tipo de novedad agregados.
// ─────────────────────────────────────────────────────────────────────────────
async function getVariablesExportData(periodId, groupId) {
  const periodDbId = id(periodId);
  const groupDbId  = id(groupId) || null;
  if (!periodDbId) throw new Error("ID de período inválido");

  const { rows } = await pool.query(
    `SELECT
       pi.document_number,
       pi.employee_name,
       pi.municipality_name,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'DIAS_NO_CLASE'), 0)::int                 AS dias_no_clase,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'CITA_MEDICA'), 0)::int                   AS cita_medica,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'CITA_MEDICA_FAMILIAR'), 0)::int          AS cita_medica_familiar,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'INCAPACIDAD_MEDICA'), 0)::int            AS incapacidad_medica,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'INCAPACIDAD_ACCIDENTE_LABORAL'), 0)::int AS incapacidad_accidente,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'CALAMIDAD_FAMILIAR'), 0)::int            AS calamidad_familiar,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'CITACIONES_OFICIALES'), 0)::int          AS citaciones_oficiales,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'LICENCIA_MATERNIDAD_PATERNIDAD'), 0)::int AS licencia_maternidad,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'SUSPENSION'), 0)::int                    AS suspension,
       COALESCE(SUM(pn.days) FILTER (WHERE pn.novelty_type = 'PERMISOS_NO_REMUNERADOS'), 0)::int       AS permisos_no_remunerados,
       MAX(pn.start_date) FILTER (WHERE pn.novelty_type = 'FECHA_RETIRO')  AS fecha_retiro,
       MAX(pn.start_date) FILTER (WHERE pn.novelty_type = 'FECHA_INGRESO') AS fecha_ingreso
     FROM payroll_items pi
     LEFT JOIN payroll_novelties pn
            ON pn.payroll_item_id = pi.id
           AND pn.novelty_type <> 'CAMBIO_OPERATIVO_COBERTURA'
    WHERE pi.period_id = $1
      AND ($2::int IS NULL OR pi.group_id = $2)
    GROUP BY pi.document_number, pi.employee_name, pi.municipality_name
    ORDER BY pi.municipality_name, pi.employee_name`,
    [periodDbId, groupDbId]
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  listOperationalPeriods,
  createOperationalPeriod,
  listPayrollGroups,
  getGroup,
  getPayrollGroupDetail,
  calculatePayrollGroup,
  createNoveltyForItem,
  createCambioOperativo,
  patchNovelty,
  setNoveltyReviewed,
  createTurnCover,
  listSupports,
  createSupport,
  getOfficialNoveltyTypes,
  getSalaryCategories,
  upsertSalaryCategory,
  getItemPayslip,
  updateTurnCoverBankInfo,
  buildChargeAccountHtml,
  rowEmployee,
  workTimeKind,
  classifySiteModality,
  OFFICIAL_NOVELTY_CODES,
  SALARY_AFFECTING,
  TRANSPORT_AFFECTING,
  ADDITIONAL_AFFECTING,
  SUPPORT_REQUIREMENTS,
  SUPPORT_TYPE_LABELS,
  normalizeNoveltyType,
  setItemReviewed,
  recalculatePayrollItem,
  deleteNovelty,
  closePayrollGroup,
  reopenPayrollGroup,
  getGroupHistory,
  listGroupTurnCovers,
  getCoverageStatsForGroup,
  listGroupTurns,
  updateExternalWorkerDocs,
  getVariablesExportData,
  getPeriodItemsForExport,
  // Configuración salarial individual (Gestores, Auxiliares, Equipo Mínimo)
  listEmployeeSalaryConfig,
  createEmployeeSalaryConfig,
  deleteEmployeeSalaryConfig,
  clearGroupCache,
};
