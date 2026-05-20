const { withModuleProtection, isDemoUser } = require("../../http/protection");
const { sendJson, sendMethodNotAllowed } = require("../../http/response");
const { ACTIONS, MODULES, ROLES } = require("../../auth/permissions");
const { matchesUserScope } = require("../../auth/access");
const { getPersonnel } = require("../../data/personnel");
const { getPayrollConfig } = require("../../data/payroll_config");
const pool = require("../../db/pool");

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: /dashboard-summary  (kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────

function getScopedPersonnel(user) {
  return getPersonnel().filter((record) =>
    matchesUserScope(user, {
      companyId: record.companyId,
      contractId: record.contractId,
      municipality: record.municipality,
    })
  );
}

function norm(s) { return String(s || "").toUpperCase().trim(); }
function getMunicipality(item) {
  return String(item.municipality || item.municipio || item.municipalityName || "").trim();
}

const AGE_BRACKETS = [
  { label: "≤25",   min: 0,  max: 25  },
  { label: "26-35", min: 26, max: 35  },
  { label: "36-45", min: 36, max: 45  },
  { label: "46-55", min: 46, max: 55  },
  { label: "56-60", min: 56, max: 60  },
  { label: "60+",   min: 61, max: 999 },
];

function getAgeBracket(birthYear) {
  if (!birthYear) return null;
  const yr = parseInt(birthYear);
  if (isNaN(yr)) return null;
  const age = new Date().getFullYear() - yr;
  return AGE_BRACKETS.find(b => age >= b.min && age <= b.max)?.label || null;
}

function normalizeDashboardText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function resolveCoverageStatus(percent, hasOperation = true) {
  if (!hasOperation) return "SIN_OPERACION";
  if (!Number.isFinite(percent)) return "SIN_OPERACION";
  if (percent >= 85) return "ESTABLE";
  if (percent >= 60) return "ALERTA";
  return "CRITICO";
}

async function getTablePresence() {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.coverage_uploads')     IS NOT NULL AS has_coverage_uploads,
      to_regclass('public.coverage_upload_rows') IS NOT NULL AS has_coverage_upload_rows,
      to_regclass('public.calendar_events')      IS NOT NULL AS has_calendar_events,
      to_regclass('public.positions')            IS NOT NULL AS has_positions
  `);

  return rows[0] || {};
}

async function getEmployeeColumnSet() {
  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employees'
  `);

  return new Set(rows.map((row) => String(row.column_name || "").trim()));
}

function buildEmployeeExpressions(employeeColumns) {
  const has = (column) => employeeColumns.has(column);

  const fullNameExpr = has("full_name")
    ? `COALESCE(NULLIF(TRIM(e.full_name), ''), 'Sin nombre')`
    : `'Sin nombre'`;

  const workdayExpr = has("workday_type")
    ? `UPPER(TRIM(COALESCE(e.workday_type, '')))`
    : `''`;

  const sexExpr = has("biological_sex")
    ? `UPPER(TRIM(COALESCE(e.biological_sex, '')))`
    : has("sex")
      ? `UPPER(TRIM(COALESCE(e.sex, '')))`
      : `''`;

  const modalityExpr = has("modality")
    ? `COALESCE(NULLIF(TRIM(e.modality), ''), 'Sin modalidad')`
    : `'Sin modalidad'`;

  const positionExpr = has("real_position")
    ? `COALESCE(NULLIF(TRIM(e.real_position), ''), 'Sin cargo')`
    : `'Sin cargo'`;

  const birthYearParts = [];
  if (has("birth_year")) birthYearParts.push("e.birth_year");
  if (has("birth_date")) birthYearParts.push("EXTRACT(YEAR FROM e.birth_date)::int");
  const birthYearExpr = birthYearParts.length
    ? `COALESCE(${birthYearParts.join(", ")})`
    : `NULL`;

  const birthMonthParts = [];
  if (has("birth_month")) birthMonthParts.push("e.birth_month");
  if (has("birth_date")) birthMonthParts.push("EXTRACT(MONTH FROM e.birth_date)::int");
  const birthMonthExpr = birthMonthParts.length
    ? `COALESCE(${birthMonthParts.join(", ")})`
    : `NULL`;

  const birthDayParts = [];
  if (has("birth_day")) birthDayParts.push("e.birth_day");
  if (has("birth_date")) birthDayParts.push("EXTRACT(DAY FROM e.birth_date)::int");
  const birthDayExpr = birthDayParts.length
    ? `COALESCE(${birthDayParts.join(", ")})`
    : `NULL`;

  return {
    fullNameExpr,
    workdayExpr,
    sexExpr,
    modalityExpr,
    positionExpr,
    birthYearExpr,
    birthMonthExpr,
    birthDayExpr,
  };
}

function buildDashboardEmployeeScope({
  user,
  resource,
  selectedMunicipalityId,
  includeAssignedMunicipalities = true,
}) {
  const joins = ["LEFT JOIN municipalities m ON m.id = e.municipality_id"];
  const conditions = ["TRUE"];
  const values = [];

  if (user?.companyId) {
    values.push(Number(user.companyId));
    conditions.push(`e.company_id = $${values.length}`);
  }

  if (resource?.contractId) {
    values.push(Number(resource.contractId));
    conditions.push(`e.contract_id = $${values.length}`);
  }

  if (selectedMunicipalityId) {
    values.push(Number(selectedMunicipalityId));
    conditions.push(`e.municipality_id = $${values.length}`);
  }

  if (includeAssignedMunicipalities) {
    const assignedMunicipalities = Array.isArray(user?.assignedMunicipalities)
      ? user.assignedMunicipalities
          .map((item) => String(item || "").trim().toLowerCase())
          .filter(Boolean)
      : [];

    if (assignedMunicipalities.length) {
      values.push(assignedMunicipalities);
      conditions.push(`LOWER(TRIM(COALESCE(m.name, ''))) = ANY($${values.length})`);
    }
  }

  return {
    joins,
    conditions,
    values,
  };
}

function buildDistribution(rows = [], fallbackColors = []) {
  return rows.map((row, index) => ({
    label: row.label,
    value: Number(row.value || 0),
    color: row.color || fallbackColors[index % fallbackColors.length] || "#0B7CFF",
  }));
}

function buildMunicipalityDistribution(rows = []) {
  return rows.map((row) => {
    const requiredTc = Number(row.required_tc || 0);
    const contractedTc = Number(row.contracted_tc || 0);
    const requiredMt = Number(row.required_mt || 0);
    const contractedMt = Number(row.contracted_mt || 0);
    const requiredTotal = requiredTc + requiredMt;
    const contractedTotal = contractedTc + contractedMt;
    const coveragePercent = requiredTotal > 0
      ? Math.round((contractedTotal / requiredTotal) * 100)
      : 0;
    const hasOperation = requiredTotal > 0;

    return {
      municipalityId: row.municipality_id ? Number(row.municipality_id) : null,
      municipalityName: row.municipality_name || "Sin municipio",
      requiredTc,
      contractedTc,
      requiredMt,
      contractedMt,
      requiredTotal,
      contractedTotal,
      coveragePercent,
      coverageStatus: resolveCoverageStatus(coveragePercent, hasOperation),
    };
  });
}

function handleDashboardSummary(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (innerReq, innerRes, innerUrl, user) => {
    const filterMunicipality = (innerUrl.searchParams.get("municipality") || "").trim();
    const yr = new Date().getFullYear();

    const allPersonnel = getScopedPersonnel(user);
    const municipalitiesList = [...new Set(allPersonnel.map(getMunicipality).filter(Boolean))].sort();

    const personnel = filterMunicipality
      ? allPersonnel.filter(p => getMunicipality(p).toLowerCase() === filterMunicipality.toLowerCase())
      : allPersonnel;

    const contractedTc = personnel.filter(p => norm(p.workTimeType || p.work_time_type || p.tipo_tiempo) === "TC").length;
    const contractedMt = personnel.filter(p => norm(p.workTimeType || p.work_time_type || p.tipo_tiempo) === "MT").length;

    const femaleCount  = personnel.filter(p => norm(p.sex || p.genero) === "MUJER").length;
    const maleCount    = personnel.filter(p => norm(p.sex || p.genero) === "HOMBRE").length;
    const femaleTc = personnel.filter(p => norm(p.workTimeType||p.work_time_type||p.tipo_tiempo)==="TC" && norm(p.sex||p.genero)==="MUJER").length;
    const maleTc   = personnel.filter(p => norm(p.workTimeType||p.work_time_type||p.tipo_tiempo)==="TC" && norm(p.sex||p.genero)==="HOMBRE").length;
    const femaleMt = personnel.filter(p => norm(p.workTimeType||p.work_time_type||p.tipo_tiempo)==="MT" && norm(p.sex||p.genero)==="MUJER").length;
    const maleMt   = personnel.filter(p => norm(p.workTimeType||p.work_time_type||p.tipo_tiempo)==="MT" && norm(p.sex||p.genero)==="HOMBRE").length;

    const totalPersonnel    = personnel.length;
    const activePersonnel   = personnel.filter(p => norm(p.status) === "ACTIVO").length;
    const inactivePersonnel = personnel.filter(p => norm(p.status) === "INACTIVO").length;
    const noveltyPersonnel  = personnel.filter(p => norm(p.status) === "NOVEDAD").length;

    const contractTypes = {};
    for (const p of personnel) {
      const ct = norm(p.contractType || p.contract_type || p.tipo_contrato || "SIN_DEFINIR");
      contractTypes[ct] = (contractTypes[ct] || 0) + 1;
    }
    const ctObraLabor   = contractTypes["OBRA_LABOR"]   || contractTypes["OBRA O LABOR"]   || 0;
    const ctTerminoFijo = contractTypes["TERMINO_FIJO"] || contractTypes["TÉRMINO FIJO"]   || 0;

    const ageByPosition = {};
    for (const p of personnel) {
      const pos = norm(p.cargo_real || p.position || "SIN CARGO");
      const bracket = getAgeBracket(p.birthYear || p.birth_year);
      if (!bracket) continue;
      if (!ageByPosition[pos]) {
        ageByPosition[pos] = {};
        for (const b of AGE_BRACKETS) ageByPosition[pos][b.label] = 0;
        ageByPosition[pos]._total = 0;
      }
      ageByPosition[pos][bracket] = (ageByPosition[pos][bracket] || 0) + 1;
      ageByPosition[pos]._total = (ageByPosition[pos]._total || 0) + 1;
    }

    const ageGenderByBracket = {};
    for (const b of AGE_BRACKETS) ageGenderByBracket[b.label] = { female: 0, male: 0 };
    for (const p of personnel) {
      const bracket = getAgeBracket(p.birthYear || p.birth_year);
      if (!bracket) continue;
      const sex = norm(p.sex || p.genero);
      if (sex === "MUJER")  ageGenderByBracket[bracket].female += 1;
      else if (sex === "HOMBRE") ageGenderByBracket[bracket].male += 1;
    }

    let requiredTc = 0, requiredMt = 0, totalCupos = 0;
    let totalSedes = 0, sedesConManipuladora = 0, sedesSinManipuladora = 0;
    const coverageByMunicipality = {};

    try {
      const latest = await pool.query(`SELECT id FROM coverage_uploads ORDER BY created_at DESC LIMIT 1`);
      if (latest.rows[0]) {
        const upId = latest.rows[0].id;

        if (filterMunicipality) {
          const totals = await pool.query(
            `SELECT COALESCE(SUM(required_tc),0) AS req_tc,
                    COALESCE(SUM(required_mt),0) AS req_mt,
                    COALESCE(SUM(cupos),0) AS cupos
             FROM coverage_upload_rows WHERE upload_id = $1 AND LOWER(municipality) = LOWER($2)`,
            [upId, filterMunicipality]
          );
          requiredTc = Number(totals.rows[0]?.req_tc || 0);
          requiredMt = Number(totals.rows[0]?.req_mt || 0);
          totalCupos = Number(totals.rows[0]?.cupos  || 0);

          const sedesQ = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN required_tc > 0 OR required_mt > 0 THEN 1 ELSE 0 END) AS con_personal
             FROM coverage_upload_rows WHERE upload_id = $1 AND LOWER(municipality) = LOWER($2)`,
            [upId, filterMunicipality]
          );
          totalSedes           = Number(sedesQ.rows[0]?.total        || 0);
          sedesConManipuladora = Number(sedesQ.rows[0]?.con_personal || 0);
          sedesSinManipuladora = totalSedes - sedesConManipuladora;
        } else {
          const totals = await pool.query(
            `SELECT COALESCE(SUM(required_tc),0) AS req_tc,
                    COALESCE(SUM(required_mt),0) AS req_mt,
                    COALESCE(SUM(cupos),0) AS cupos
             FROM coverage_upload_rows WHERE upload_id = $1`,
            [upId]
          );
          requiredTc = Number(totals.rows[0]?.req_tc || 0);
          requiredMt = Number(totals.rows[0]?.req_mt || 0);
          totalCupos = Number(totals.rows[0]?.cupos  || 0);

          const sedesQ = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN required_tc > 0 OR required_mt > 0 THEN 1 ELSE 0 END) AS con_personal
             FROM coverage_upload_rows WHERE upload_id = $1`,
            [upId]
          );
          totalSedes           = Number(sedesQ.rows[0]?.total        || 0);
          sedesConManipuladora = Number(sedesQ.rows[0]?.con_personal || 0);
          sedesSinManipuladora = totalSedes - sedesConManipuladora;
        }

        const munRows = await pool.query(
          `SELECT municipality,
                  COALESCE(SUM(required_tc),0) AS req_tc,
                  COALESCE(SUM(required_mt),0) AS req_mt,
                  COALESCE(SUM(cupos),0)        AS cupos,
                  COUNT(DISTINCT institution)   AS institutions
           FROM coverage_upload_rows WHERE upload_id = $1
           GROUP BY municipality ORDER BY municipality`,
          [upId]
        );
        for (const row of munRows.rows) {
          const mun = String(row.municipality || "").trim();
          if (!mun) continue;
          coverageByMunicipality[mun] = {
            requiredTc:   Number(row.req_tc || 0),
            requiredMt:   Number(row.req_mt || 0),
            cupos:        Number(row.cupos  || 0),
            institutions: Number(row.institutions || 0),
            contractedTc: 0,
            contractedMt: 0,
          };
        }
        for (const p of personnel) {
          const mun = getMunicipality(p);
          if (!mun || !coverageByMunicipality[mun]) continue;
          const wt = norm(p.workTimeType || p.work_time_type || p.tipo_tiempo);
          if (wt === "TC") coverageByMunicipality[mun].contractedTc += 1;
          if (wt === "MT") coverageByMunicipality[mun].contractedMt += 1;
        }
      }
    } catch { /* ignore */ }

    const retirosFile = personnel.filter(p => {
      if (norm(p.status) !== "INACTIVO") return false;
      const td = p.terminationDate || p.fecha_retiro || "";
      return td && String(td).startsWith(String(yr));
    }).length;

    let retirosDb = 0;
    try {
      const r = await pool.query(
        `SELECT COUNT(*) AS cnt FROM payroll_novelties
         WHERE novelty_type = 'RETIRO' AND EXTRACT(YEAR FROM start_date) = $1`, [yr]
      );
      retirosDb = Number(r.rows[0]?.cnt || 0);
    } catch { /* ignore */ }

    const retirosThisYear = Math.max(retirosFile, retirosDb);
    const retirosPct = totalPersonnel > 0 ? Math.round((retirosThisYear / totalPersonnel) * 100) : 0;
    const inactivosPct = totalPersonnel > 0 ? Math.round((inactivePersonnel / totalPersonnel) * 100) : 0;

    const pctTc = requiredTc > 0 ? Math.round((contractedTc / requiredTc) * 100) : null;
    const pctMt = requiredMt > 0 ? Math.round((contractedMt / requiredMt) * 100) : null;
    const tcPct20 = Math.round(requiredTc * 0.20);
    const municipalityCount = filterMunicipality ? 1 : [...new Set(personnel.map(getMunicipality).filter(Boolean))].length;

    sendJson(innerRes, 200, {
      ok: true,
      ts: Date.now(),
      kpis: {
        contractedTc, requiredTc, pctTc,
        contractedMt, requiredMt, pctMt,
        tcPct20,
        femaleCount, maleCount, femaleTc, maleTc, femaleMt, maleMt,
        totalPersonnel, activePersonnel, inactivePersonnel, noveltyPersonnel,
        ctObraLabor, ctTerminoFijo,
        retirosThisYear, retirosPct, inactivosPct,
        totalCupos,
        totalSedes, sedesConManipuladora, sedesSinManipuladora,
        municipalities: municipalityCount,
      },
      ageByPosition,
      ageGenderByBracket,
      ageBrackets: AGE_BRACKETS.map(b => b.label),
      coverageByMunicipality,
      municipalitiesList,
    });
  })(req, res, url);
}

function handleDashboardWorkspaceSummary(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(
    MODULES.DASHBOARD,
    ACTIONS.VIEW,
    async (_, innerRes, innerUrl, user, resource) => {
      if (isDemoUser(user)) {
        sendJson(innerRes, 200, {
          ok: true,
          data: {
            activeEmployees: 0,
            requiredTc: 0,
            contractedTc: 0,
            requiredMt: 0,
            contractedMt: 0,
            required20PercentTc: 0,
            coveragePercent: 0,
            coverageStatus: "SIN_OPERACION",
            coverageByMunicipality: [],
            employeesByGender: [],
            employeesByModality: [],
            employeesByAgeRange: [],
            employeesByArea: [],
            birthdaysThisMonth: [],
            upcomingEvents: [],
          },
        });
        return;
      }

      const selectedMunicipalityIdRaw =
        innerUrl.searchParams.get("municipality_id") ||
        innerUrl.searchParams.get("municipalityId") ||
        "";
      const parsedMunicipalityId = selectedMunicipalityIdRaw
        ? Number(selectedMunicipalityIdRaw)
        : null;
      const selectedMunicipalityId = Number.isFinite(parsedMunicipalityId)
        ? parsedMunicipalityId
        : null;

      const personnelType = (innerUrl.searchParams.get("type") || "").toLowerCase().trim();

      const now          = new Date();
      const refMonth     = Math.min(12, Math.max(1, Number(innerUrl.searchParams.get("month")) || (now.getMonth() + 1)));
      const refYear      = Math.min(2100, Math.max(2000, Number(innerUrl.searchParams.get("year"))  || now.getFullYear()));
      const refMonthStr  = String(refMonth).padStart(2, "0");
      const refStart     = `${refYear}-${refMonthStr}-01`;
      const refEnd       = `${refYear}-${refMonthStr}-${new Date(refYear, refMonth, 0).getDate()}`;
      const currentDay   = now.getDate();
      const isCurrentMonth = refMonth === (now.getMonth() + 1) && refYear === now.getFullYear();

      const [
        presence,
        employeeColumns,
      ] = await Promise.all([
        getTablePresence(),
        getEmployeeColumnSet(),
      ]);

      const employeeExpr = buildEmployeeExpressions(employeeColumns);
      const employeeScope = buildDashboardEmployeeScope({
        user,
        resource,
        selectedMunicipalityId,
      });

      if (personnelType === "operario" && employeeColumns.has("real_position")) {
        employeeScope.values.push("OPERARIO MANIPULADOR DE ALIMENTOS");
        employeeScope.conditions.push(
          `UPPER(TRIM(COALESCE(e.real_position, ''))) = $${employeeScope.values.length}`
        );
      } else if (personnelType === "equipo" && employeeColumns.has("real_position")) {
        employeeScope.values.push("OPERARIO MANIPULADOR DE ALIMENTOS");
        employeeScope.conditions.push(
          `UPPER(TRIM(COALESCE(e.real_position, ''))) != $${employeeScope.values.length}`
        );
      }

      const employeeFromSql = `
        FROM employees e
        ${employeeScope.joins.join("\n")}
        WHERE ${employeeScope.conditions.join(" AND ")}
      `;

      const employeeSummaryQuery = `
        SELECT
          COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO') AS active_employees,
          COUNT(*) FILTER (
            WHERE UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
              AND ${employeeExpr.workdayExpr} = 'TC'
          ) AS contracted_tc,
          COUNT(*) FILTER (
            WHERE UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
              AND ${employeeExpr.workdayExpr} = 'MT'
          ) AS contracted_mt
        ${employeeFromSql}
      `;

      const genderQuery = `
        SELECT
          CASE
            WHEN ${employeeExpr.sexExpr} IN ('F', 'FEMENINO', 'MUJER') THEN 'Mujeres'
            WHEN ${employeeExpr.sexExpr} IN ('M', 'MASCULINO', 'HOMBRE') THEN 'Hombres'
            ELSE 'Sin dato'
          END AS label,
          COUNT(*) AS value
        ${employeeFromSql}
          AND UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
        GROUP BY 1
        ORDER BY COUNT(*) DESC, 1 ASC
      `;

      const modalityQuery = `
        SELECT
          ${employeeExpr.modalityExpr} AS label,
          COUNT(*) AS value
        ${employeeFromSql}
          AND UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
        GROUP BY 1
        ORDER BY COUNT(*) DESC, 1 ASC
      `;

      const ageQuery = `
        SELECT
          CASE
            WHEN ${employeeExpr.birthYearExpr} IS NULL THEN 'Sin dato'
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} <= 25 THEN '≤25'
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} BETWEEN 26 AND 35 THEN '26-35'
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} BETWEEN 36 AND 45 THEN '36-45'
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} BETWEEN 46 AND 55 THEN '46-55'
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} BETWEEN 56 AND 60 THEN '56-60'
            ELSE '60+'
          END AS label,
          COUNT(*) AS value,
          CASE
            WHEN ${employeeExpr.birthYearExpr} IS NULL THEN 7
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} <= 25 THEN 1
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} BETWEEN 26 AND 35 THEN 2
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} BETWEEN 36 AND 45 THEN 3
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} BETWEEN 46 AND 55 THEN 4
            WHEN EXTRACT(YEAR FROM CURRENT_DATE)::int - ${employeeExpr.birthYearExpr} BETWEEN 56 AND 60 THEN 5
            ELSE 6
          END AS sort_order
        ${employeeFromSql}
          AND UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
        GROUP BY 1, 3
        ORDER BY sort_order ASC
      `;

      const bdayDayFilter = isCurrentMonth
        ? `AND ${employeeExpr.birthDayExpr} >= $${employeeScope.values.length + 2}`
        : `AND ${employeeExpr.birthDayExpr} BETWEEN 1 AND 31`;

      const birthdaysQuery = `
        SELECT
          e.id,
          ${employeeExpr.fullNameExpr} AS full_name,
          ${employeeExpr.positionExpr} AS position_name,
          m.name AS municipality_name,
          ${employeeExpr.birthDayExpr} AS birth_day,
          ${employeeExpr.birthMonthExpr} AS birth_month
        ${employeeFromSql}
          AND UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
          AND ${employeeExpr.birthMonthExpr} = $${employeeScope.values.length + 1}
          ${bdayDayFilter}
        ORDER BY ${employeeExpr.birthDayExpr} ASC, ${employeeExpr.fullNameExpr} ASC
        LIMIT 31
      `;

      const employeeTasks = [
        pool.query(employeeSummaryQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] employeeSummaryQuery falló:", err.message); return { rows: [] }; }),
        pool.query(genderQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] genderQuery falló:", err.message); return { rows: [] }; }),
        pool.query(modalityQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] modalityQuery falló:", err.message); return { rows: [] }; }),
        pool.query(ageQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] ageQuery falló:", err.message); return { rows: [] }; }),
        pool.query(birthdaysQuery, [...employeeScope.values, refMonth, ...(isCurrentMonth ? [currentDay] : [])]).catch(err => { console.error("[dashboard/summary] birthdaysQuery falló:", err.message); return { rows: [] }; }),
      ];

      if (presence.has_positions) {
        const areaQuery = `
          SELECT
            COALESCE(NULLIF(TRIM(p.area), ''), 'Sin area') AS label,
            COUNT(*) AS value
          FROM employees e
          LEFT JOIN municipalities m ON m.id = e.municipality_id
          INNER JOIN positions p
            ON p.company_id = e.company_id
           AND (p.contract_id = e.contract_id OR p.contract_id IS NULL)
           AND UPPER(TRIM(p.name)) = UPPER(TRIM(${employeeExpr.positionExpr}))
           AND p.active = true
          WHERE ${employeeScope.conditions.join(" AND ")}
            AND UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
          GROUP BY 1
          ORDER BY COUNT(*) DESC, 1 ASC
        `;
        employeeTasks.push(pool.query(areaQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] areaQuery falló:", err.message); return { rows: [] }; }));
      }

      // Optional document-compliance queries (columns may not exist in all deployments)
      const hasSisben       = employeeColumns.has("sisben");
      const hasResidenceCert = employeeColumns.has("residence_certificate");
      const sisbenExpExpr   = employeeColumns.has("sisben_expiry")
        ? "e.sisben_expiry"
        : employeeColumns.has("sisben_exp_date") ? "e.sisben_exp_date" : "NULL::date";
      const certExpExpr     = employeeColumns.has("residence_certificate_expiry")
        ? "e.residence_certificate_expiry" : "NULL::date";

      // Cargo and education queries — only for equipo tab
      const cargoQuery = personnelType === "equipo" && employeeColumns.has("real_position") ? `
        SELECT
          COALESCE(NULLIF(TRIM(e.real_position),''),'Sin cargo') AS label,
          COUNT(*) AS value
        ${employeeFromSql}
          AND UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
        GROUP BY 1
        ORDER BY COUNT(*) DESC, 1 ASC
      ` : null;

      const educQuery = personnelType === "equipo" && employeeColumns.has("education_level") ? `
        SELECT
          COALESCE(NULLIF(UPPER(TRIM(e.education_level)),''),'SIN DATO') AS label,
          COUNT(*) AS value
        ${employeeFromSql}
          AND UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
        GROUP BY 1
        ORDER BY COUNT(*) DESC, 1 ASC
      ` : null;

      // Experience distribution — operario tab only, sums `dias` from work_experience JSONB array
      const experienceQuery = personnelType !== "equipo" ? `
        SELECT
          CASE
            WHEN total_days = 0 THEN 'Sin dato'
            WHEN total_days < 90  THEN '< 3 meses'
            WHEN total_days <= 210 THEN '3 a 7 meses'
            ELSE '> 1 año'
          END AS label,
          COUNT(*) AS value
        FROM (
          SELECT
            COALESCE((
              SELECT SUM((exp->>'dias')::numeric)
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(e.work_experience) = 'array'
                  THEN e.work_experience ELSE '[]'::jsonb END
              ) AS exp
              WHERE (exp->>'dias') IS NOT NULL
                AND (exp->>'dias') ~ '^[0-9]'
            ), 0)::int AS total_days
          ${employeeFromSql}
            AND UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
        ) sub
        GROUP BY 1
      ` : null;

      // Food handling (course + exam) — operario tab only, no column guard
      const foodHandlingQuery = personnelType !== "equipo" ? `
        SELECT
          COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO'
            AND (e.food_handling_course_expiry_date IS NOT NULL OR e.food_handling_exam_expiry_date IS NOT NULL)
            AND LEAST(
              COALESCE(e.food_handling_course_expiry_date, '9999-12-31'::date),
              COALESCE(e.food_handling_exam_expiry_date,   '9999-12-31'::date)
            ) > CURRENT_DATE + INTERVAL '30 days') AS vigente,
          COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO'
            AND (e.food_handling_course_expiry_date IS NOT NULL OR e.food_handling_exam_expiry_date IS NOT NULL)
            AND LEAST(
              COALESCE(e.food_handling_course_expiry_date, '9999-12-31'::date),
              COALESCE(e.food_handling_exam_expiry_date,   '9999-12-31'::date)
            ) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') AS proximo,
          COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO'
            AND (e.food_handling_course_expiry_date IS NOT NULL OR e.food_handling_exam_expiry_date IS NOT NULL)
            AND LEAST(
              COALESCE(e.food_handling_course_expiry_date, '9999-12-31'::date),
              COALESCE(e.food_handling_exam_expiry_date,   '9999-12-31'::date)
            ) < CURRENT_DATE) AS vencido,
          COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO'
            AND e.food_handling_course_expiry_date IS NULL
            AND e.food_handling_exam_expiry_date   IS NULL) AS sin_doc,
          COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='INACTIVO') AS inactivos
        ${employeeFromSql}
      ` : null;

      const [employeeResults, sisbenResult, certResult, cargoResult, educResult, expResult, foodResult] = await Promise.all([
        Promise.all(employeeTasks),
        hasSisben
          ? pool.query(`
              SELECT
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO' AND e.sisben = true  AND (${sisbenExpExpr} IS NULL OR ${sisbenExpExpr} > $${employeeScope.values.length + 2}::date)) AS vigente,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO' AND e.sisben = true  AND ${sisbenExpExpr} IS NOT NULL AND ${sisbenExpExpr} BETWEEN $${employeeScope.values.length + 1}::date AND $${employeeScope.values.length + 2}::date) AS proximo,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO' AND e.sisben = true  AND ${sisbenExpExpr} IS NOT NULL AND ${sisbenExpExpr} < $${employeeScope.values.length + 1}::date) AS vencido,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO' AND (e.sisben IS NULL OR e.sisben = false)) AS sin_sisben,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='INACTIVO') AS inactivos
              ${employeeFromSql}
            `, [...employeeScope.values, refStart, refEnd]).catch(err => { console.error("[dashboard/summary] sisbenQuery falló:", err.message); return { rows: [{}] }; })
          : Promise.resolve({ rows: [{}] }),
        hasResidenceCert
          ? pool.query(`
              SELECT
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO' AND e.residence_certificate = true  AND (${certExpExpr} IS NULL OR ${certExpExpr} > $${employeeScope.values.length + 2}::date)) AS vigente,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO' AND e.residence_certificate = true  AND ${certExpExpr} IS NOT NULL AND ${certExpExpr} BETWEEN $${employeeScope.values.length + 1}::date AND $${employeeScope.values.length + 2}::date) AS proximo,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO' AND e.residence_certificate = true  AND ${certExpExpr} IS NOT NULL AND ${certExpExpr} < $${employeeScope.values.length + 1}::date) AS vencido,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='ACTIVO' AND (e.residence_certificate IS NULL OR e.residence_certificate = false)) AS sin_certificado,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status,'')))='INACTIVO') AS inactivos
              ${employeeFromSql}
            `, [...employeeScope.values, refStart, refEnd]).catch(err => { console.error("[dashboard/summary] certQuery falló:", err.message); return { rows: [{}] }; })
          : Promise.resolve({ rows: [{}] }),
        cargoQuery
          ? pool.query(cargoQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] cargoQuery falló:", err.message); return { rows: [] }; })
          : Promise.resolve({ rows: [] }),
        educQuery
          ? pool.query(educQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] educQuery falló:", err.message); return { rows: [] }; })
          : Promise.resolve({ rows: [] }),
        experienceQuery
          ? pool.query(experienceQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] experienceQuery falló:", err.message); return { rows: [] }; })
          : Promise.resolve({ rows: [] }),
        foodHandlingQuery
          ? pool.query(foodHandlingQuery, employeeScope.values).catch(err => { console.error("[dashboard/summary] foodHandlingQuery falló:", err.message); return { rows: [{}] }; })
          : Promise.resolve({ rows: [{}] }),
      ]);

      const employeeSummary = employeeResults[0].rows[0] || {};
      const genderRows   = employeeResults[1].rows || [];
      const modalityRows = employeeResults[2].rows || [];
      const ageRows      = employeeResults[3].rows || [];
      const birthdayRows = employeeResults[4].rows || [];
      const areaRows     = presence.has_positions ? employeeResults[5]?.rows || [] : [];
      const sisbenRow    = sisbenResult.rows[0] || {};
      const certRow      = certResult.rows[0] || {};
      const cargoRows    = cargoResult.rows || [];
      const educRows     = educResult.rows  || [];
      const expRows      = expResult.rows   || [];
      const foodRow      = foodResult.rows[0] || {};

      let coverageByMunicipality = [];
      let requiredTc = 0;
      let requiredMt = 0;

      if (presence.has_coverage_uploads && presence.has_coverage_upload_rows) {
        const coverageValues = [];
        const uploadConditions = ["TRUE"];
        const rowConditions = ["r.upload_id = (SELECT id FROM latest_upload)"];
        const employeeCoverageConditions = ["TRUE"];

        if (user?.companyId) {
          coverageValues.push(Number(user.companyId));
          uploadConditions.push(`u.company_id = $${coverageValues.length}`);

          coverageValues.push(Number(user.companyId));
          employeeCoverageConditions.push(`e.company_id = $${coverageValues.length}`);
        }

        if (resource?.contractId) {
          coverageValues.push(Number(resource.contractId));
          uploadConditions.push(`u.contract_id = $${coverageValues.length}`);

          coverageValues.push(Number(resource.contractId));
          employeeCoverageConditions.push(`e.contract_id = $${coverageValues.length}`);
        }

        if (selectedMunicipalityId) {
          coverageValues.push(Number(selectedMunicipalityId));
          rowConditions.push(`LOWER(TRIM(r.municipality)) = (
            SELECT LOWER(TRIM(name))
            FROM municipalities
            WHERE id = $${coverageValues.length}
            LIMIT 1
          )`);

          coverageValues.push(Number(selectedMunicipalityId));
          employeeCoverageConditions.push(`e.municipality_id = $${coverageValues.length}`);
        }

        const assignedMunicipalities = Array.isArray(user?.assignedMunicipalities)
          ? user.assignedMunicipalities
              .map((item) => String(item || "").trim().toLowerCase())
              .filter(Boolean)
          : [];
        if (assignedMunicipalities.length) {
          coverageValues.push(assignedMunicipalities);
          rowConditions.push(`LOWER(TRIM(r.municipality)) = ANY($${coverageValues.length})`);

          coverageValues.push(assignedMunicipalities);
          employeeCoverageConditions.push(`LOWER(TRIM(COALESCE(m.name, ''))) = ANY($${coverageValues.length})`);
        }

        const coverageQuery = `
          WITH latest_upload AS (
            SELECT u.id
            FROM coverage_uploads u
            WHERE ${uploadConditions.join(" AND ")}
            ORDER BY u.created_at DESC, u.id DESC
            LIMIT 1
          ),
          coverage AS (
            SELECT
              mun.id AS municipality_id,
              COALESCE(mun.name, TRIM(r.municipality)) AS municipality_name,
              COALESCE(SUM(r.required_tc), 0) AS required_tc,
              COALESCE(SUM(r.required_mt), 0) AS required_mt
            FROM coverage_upload_rows r
            LEFT JOIN municipalities mun
              ON LOWER(TRIM(mun.name)) = LOWER(TRIM(r.municipality))
            WHERE ${rowConditions.join(" AND ")}
            GROUP BY mun.id, COALESCE(mun.name, TRIM(r.municipality))
          ),
          employees AS (
            SELECT
              m.id AS municipality_id,
              m.name AS municipality_name,
              COUNT(*) FILTER (
                WHERE UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
                  AND ${employeeExpr.workdayExpr} = 'TC'
              ) AS contracted_tc,
              COUNT(*) FILTER (
                WHERE UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO'
                  AND ${employeeExpr.workdayExpr} = 'MT'
              ) AS contracted_mt
            FROM employees e
            LEFT JOIN municipalities m ON m.id = e.municipality_id
            WHERE ${employeeCoverageConditions.join(" AND ")}
            GROUP BY m.id, m.name
          )
          SELECT
            COALESCE(c.municipality_id, emp.municipality_id) AS municipality_id,
            COALESCE(c.municipality_name, emp.municipality_name) AS municipality_name,
            COALESCE(c.required_tc, 0) AS required_tc,
            COALESCE(c.required_mt, 0) AS required_mt,
            COALESCE(emp.contracted_tc, 0) AS contracted_tc,
            COALESCE(emp.contracted_mt, 0) AS contracted_mt
          FROM coverage c
          FULL OUTER JOIN employees emp
            ON LOWER(TRIM(COALESCE(emp.municipality_name, ''))) = LOWER(TRIM(COALESCE(c.municipality_name, '')))
          WHERE COALESCE(c.municipality_name, emp.municipality_name) IS NOT NULL
          ORDER BY (COALESCE(c.required_tc, 0) + COALESCE(c.required_mt, 0)) DESC,
                   COALESCE(c.municipality_name, emp.municipality_name) ASC
        `;

        const coverageResult = await pool.query(coverageQuery, coverageValues).catch(() => null);

        if (coverageResult?.rows?.length) {
          coverageByMunicipality = buildMunicipalityDistribution(coverageResult.rows);
          requiredTc = coverageByMunicipality.reduce((sum, item) => sum + item.requiredTc, 0);
          requiredMt = coverageByMunicipality.reduce((sum, item) => sum + item.requiredMt, 0);
        }
      }

      const upcomingEvents = presence.has_calendar_events
        ? await pool.query(
            `
            SELECT id, title, event_date, event_time, description
            FROM calendar_events
            WHERE event_date >= CURRENT_DATE
              ${user?.companyId ? `AND (company_id = $1 OR company_id IS NULL)` : ""}
            ORDER BY event_date ASC, event_time ASC NULLS LAST
            LIMIT 8
            `,
            user?.companyId ? [Number(user.companyId)] : []
          ).then(r => r.rows.map((row) => ({
            id: row.id,
            title: row.title,
            date: row.event_date,
            time: row.event_time || null,
            description: row.description || "",
          }))).catch(err => { console.error("[dashboard/summary] upcomingEvents falló:", err.message); return []; })
        : [];

      const contractedTc = Number(employeeSummary.contracted_tc || 0);
      const contractedMt = Number(employeeSummary.contracted_mt || 0);
      const totalRequired = requiredTc + requiredMt;
      const totalContracted = contractedTc + contractedMt;
      const coveragePercent = totalRequired > 0
        ? Math.round((totalContracted / totalRequired) * 100)
        : 0;

      sendJson(innerRes, 200, {
        ok: true,
        data: {
          activeEmployees: Number(employeeSummary.active_employees || 0),
          requiredTc,
          contractedTc,
          requiredMt,
          contractedMt,
          required20PercentTc: Math.ceil(requiredTc * 0.2),
          coveragePercent,
          coverageStatus: resolveCoverageStatus(coveragePercent, totalRequired > 0),
          coverageByMunicipality,
          employeesByGender: buildDistribution(genderRows, ["#8B5CF6", "#0B7CFF", "#CBD5E1"]),
          employeesByModality: buildDistribution(modalityRows, ["#0B7CFF", "#2ECF9A", "#F7C948", "#8B5CF6"]),
          employeesByAgeRange: buildDistribution(ageRows, ["#071B4D", "#0B7CFF", "#2ECF9A", "#F7C948", "#8B5CF6", "#FF4D4F", "#CBD5E1"]),
          employeesByArea: buildDistribution(areaRows, ["#071B4D", "#0B7CFF", "#2ECF9A", "#8B5CF6", "#F7C948", "#FF4D4F"]),
          birthdaysThisMonth: birthdayRows.map((row) => ({
            id: row.id,
            name: row.full_name,
            day: Number(row.birth_day || 0),
            month: Number(row.birth_month || 0),
            position: row.position_name || "Sin cargo",
            municipality: row.municipality_name || "Sin municipio",
          })),
          upcomingEvents,
          sisbenStats: {
            vigente:   Number(sisbenRow.vigente    || 0),
            proximo:   Number(sisbenRow.proximo    || 0),
            vencido:   Number(sisbenRow.vencido    || 0),
            sinSisben: Number(sisbenRow.sin_sisben  || 0),
            inactivos: Number(sisbenRow.inactivos   || 0),
          },
          residenceCertStats: {
            vigente:        Number(certRow.vigente         || 0),
            proximo:        Number(certRow.proximo         || 0),
            vencido:        Number(certRow.vencido         || 0),
            sinCertificado: Number(certRow.sin_certificado || 0),
            inactivos:      Number(certRow.inactivos       || 0),
          },
          employeesByCargo: buildDistribution(cargoRows, ["#0B7CFF","#2ECF9A","#F7C948","#8B5CF6","#FF4D4F","#378ADD","#D85A30","#071B4D","#1D9E75","#EF9F27"]),
          employeesByEducation: buildDistribution(educRows, ["#64748B","#0B7CFF","#2ECF9A","#F7C948","#8B5CF6","#FF4D4F","#CBD5E1"]),
          experienceDistribution: expRows.map(r => ({ label: r.label, value: Number(r.value || 0) })),
          foodHandlingStats: {
            vigente:   Number(foodRow.vigente   || 0),
            proximo:   Number(foodRow.proximo   || 0),
            vencido:   Number(foodRow.vencido   || 0),
            sinDoc:    Number(foodRow.sin_doc   || 0),
            inactivos: Number(foodRow.inactivos  || 0),
          },
        },
      });
    }
  )(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// COCKPIT ENDPOINTS  — /dashboard/*
// ─────────────────────────────────────────────────────────────────────────────

// ── 5-minute KPI cache (keyed by companyId|contractId|municipalityId) ─────────
const _kpiCache = new Map();
const KPI_TTL = 5 * 60 * 1000;

function _cacheKey(a, b, c) { return `${a ?? ""}|${b ?? ""}|${c ?? ""}`; }
function _cacheGet(k) {
  const e = _kpiCache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > KPI_TTL) { _kpiCache.delete(k); return null; }
  return e.data;
}
function _cacheSet(k, data) { _kpiCache.set(k, { data, ts: Date.now() }); }

// ── Role helpers ──────────────────────────────────────────────────────────────
function isOpsOnly(user) {
  return String(user.role || "").toLowerCase() === ROLES.OPERATIONS;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/kpis?contract_id=&municipality_id=
// ─────────────────────────────────────────────────────────────────────────────
function handleDashboardKpis(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, innerUrl, user) => {
    if (isDemoUser(user)) {
      sendJson(innerRes, 200, {
        ok: true, ts: Date.now(), cached: false,
        data: {
          active:0, inactive:0, novelty:0, total:0, tc_count:0, mt_count:0,
          required_tc:0, required_mt:0, required:0, contracted:0, pct_coverage:null,
          tc_20pct:0, municipalities_covered:0, total_cupos:0, pending_novelties:0,
          pending_docs:0, expiring_soon_docs:0, payroll_total:0,
          female_active:0, male_active:0, female_inactive:0, male_inactive:0,
          female_tc:0, male_tc:0, municipalities: [],
          age: { le25:0, age2635:0, age3645:0, age4655:0, age5660:0, plus61:0 },
        },
      });
      return;
    }

    const contractId    = innerUrl.searchParams.get("contract_id")    ? Number(innerUrl.searchParams.get("contract_id"))    : null;
    const municipalityId = innerUrl.searchParams.get("municipality_id") ? Number(innerUrl.searchParams.get("municipality_id")) : null;

    const ckey = _cacheKey(user.companyId, contractId, municipalityId);
    const hit  = _cacheGet(ckey);
    if (hit) { sendJson(innerRes, 200, { ...hit, cached: true }); return; }

    // ── Employee WHERE ──
    const empParts = [], empVals = [];
    if (user.companyId)  { empVals.push(user.companyId);  empParts.push(`company_id = $${empVals.length}`); }
    if (contractId)      { empVals.push(contractId);      empParts.push(`contract_id = $${empVals.length}`); }
    if (municipalityId)  { empVals.push(municipalityId);  empParts.push(`municipality_id = $${empVals.length}`); }
    const empWhere = empParts.length ? "WHERE " + empParts.join(" AND ") : "";

    // ── Coverage WHERE ──
    let covSql = `SELECT
      COALESCE(SUM(required_tc),0) AS req_tc,
      COALESCE(SUM(required_mt),0) AS req_mt,
      COALESCE(SUM(cupos),0)       AS cupos,
      COUNT(DISTINCT TRIM(municipality)) AS mun_covered
    FROM coverage_upload_rows
    WHERE upload_id = (SELECT id FROM coverage_uploads ORDER BY created_at DESC LIMIT 1)`;
    const covVals = [];
    if (municipalityId) {
      covVals.push(municipalityId);
      covSql += ` AND LOWER(TRIM(municipality)) = (
        SELECT LOWER(TRIM(name)) FROM municipalities WHERE id = $${covVals.length} LIMIT 1
      )`;
    }

    // ── Municipalities list for filters ──
    let munListSql, munListVals;
    if (user.companyId) {
      munListSql  = `SELECT DISTINCT m.id, m.name FROM municipalities m
                     JOIN employees e ON e.municipality_id = m.id AND e.company_id = $1
                     ORDER BY m.name`;
      munListVals = [user.companyId];
    } else {
      munListSql  = `SELECT id, name FROM municipalities ORDER BY name`;
      munListVals = [];
    }

    const [empR, covR, novR, munListR] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO')   AS active,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'INACTIVO') AS inactive,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'NOVEDAD')  AS novelty,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE UPPER(TRIM(workday_type)) = 'TC') AS tc_count,
          COUNT(*) FILTER (WHERE UPPER(TRIM(workday_type)) = 'MT') AS mt_count,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO'
            AND food_handling_exam_expiry_date IS NULL)             AS missing_exam,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO'
            AND food_handling_exam_expiry_date IS NOT NULL
            AND food_handling_exam_expiry_date <= CURRENT_DATE + INTERVAL '30 days') AS expiring_exam,
          COUNT(*) FILTER (WHERE UPPER(TRIM(sex)) = 'F' AND UPPER(TRIM(status)) = 'ACTIVO')   AS female_active,
          COUNT(*) FILTER (WHERE UPPER(TRIM(sex)) = 'M' AND UPPER(TRIM(status)) = 'ACTIVO')   AS male_active,
          COUNT(*) FILTER (WHERE UPPER(TRIM(sex)) = 'F' AND UPPER(TRIM(status)) = 'INACTIVO') AS female_inactive,
          COUNT(*) FILTER (WHERE UPPER(TRIM(sex)) = 'M' AND UPPER(TRIM(status)) = 'INACTIVO') AS male_inactive,
          COUNT(*) FILTER (WHERE UPPER(TRIM(sex)) = 'F' AND UPPER(TRIM(workday_type)) = 'TC' AND UPPER(TRIM(status)) = 'ACTIVO') AS female_tc,
          COUNT(*) FILTER (WHERE UPPER(TRIM(sex)) = 'M' AND UPPER(TRIM(workday_type)) = 'TC' AND UPPER(TRIM(status)) = 'ACTIVO') AS male_tc,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO' AND birth_year IS NOT NULL
            AND (EXTRACT(YEAR FROM NOW())::int - birth_year) <= 25)                    AS age_le25,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO' AND birth_year IS NOT NULL
            AND (EXTRACT(YEAR FROM NOW())::int - birth_year) BETWEEN 26 AND 35)        AS age_26_35,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO' AND birth_year IS NOT NULL
            AND (EXTRACT(YEAR FROM NOW())::int - birth_year) BETWEEN 36 AND 45)        AS age_36_45,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO' AND birth_year IS NOT NULL
            AND (EXTRACT(YEAR FROM NOW())::int - birth_year) BETWEEN 46 AND 55)        AS age_46_55,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO' AND birth_year IS NOT NULL
            AND (EXTRACT(YEAR FROM NOW())::int - birth_year) BETWEEN 56 AND 60)        AS age_56_60,
          COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'ACTIVO' AND birth_year IS NOT NULL
            AND (EXTRACT(YEAR FROM NOW())::int - birth_year) > 60)                     AS age_61_plus
        FROM employees ${empWhere}
      `, empVals),

      pool.query(covSql, covVals),

      user.companyId
        ? pool.query(
            `SELECT COUNT(*) AS cnt FROM payroll_novelties WHERE status = 'PENDIENTE' AND company_id = $1`,
            [user.companyId]
          )
        : pool.query(`SELECT COUNT(*) AS cnt FROM payroll_novelties WHERE status = 'PENDIENTE'`),

      pool.query(munListSql, munListVals),
    ]);

    const e   = empR.rows[0] || {};
    const c   = covR.rows[0] || {};
    const cfg = getPayrollConfig();

    const active   = Number(e.active   || 0);
    const tcCount  = Number(e.tc_count || 0);
    const mtCount  = Number(e.mt_count || 0);
    const reqTc    = Number(c.req_tc   || 0);
    const reqMt    = Number(c.req_mt   || 0);
    const required = reqTc + reqMt;
    const contracted   = tcCount + mtCount;
    const pctCoverage  = required > 0 ? Math.round((contracted / required) * 100) : null;
    const payrollTotal = Math.round(tcCount * cfg.smlmv + mtCount * (cfg.smlmv * 0.5));

    const result = {
      ok: true,
      ts: Date.now(),
      cached: false,
      data: {
        active,
        inactive:         Number(e.inactive    || 0),
        novelty:          Number(e.novelty     || 0),
        total:            Number(e.total       || 0),
        tc_count:         tcCount,
        mt_count:         mtCount,
        required_tc:      reqTc,
        required_mt:      reqMt,
        required,
        contracted,
        pct_coverage:     pctCoverage,
        tc_20pct:         Math.round(reqTc * 0.20),
        municipalities_covered: Number(c.mun_covered || 0),
        total_cupos:      Number(c.cupos || 0),
        pending_novelties:  Number(novR.rows[0]?.cnt || 0),
        pending_docs:       Number(e.missing_exam   || 0),
        expiring_soon_docs: Number(e.expiring_exam  || 0),
        payroll_total:      payrollTotal,
        female_active:    Number(e.female_active   || 0),
        male_active:      Number(e.male_active    || 0),
        female_inactive:  Number(e.female_inactive|| 0),
        male_inactive:    Number(e.male_inactive  || 0),
        female_tc:        Number(e.female_tc      || 0),
        male_tc:          Number(e.male_tc        || 0),
        age_brackets: {
          "≤25":   Number(e.age_le25   || 0),
          "26-35": Number(e.age_26_35  || 0),
          "36-45": Number(e.age_36_45  || 0),
          "46-55": Number(e.age_46_55  || 0),
          "56-60": Number(e.age_56_60  || 0),
          "60+":   Number(e.age_61_plus|| 0),
        },
        municipalities_list: munListR.rows.map(r => ({ id: Number(r.id), name: r.name })),
      },
    };

    _cacheSet(ckey, result);
    sendJson(innerRes, 200, result);
  })(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/alerts
// ─────────────────────────────────────────────────────────────────────────────
function handleDashboardAlerts(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, innerUrl, user) => {
    if (isDemoUser(user)) {
      sendJson(innerRes, 200, { ok: true, data: [{ type: "ok", severity: "ok", message: "Sin alertas activas", count: 0, action_url: null }] });
      return;
    }
    const cVals   = user.companyId ? [user.companyId] : [];
    const cFilter = user.companyId ? "AND company_id = $1" : "";
    const cEmp    = user.companyId ? "AND e.company_id = $1" : "";

    const [expiringR, lowCovR, novR, retirosR] = await Promise.all([
      // Certificados de manipulación expirando próximamente o ya expirados
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE food_handling_exam_expiry_date <= CURRENT_DATE)            AS expired,
          COUNT(*) FILTER (WHERE food_handling_exam_expiry_date  > CURRENT_DATE
                             AND food_handling_exam_expiry_date <= CURRENT_DATE + INTERVAL '30 days') AS expiring
        FROM employees
        WHERE UPPER(TRIM(status)) = 'ACTIVO'
          AND food_handling_exam_expiry_date IS NOT NULL
          ${cFilter}
      `, cVals),

      // Municipios con cobertura < 85%
      pool.query(`
        WITH latest AS (SELECT id FROM coverage_uploads ORDER BY created_at DESC LIMIT 1),
        cov AS (
          SELECT LOWER(TRIM(municipality)) AS mun_norm,
            COALESCE(SUM(required_tc),0) + COALESCE(SUM(required_mt),0) AS required
          FROM coverage_upload_rows
          WHERE upload_id = (SELECT id FROM latest)
          GROUP BY LOWER(TRIM(municipality))
          HAVING COALESCE(SUM(required_tc),0) + COALESCE(SUM(required_mt),0) > 0
        ),
        emp AS (
          SELECT LOWER(TRIM(m.name)) AS mun_norm, COUNT(e.id) AS contracted
          FROM municipalities m
          LEFT JOIN employees e ON e.municipality_id = m.id
            AND UPPER(TRIM(e.status)) = 'ACTIVO' ${cEmp}
          GROUP BY LOWER(TRIM(m.name))
        )
        SELECT COUNT(*) AS low_count
        FROM cov c
        JOIN emp e ON e.mun_norm = c.mun_norm
        WHERE c.required > 0 AND (e.contracted::float / c.required) * 100 < 85
      `, cVals),

      // Novedades pendientes
      pool.query(`
        SELECT COUNT(*) AS cnt FROM payroll_novelties
        WHERE status = 'PENDIENTE' ${cFilter}
      `, cVals),

      // Retiros en últimos 30 días
      pool.query(`
        SELECT COUNT(*) AS cnt FROM employees
        WHERE UPPER(TRIM(status)) = 'INACTIVO'
          AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
          ${cFilter}
      `, cVals),
    ]);

    const alerts = [];

    const expired  = Number(expiringR.rows[0]?.expired  || 0);
    const expiring = Number(expiringR.rows[0]?.expiring || 0);
    if (expired > 0) {
      alerts.push({
        type: "docs_expiring", severity: "critical",
        message: `${expired} empleado(s) con certificado de manipulación VENCIDO`,
        count: expired, action_url: "#gestion_personal",
      });
    }
    if (expiring > 0) {
      alerts.push({
        type: "docs_expiring", severity: "warning",
        message: `${expiring} certificado(s) de manipulación vencen en los próximos 30 días`,
        count: expiring, action_url: "#gestion_personal",
      });
    }

    const lowCov = Number(lowCovR.rows[0]?.low_count || 0);
    if (lowCov > 0) {
      alerts.push({
        type: "low_coverage", severity: "critical",
        message: `${lowCov} municipio(s) con cobertura por debajo del 85%`,
        count: lowCov, action_url: "#cobertura_calculadora",
      });
    }

    const pending = Number(novR.rows[0]?.cnt || 0);
    if (pending > 0) {
      alerts.push({
        type: "pending_novelties", severity: "warning",
        message: `${pending} novedad(es) de nómina pendiente(s) de procesar`,
        count: pending, action_url: "#nomina_novedades",
      });
    }

    const retiros = Number(retirosR.rows[0]?.cnt || 0);
    if (retiros > 0) {
      alerts.push({
        type: "retiros_recientes", severity: "info",
        message: `${retiros} retiro(s) registrado(s) en los últimos 30 días`,
        count: retiros, action_url: "#gestion_personal",
      });
    }

    if (alerts.length === 0) {
      alerts.push({ type: "ok", severity: "ok", message: "Sin alertas activas", count: 0, action_url: null });
    }

    sendJson(innerRes, 200, { ok: true, data: alerts });
  })(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/coverage-map
// ─────────────────────────────────────────────────────────────────────────────
function handleDashboardCoverageMap(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, innerUrl, user) => {
    if (isDemoUser(user)) { sendJson(innerRes, 200, { ok: true, data: [] }); return; }
    const cVals = user.companyId ? [user.companyId] : [];
    const cJoin = user.companyId ? "AND e.company_id = $1" : "";

    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT id FROM coverage_uploads ORDER BY created_at DESC LIMIT 1
      ),
      cov AS (
        SELECT
          LOWER(TRIM(municipality)) AS mun_norm,
          COALESCE(SUM(required_tc), 0) AS req_tc,
          COALESCE(SUM(required_mt), 0) AS req_mt
        FROM coverage_upload_rows
        WHERE upload_id = (SELECT id FROM latest)
        GROUP BY LOWER(TRIM(municipality))
      ),
      emp AS (
        SELECT
          m.id   AS mun_id,
          m.name AS mun_name,
          LOWER(TRIM(m.name)) AS mun_norm,
          COUNT(e.id) FILTER (WHERE UPPER(TRIM(e.status)) = 'ACTIVO') AS contracted,
          COUNT(e.id) FILTER (WHERE UPPER(TRIM(e.workday_type)) = 'TC'
                               AND UPPER(TRIM(e.status)) = 'ACTIVO')  AS contracted_tc,
          COUNT(e.id) FILTER (WHERE UPPER(TRIM(e.workday_type)) = 'MT'
                               AND UPPER(TRIM(e.status)) = 'ACTIVO')  AS contracted_mt
        FROM municipalities m
        LEFT JOIN employees e ON e.municipality_id = m.id ${cJoin}
        GROUP BY m.id, m.name
      )
      SELECT
        em.mun_id                          AS municipality_id,
        em.mun_name                        AS municipality_name,
        COALESCE(cv.req_tc, 0)             AS required_tc,
        COALESCE(cv.req_mt, 0)             AS required_mt,
        COALESCE(cv.req_tc,0) + COALESCE(cv.req_mt,0) AS required,
        em.contracted,
        em.contracted_tc,
        em.contracted_mt,
        CASE
          WHEN (COALESCE(cv.req_tc,0) + COALESCE(cv.req_mt,0)) > 0
          THEN ROUND((em.contracted::float /
               (COALESCE(cv.req_tc,0) + COALESCE(cv.req_mt,0))) * 100)
          ELSE NULL
        END AS coverage_pct
      FROM emp em
      LEFT JOIN cov cv ON cv.mun_norm = em.mun_norm
      WHERE em.contracted > 0
         OR (COALESCE(cv.req_tc,0) + COALESCE(cv.req_mt,0)) > 0
      ORDER BY em.mun_name
    `, cVals);

    const data = rows.map(r => {
      const pct = r.coverage_pct !== null ? Number(r.coverage_pct) : null;
      return {
        municipality_id:   Number(r.municipality_id),
        municipality_name: r.municipality_name,
        required_tc:       Number(r.required_tc   || 0),
        required_mt:       Number(r.required_mt   || 0),
        required:          Number(r.required       || 0),
        contracted:        Number(r.contracted     || 0),
        contracted_tc:     Number(r.contracted_tc  || 0),
        contracted_mt:     Number(r.contracted_mt  || 0),
        coverage_pct:      pct,
        status: pct === null ? "no_data" : pct >= 95 ? "ok" : pct >= 85 ? "warning" : "critical",
      };
    });

    sendJson(innerRes, 200, { ok: true, data });
  })(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/recent-activity?limit=10
// ─────────────────────────────────────────────────────────────────────────────
function handleDashboardRecentActivity(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, innerUrl, user) => {
    if (isDemoUser(user)) { sendJson(innerRes, 200, { ok: true, data: [] }); return; }
    const limit = Math.min(Number(innerUrl.searchParams.get("limit") || 10), 50);

    let empQuery, empVals, novQuery, novVals;

    if (user.companyId) {
      empQuery = `
        SELECT id,
          TRIM(COALESCE(first_name,'') || ' ' || COALESCE(first_last_name,'')) AS full_name,
          status, created_at, updated_at
        FROM employees
        WHERE company_id = $1
        ORDER BY GREATEST(created_at, updated_at) DESC
        LIMIT $2`;
      empVals = [user.companyId, limit];

      novQuery = `
        SELECT n.id, n.novelty_type, n.status, n.created_at, n.employee_id,
          TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.first_last_name,'')) AS emp_name
        FROM payroll_novelties n
        LEFT JOIN employees e ON e.id = n.employee_id
        WHERE n.company_id = $1
        ORDER BY n.created_at DESC
        LIMIT $2`;
      novVals = [user.companyId, limit];
    } else {
      empQuery = `
        SELECT id,
          TRIM(COALESCE(first_name,'') || ' ' || COALESCE(first_last_name,'')) AS full_name,
          status, created_at, updated_at
        FROM employees
        ORDER BY GREATEST(created_at, updated_at) DESC
        LIMIT $1`;
      empVals = [limit];

      novQuery = `
        SELECT n.id, n.novelty_type, n.status, n.created_at, n.employee_id,
          TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.first_last_name,'')) AS emp_name
        FROM payroll_novelties n
        LEFT JOIN employees e ON e.id = n.employee_id
        ORDER BY n.created_at DESC
        LIMIT $1`;
      novVals = [limit];
    }

    const [empR, novR] = await Promise.all([
      pool.query(empQuery, empVals),
      pool.query(novQuery, novVals),
    ]);

    const activities = [];

    for (const r of empR.rows) {
      const createdMs  = new Date(r.created_at).getTime();
      const updatedMs  = new Date(r.updated_at).getTime();
      const isNew      = Math.abs(updatedMs - createdMs) < 10_000;
      const ts         = isNew ? r.created_at : r.updated_at;
      activities.push({
        timestamp:   ts,
        type:        isNew ? "INGRESO" : "ACTUALIZACION",
        description: isNew
          ? `Ingreso de empleado: ${r.full_name || "Sin nombre"}`
          : `Actualización: ${r.full_name || "Sin nombre"}`,
        user:      "sistema",
        entity_id: r.id,
      });
    }

    for (const r of novR.rows) {
      const label = r.novelty_type.toLowerCase().replace(/_/g, " ");
      activities.push({
        timestamp:   r.created_at,
        type:        `NOVEDAD_${r.novelty_type}`,
        description: `Novedad (${label}): ${r.emp_name || "Empleado"}`,
        user:      "sistema",
        entity_id: r.employee_id,
      });
    }

    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sendJson(innerRes, 200, { ok: true, data: activities.slice(0, limit) });
  })(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/staff-by-cargo?type=real|licitacion&month=YYYY-MM
// ─────────────────────────────────────────────────────────────────────────────
function handleDashboardStaffByCargo(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, innerUrl, user) => {
    if (isOpsOnly(user)) {
      sendJson(innerRes, 403, { ok: false, message: "Sin acceso a datos de personal" });
      return;
    }
    if (isDemoUser(user)) { sendJson(innerRes, 200, { ok: true, data: [] }); return; }

    const type = (innerUrl.searchParams.get("type") || "real").toLowerCase();
    const month = innerUrl.searchParams.get("month") || "";   // formato YYYY-MM

    const cargoExpr = type === "licitacion"
      ? `COALESCE(NULLIF(TRIM(offered_position),''), NULLIF(TRIM(offer_position),''), 'Sin cargo licitación')`
      : `COALESCE(NULLIF(TRIM(real_position),''), NULLIF(TRIM(cargo),''), 'Sin cargo')`;

    const vals = [];
    const compFilter = user.companyId
      ? (vals.push(user.companyId), `AND company_id = $${vals.length}`)
      : "";

    let activeFilter  = `UPPER(TRIM(status)) = 'ACTIVO'`;
    let retiredFilter = `UPPER(TRIM(status)) IN ('INACTIVO','RETIRADO','RETIRO')`;

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split("-").map(Number);
      vals.push(y, m);
      const yi = vals.length - 1;
      const mi = vals.length;
      activeFilter  += ` AND EXTRACT(YEAR FROM start_date)::int = $${yi} AND EXTRACT(MONTH FROM start_date)::int = $${mi}`;
      retiredFilter += ` AND EXTRACT(YEAR FROM updated_at)::int = $${yi} AND EXTRACT(MONTH FROM updated_at)::int = $${mi}`;
    }

    const { rows } = await pool.query(`
      SELECT
        ${cargoExpr} AS cargo,
        COUNT(*) FILTER (WHERE ${activeFilter})  AS active,
        COUNT(*) FILTER (WHERE ${retiredFilter}) AS retired
      FROM employees
      WHERE 1=1 ${compFilter}
      GROUP BY 1
      HAVING COUNT(*) FILTER (WHERE ${activeFilter}) > 0
          OR COUNT(*) FILTER (WHERE ${retiredFilter}) > 0
      ORDER BY active DESC, retired DESC
    `, vals);

    const data = rows.map(r => ({
      cargo:   r.cargo,
      active:  Number(r.active  || 0),
      retired: Number(r.retired || 0),
    }));

    sendJson(innerRes, 200, { ok: true, data });
  })(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET  /dashboard/events          — lista eventos futuros (todos los roles)
// POST /dashboard/events          — crear evento (solo administrador)
// DELETE /dashboard/events/:id   — borrar evento (solo administrador)
// ─────────────────────────────────────────────────────────────────────────────
function isAdmin(user) {
  return String(user.role || "").toLowerCase() === "administrador";
}

function handleDashboardEvents(req, res, url) {
  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, innerUrl, user) => {

    // ── GET: listar eventos próximos ──────────────────────────────────────────
    if (req.method === "GET") {
      const vals = user.companyId ? [user.companyId] : [];
      const compFilter = user.companyId
        ? `AND (company_id = $1 OR company_id IS NULL)`
        : "";
      const { rows } = await pool.query(`
        SELECT id, title, event_date, event_time, description, company_id, created_by
        FROM calendar_events
        WHERE event_date >= CURRENT_DATE
          ${compFilter}
        ORDER BY event_date ASC, event_time ASC NULLS LAST
        LIMIT 30
      `, vals);

      const data = rows.map(r => ({
        id:          r.id,
        title:       r.title,
        date:        r.event_date,           // "YYYY-MM-DD"
        time:        r.event_time || null,   // "HH:MM:SS" or null
        description: r.description || "",
        companyId:   r.company_id,
        createdBy:   r.created_by,
      }));
      sendJson(innerRes, 200, { ok: true, data });
      return;
    }

    // ── POST: crear evento (solo admin) ───────────────────────────────────────
    if (req.method === "POST") {
      if (!isAdmin(user)) {
        sendJson(innerRes, 403, { ok: false, message: "Solo los administradores pueden crear eventos" });
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const { title, date, time, description } = JSON.parse(body || "{}");
      if (!title || !date) {
        sendJson(innerRes, 400, { ok: false, message: "Título y fecha son obligatorios" });
        return;
      }
      const { rows } = await pool.query(`
        INSERT INTO calendar_events (title, event_date, event_time, description, company_id, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, title, event_date, event_time, description, company_id
      `, [
        title.trim(),
        date,
        time || null,
        description?.trim() || null,
        user.companyId || null,
        user.name || user.username,
      ]);
      sendJson(innerRes, 201, { ok: true, data: rows[0] });
      return;
    }

    sendMethodNotAllowed(innerRes);
  })(req, res, url);
}

function handleDashboardEventDelete(req, res, url, eventId) {
  if (req.method !== "DELETE") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, _u, user) => {
    if (!isAdmin(user)) {
      sendJson(innerRes, 403, { ok: false, message: "Solo los administradores pueden eliminar eventos" });
      return;
    }
    const vals = user.companyId
      ? [eventId, user.companyId]
      : [eventId];
    const compFilter = user.companyId ? "AND (company_id = $2 OR company_id IS NULL)" : "";
    const { rowCount } = await pool.query(
      `DELETE FROM calendar_events WHERE id = $1 ${compFilter}`,
      vals
    );
    if (!rowCount) {
      sendJson(innerRes, 404, { ok: false, message: "Evento no encontrado" });
      return;
    }
    sendJson(innerRes, 200, { ok: true });
  })(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/birthdays?limit=15
// Devuelve los próximos cumpleaños del personal activo, ordenados por fecha
// más próxima (hoy primero, luego días siguientes, sin pasados).
// ─────────────────────────────────────────────────────────────────────────────
function handleDashboardBirthdays(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, innerUrl, user) => {
    const limit = Math.min(Number(innerUrl.searchParams.get("limit") || 15), 50);

    const compFilter = user.companyId ? `AND company_id = $1` : "";
    const vals       = user.companyId ? [user.companyId] : [];

    // sort_key: mes*100+dia para este año si aún no pasó, si ya pasó +1300 para
    // que quede al final y aparezca como "próximo año".
    // Se excluyen días 29-31 en febrero para evitar make_date errors.
    const { rows } = await pool.query(`
      SELECT
        TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.first_last_name,'')) AS name,
        e.birth_day   AS day,
        e.birth_month AS month,
        e.cargo,
        m.name AS municipality_name,
        CASE
          WHEN (e.birth_month > EXTRACT(MONTH FROM CURRENT_DATE)::int)
            OR (e.birth_month  = EXTRACT(MONTH FROM CURRENT_DATE)::int
                AND e.birth_day >= EXTRACT(DAY  FROM CURRENT_DATE)::int)
          THEN e.birth_month * 100 + e.birth_day
          ELSE e.birth_month * 100 + e.birth_day + 1300
        END AS sort_key
      FROM employees e
      LEFT JOIN municipalities m ON m.id = e.municipality_id
      WHERE UPPER(TRIM(e.status)) = 'ACTIVO'
        AND e.birth_day   BETWEEN 1 AND 28
        AND e.birth_month BETWEEN 1 AND 12
        ${compFilter.replace('company_id', 'e.company_id')}
      ORDER BY sort_key ASC
      LIMIT $${vals.length + 1}
    `, [...vals, limit]);

    const today = new Date();
    const todayMonth = today.getMonth() + 1;
    const todayDay   = today.getDate();

    const data = rows.map(r => {
      const sortKey = Number(r.sort_key);
      const isToday = Number(r.month) === todayMonth && Number(r.day) === todayDay;
      const targetYear = sortKey > 1300
        ? today.getFullYear() + 1
        : today.getFullYear();
      const date = `${String(r.day).padStart(2,"0")}/${String(r.month).padStart(2,"0")}/${targetYear}`;
      const daysUntil = isToday
        ? 0
        : Math.round((new Date(targetYear, Number(r.month) - 1, Number(r.day)) - today) / 86400000);
      return { name: r.name, day: Number(r.day), month: Number(r.month), date, daysUntil, isToday, cargo: r.cargo || null, municipality: r.municipality_name || null };
    });

    sendJson(innerRes, 200, { ok: true, data });
  })(req, res, url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/periods
// Returns available periods: union of employee start/coverage dates + coverage
// upload period_month values.  Includes future months if a projection was uploaded.
// ─────────────────────────────────────────────────────────────────────────────
function handleDashboardPeriods(req, res, url) {
  if (req.method !== "GET") { sendMethodNotAllowed(res); return; }

  withModuleProtection(MODULES.DASHBOARD, ACTIONS.VIEW, async (_, innerRes, innerUrl, user, resource) => {
    // Employee scope (company + contract)
    const empVals  = [];
    const empConds = [];
    if (user?.companyId)      { empVals.push(Number(user.companyId));      empConds.push(`e.company_id    = $${empVals.length}`); }
    if (resource?.contractId) { empVals.push(Number(resource.contractId)); empConds.push(`e.contract_id   = $${empVals.length}`); }
    const empWhere = empConds.length ? `AND ${empConds.join(" AND ")}` : "";

    // Coverage upload scope
    const covVals  = [];
    const covConds = ["period_month IS NOT NULL", "TRIM(period_month) != ''", "period_month ~ '^[0-9]{4}-[0-9]{2}$'"];
    if (user?.companyId)      { covVals.push(Number(user.companyId));      covConds.push(`company_id  = $${covVals.length}`); }
    if (resource?.contractId) { covVals.push(Number(resource.contractId)); covConds.push(`contract_id = $${covVals.length}`); }

    const [empRes, covRes] = await Promise.all([
      pool.query(`
        SELECT DISTINCT period FROM (
          SELECT TO_CHAR(e.start_date, 'YYYY-MM') AS period
          FROM employees e
          WHERE e.start_date IS NOT NULL ${empWhere}
          UNION
          SELECT TO_CHAR(e.coverage_start_date, 'YYYY-MM') AS period
          FROM employees e
          WHERE e.coverage_start_date IS NOT NULL ${empWhere}
        ) sub
        WHERE period IS NOT NULL AND period != ''
      `, empVals).catch(() => ({ rows: [] })),

      pool.query(`
        SELECT DISTINCT period_month AS period
        FROM coverage_uploads
        WHERE ${covConds.join(" AND ")}
      `, covVals).catch(() => ({ rows: [] })),
    ]);

    const periodSet = new Set();
    for (const r of empRes.rows) if (r.period) periodSet.add(r.period);
    for (const r of covRes.rows) if (r.period) periodSet.add(r.period);

    // Always guarantee current month is present as fallback
    const now = new Date();
    periodSet.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);

    // Newest first
    const periods = Array.from(periodSet).sort((a, b) => b.localeCompare(a)).slice(0, 36);

    sendJson(innerRes, 200, { ok: true, data: periods });
  })(req, res, url);
}

module.exports = {
  handleDashboardSummary,
  handleDashboardWorkspaceSummary,
  handleDashboardKpis,
  handleDashboardAlerts,
  handleDashboardCoverageMap,
  handleDashboardRecentActivity,
  handleDashboardStaffByCargo,
  handleDashboardBirthdays,
  handleDashboardEvents,
  handleDashboardEventDelete,
  handleDashboardPeriods,
};
