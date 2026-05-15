// ─── Part 1: Imports + helpers básicos ───────────────────────────────────────

const pool = require("../../db/pool");
const { getEmployeeById } = require("../../db/employees.repository");

// ─── Normalización ────────────────────────────────────────────────────────────

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function normalizeMunName(name) {
  return normalizeText(name).replace(/\s+/g, " ");
}

// ─── Estado laboral derivado ──────────────────────────────────────────────────

function getPersonnelWorkStatus(employee) {
  if (!employee) return "DESCONOCIDO";

  const status = normalizeText(employee.status || employee.estado || "");

  if (status === "ACTIVO") return "ACTIVO";
  if (status === "INACTIVO") return "INACTIVO";
  if (status === "NOVEDAD") return "NOVEDAD";
  if (status === "REGISTRO INCOMPLETO") return "INCOMPLETO";
  if (status === "RETIRADO") return "RETIRADO";

  return status || "DESCONOCIDO";
}

// ─── Consultas de documentos ──────────────────────────────────────────────────

async function getPersonnelDocument(employeeId, docTypeId) {
  const numEmpId = Number(employeeId);
  const numDocTypeId = Number(docTypeId);

  if (!Number.isFinite(numEmpId) || numEmpId <= 0) return null;
  if (!Number.isFinite(numDocTypeId) || numDocTypeId <= 0) return null;

  const result = await pool.query(
    `SELECT
       ed.*,
       dt.code   AS doc_type_code,
       dt.name   AS doc_type_name,
       dt.phase  AS doc_type_phase
     FROM employee_documents ed
     JOIN document_types dt ON dt.id = ed.document_type_id
     WHERE ed.employee_id = $1
       AND ed.document_type_id = $2
     ORDER BY ed.uploaded_at DESC
     LIMIT 1`,
    [numEmpId, numDocTypeId]
  );

  return result.rows[0] || null;
}

async function getPersonnelDocumentChecklist(employeeId) {
  const numEmpId = Number(employeeId);
  if (!Number.isFinite(numEmpId) || numEmpId <= 0) return [];

  const result = await pool.query(
    `SELECT
       dt.id            AS doc_type_id,
       dt.code          AS code,
       dt.name          AS name,
       dt.phase         AS phase,
       dt.required      AS required,
       ed.id            AS upload_id,
       ed.status        AS upload_status,
       ed.file_name     AS file_name,
       ed.uploaded_at   AS uploaded_at,
       ed.expiration_date AS expiration_date,
       ed.validated     AS validated,
       ed.observations  AS observations
     FROM document_types dt
     LEFT JOIN employee_documents ed
       ON ed.document_type_id = dt.id
      AND ed.employee_id = $1
     WHERE dt.active = true
     ORDER BY dt.phase, dt.name`,
    [numEmpId]
  );

  return result.rows.map((row) => ({
    docTypeId: row.doc_type_id,
    code: row.code,
    name: row.name,
    phase: row.phase,
    required: Boolean(row.required),
    uploaded: row.upload_id !== null,
    uploadId: row.upload_id || null,
    status: row.upload_status || null,
    fileName: row.file_name || null,
    uploadedAt: row.uploaded_at || null,
    expirationDate: row.expiration_date || null,
    validated: Boolean(row.validated),
    observations: row.observations || null,
  }));
}

async function getRequiredDocumentsForEmployee(employeeId) {
  const numEmpId = Number(employeeId);
  if (!Number.isFinite(numEmpId) || numEmpId <= 0) return [];

  const result = await pool.query(
    `SELECT
       dt.id              AS doc_type_id,
       dt.code            AS code,
       dt.name            AS name,
       dt.phase           AS phase,
       cpd.required       AS required,
       cp.name            AS position_name,
       cp.category        AS category,
       cp.profile_level   AS profile_level
     FROM employees e
     JOIN contract_positions cp
       ON cp.company_id  = e.company_id
      AND cp.contract_id = e.contract_id
      AND cp.tenant_id   = e.tenant_id
      AND UPPER(TRIM(cp.name)) = UPPER(TRIM(
            CASE
              WHEN e.presented_in_offer = true
                THEN COALESCE(
                       NULLIF(e.offered_position, ''),
                       NULLIF(e.offer_position, ''),
                       e.real_position
                     )
              ELSE e.real_position
            END
          ))
     JOIN contract_position_documents cpd
       ON cpd.contract_position_id = cp.id
     JOIN document_types dt
       ON dt.id = cpd.document_type_id
     WHERE e.id = $1
     ORDER BY dt.phase, dt.name`,
    [numEmpId]
  );

  return result.rows.map((row) => ({
    docTypeId: row.doc_type_id,
    code: row.code,
    name: row.name,
    phase: row.phase,
    required: Boolean(row.required),
    positionName: row.position_name || null,
    category: row.category || null,
    profileLevel: row.profile_level || null,
  }));
}

// ─── Part 2: getPersonnelHvStatus + calculateDocumentAlerts ──────────────────

const HV_STATUS = {
  COMPLETE:    "COMPLETO",
  INCOMPLETE:  "INCOMPLETO",
  PENDING:     "PENDIENTE",
  NO_POSITION: "SIN_CARGO",
};

async function getPersonnelHvStatus(employeeId) {
  const [required, checklist] = await Promise.all([
    getRequiredDocumentsForEmployee(employeeId),
    getPersonnelDocumentChecklist(employeeId),
  ]);

  if (!required.length) {
    return {
      status: HV_STATUS.NO_POSITION,
      label: "Sin cargo definido — no se pueden determinar documentos requeridos",
      total: 0,
      uploaded: 0,
      approved: 0,
      missing: [],
      completionPct: 0,
    };
  }

  const checklistByCode = new Map(checklist.map((d) => [d.code, d]));

  const missing = [];
  let uploaded = 0;
  let approved = 0;

  for (const req of required) {
    const doc = checklistByCode.get(req.code);

    if (!doc || !doc.uploaded) {
      if (req.required) missing.push({ docTypeId: req.docTypeId, code: req.code, name: req.name, phase: req.phase });
      continue;
    }

    uploaded++;
    if (doc.status === "aprobado" || doc.validated) approved++;
  }

  const total = required.length;
  const completionPct = total > 0 ? Math.round((uploaded / total) * 100) : 0;

  let status;
  if (missing.length === 0 && approved === total) {
    status = HV_STATUS.COMPLETE;
  } else if (uploaded === 0) {
    status = HV_STATUS.PENDING;
  } else {
    status = HV_STATUS.INCOMPLETE;
  }

  return {
    status,
    label: `${uploaded} de ${total} documentos cargados (${completionPct}%)`,
    total,
    uploaded,
    approved,
    missing,
    completionPct,
  };
}

function calculateDocumentAlerts(checklist, daysAhead = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limitMs = daysAhead * 86_400_000;

  const expired      = [];
  const expiringSoon = [];
  const missingRequired = [];

  for (const doc of checklist) {
    if (!doc.uploaded && doc.required) {
      missingRequired.push({ code: doc.code, name: doc.name, phase: doc.phase });
      continue;
    }

    if (!doc.expirationDate) continue;

    const expiry = new Date(doc.expirationDate);
    expiry.setHours(0, 0, 0, 0);
    const diff = expiry - today;

    if (diff < 0) {
      expired.push({
        code:           doc.code,
        name:           doc.name,
        uploadId:       doc.uploadId,
        expirationDate: doc.expirationDate,
        daysOverdue:    Math.abs(Math.round(diff / 86_400_000)),
      });
    } else if (diff <= limitMs) {
      expiringSoon.push({
        code:           doc.code,
        name:           doc.name,
        uploadId:       doc.uploadId,
        expirationDate: doc.expirationDate,
        daysLeft:       Math.round(diff / 86_400_000),
      });
    }
  }

  return {
    hasAlerts: expired.length > 0 || expiringSoon.length > 0 || missingRequired.length > 0,
    expired,
    expiringSoon,
    missingRequired,
  };
}

// ─── Part 3: calculatePersonnelDashboard + filtros ───────────────────────────

const AGE_BRACKETS = [
  { label: "≤25",   min: 0,  max: 25  },
  { label: "26-35", min: 26, max: 35  },
  { label: "36-45", min: 36, max: 45  },
  { label: "46-55", min: 46, max: 55  },
  { label: "56-60", min: 56, max: 60  },
  { label: "60+",   min: 61, max: 999 },
];

function getAgeBracket(birthYear) {
  const yr = parseInt(birthYear, 10);
  if (isNaN(yr) || yr <= 0) return null;
  const age = new Date().getFullYear() - yr;
  return AGE_BRACKETS.find((b) => age >= b.min && age <= b.max)?.label ?? null;
}

// ─── getPersonnelFilterValue ──────────────────────────────────────────────────

const FILTER_EXTRACTORS = {
  municipality:  (e) => normalizeMunName(e.municipalityName || e.municipality || e.municipio || ""),
  status:        (e) => normalizeText(e.status || e.estado || ""),
  workdayType:   (e) => normalizeText(e.workdayType || e.workday_type || ""),
  position:      (e) => normalizeText(e.cargo_real || e.position || e.cargo || ""),
  institution:   (e) => normalizeText(e.institutionName || e.institution || e.institucion_educativa || ""),
  site:          (e) => normalizeText(e.siteName || e.site || e.sede_educativa || ""),
  modality:      (e) => normalizeText(e.modality || e.modalidad || ""),
  sex:           (e) => normalizeText(e.biologicalSex || e.sex || e.genero || ""),
  eps:           (e) => normalizeText(e.eps || ""),
  companyId:     (e) => String(e.companyId || e.company_id || ""),
  contractId:    (e) => String(e.contractId || e.contract_id || ""),
};

function getPersonnelFilterValue(employee, filterKey) {
  const extractor = FILTER_EXTRACTORS[filterKey];
  return extractor ? extractor(employee) : "";
}

// ─── filterPersonnelRows ──────────────────────────────────────────────────────

function filterPersonnelRows(rows, filters = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const {
    search,
    municipality,
    status,
    workdayType,
    position,
    institution,
    site,
    modality,
    sex,
    eps,
    companyId,
    contractId,
  } = filters;

  const searchNorm = search ? normalizeText(search) : null;

  return rows.filter((emp) => {
    if (searchNorm) {
      const fullName = normalizeText(emp.fullName || emp.name || emp.nombre || "");
      const docNum   = String(emp.documentNumber || emp.numero_documento || "");
      if (!fullName.includes(searchNorm) && !docNum.includes(searchNorm)) return false;
    }

    if (municipality) {
      if (getPersonnelFilterValue(emp, "municipality") !== normalizeMunName(municipality)) return false;
    }

    if (status) {
      if (getPersonnelFilterValue(emp, "status") !== normalizeText(status)) return false;
    }

    if (workdayType) {
      if (getPersonnelFilterValue(emp, "workdayType") !== normalizeText(workdayType)) return false;
    }

    if (position) {
      if (getPersonnelFilterValue(emp, "position") !== normalizeText(position)) return false;
    }

    if (institution) {
      if (getPersonnelFilterValue(emp, "institution") !== normalizeText(institution)) return false;
    }

    if (site) {
      if (getPersonnelFilterValue(emp, "site") !== normalizeText(site)) return false;
    }

    if (modality) {
      if (getPersonnelFilterValue(emp, "modality") !== normalizeText(modality)) return false;
    }

    if (sex) {
      if (getPersonnelFilterValue(emp, "sex") !== normalizeText(sex)) return false;
    }

    if (eps) {
      if (getPersonnelFilterValue(emp, "eps") !== normalizeText(eps)) return false;
    }

    if (companyId !== undefined && companyId !== null && companyId !== "") {
      if (getPersonnelFilterValue(emp, "companyId") !== String(companyId)) return false;
    }

    if (contractId !== undefined && contractId !== null && contractId !== "") {
      if (getPersonnelFilterValue(emp, "contractId") !== String(contractId)) return false;
    }

    return true;
  });
}

// ─── getVisibleMunicipalityOptions ───────────────────────────────────────────

function getVisibleMunicipalityOptions(rows) {
  const seen = new Set();
  for (const emp of rows) {
    const name = String(
      emp.municipalityName || emp.municipality || emp.municipio || ""
    ).trim();
    if (name) seen.add(name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "es"));
}

// ─── calculatePersonnelDashboard ─────────────────────────────────────────────

function calculatePersonnelDashboard(rows) {
  const total = rows.length;

  const byStatus      = {};
  const byWorkdayType = {};
  const byGender      = {};
  const byMunicipality = {};
  const byPosition    = {};
  const byEps         = {};
  const ageByPosition = {};
  const ageGenderByBracket = {};

  for (const b of AGE_BRACKETS) ageGenderByBracket[b.label] = { female: 0, male: 0 };

  for (const emp of rows) {
    const status     = normalizeText(emp.status || emp.estado || "SIN_ESTADO");
    const workday    = normalizeText(emp.workdayType || emp.workday_type || "");
    const sex        = normalizeText(emp.biologicalSex || emp.sex || emp.genero || "");
    const mun        = String(emp.municipalityName || emp.municipality || emp.municipio || "").trim();
    const pos        = normalizeText(emp.cargo_real || emp.position || emp.cargo || "SIN CARGO");
    const eps        = normalizeText(emp.eps || "SIN EPS");
    const birthYear  = emp.birthYear || emp.birth_year;
    const bracket    = getAgeBracket(birthYear);

    byStatus[status]           = (byStatus[status]           || 0) + 1;
    if (workday) byWorkdayType[workday] = (byWorkdayType[workday] || 0) + 1;
    if (sex)     byGender[sex]          = (byGender[sex]          || 0) + 1;
    if (mun)     byMunicipality[mun]    = (byMunicipality[mun]    || 0) + 1;
    byPosition[pos]            = (byPosition[pos]            || 0) + 1;
    byEps[eps]                 = (byEps[eps]                 || 0) + 1;

    if (bracket) {
      if (!ageByPosition[pos]) {
        ageByPosition[pos] = { _total: 0 };
        for (const b of AGE_BRACKETS) ageByPosition[pos][b.label] = 0;
      }
      ageByPosition[pos][bracket] += 1;
      ageByPosition[pos]._total   += 1;

      if (sex === "MUJER")  ageGenderByBracket[bracket].female += 1;
      if (sex === "HOMBRE") ageGenderByBracket[bracket].male   += 1;
    }
  }

  return {
    total,
    byStatus,
    byWorkdayType,
    byGender,
    byMunicipality,
    byPosition,
    byEps,
    ageByPosition,
    ageGenderByBracket,
    ageBrackets: AGE_BRACKETS.map((b) => b.label),
    municipalityCount: Object.keys(byMunicipality).length,
  };
}

module.exports = {
  normalizeText,
  normalizeMunName,
  getPersonnelWorkStatus,
  getPersonnelDocument,
  getPersonnelDocumentChecklist,
  getRequiredDocumentsForEmployee,
  getPersonnelHvStatus,
  calculateDocumentAlerts,
  getPersonnelFilterValue,
  filterPersonnelRows,
  getVisibleMunicipalityOptions,
  calculatePersonnelDashboard,
};
