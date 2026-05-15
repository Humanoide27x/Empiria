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

module.exports = {
  handleDashboardSummary,
  handleDashboardKpis,
  handleDashboardAlerts,
  handleDashboardCoverageMap,
  handleDashboardRecentActivity,
  handleDashboardStaffByCargo,
};
