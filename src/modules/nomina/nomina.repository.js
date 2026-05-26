"use strict";

const pool = require("../../db/pool");

// ── Tipos de novedad PAE (misma lógica que la calculadora) ───────────────────

const NOVELTY_TYPES = {
  incapacidad_eps: { label: "Incapacidad EPS",           paid: true,  coverage: "EPS" },
  incapacidad_arl: { label: "Incapacidad ARL",           paid: true,  coverage: "ARL" },
  licencia_mat:    { label: "Licencia de maternidad",    paid: true,  coverage: "EPS" },
  licencia_nr:     { label: "Licencia no remunerada",    paid: false, coverage: null  },
  ausencia:        { label: "Ausencia injustificada",    paid: false, coverage: null  },
  suspension:      { label: "Suspensión disciplinaria",  paid: false, coverage: null  },
};

// ── Derivar modalidad específica (CAARES1-4 / CAA1-2 / RI) ───────────────────

function deriveModalityClass(modality, workdayType, siteTcCount) {
  const mod = String(modality    || "").toUpperCase().trim();
  const wt  = String(workdayType || "").toUpperCase().trim();
  if (mod === "RI") return "RI";
  if (mod.includes("CAARES")) {
    if (wt === "TC") return siteTcCount <= 1 ? "CAARES1" : "CAARES3";
    return siteTcCount <= 1 ? "CAARES2" : "CAARES4";
  }
  return wt === "MT" ? "CAA2" : "CAA1";
}

// ── Motor de cálculo (misma lógica que calculator.js) ────────────────────────

function calcLineHoras(salaryConfig, modClass, horasDiarias) {
  const modCfg     = (salaryConfig.modalities || {})[modClass] || {};
  const smlv       = salaryConfig.smlv           || 1_750_905;
  const salaryBase = modCfg.salary               || smlv;
  const valorHora  = Math.round(salaryBase / 240);
  const totalHoras = (horasDiarias || []).reduce((s, d) => s + (Number(d.horas) || 0), 0);
  const workedDays = (horasDiarias || []).filter(d => (Number(d.horas) || 0) > 0).length;
  const devengado  = Math.round(valorHora * totalHoras);
  const salud      = Math.ceil(devengado * 0.04 / 100) * 100;
  const pension    = salud;
  const totalDed   = salud * 2;
  const neto       = devengado - totalDed;
  return {
    valorHora, totalHoras, devengado, workedDays,
    salaryBase, dailySalary: Math.round(salaryBase / 30),
    baseEarned: devengado, extraShiftAmount: 0, otherEarnings: 0,
    salarioProp: devengado, auxTrans: 0, adicsCalc: [], totalAdics: 0,
    totalDev: devengado, salud, pension, totalDed, neto,
  };
}

function calcLine(salaryConfig, modClass, diasNoClase, novedades, turnos = []) {
  const modCfg     = (salaryConfig.modalities || {})[modClass] || {};
  const smlv       = salaryConfig.smlv           || 1_750_905;
  const auxCfg     = salaryConfig.aux_transporte || 249_095;
  const salaryBase = modCfg.salary               || smlv;
  const adicionales = (modCfg.adicionales || []).filter(
    a => String(a.label || "").trim() && Number(a.value) > 0
  );

  const diasSinPago       = novedades.filter(n => !n.paid).reduce((s, n) => s + (n.days || 0), 0);
  const diasCubiertos     = novedades.filter(n =>  n.paid).reduce((s, n) => s + (n.days || 0), 0);
  const diasConSalario    = Math.max(0, 30 - diasSinPago);
  const diasConTransporte = Math.max(0, 30 - diasNoClase - diasSinPago - diasCubiertos);
  const dailySalary = salaryBase / 30;
  const salarioProp = Math.round(dailySalary * diasConSalario);
  const turnosInfo = (Array.isArray(turnos) ? turnos : []).map(t => {
    const turnoCfg      = (salaryConfig.modalities || {})[t.modalidad] || modCfg;
    const salarioTurno  = turnoCfg.salary || smlv;
    const diasTurno     = Math.max(0, Number(t.dias) || 0);
    const valorUnitario = Math.round(salarioTurno / 30);
    const totalTurno    = Math.round(valorUnitario * diasTurno);
    return {
      modalidad: t.modalidad,
      dias: diasTurno,
      salario: salarioTurno,
      salarioMensual: salarioTurno,
      valorUnitario,
      total: totalTurno,
      prop: totalTurno,
    };
  });
  const extraShiftAmount = turnosInfo.reduce((s, t) => s + t.total, 0);
  const auxTrans    = Math.round(auxCfg    / 30 * diasConTransporte);
  const adicsCalc   = adicionales.map(a => ({
    label: a.label,
    base:  Number(a.value),
    prop:  Math.round(Number(a.value) / 30 * diasConTransporte),
  }));
  const totalAdics = adicsCalc.reduce((s, a) => s + a.prop, 0);
  const otherEarnings = auxTrans + totalAdics;
  const totalDev   = salarioProp + extraShiftAmount + otherEarnings;
  const salud      = Math.ceil(salarioProp * 0.04 / 100) * 100;
  const pension    = salud;
  const totalDed   = salud * 2;
  const neto       = totalDev - totalDed;

  return {
    diasSinPago, diasCubiertos, diasConSalario, diasConTransporte,
    salaryBase,
    dailySalary,
    workedDays: diasConSalario,
    salarioProp,
    baseEarned: salarioProp,
    turnosInfo,
    extraShiftAmount,
    auxTrans,
    adicsCalc,
    totalAdics,
    otherEarnings,
    totalDev,
    grossEarned: totalDev,
    salud, pension, totalDed, neto,
  };
}

function extractPayrollBreakdown(row) {
  const snapshot = row && row.salary_snapshot && typeof row.salary_snapshot === "object" && !Array.isArray(row.salary_snapshot)
    ? row.salary_snapshot
    : {};
  const saved = snapshot.payrollBreakdown && typeof snapshot.payrollBreakdown === "object" && !Array.isArray(snapshot.payrollBreakdown)
    ? snapshot.payrollBreakdown
    : {};
  const transportAllowance = Number(row.transport_allowance || 0);
  const configuredEarnings = Number(row.other_earnings || 0);
  const baseEarned         = Number(saved.baseEarned || row.base_salary || 0);
  const totalDev           = Number(row.total_devengado || 0);
  const salaryFromConfig   = snapshot.modalities && row.modality_class
    ? Number((snapshot.modalities[row.modality_class] || {}).salary || 0)
    : 0;

  return {
    baseSalaryMonthly: Number(saved.baseSalaryMonthly || salaryFromConfig || baseEarned),
    workedDays: Number(saved.workedDays || row.worked_days || 0),
    dailySalary: Number(saved.dailySalary || 0),
    baseEarned,
    extraShiftAmount: Number(saved.extraShiftAmount || 0),
    otherEarnings: Number(saved.otherEarnings ?? (transportAllowance + configuredEarnings)),
    transportAllowance: Number(saved.transportAllowance ?? transportAllowance),
    configuredEarnings: Number(saved.configuredEarnings ?? configuredEarnings),
    grossEarned: Number(saved.grossEarned || totalDev || (baseEarned + transportAllowance + configuredEarnings)),
    turnos: Array.isArray(saved.turnos) ? saved.turnos : [],
  };
}

// ── Empleados del contrato con modalidad derivada ─────────────────────────────

async function getContractEmployees(contractId, municipalityIds = null) {
  const params = [contractId];
  const extraWhere = [];
  if (Array.isArray(municipalityIds) && municipalityIds.length > 0) {
    params.push(municipalityIds);
    extraWhere.push(`e.municipality_id = ANY($${params.length})`);
  }
  const munFilter = extraWhere.length ? ` AND ${extraWhere.join(" AND ")}` : "";

  const { rows } = await pool.query(`
    SELECT
      e.id, e.full_name, e.document_number, e.document_type,
      e.modality, e.workday_type, e.status,
      e.real_position,
      e.site_id, e.institution_id,
      s.name AS site_name,
      i.name AS institution_name,
      m.name AS municipality_name,
      (
        SELECT COUNT(*)::int FROM employees e2
        WHERE e2.contract_id = e.contract_id
          AND e2.site_id = e.site_id
          AND UPPER(COALESCE(e2.workday_type, '')) = 'TC'
          AND e2.status = 'ACTIVO'
      ) AS site_tc_count
    FROM employees e
    LEFT JOIN educational_sites s ON s.id = e.site_id
    LEFT JOIN institutions      i ON i.id = e.institution_id
    LEFT JOIN municipalities    m ON m.id = e.municipality_id
    WHERE e.contract_id = $1 AND e.status = 'ACTIVO'${munFilter}
    ORDER BY s.name NULLS LAST, e.full_name
  `, params);

  return rows.map(r => ({
    id:              r.id,
    fullName:        r.full_name        || "",
    documentNumber:  r.document_number  || "",
    documentType:    r.document_type    || "",
    modality:        r.modality         || "",
    workdayType:     r.workday_type     || "",
    cargo:           r.real_position    || "",
    siteName:        r.site_name        || "",
    institutionName: r.institution_name || "",
    municipalityName: r.municipality_name || "",
    modalityClass:   deriveModalityClass(r.modality, r.workday_type, r.site_tc_count),
  }));
}

async function getSalaryConfigForContract(contractId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(salary_config, '{}') AS sc FROM contract_settings WHERE contract_id = $1`,
    [contractId]
  );
  return rows[0]?.sc || {};
}

// ── Períodos ──────────────────────────────────────────────────────────────────

async function listPeriods(contractId) {
  const { rows } = await pool.query(`
    SELECT
      pp.*,
      u.full_name AS creator_name,
      (SELECT COUNT(*)::int FROM payroll_results pr WHERE pr.period_id = pp.id) AS employee_count,
      (SELECT COALESCE(SUM(pr.neto_pagar),0)::bigint FROM payroll_results pr WHERE pr.period_id = pp.id) AS total_neto
    FROM payroll_periods pp
    LEFT JOIN users u ON u.id = pp.created_by
    WHERE pp.contract_id = $1
    ORDER BY pp.period_start DESC
  `, [contractId]);
  return rows;
}

async function createPeriod(contractId, companyId, periodStr, label, userId) {
  const [y, m] = periodStr.split("-").map(Number);
  const periodStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const periodEnd   = `${y}-${String(m).padStart(2, "0")}-30`;

  const { rows } = await pool.query(`
    INSERT INTO payroll_periods
      (company_id, contract_id, period_start, period_end, label, status, created_by)
    VALUES ($1, $2, $3, $4, $5, 'BORRADOR', $6)
    ON CONFLICT (company_id, contract_id, period_start)
    DO UPDATE SET label = EXCLUDED.label
    RETURNING *
  `, [companyId, contractId, periodStart, periodEnd, label, userId]);
  return rows[0];
}

async function getPeriodById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM payroll_periods WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

async function getPeriodResults(periodId) {
  const { rows } = await pool.query(
    `SELECT * FROM payroll_results WHERE period_id = $1 ORDER BY employee_name`,
    [periodId]
  );
  return rows.map(r => {
    const breakdown = extractPayrollBreakdown(r);
    return {
      id:              r.id,
      employeeId:      r.employee_id,
      employeeName:    r.employee_name,
      documentNumber:  r.document_number,
      site:            r.site,
      institution:     r.institution,
      municipality:    r.municipality,
      modality:        r.modality,
      modalityClass:   r.modality_class,
      workdayType:     r.work_time_type,
      payrollType:     r.payroll_type   || "mensual",
      diasNoClase:     Number(r.dias_no_clase   || 0),
      novedades:       Array.isArray(r.novedades_detalle)   ? r.novedades_detalle   : [],
      adicionales:     Array.isArray(r.adicionales_detalle) ? r.adicionales_detalle : [],
      horasDiarias:    Array.isArray(r.horas_diarias)       ? r.horas_diarias       : [],
      turnos:          breakdown.turnos,
      salarioMensual:  breakdown.baseSalaryMonthly,
      salarioDiario:   breakdown.dailySalary,
      workedDays:      breakdown.workedDays,
      devengadoBase:   breakdown.baseEarned,
      turnosExtra:     breakdown.extraShiftAmount,
      otrosDevengos:   breakdown.otherEarnings,
      salarioProp:     breakdown.baseEarned,
      auxTrans:        breakdown.transportAllowance,
      totalAdics:      breakdown.configuredEarnings,
      totalDev:        Number(r.total_devengado),
      salud:           Number(r.deduccion_salud),
      pension:         Number(r.deduccion_pension),
      totalDed:        Number(r.total_deducciones),
      neto:            Number(r.neto_pagar),
      calculatedAt:    r.calculated_at,
    };
  });
}

// ── Guardar liquidación ───────────────────────────────────────────────────────

async function savePeriodLines(periodId, contractId, companyId, lines, salarySnapshot) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM payroll_results WHERE period_id = $1", [periodId]);

    for (const line of lines) {
      const calc = line.calc;
      const baseSnapshot = salarySnapshot && typeof salarySnapshot === "object" && !Array.isArray(salarySnapshot)
        ? salarySnapshot
        : {};
      const lineSnapshot = {
        ...baseSnapshot,
        payrollBreakdown: {
          baseSalaryMonthly: Number(calc.salaryBase || 0),
          workedDays: Number(calc.workedDays || 0),
          dailySalary: Number(calc.dailySalary || 0),
          baseEarned: Number(calc.baseEarned || calc.salarioProp || 0),
          extraShiftAmount: Number(calc.extraShiftAmount || 0),
          transportAllowance: Number(calc.auxTrans || 0),
          configuredEarnings: Number(calc.totalAdics || 0),
          otherEarnings: Number(calc.otherEarnings || ((calc.auxTrans || 0) + (calc.totalAdics || 0))),
          grossEarned: Number(calc.totalDev || 0),
          turnos: Array.isArray(calc.turnosInfo) ? calc.turnosInfo : [],
        },
      };
      await client.query(`
        INSERT INTO payroll_results (
          period_id, employee_id, employee_name, document_number,
          company_id, contract_id, municipality, institution, site,
          modality, modality_class, work_time_type, worked_days,
          base_salary, transport_allowance, other_earnings,
          total_devengado, deduccion_salud, deduccion_pension, total_deducciones,
          novedad_descuento, neto_pagar, observations,
          dias_no_clase, novedades_detalle, adicionales_detalle, salary_snapshot,
          horas_diarias, payroll_type
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,$18,$19,$20,0,$21,'',
          $22,$23,$24,$25,$26,$27
        )
      `, [
        periodId,
        line.employeeId, line.fullName, line.documentNumber,
        companyId, contractId,
        line.municipalityName || "", line.institutionName || "", line.siteName || "",
        line.modality || "", line.modalityClass || "", line.workdayType || "",
        Number(calc.workedDays || 0),
        calc.salarioProp, calc.auxTrans, ((calc.totalAdics || 0) + (calc.extraShiftAmount || 0)),
        calc.totalDev, calc.salud, calc.pension, calc.totalDed,
        calc.neto,
        line.diasNoClase || 0,
        JSON.stringify(line.novedades || []),
        JSON.stringify(calc.adicsCalc || []),
        JSON.stringify(lineSnapshot),
        JSON.stringify(line.horasDiarias || []),
        line.payrollType || "mensual",
      ]);
    }

    await client.query(
      `UPDATE payroll_periods SET status = 'CALCULADO' WHERE id = $1`, [periodId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function closePeriod(periodId) {
  const { rows } = await pool.query(`
    UPDATE payroll_periods
      SET status = 'CERRADO', closed_at = NOW()
    WHERE id = $1 AND status = 'CALCULADO'
    RETURNING *
  `, [periodId]);
  if (!rows[0]) throw new Error("El período debe estar calculado antes de cerrar");
  return rows[0];
}

// ── Exportar Excel ────────────────────────────────────────────────────────────

async function generateExcelBuffer(periodId) {
  const XLSX = require("xlsx");
  const period  = await getPeriodById(periodId);
  if (!period) throw new Error("Período no encontrado");
  const results = await getPeriodResults(periodId);

  const fmtCOP = n => `$${Number(n).toLocaleString("es-CO")}`;

  const header = [
    "Empleado", "Documento", "Sede", "Institución", "Municipio",
    "Modalidad", "Jornada",
    "Días no clase", "Días sin pago", "Días cubiertos",
    "Días con salario", "Días con transporte",
    "Salario mensual", "Salario diario", "Devengado base", "Turnos extra", "Otros devengos",
    "Total devengado", "Salud 4%", "Pensión 4%", "Total deducciones", "Neto a pagar",
  ];

  const dataRows = results.map(r => {
    const diasSinPago       = r.novedades.filter(n => !n.paid).reduce((s, n) => s + n.days, 0);
    const diasCubiertos     = r.novedades.filter(n =>  n.paid).reduce((s, n) => s + n.days, 0);
    const diasConTransporte = Math.max(0, 30 - r.diasNoClase - diasSinPago - diasCubiertos);
    return [
      r.employeeName, r.documentNumber, r.site, r.institution, r.municipality,
      r.modality, r.workdayType,
      r.diasNoClase, diasSinPago, diasCubiertos,
      r.workedDays, diasConTransporte,
      r.salarioMensual, r.salarioDiario, r.devengadoBase, r.turnosExtra, r.otrosDevengos,
      r.totalDev, r.salud, r.pension, r.totalDed, r.neto,
    ];
  });

  const totals = results.reduce(
    (a, r) => ({ dev: a.dev + r.totalDev, ded: a.ded + r.totalDed, neto: a.neto + r.neto }),
    { dev: 0, ded: 0, neto: 0 }
  );
  const totRow = ["TOTALES", "", "", "", "", "", "", "", "", "", "", "",
    "", "", "", "", "", totals.dev, "", "", totals.ded, totals.neto];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows, totRow]);

  // Column widths
  ws["!cols"] = [
    { wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 28 }, { wch: 18 },
    { wch: 10 }, { wch: 8 },
    { wch: 11 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 16 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Nómina");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = {
  calcLineHoras,
  NOVELTY_TYPES,
  deriveModalityClass,
  calcLine,
  getContractEmployees,
  getSalaryConfigForContract,
  listPeriods,
  createPeriod,
  getPeriodById,
  getPeriodResults,
  savePeriodLines,
  closePeriod,
  generateExcelBuffer,
};
