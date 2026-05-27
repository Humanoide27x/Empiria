"use strict";

const pool = require("../../db/pool");
const { getPayrollConfig } = require("../../data/payroll_config");
const { calculatePayrollDeductionBase } = require("../../utils/payroll-deductions");

const OPERARIO_POSITION = "OPERARIO MANIPULADOR DE ALIMENTOS";

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
  "CITACION_COLEGIO",
  "LICENCIA_MATERNIDAD_PATERNIDAD",
  "SUSPENSION",
  "FECHA_INGRESO",
  "FECHA_RETIRO",
  "CAMBIO_OPERATIVO_COBERTURA",
]);

// Novedades que reducen salario devengado (pro-rata días no pagados)
const SALARY_AFFECTING = new Set([
  "PERMISOS_NO_REMUNERADOS",
  "SUSPENSION",
  "FECHA_INGRESO",   // ajusta inicio del período
  "FECHA_RETIRO",    // ajusta fin del período
]);

// Novedades que reducen auxilio de transporte (sin afectar salario)
const TRANSPORT_AFFECTING = new Set([
  "DIAS_NO_CLASE",
  "CITA_MEDICA",
  "INCAPACIDAD_MEDICA",
  "INCAPACIDAD_ACCIDENTE_LABORAL",
  "CALAMIDAD_FAMILIAR",
  "LUTO",
  "CITACION_COLEGIO",
  "LICENCIA_MATERNIDAD_PATERNIDAD",
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

function isOperario(position) {
  return norm(position) === norm(OPERARIO_POSITION);
}

function normalizeOperationalPayrollItem(item) {
  if (!item || typeof item !== "object") return item;

  const baseSalary = n(item.base_salary);
  const totalDevengado = n(item.total_devengado);
  const deduccionSalud = calculatePayrollDeductionBase(baseSalary);
  const deduccionPension = calculatePayrollDeductionBase(baseSalary);
  const totalDeducciones = deduccionSalud + deduccionPension;
  const netoPagar = Math.max(0, totalDevengado - totalDeducciones);
  const calculation = item.calculation && typeof item.calculation === "object"
    ? {
        ...item.calculation,
        deduccion_salud: deduccionSalud,
        deduccion_pension: deduccionPension,
      }
    : item.calculation;

  return {
    ...item,
    total_deducciones: totalDeducciones,
    neto_pagar: netoPagar,
    calculation,
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
  "CITACION COLEGIO":                   "CITACION_COLEGIO",
  "CITACION EN COLEGIO":                "CITACION_COLEGIO",
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
  const mod  = norm(employee.modality);
  const wtk  = workTimeKind(employee.work_time_type);
  const siteId = employee.site_id;

  if (mod === "RI") return "RI";

  if (mod === "CAARES" || mod.startsWith("CAARES")) {
    // Contar TC en misma sede con modalidad CAARES (usando site_id)
    const peersCAARES = allPeriodEmployees.filter((p) => {
      const pm = norm(p.modality);
      return (
        p.site_id === siteId &&
        (pm === "CAARES" || pm.startsWith("CAARES"))
      );
    });
    const tcCount = peersCAARES.filter((p) => workTimeKind(p.work_time_type) === "TC").length;

    if (wtk === "TC") return tcCount <= 1 ? "CAARES1" : "CAARES3";
    return tcCount <= 1 ? "CAARES2" : "CAARES4";
  }

  if (mod === "CAA" || mod.startsWith("CAA")) {
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

  // ── Coberturas internas (suman a este empleado si él cubrió a otro) ───────
  const internalCoverValue = covers
    .filter(
      (c) =>
        c.cover_type === "INTERNA" &&
        String(c.internal_employee_id) === String(employee.employee_id)
    )
    .reduce((sum, c) => sum + n(c.total_value), 0);

  // ── Totales ───────────────────────────────────────────────────────────────
  const effectiveSalary    = Math.max(0, baseSalary    - salaryDiscount);
  const effectiveTransport = Math.max(0, auxTransporte - transportDiscount);
  const effectiveOther     = otherEarnings + internalCoverValue;

  const totalDevengado = effectiveSalary + effectiveTransport + effectiveOther;

  // Deducciones: misma fórmula que Calculadora de Salario — ceil al 100 sobre salario efectivo
  const deduccionSalud   = calculatePayrollDeductionBase(effectiveSalary);
  const deduccionPension = calculatePayrollDeductionBase(effectiveSalary);
  const totalDeducciones = deduccionSalud + deduccionPension;

  const netoPagar = Math.max(0, totalDevengado - totalDeducciones);

  return {
    base_salary:         effectiveSalary,
    transport_allowance: effectiveTransport,
    other_earnings:      effectiveOther,
    total_devengado:     totalDevengado,
    total_deducciones:   totalDeducciones,
    neto_pagar:          netoPagar,
    worked_days:         workedDays,
    calculation: {
      salary_category:         employee.salary_category || "",
      worked_days:             workedDays,
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
      internal_cover_value:    internalCoverValue,
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
  let salaryDiscount    = 0;
  let transportDiscount = 0;
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
      salaryDiscount += amount;
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

  // ── Efectivos ─────────────────────────────────────────────────────────────
  const totalBase   = Math.max(0, (baseOrig  + baseNew)  - salaryDiscount);
  const totalTrans  = Math.max(0, (transOrig + transNew) - transportDiscount);
  const totalOther  = (otherOrig + otherNew) + internalCoverValue;
  const totalDevengado = totalBase + totalTrans + totalOther;

  const deduccionSalud   = calculatePayrollDeductionBase(totalBase);
  const deduccionPension = calculatePayrollDeductionBase(totalBase);
  const totalDeducciones = deduccionSalud + deduccionPension;
  const netoPagar = Math.max(0, totalDevengado - totalDeducciones);

  return {
    base_salary:         totalBase,
    transport_allowance: totalTrans,
    other_earnings:      totalOther,
    total_devengado:     totalDevengado,
    total_deducciones:   totalDeducciones,
    neto_pagar:          netoPagar,
    worked_days:         30,
    calculation: {
      salary_category:         employee.salary_category || "",
      worked_days:             30,
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
      salary_discount:         salaryDiscount,
      salary_novelties:        salaryNoveltyDetail,
      transport_discount:      transportDiscount,
      transport_novelties:     transportNoveltyDetail,
      deduccion_salud:         deduccionSalud,
      deduccion_pension:       deduccionPension,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPLEADOS ACTIVOS PARA EL PERÍODO
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
            e.real_position AS operational_position, e.status
       FROM payroll_periods pp
       JOIN employees e ON e.contract_id = pp.contract_id
       LEFT JOIN municipalities m ON m.id = e.municipality_id
       LEFT JOIN institutions i   ON i.id = e.institution_id
       LEFT JOIN educational_sites s ON s.id = e.site_id
      WHERE pp.id = $1
        AND NULLIF(BTRIM(e.real_position), '') IS NOT NULL
        AND e.municipality_id IS NOT NULL
        AND UPPER(BTRIM(COALESCE(e.status, 'ACTIVO'))) NOT IN ('RETIRADO','RETIRADA','INACTIVO','INACTIVA')
      ORDER BY UPPER(e.real_position), m.name NULLS LAST, e.full_name`,
    [periodId]
  );
  return rows.filter((r) => statusIsActive(r.status));
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
    `SELECT pp.*,
            COUNT(DISTINCT pi.employee_id)::int                                        AS employee_count,
            COALESCE(SUM(pi.total_devengado), 0)::bigint                               AS total_devengado,
            COALESCE(SUM(pi.total_deducciones), 0)::bigint                             AS total_deducciones,
            COALESCE(SUM(pi.neto_pagar), 0)::bigint                                    AS total_neto,
            COUNT(DISTINCT pn.id)::int                                                 AS novelty_count,
            COUNT(DISTINCT pn.id) FILTER (WHERE pn.reviewed = true)::int               AS reviewed_count,
            COUNT(DISTINCT ns.id) FILTER (WHERE ns.status = 'pendiente')::int          AS pending_supports
       FROM payroll_periods pp
       LEFT JOIN payroll_items pi      ON pi.period_id = pp.id
       LEFT JOIN payroll_novelties pn  ON pn.payroll_period_id = pp.id
       LEFT JOIN novelty_supports ns   ON ns.payroll_period_id = pp.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY pp.id
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
  for (const emp of employees) {
    await pool.query(
      `INSERT INTO payroll_groups (period_id, company_id, contract_id, municipality_id, operational_position, group_type)
       SELECT $1, $2, $3, $4, $5, 'MUNICIPAL'
        WHERE NOT EXISTS (
          SELECT 1 FROM payroll_groups pg
           WHERE pg.period_id = $1
             AND pg.contract_id = $3
             AND COALESCE(pg.municipality_id, 0) = COALESCE($4::integer, 0)
             AND UPPER(BTRIM(pg.operational_position)) = UPPER(BTRIM($5))
        )`,
      [periodId, emp.company_id, emp.contract_id, emp.municipality_id, emp.operational_position]
    );
  }
}

async function getGroup(groupId) {
  const { rows } = await pool.query(`SELECT * FROM payroll_groups WHERE id = $1`, [groupId]);
  return rows[0] || null;
}

async function listPayrollGroups(periodId) {
  await ensurePayrollGroups(periodId);
  const activeEmployees = await activeEmployeesForPeriod(periodId);

  const activeCountByGroup = new Map();
  for (const emp of activeEmployees) {
    const key = `${emp.contract_id}|${emp.municipality_id || 0}|${norm(emp.operational_position)}`;
    activeCountByGroup.set(key, (activeCountByGroup.get(key) || 0) + 1);
  }

  const { rows } = await pool.query(
    `SELECT pg.*, m.name AS municipality_name,
            COUNT(DISTINCT pi.employee_id)::int                                      AS employees,
            COUNT(DISTINCT pn.id)::int                                               AS novelties,
            COUNT(DISTINCT pn.id) FILTER (WHERE pn.reviewed = true)::int             AS reviewed,
            COUNT(DISTINCT ns.id) FILTER (WHERE ns.status = 'pendiente')::int        AS pending_supports,
            COUNT(DISTINCT pi.id) FILTER (WHERE pi.reviewed = true)::int             AS items_reviewed,
            COALESCE(SUM(pi.total_devengado),0)::bigint                              AS total_devengado,
            COALESCE(SUM(pi.total_deducciones),0)::bigint                            AS total_deducciones,
            COALESCE(SUM(pi.neto_pagar),0)::bigint                                   AS neto
       FROM payroll_groups pg
       LEFT JOIN municipalities m      ON m.id = pg.municipality_id
       LEFT JOIN payroll_items pi      ON pi.group_id = pg.id
       LEFT JOIN payroll_novelties pn  ON pn.payroll_item_id = pi.id
       LEFT JOIN novelty_supports ns   ON ns.novelty_id = pn.id
      WHERE pg.period_id = $1
      GROUP BY pg.id, m.name
      ORDER BY UPPER(pg.operational_position), m.name NULLS LAST`,
    [periodId]
  );

  const positions = new Map();
  for (const row of rows) {
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
    const activeKey = `${row.contract_id}|${row.municipality_id || 0}|${norm(row.operational_position)}`;
    const item = {
      id:                row.id,
      municipality_id:   row.municipality_id,
      municipality_name: row.municipality_name || "Sin municipio",
      status:            row.status,
      employees:         Number(row.employees || activeCountByGroup.get(activeKey) || 0),
      novelties:         Number(row.novelties || 0),
      reviewed:          Number(row.reviewed || 0),
      items_reviewed:    Number(row.items_reviewed || 0),
      pending_supports:  Number(row.pending_supports || 0),
      total_devengado:   Number(row.total_devengado || 0),
      total_deducciones: Number(row.total_deducciones || 0),
      neto:              Number(row.neto || 0),
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
  return { positions: Array.from(positions.values()), groups: rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULAR GRUPO DE NÓMINA
// ─────────────────────────────────────────────────────────────────────────────
async function calculatePayrollGroup(groupId) {
  const group = await getGroup(groupId);
  if (!group) throw new Error("Grupo de nomina no encontrado");
  if (group.status === "cerrada") throw new Error("El grupo ya esta cerrado");

  // Todos los empleados activos del período (para contar peers CAARES por site_id)
  const allPeriodEmployees = await activeEmployeesForPeriod(group.period_id);

  // Empleados de este grupo específico
  const groupEmployees = allPeriodEmployees.filter((emp) =>
    emp.contract_id === group.contract_id &&
    emp.municipality_id === group.municipality_id &&
    norm(emp.operational_position) === norm(group.operational_position)
  );

  // Configuración salarial desde DB (o fallback JSON)
  const salaryCategories = await getSalaryCategories(group.contract_id);

  // Novedades del período para este municipio
  const { rows: novelties } = await pool.query(
    `SELECT * FROM payroll_novelties
      WHERE payroll_period_id = $1 AND municipality_id = $2`,
    [group.period_id, group.municipality_id]
  );

  // Coberturas de turno del período
  const { rows: covers } = await pool.query(
    `SELECT * FROM payroll_turn_covers WHERE payroll_period_id = $1`,
    [group.period_id]
  );

  const cfg = getPayrollConfig();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // DEBUG: mostrar mapa completo de categorías para verificar other_recargos
    console.log("[PAYROLL CATEGORIES]", JSON.stringify(salaryCategories, null, 2));

    for (const emp of groupEmployees) {
      // Clasificar usando site_id
      const categoryCode = classifySiteModality(emp, allPeriodEmployees);
      emp.salary_category = categoryCode;

      // Obtener configuración salarial para la categoría
      const salConfig = salaryCategories[categoryCode] || {
        base_salary:         n(cfg.modalitySalaries?.[categoryCode] || cfg.smlmv || 0),
        transport_allowance: n(cfg.transportAllowance || 0),
        other_recargos:      0,
      };

      // DEBUG: por empleado
      console.log(`[PAYROLL CATEGORY] ${emp.employee_name} → ${categoryCode}`, salConfig);

      // Novedades del empleado
      const empNovelties = novelties.filter(
        (x) => String(x.employee_id) === String(emp.employee_id)
      );

      // Cambio operativo: usa cálculo proporcional si existe la novedad
      const cambioNov = empNovelties.find((x) => x.novelty_type === "CAMBIO_OPERATIVO_COBERTURA");
      const amounts = cambioNov
        ? calculateAmountsWithCambio(emp, salConfig, empNovelties, covers, cambioNov, salaryCategories)
        : calculateEmployeeAmounts(emp, salConfig, empNovelties, covers);

      await client.query(
        `INSERT INTO payroll_items (
           group_id, period_id, employee_id, employee_name, document_number,
           company_id, contract_id, municipality_id, municipality_name,
           institution_id, institution_name, site_id, site_name,
           modality, operational_position, work_time_type,
           salary_category, worked_days,
           base_salary, transport_allowance, other_earnings,
           total_devengado, total_deducciones, neto_pagar,
           calculation, updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())
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
           updated_at         = NOW()
         WHERE payroll_items.reviewed IS NOT TRUE`,
        [
          group.id, group.period_id, emp.employee_id, emp.employee_name, emp.document_number,
          emp.company_id, emp.contract_id, emp.municipality_id, emp.municipality_name,
          emp.institution_id, emp.institution_name, emp.site_id, emp.site_name,
          emp.modality, emp.operational_position, emp.work_time_type,
          categoryCode, amounts.worked_days,
          amounts.base_salary, amounts.transport_allowance, amounts.other_earnings,
          amounts.total_devengado, amounts.total_deducciones, amounts.neto_pagar,
          JSON.stringify(amounts.calculation),
        ]
      );
    }

    await client.query(
      `UPDATE payroll_groups SET status = 'en_revision', updated_at = NOW() WHERE id = $1`,
      [group.id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getPayrollGroupDetail(group.period_id, group.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// DETALLE DE GRUPO (items + novedades + soportes)
// ─────────────────────────────────────────────────────────────────────────────
async function getPayrollGroupDetail(periodId, groupId) {
  const group = await getGroup(groupId);
  if (!group || Number(group.period_id) !== Number(periodId)) {
    throw new Error("Grupo de nomina no encontrado");
  }

  const [
    { rows: items },
    { rows: novelties },
    { rows: supports },
    { rows: periodCovers },
    salaryCategories,
  ] = await Promise.all([
    pool.query(
      `SELECT pi.*,
              COUNT(pn.id)::int                                           AS novelty_count,
              COUNT(pn.id) FILTER (WHERE pn.reviewed = true)::int         AS reviewed_count,
              COUNT(ns.id) FILTER (WHERE ns.status = 'pendiente')::int    AS pending_supports
         FROM payroll_items pi
         LEFT JOIN payroll_novelties pn ON pn.payroll_item_id = pi.id
         LEFT JOIN novelty_supports  ns ON ns.novelty_id = pn.id
        WHERE pi.group_id = $1
        GROUP BY pi.id
        ORDER BY pi.employee_name`,
      [groupId]
    ),
    pool.query(
      `SELECT pn.*, pi.employee_name, pi.document_number, pi.reviewed AS item_reviewed,
              pnt.name AS novelty_name,
              pnt.affects_salary, pnt.affects_transport, pnt.requires_turn_cover,
              ptc.id AS turn_cover_id
         FROM payroll_novelties pn
         LEFT JOIN payroll_items pi          ON pi.id = pn.payroll_item_id
         LEFT JOIN payroll_novelty_types pnt ON pnt.code = pn.novelty_type
         LEFT JOIN payroll_turn_covers ptc   ON ptc.novelty_id = pn.id
        WHERE pn.payroll_period_id = $1
          AND (
            pn.payroll_item_id IN (SELECT id FROM payroll_items WHERE group_id = $2)
            OR pn.municipality_id = $3
          )
        ORDER BY pn.created_at DESC`,
      [periodId, groupId, group.municipality_id]
    ),
    pool.query(
      `SELECT ns.*, pn.novelty_type, pi.employee_name, pi.document_number,
              m.name AS municipality_name
         FROM novelty_supports ns
         LEFT JOIN payroll_novelties pn ON pn.id = ns.novelty_id
         LEFT JOIN payroll_items pi     ON pi.id = pn.payroll_item_id
         LEFT JOIN municipalities m     ON m.id = ns.municipality_id
        WHERE ns.payroll_period_id = $1 AND ns.municipality_id = $2
        ORDER BY ns.created_at DESC`,
      [periodId, group.municipality_id]
    ),
    pool.query(
      `SELECT * FROM payroll_turn_covers WHERE payroll_period_id = $1`,
      [periodId]
    ),
    getSalaryCategories(group.contract_id),
  ]);

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
      base_salary:         amounts.base_salary,
      transport_allowance: amounts.transport_allowance,
      other_earnings:      amounts.other_earnings,
      total_devengado:     amounts.total_devengado,
      total_deducciones:   amounts.total_deducciones,
      neto_pagar:          amounts.neto_pagar,
      worked_days:         amounts.worked_days,
      calculation:         amounts.calculation,
    };
  });

  const totals = normalizedItems.reduce(
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

  return { group, items: normalizedItems, novelties, supports, totals };
}

// ─────────────────────────────────────────────────────────────────────────────
// RECALCULAR ITEM TRAS CAMBIO DE NOVEDAD
// Actualiza base_salary, transport_allowance, total_devengado, neto_pagar, etc.
// en payroll_items aplicando todas las novedades actuales del empleado.
// ─────────────────────────────────────────────────────────────────────────────
async function recalculatePayrollItem(itemId) {
  const { rows: itemRows } = await pool.query(
    `SELECT * FROM payroll_items WHERE id = $1`,
    [itemId]
  );
  const item = itemRows[0];
  if (!item || item.reviewed) return item; // no tocar revisados

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
  const { rows: covers } = await pool.query(
    `SELECT * FROM payroll_turn_covers WHERE payroll_period_id = $1`,
    [item.period_id]
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
  return updated[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR NOVEDAD
// ─────────────────────────────────────────────────────────────────────────────
async function createNoveltyForItem(itemId, payload = {}, userId) {
  const { rows: itemRows } = await pool.query(`SELECT * FROM payroll_items WHERE id = $1`, [itemId]);
  const item = itemRows[0];
  if (!item) throw new Error("Empleado de nomina no encontrado");
  if (item.reviewed) {
    const err = new Error("Registro de nómina bloqueado por revisión.");
    err.httpStatus = 403;
    throw err;
  }

  // Normalizar y validar tipo oficial
  const rawInput = text(payload.novelty_type || payload.noveltyType || "");
  console.log("[NOVELTY PAYLOAD]", JSON.stringify({ item_id: itemId, ...payload }));
  let typeRaw;
  try {
    typeRaw = normalizeNoveltyType(rawInput);
  } catch (validationErr) {
    throw new Error(validationErr.message);
  }
  console.log("[NOVELTY TYPE NORMALIZED]", typeRaw);
  if (typeRaw === "CAMBIO_OPERATIVO_COBERTURA") {
    throw new Error("Use el endpoint /payroll/items/:id/cambio-operativo para registrar cambios operativos de cobertura");
  }

  // Auto-calcular días desde fechas si no se proveen
  const startDate = payload.start_date || payload.startDate || null;
  const endDate   = payload.end_date   || payload.endDate   || null;
  let days = n(payload.days);
  if (!days && startDate && endDate) {
    const diff = (new Date(endDate) - new Date(startDate)) / 86400000;
    days = Math.max(1, Math.round(diff) + 1);
  }

  if (days <= 0) throw new Error("Los días de la novedad deben ser mayor a 0");

  // Obtener metadatos del tipo de novedad desde DB
  const { rows: typeRows } = await pool.query(
    `SELECT * FROM payroll_novelty_types WHERE code = $1`,
    [typeRaw]
  );
  const noveltyTypeMeta = typeRows[0] || {};
  const supportRequired  = Boolean(payload.support_required ?? payload.supportRequired ?? noveltyTypeMeta.requires_support ?? false);

  const { rows: inserted } = await pool.query(
    `INSERT INTO payroll_novelties (
       payroll_item_id, payroll_period_id, employee_id, employee_name, document_number,
       company_id, contract_id, municipality_id, institution_id, site_id,
       operational_position, novelty_type, start_date, end_date, days,
       value, observations, description, support_required, support_status, status,
       created_by_user_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'PENDIENTE',$21)
     RETURNING *`,
    [
      item.id, item.period_id, item.employee_id, item.employee_name, item.document_number,
      item.company_id, item.contract_id, item.municipality_id, item.institution_id, item.site_id,
      item.operational_position, typeRaw, startDate, endDate, days,
      n(payload.value), text(payload.observations || payload.description),
      text(payload.description || payload.observations),
      supportRequired, supportRequired ? "pendiente" : "aprobado",
      id(userId),
    ]
  );

  if (supportRequired) {
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

  // Recalcular el item inmediatamente para reflejar el impacto de la novedad
  await recalculatePayrollItem(item.id);

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

  return inserted[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// EDITAR NOVEDAD (bloqueada si está revisada)
// ─────────────────────────────────────────────────────────────────────────────
async function patchNovelty(noveltyId, payload = {}, userId) {
  const { rows: current } = await pool.query(
    `SELECT * FROM payroll_novelties WHERE id = $1`,
    [noveltyId]
  );
  const novelty = current[0];
  if (!novelty) throw new Error("Novedad no encontrada");
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

  const updates = [];
  const values  = [noveltyId];

  const allowed = {
    novelty_type:     (v) => text(v).toUpperCase(),
    start_date:       (v) => v || null,
    end_date:         (v) => v || null,
    days:             n,
    value:            n,
    observations:     text,
    description:      text,
    support_required: Boolean,
    support_status:   text,
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

  // Recalcular el item para reflejar el nuevo impacto
  if (novelty.payroll_item_id) {
    await recalculatePayrollItem(novelty.payroll_item_id);
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

  // No permitir quitar revisión si el grupo está cerrado
  if (!reviewed && current[0].group_status === "cerrada") {
    const err = new Error("No se puede modificar una nómina cerrada.");
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
    `SELECT * FROM payroll_novelties WHERE id = $1`,
    [noveltyId]
  );
  const novelty = novRows[0];
  if (!novelty) throw new Error("Novedad no encontrada");
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

  const coverType = norm(payload.cover_type || payload.coverType) === "EXTERNA" ? "EXTERNA" : "INTERNA";
  const days      = n(payload.days || novelty.days || 1) || 1;

  // Obtener valor_dia
  // Si se provee explícito se usa; si no se calcula desde la categoría salarial
  let valuePerDay = n(payload.value_per_day || payload.valueDay || payload.valor_dia);
  if (!valuePerDay) {
    const categories = await getSalaryCategories(novelty.contract_id);
    // Usar la modalidad del payload o del empleado de nómina
    const empMod = text(payload.modality || payload.modalidad);
    const item = await pool.query(`SELECT * FROM payroll_items WHERE id = $1`, [novelty.payroll_item_id]);
    const itemRow = item.rows[0];
    const category = itemRow?.salary_category || (empMod === "RI" ? "RI" : "CAA1");
    const sal = categories[category] || { base_salary: 0, transport_allowance: 0, other_recargos: 0 };
    valuePerDay = Math.round(
      (sal.base_salary + sal.transport_allowance + sal.other_recargos) / 30
    );
  }

  let externalWorkerId  = null;
  let internalEmployeeId = null;

  if (coverType === "INTERNA") {
    internalEmployeeId = id(payload.internal_employee_id || payload.employee_id || payload.employeeId);
    if (!internalEmployeeId) throw new Error("Debe seleccionar el empleado interno que cubrio la novedad");
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
        text(payload.modality      || payload.modalidad),
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
    `UPDATE payroll_novelties SET cover_type = $2, value = $3, updated_at = NOW() WHERE id = $1`,
    [novelty.id, coverType, days * valuePerDay]
  );

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

  return { ...coverRows[0], external_worker_id: externalWorkerId };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF HTML: CUENTA DE COBRO PARA EXTERNO
// ─────────────────────────────────────────────────────────────────────────────
async function buildChargeAccountHtml(coverId) {
  const { rows } = await pool.query(
    `SELECT ptc.*,
            pn.novelty_type, pn.start_date, pn.end_date, pn.days AS nov_days,
            pn.observations AS nov_obs,
            etw.full_name, etw.document_number, etw.phone, etw.bank,
            etw.account_type, etw.account_number,
            m.name AS municipality_name,
            i.name AS institution_name,
            s.name AS site_name,
            pi.modality, pi.salary_category,
            pp.label AS period_label, pp.period_start, pp.period_end
       FROM payroll_turn_covers ptc
       JOIN payroll_novelties pn     ON pn.id = ptc.novelty_id
       JOIN external_turn_workers etw ON etw.id = ptc.external_worker_id
       JOIN payroll_items pi          ON pi.id = ptc.payroll_item_id
       JOIN payroll_periods pp        ON pp.id = ptc.payroll_period_id
       LEFT JOIN municipalities m     ON m.id = pi.municipality_id
       LEFT JOIN institutions i       ON i.id = pi.institution_id
       LEFT JOIN educational_sites s  ON s.id = pi.site_id
      WHERE ptc.id = $1 AND ptc.cover_type = 'EXTERNA'
      LIMIT 1`,
    [coverId]
  );
  const r = rows[0];
  if (!r) throw new Error("Cuenta de cobro no encontrada o el turno no es externo");

  const fmt = (v) =>
    Number(v || 0).toLocaleString("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    });

  const today = new Date().toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cuenta de Cobro</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;padding:30px;max-width:700px;margin:auto}
  h1{font-size:20px;text-align:center;margin-bottom:4px}
  .sub{text-align:center;font-size:12px;color:#555;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  td,th{padding:7px 10px;border:1px solid #ccc}
  th{background:#f0f0f0;font-weight:700;text-align:left}
  .total-row td{font-weight:700;font-size:15px;background:#e8f5e9}
  .firma{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
  .firma-box{border-top:1px solid #555;padding-top:6px;text-align:center;font-size:12px}
  @media print{body{padding:10px}.no-print{display:none}}
</style>
</head>
<body>
<button class="no-print" onclick="window.print()" style="margin-bottom:16px;padding:8px 16px;cursor:pointer;background:#0F766E;color:#fff;border:none;border-radius:6px;font-size:13px">
  Imprimir / Descargar PDF
</button>

<h1>CUENTA DE COBRO</h1>
<div class="sub">Fecha: ${today}</div>

<table>
  <tr><th>Nombre completo</th><td>${r.full_name || ""}</td></tr>
  <tr><th>Cédula de ciudadanía</th><td>${r.document_number || ""}</td></tr>
  <tr><th>Teléfono</th><td>${r.phone || "—"}</td></tr>
  <tr><th>Banco</th><td>${r.bank || "—"}</td></tr>
  <tr><th>Tipo de cuenta</th><td>${r.account_type || "—"}</td></tr>
  <tr><th>Número de cuenta</th><td>${r.account_number || "—"}</td></tr>
</table>

<table>
  <tr><th>Municipio</th><td>${r.municipality_name || "—"}</td></tr>
  <tr><th>Institución</th><td>${r.institution_name || "—"}</td></tr>
  <tr><th>Sede</th><td>${r.site_name || "—"}</td></tr>
  <tr><th>Modalidad</th><td>${r.modality || "—"}</td></tr>
  <tr><th>Período</th><td>${r.period_label || ""} (${r.period_start || ""} — ${r.period_end || ""})</td></tr>
  <tr><th>Tipo de novedad cubierta</th><td>${r.novelty_type || ""}</td></tr>
  <tr><th>Días cubiertos</th><td>${r.days || r.nov_days || 0}</td></tr>
  <tr><th>Fechas</th><td>${r.start_date || "—"} al ${r.end_date || "—"}</td></tr>
</table>

<table>
  <tr><th>Concepto del servicio</th><td>Cobertura de turno por novedad laboral</td></tr>
  <tr><th>Valor día</th><td>${fmt(r.value_per_day)}</td></tr>
  <tr class="total-row"><td><strong>TOTAL A PAGAR</strong></td><td><strong>${fmt(r.total_value)}</strong></td></tr>
</table>

<div class="firma">
  <div class="firma-box">
    <p>Firma del beneficiario</p>
    <p style="margin-top:4px">C.C. ${r.document_number || ""}</p>
  </div>
  <div class="firma-box">
    <p>Firma y sello del contratante</p>
    <p style="margin-top:4px">Cargo: Representante Legal / Talento Humano</p>
  </div>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOPORTES DOCUMENTALES
// ─────────────────────────────────────────────────────────────────────────────
async function listSupports(filters = {}) {
  const values = [];
  const where  = [];
  if (filters.periodId)      { values.push(id(filters.periodId));      where.push(`ns.payroll_period_id = $${values.length}`); }
  if (filters.status)        { values.push(text(filters.status));       where.push(`ns.status = $${values.length}`); }
  if (filters.municipalityId){ values.push(id(filters.municipalityId)); where.push(`ns.municipality_id = $${values.length}`); }

  const { rows } = await pool.query(
    `SELECT ns.*, pn.novelty_type, pn.description, pi.employee_name, pi.document_number,
            m.name AS municipality_name
       FROM novelty_supports ns
       LEFT JOIN payroll_novelties pn ON pn.id = ns.novelty_id
       LEFT JOIN payroll_items pi     ON pi.id = pn.payroll_item_id
       LEFT JOIN municipalities m     ON m.id = ns.municipality_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ns.created_at DESC`,
    values
  );
  return rows;
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
            pp.label AS period_label, pp.period_start, pp.period_end
       FROM payroll_items pi
       LEFT JOIN municipalities m      ON m.id = pi.municipality_id
       LEFT JOIN institutions i        ON i.id = pi.institution_id
       LEFT JOIN educational_sites s   ON s.id = pi.site_id
       JOIN payroll_periods pp         ON pp.id = pi.period_id
      WHERE pi.id = $1`,
    [itemId]
  );
  if (!itemRows[0]) throw new Error("Item de nómina no encontrado");
  const item = itemRows[0];

  const [{ rows: novRows }, { rows: coverRows }, { rows: myCovers }] = await Promise.all([
    pool.query(
      `SELECT pn.*, pnt.name AS novelty_name, pnt.affects_salary, pnt.affects_transport
         FROM payroll_novelties pn
         LEFT JOIN payroll_novelty_types pnt ON pnt.code = pn.novelty_type
        WHERE pn.payroll_item_id = $1
        ORDER BY pn.created_at`,
      [itemId]
    ),
    pool.query(
      `SELECT ptc.*, etw.full_name AS ext_name, etw.document_number AS ext_doc,
              e.full_name AS int_name
         FROM payroll_turn_covers ptc
         LEFT JOIN external_turn_workers etw ON etw.id = ptc.external_worker_id
         LEFT JOIN employees e               ON e.id = ptc.internal_employee_id
        WHERE ptc.payroll_item_id = $1`,
      [itemId]
    ),
    // Coberturas internas hechas POR este empleado (para que calculateEmployeeAmounts las sume)
    pool.query(
      `SELECT * FROM payroll_turn_covers
        WHERE payroll_period_id = $1 AND cover_type = 'INTERNA' AND internal_employee_id = $2`,
      [item.period_id, item.employee_id]
    ),
  ]);

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
    ? calculateAmountsWithCambio(emp, salConfig, novRows, myCovers, cambioNov, salaryCategories)
    : calculateEmployeeAmounts(emp, salConfig, novRows, myCovers);
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
      other_recargos_value: liveCalc.other_recargos_value != null
        ? n(liveCalc.other_recargos_value)
        : Math.max(0, liveAmounts.other_earnings - n(liveCalc.internal_cover_value)),
      internal_cover_value: n(liveCalc.internal_cover_value),
      total_devengado:      liveAmounts.total_devengado,
    },
    deductions: {
      salud:             n(liveCalc.deduccion_salud),
      pension:           n(liveCalc.deduccion_pension),
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
    novelties:       enrichedNovelties,
    covers:          coverRows,
    calculation:     liveCalc,
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
    `SELECT pn.*, pi.reviewed AS item_reviewed
       FROM payroll_novelties pn
       LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
      WHERE pn.id = $1`,
    [noveltyId]
  );
  const novelty = current[0];
  if (!novelty) throw new Error("Novedad no encontrada");

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

  // Eliminar novedad (cascadea: novelty_supports, payroll_turn_covers)
  await pool.query(`DELETE FROM payroll_novelties WHERE id = $1`, [noveltyId]);

  // Recalcular el item afectado
  if (novelty.payroll_item_id) {
    await recalculatePayrollItem(novelty.payroll_item_id);
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

  // No permitir quitar revisión si el grupo está cerrado
  if (!reviewed && item.group_status === "cerrada") {
    const err = new Error("No se puede modificar una nómina cerrada.");
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
// CERRAR GRUPO DE NÓMINA
// ─────────────────────────────────────────────────────────────────────────────
async function closePayrollGroup(groupId, user = {}) {
  const group = await getGroup(groupId);
  if (!group) throw new Error("Grupo de nómina no encontrado");
  if (group.status === "cerrada") throw new Error("Este grupo ya está cerrado.");

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

  const { rows } = await pool.query(
    `UPDATE payroll_groups
        SET status = 'cerrada', closed_by = $2, closed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [groupId, reviewerId]
  );

  try {
    await pool.query(
      `INSERT INTO audit_logs (module, entity_type, entity_id, action, user_id, user_name, payload)
       VALUES ('payroll', 'payroll_group', $1, 'CLOSE_PAYROLL_GROUP', $2, $3, $4)`,
      [String(groupId), reviewerId, reviewerName,
       JSON.stringify({ group_id: groupId, municipality_id: group.municipality_id, period_id: group.period_id })]
    );
  } catch (_) { /* audit es best-effort */ }

  return rows[0];
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
  buildChargeAccountHtml,
  rowEmployee,
  workTimeKind,
  classifySiteModality,
  OFFICIAL_NOVELTY_CODES,
  SALARY_AFFECTING,
  TRANSPORT_AFFECTING,
  normalizeNoveltyType,
  setItemReviewed,
  recalculatePayrollItem,
  deleteNovelty,
  closePayrollGroup,
  getCoverageStatsForGroup,
};
