const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { withModuleProtection, isDemoUser } = require("../../http/protection");

const {
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  updateEmployeePhoto,
} = require("../../db/employees.repository");
const {
  resolveMunicipalityRecord,
  listMunicipalities,
} = require("../../db/municipalities.repository");

const pool = require("../../db/pool");

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

const GESTOR_POSITION = "GESTOR DE ZONA";
const AUXILIAR_GESTOR_POSITION = "AUXILIAR DE GESTOR DE ZONA";

// Cache del catálogo educativo — se reconstruye máximo una vez cada 5 minutos
let _catalogCache = new Map();
const CATALOG_TTL = 5 * 60 * 1000;

function normalizeScopedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function splitAssignedMunicipalities(value) {
  return String(value || "")
    .split(/[|,;\n\r]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function listScopedManagers({
  companyId,
  contractId,
  municipalityId,
  municipalityName,
  allowedMunicipalityIds = [],
}) {
  let municipality = null;
  try {
    municipality = await resolveMunicipalityRecord({ municipalityId, municipalityName });
  } catch {
    municipality = null;
  }
  if (!municipality) {
    return {
      municipality: null,
      gestores: [],
      auxiliares: [],
    };
  }

  if (
    Array.isArray(allowedMunicipalityIds) &&
    allowedMunicipalityIds.length > 0 &&
    !allowedMunicipalityIds.map(String).includes(String(municipality.id))
  ) {
    return {
      municipality,
      gestores: [],
      auxiliares: [],
    };
  }

  const values = [
    [GESTOR_POSITION, AUXILIAR_GESTOR_POSITION],
  ];
  const conditions = [
    `(
      UPPER(TRIM(COALESCE(e.real_position, ''))) = ANY($1)
      OR UPPER(TRIM(COALESCE(e.cargo, ''))) = ANY($1)
    )`,
    `COALESCE(NULLIF(TRIM(e.full_name), ''), '') <> ''`,
    `UPPER(TRIM(COALESCE(e.status, 'ACTIVO'))) = 'ACTIVO'`,
  ];
  const assignmentJoinConditions = [
    `eca.employee_id = e.id`,
    `eca.active = true`,
    `eca.assignment_end_date IS NULL`,
  ];

  if (companyId) {
    values.push(Number(companyId));
    assignmentJoinConditions.push(`eca.company_id = $${values.length}`);
    conditions.push(`(e.company_id = $${values.length} OR eca.id IS NOT NULL)`);
  }

  if (contractId) {
    values.push(Number(contractId));
    assignmentJoinConditions.push(`eca.contract_id = $${values.length}`);
    conditions.push(`(e.contract_id = $${values.length} OR eca.id IS NOT NULL)`);
  }

  const { rows } = await pool.query(
    `
    SELECT
      e.id,
      e.full_name,
      e.real_position,
      e.cargo,
      e.municipios_a_cargo,
      e.municipality_id,
      legacy_m.name AS municipality_name,
      COALESCE(
        ARRAY_REMOVE(
          ARRAY_AGG(DISTINCT eam.municipality_id) FILTER (WHERE eam.municipality_id IS NOT NULL),
          NULL
        ),
        ARRAY[]::INTEGER[]
      ) AS assignment_municipality_ids,
      COALESCE(
        ARRAY_REMOVE(
          ARRAY_AGG(DISTINCT scoped_m.name) FILTER (WHERE scoped_m.name IS NOT NULL),
          NULL
        ),
        ARRAY[]::TEXT[]
      ) AS assignment_municipality_names
    FROM employees e
    LEFT JOIN municipalities legacy_m
      ON legacy_m.id = e.municipality_id
    LEFT JOIN employee_contract_assignments eca
      ON ${assignmentJoinConditions.join("\n     AND ")}
    LEFT JOIN employee_assignment_municipalities eam
      ON eam.assignment_id = eca.id
     AND eam.active = true
    LEFT JOIN municipalities scoped_m
      ON scoped_m.id = eam.municipality_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY e.id, e.full_name, e.real_position, e.cargo, e.municipios_a_cargo, e.municipality_id, legacy_m.name
    ORDER BY e.full_name ASC
    `,
    values
  );

  const targetMunicipality = normalizeScopedText(municipality.name);
  const targetMunicipalityId = String(municipality.id);
  const gestores = [];
  const auxiliares = [];

  for (const row of rows) {
    const assignedMunicipalities = splitAssignedMunicipalities(row.municipios_a_cargo);
    const assignmentMunicipalityIds = Array.isArray(row.assignment_municipality_ids)
      ? row.assignment_municipality_ids.map((item) => String(item))
      : [];
    const assignmentMunicipalityNames = Array.isArray(row.assignment_municipality_names)
      ? row.assignment_municipality_names
      : [];
    const hasMunicipality = (
      assignmentMunicipalityIds.includes(targetMunicipalityId)
      || assignedMunicipalities.some((item) => {
        const normalized = normalizeScopedText(item);
        return normalized === targetMunicipality || String(item).trim() === targetMunicipalityId;
      })
      || assignmentMunicipalityNames.some(
        (item) => normalizeScopedText(item) === targetMunicipality
      )
      || String(row.municipality_id || "").trim() === targetMunicipalityId
      || normalizeScopedText(row.municipality_name) === targetMunicipality
    );
    if (!hasMunicipality) continue;

    const fullName = String(row.full_name || "").trim();
    if (!fullName) continue;

    const position = normalizeScopedText(row.real_position || row.cargo);
    if (position === GESTOR_POSITION && !gestores.includes(fullName)) gestores.push(fullName);
    if (position === AUXILIAR_GESTOR_POSITION && !auxiliares.includes(fullName)) auxiliares.push(fullName);
  }

  return {
    municipality,
    gestores,
    auxiliares,
  };
}

async function validateScopedManagerAssignments(body = {}, resource = {}) {
  const gestorName = String(body.gestorZona || body.gestor_zona || "").trim();
  const auxiliarName = String(body.auxiliarGestorZona || body.auxiliar_gestor_zona || "").trim();

  if (!gestorName && !auxiliarName) {
    return { ok: true };
  }

  const companyId = body.companyId || body.company_id || resource?.companyId || null;
  const contractId = body.contractId || body.contract_id || resource?.contractId || null;
  const municipalityId = body.municipalityId || body.municipality_id || body.municipio_id || null;
  const municipalityName = body.municipalityName || body.municipality || body.municipio || null;

  const scopedManagers = await listScopedManagers({
    companyId,
    contractId,
    municipalityId,
    municipalityName,
    allowedMunicipalityIds: resource?.municipalityIds,
  });

  if (!scopedManagers.municipality) {
    return {
      ok: false,
      status: 400,
      message: "Debes seleccionar un municipio valido antes de asignar gestor.",
    };
  }

  if (
    gestorName &&
    !scopedManagers.gestores.some((item) => normalizeScopedText(item) === normalizeScopedText(gestorName))
  ) {
    return {
      ok: false,
      status: 400,
      message: scopedManagers.gestores.length
        ? "El gestor seleccionado no esta asignado a este municipio."
        : "No hay gestores asignados a este municipio.",
    };
  }

  if (
    auxiliarName &&
    !scopedManagers.auxiliares.some((item) => normalizeScopedText(item) === normalizeScopedText(auxiliarName))
  ) {
    return {
      ok: false,
      status: 400,
      message: scopedManagers.auxiliares.length
        ? "El auxiliar de gestor seleccionado no esta asignado a este municipio."
        : "No hay auxiliares de gestor asignados a este municipio.",
    };
  }

  return {
    ok: true,
    municipality: scopedManagers.municipality,
  };
}

async function measureEndpoint(label, fn) {
  const startedAt = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (elapsedMs >= 500) {
      console.warn(`[perf] ${label} ${elapsedMs.toFixed(1)}ms`);
    }
  }
}

function getEducationalCatalogCacheKey({
  companyId,
  contractId,
  allowedMunicipalityIds = [],
}) {
  return [
    companyId || "",
    contractId || "",
    Array.isArray(allowedMunicipalityIds) ? allowedMunicipalityIds.map(String).sort().join(",") : "",
  ].join("|");
}

function readEducationalCatalogCache(cacheKey) {
  const cached = _catalogCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.ts > CATALOG_TTL) {
    _catalogCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function writeEducationalCatalogCache(cacheKey, data) {
  _catalogCache.set(cacheKey, { ts: Date.now(), data });
}

async function getEducationalCatalog({
  companyId,
  contractId,
  allowedMunicipalityIds = [],
} = {}) {
  const scopedCompanyId = Number(companyId) || null;
  const scopedContractId = Number(contractId) || null;
  const cacheKey = getEducationalCatalogCacheKey({
    companyId: scopedCompanyId,
    contractId: scopedContractId,
    allowedMunicipalityIds,
  });
  const cached = readEducationalCatalogCache(cacheKey);
  if (cached) return cached;

  if (!scopedCompanyId || !scopedContractId) {
    return {
      educationalCatalog: {},
      educationalCatalogMeta: {
        companyId: scopedCompanyId,
        contractId: scopedContractId,
        periodMonth: null,
        uploadId: null,
        hasCoverage: false,
        municipalities: [],
        message: "Selecciona empresa y contrato para cargar la cobertura PAE.",
      },
    };
  }

  const coverageResult = await pool.query(
    `
    WITH latest_upload AS (
      SELECT id, period_month
      FROM coverage_uploads
      WHERE company_id = $1
        AND contract_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    SELECT
      lu.id AS upload_id,
      lu.period_month,
      r.municipality_id,
      COALESCE(m.name, TRIM(r.municipality)) AS municipality_name,
      TRIM(r.institution) AS institution_name,
      TRIM(r.site) AS site_name,
      TRIM(r.modality) AS modality_name
    FROM latest_upload lu
    JOIN coverage_upload_rows r
      ON r.upload_id = lu.id
    LEFT JOIN municipalities m
      ON m.id = r.municipality_id
    WHERE NULLIF(TRIM(r.municipality), '') IS NOT NULL
      AND NULLIF(TRIM(r.institution), '') IS NOT NULL
      AND NULLIF(TRIM(r.site), '') IS NOT NULL
      AND NULLIF(TRIM(r.modality), '') IS NOT NULL
    ORDER BY 3, 4, 5, 6
    `,
    [scopedCompanyId, scopedContractId]
  );

  const municipalityRows = await listMunicipalities({ activeOnly: true });
  const municipalityById = new Map(
    municipalityRows.map((row) => [String(row.id), row])
  );

  const allowedMunicipalitySet = Array.isArray(allowedMunicipalityIds) && allowedMunicipalityIds.length > 0
    ? new Set(allowedMunicipalityIds.map(String))
    : null;

  const catalog = {};
  const municipalityOptions = [];
  const seenMunicipalities = new Set();

  for (const row of coverageResult.rows) {
    const municipalityName = String(row.municipality_name || "").trim();
    const institutionName = String(row.institution_name || "").trim();
    const siteName = String(row.site_name || "").trim();
    const modalityName = String(row.modality_name || "").trim();
    if (!municipalityName || !institutionName || !siteName || !modalityName) continue;

    const matchedMunicipality = municipalityById.get(String(row.municipality_id || "")) || null;

    if (
      allowedMunicipalitySet &&
      (!matchedMunicipality || !allowedMunicipalitySet.has(String(matchedMunicipality.id)))
    ) {
      continue;
    }

    const municipalityKey = String(matchedMunicipality?.id || row.municipality_id || "").trim();
    if (!municipalityKey) continue;
    const municipalityLabel = matchedMunicipality?.name || municipalityName;

    if (!catalog[municipalityKey]) catalog[municipalityKey] = {};
    if (!catalog[municipalityKey][institutionName]) catalog[municipalityKey][institutionName] = {};
    if (!catalog[municipalityKey][institutionName][siteName]) catalog[municipalityKey][institutionName][siteName] = [];

    if (!catalog[municipalityKey][institutionName][siteName].includes(modalityName)) {
      catalog[municipalityKey][institutionName][siteName].push(modalityName);
    }

    if (!seenMunicipalities.has(municipalityKey)) {
      seenMunicipalities.add(municipalityKey);
      municipalityOptions.push({
        id: matchedMunicipality?.id || Number(row.municipality_id) || null,
        name: municipalityLabel,
      });
    }
  }

  municipalityOptions.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));

  const response = {
    educationalCatalog: catalog,
    educationalCatalogMeta: {
      companyId: scopedCompanyId,
      contractId: scopedContractId,
      periodMonth: coverageResult.rows[0]?.period_month || null,
      uploadId: coverageResult.rows[0]?.upload_id || null,
      hasCoverage: municipalityOptions.length > 0,
      municipalities: municipalityOptions,
      message: municipalityOptions.length
        ? ""
        : "No existe cobertura PAE cargada para este contexto.",
    },
  };

  writeEducationalCatalogCache(cacheKey, response);
  return response;
}

async function handleContractPositions(req, res, contractId) {
  const { requireAuth } = require("../auth/auth.helpers");
  const auth = requireAuth(req, res);
  if (!auth) return;

  const { rows } = await pool.query(
    `SELECT positions FROM contract_settings WHERE contract_id = $1`,
    [contractId]
  );
  const positions = Array.isArray(rows[0]?.positions) ? rows[0].positions : [];
  sendJson(res, 200, { ok: true, positions });
}

function handlePersonnel(req, res) {
  // ==============================
  // IMPORTAR PERSONAL
  // ==============================
  if (req.method === "POST" && req.url === "/personnel/import") {
    return withModuleProtection(
      "gestion_personal",
      "create",
      async (req, res) => {
        return sendJson(res, 410, {
          ok: false,
          message: "La importacion directa fue deshabilitada. Usa /employee-import/preview.",
        });

        try {
          const body = await readJsonBody(req);

          if (!body.fileBase64) {
            return sendJson(res, 400, {
              ok: false,
              message: "Debes enviar el archivo Excel.",
            });
          }

          const result = await importEmployeesFromExcel({
            fileBase64: body.fileBase64,
            fileName: body.fileName || "personal.xlsx",
            defaults: {
              companyId: body.companyId,
              contractId: body.contractId,
            },
          });

          return sendJson(res, 200, {
            ok: true,
            data: result,
            message: "Importación realizada correctamente",
          });
        } catch (error) {
          return sendJson(res, 400, {
            ok: false,
            message: error.message || "Error importando personal",
          });
        }
      }
    )(req, res);
  }

  // ==============================
  // GET PERSONAL
  // ==============================
  if (req.method === "GET") {
    const requestUrl = new URL(req.url, 'http://localhost');
    return withModuleProtection(
      "gestion_personal",
      "view",
      async (req, res, url, user, resource) => {
        const parsedUrl = url || requestUrl;
        if (parsedUrl.pathname === "/personnel/catalog") {
          const qCompanyId = parsedUrl.searchParams.get("companyId") || resource?.companyId || "";
          const qContractId = parsedUrl.searchParams.get("contractId") || resource?.contractId || "";
          const educationalCatalogPayload = await measureEndpoint(
            "GET /personnel/catalog educationalCatalog",
            () => getEducationalCatalog({
              companyId: qCompanyId,
              contractId: qContractId,
              allowedMunicipalityIds: resource?.municipalityIds,
            })
          ).catch(err => {
            console.error("ERROR CATALOGO EDUCATIVO:", err);
            return {
              educationalCatalog: {},
              educationalCatalogMeta: {
                companyId: qCompanyId ? Number(qCompanyId) || null : null,
                contractId: qContractId ? Number(qContractId) || null : null,
                periodMonth: null,
                uploadId: null,
                hasCoverage: false,
                municipalities: [],
                message: "No fue posible cargar la cobertura PAE para este contexto.",
              },
            };
          });
          return sendJson(res, 200, { ok: true, ...educationalCatalogPayload });
        }

        if (parsedUrl.pathname === "/personnel/managers") {
          const qMunicipalityId = parsedUrl.searchParams.get("municipalityId")
            || parsedUrl.searchParams.get("municipality_id")
            || "";
          const qMunicipalityName = parsedUrl.searchParams.get("municipalityName")
            || parsedUrl.searchParams.get("municipality_name")
            || "";
          const qCompanyId = parsedUrl.searchParams.get("companyId") || resource?.companyId || "";
          const qContractId = parsedUrl.searchParams.get("contractId") || resource?.contractId || "";

          const scopedManagers = await measureEndpoint(
            "GET /personnel/managers listScopedManagers",
            () => listScopedManagers({
              companyId: qCompanyId,
              contractId: qContractId,
              municipalityId: qMunicipalityId,
              municipalityName: qMunicipalityName,
              allowedMunicipalityIds: resource?.municipalityIds,
            })
          );

          const municipalityName = scopedManagers.municipality?.name || "";
          const message = !scopedManagers.municipality
            ? "Selecciona un municipio valido para consultar gestores."
            : scopedManagers.gestores.length
              ? `Gestores cargados para ${municipalityName}.`
              : "No hay gestores asignados a este municipio.";

          return sendJson(res, 200, {
            ok: true,
            municipalityId: scopedManagers.municipality?.id || null,
            municipalityName,
            gestores: scopedManagers.gestores,
            auxiliares: scopedManagers.auxiliares,
            message,
          });
        }

        const detailMatch = parsedUrl.pathname.match(/^\/personnel\/(\d+)$/);
        if (detailMatch) {
          const employee = await measureEndpoint("GET /personnel/:id getEmployeeById", () => getEmployeeById(Number(detailMatch[1])));
          if (!employee) {
            return sendJson(res, 404, { ok: false, message: "Empleado no encontrado" });
          }
          if (resource?.companyId && Number(employee.companyId || employee.company_id) !== Number(resource.companyId)) {
            return sendJson(res, 404, { ok: false, message: "Empleado no encontrado" });
          }
          if (resource?.contractId && Number(employee.contractId || employee.contract_id) !== Number(resource.contractId)) {
            return sendJson(res, 404, { ok: false, message: "Empleado no encontrado" });
          }
          if (Array.isArray(resource?.municipalityIds) && resource.municipalityIds.length > 0) {
            const allowedMunicipality = resource.municipalityIds.map(String).includes(String(employee.municipalityId || employee.municipality_id));
            if (!allowedMunicipality) {
              return sendJson(res, 404, { ok: false, message: "Empleado no encontrado" });
            }
          }
          return sendJson(res, 200, { ok: true, data: employee });
        }

        if (isDemoUser(user)) {
          return sendJson(res, 200, {
            data: [],
            pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
            total: 0,
            page: 1,
            limit: 25,
            pageSize: 25,
            educationalCatalog: {},
          });
        }

        const filters = {};
        if (resource?.companyId) filters.companyId = resource.companyId;
        if (resource?.contractId) filters.contractId = resource.contractId;
        if (resource?.tenantId) filters.tenantId = resource.tenantId;
        if (Array.isArray(resource?.municipalityIds) && resource.municipalityIds.length > 0) {
          filters.municipalityIds = resource.municipalityIds;
        }

        const toPositiveInt = (value, fallback, max) => {
          const n = Number(value);
          return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
        };
        const qMunicipalityName = parsedUrl.searchParams.get('municipalityName') || '';
        const qMunicipalityId   = parsedUrl.searchParams.get('municipalityId')   || '';
        const qCompanyId        = parsedUrl.searchParams.get('companyId')        || '';
        const qContractId       = parsedUrl.searchParams.get('contractId')       || '';
        const qSearch           = parsedUrl.searchParams.get('search')           || '';
        const qNameSearch       = parsedUrl.searchParams.get('nameSearch')       || '';
        const qDocumentNumber   = parsedUrl.searchParams.get('documentNumber')   || '';
        const qStatus           = parsedUrl.searchParams.get('status')           || '';
        const qActive           = parsedUrl.searchParams.get('active')           || '';
        const qCoverage         = parsedUrl.searchParams.get('coverage')         || parsedUrl.searchParams.get('coverageStatus') || '';
        const qPersonnelType    = parsedUrl.searchParams.get('personnelType')    || parsedUrl.searchParams.get('type') || '';
        const qRole             = parsedUrl.searchParams.get('role') || parsedUrl.searchParams.get('position') || '';
        const qDocumentStatus   = parsedUrl.searchParams.get('documentStatus')   || '';
        const qHvStatus         = parsedUrl.searchParams.get('hvStatus')         || parsedUrl.searchParams.get('documentaryStatus') || '';
        const qGestorZona       = parsedUrl.searchParams.get('gestorZona')       || '';
        const qInstitution      = parsedUrl.searchParams.get('institution')      || '';
        const qSite             = parsedUrl.searchParams.get('site')             || '';
        const qModality         = parsedUrl.searchParams.get('modality')         || '';
        const qPage             = toPositiveInt(parsedUrl.searchParams.get('page'), 1, 1000000);
        const qPageSize         = toPositiveInt(
          parsedUrl.searchParams.get('pageSize') || parsedUrl.searchParams.get('limit'),
          25,
          5000
        );
        const exportAll         = parsedUrl.searchParams.get('export') === '1' || parsedUrl.searchParams.get('all') === '1';

        if (qSearch)           filters.search           = qSearch;
        if (qMunicipalityName) filters.municipalityName = qMunicipalityName;
        if (qCompanyId && (!resource?.companyId || String(resource.companyId) === String(qCompanyId))) {
          filters.companyId = qCompanyId;
        }
        if (qMunicipalityId) {
          const allowed = !Array.isArray(resource?.municipalityIds)
            || resource.municipalityIds.length === 0
            || resource.municipalityIds.map(String).includes(String(qMunicipalityId));
          if (allowed) filters.municipalityId = qMunicipalityId;
        }
        if (qContractId && (!resource?.contractId || String(resource.contractId) === String(qContractId))) {
          filters.contractId = qContractId;
        }
        if (qNameSearch)       filters.nameSearch       = qNameSearch;
        if (qDocumentNumber)   filters.documentNumber   = qDocumentNumber;
        if (qStatus)           filters.status           = qStatus;
        if (qActive)           filters.active           = qActive;
        if (qCoverage)         filters.coverage         = qCoverage;
        if (qPersonnelType)    filters.personnelType    = qPersonnelType;
        if (qRole)             filters.role             = qRole;
        if (qDocumentStatus)   filters.documentStatus   = qDocumentStatus;
        if (qHvStatus)         filters.hvStatus         = qHvStatus;
        if (qGestorZona)       filters.gestorZona       = qGestorZona;
        if (qInstitution)      filters.institution      = qInstitution;
        if (qSite)             filters.site             = qSite;
        if (qModality)         filters.modality         = qModality;
        filters.page  = qPage;
        filters.pageSize = qPageSize;
        filters.exportAll = exportAll;

        const hasUserFilter = !!(
          qSearch || qMunicipalityName || qMunicipalityId || qContractId || qNameSearch ||
          qCompanyId || qDocumentNumber || qStatus || qActive || qCoverage || qPersonnelType ||
          qRole || qDocumentStatus || qHvStatus || qGestorZona ||
          qInstitution || qSite || qModality
        );

        const result = await measureEndpoint("GET /personnel getEmployees", () => getEmployees(filters));

        const pagination = {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
        };

        return sendJson(res, 200, {
          data:  result.rows,
          pagination,
          total: result.total,
          page:  result.page,
          limit: result.limit,
          pageSize: result.pageSize,
          appliedFilters: {
            search: filters.search || "",
            companyId: filters.companyId || "",
            contractId: filters.contractId || "",
            municipalityId: filters.municipalityId || "",
            municipalityName: filters.municipalityName || "",
            status: filters.status || "",
            active: filters.active || "",
            coverage: filters.coverage || "",
            personnelType: filters.personnelType || "",
            position: filters.role || filters.position || "",
            documentStatus: filters.documentStatus || "",
            hvStatus: filters.hvStatus || "",
            gestorZona: filters.gestorZona || "",
            institution: filters.institution || "",
            site: filters.site || "",
            modality: filters.modality || "",
          },
        });
      }
    )(req, res, requestUrl);
  }

  // ==============================
  // CREAR
  // ==============================
  if (req.method === "POST") {
    return withModuleProtection(
      "gestion_personal",
      "create",
      async (req, res, url, user, resource) => {
        const body = await readJsonBody(req);

        if (!body.fullName && !(body.firstName || body.primer_nombre)) {
          return sendJson(res, 400, {
            ok: false,
            message: "El nombre del empleado es obligatorio.",
          });
        }

        if (!body.documentNumber && !body.numero_documento) {
          return sendJson(res, 400, {
            ok: false,
            message: "El número de documento es obligatorio.",
          });
        }

        // Inyectar companyId/contractId del contexto si no vienen en el body
        if (!body.companyId && !body.company_id && resource?.companyId) {
          body.companyId = resource.companyId;
        }
        if (!body.contractId && !body.contract_id && resource?.contractId) {
          body.contractId = resource.contractId;
        }

        const managerValidation = await validateScopedManagerAssignments(body, resource);
        if (!managerValidation.ok) {
          return sendJson(res, managerValidation.status || 400, {
            ok: false,
            message: managerValidation.message,
          });
        }

        const created = await createEmployee(body);
        return sendJson(res, 201, { data: created });
      }
    )(req, res);
  }

  // ==============================
  // FOTO DE PERFIL
  // ==============================
  if (req.method === "PATCH" && req.url === "/personnel/photo") {
    return withModuleProtection(
      "gestion_personal",
      "update",
      async (req, res) => {
        const body = await readJsonBody(req);
        const { id, photoUrl } = body;
        if (!id) return sendJson(res, 400, { ok: false, message: "ID requerido" });
        if (!photoUrl) return sendJson(res, 400, { ok: false, message: "photoUrl requerida" });
        const updated = await updateEmployeePhoto(id, photoUrl);
        if (!updated) return sendJson(res, 404, { ok: false, message: "Empleado no encontrado" });
        return sendJson(res, 200, { ok: true });
      }
    )(req, res);
  }

  // ==============================
  // ACTUALIZAR
  // ==============================
  if (req.method === "PUT") {
    return withModuleProtection(
      "gestion_personal",
      "update",
      async (req, res, url, user, resource) => {
        const body = await readJsonBody(req);
        const id = body.id || body.employeeId || body.personnelId;

        if (!id) {
          return sendJson(res, 400, {
            ok: false,
            message: "ID requerido para actualizar el empleado",
          });
        }

        if (!body.companyId && !body.company_id && resource?.companyId) {
          body.companyId = resource.companyId;
        }
        if (!body.contractId && !body.contract_id && resource?.contractId) {
          body.contractId = resource.contractId;
        }

        const managerValidation = await validateScopedManagerAssignments(body, resource);
        if (!managerValidation.ok) {
          return sendJson(res, managerValidation.status || 400, {
            ok: false,
            message: managerValidation.message,
          });
        }

        let updated;
        try {
          updated = await updateEmployee(id, body);
        } catch (err) {
          console.error("[PUT /personnel] Error en updateEmployee:", err.message, "\nBody keys:", Object.keys(body));
          const msg = err.message || "";
          if (msg.includes("llave foránea") || msg.includes("foreign key") || msg.includes("fkey")) {
            return sendJson(res, 400, {
              ok: false,
              message: "No se pudo guardar: la sede o institución seleccionada no existe en el catálogo. Selecciona nuevamente municipio → institución → sede y guarda.",
            });
          }
          return sendJson(res, 500, { ok: false, message: "Error interno al actualizar el empleado: " + err.message });
        }

        if (!updated) {
          return sendJson(res, 404, {
            ok: false,
            message: "Empleado no encontrado",
          });
        }

        return sendJson(res, 200, {
          ok: true,
          data: updated,
          message: "Empleado actualizado correctamente",
        });
      }
    )(req, res);
  }

  return sendJson(res, 405, {
    ok: false,
    message: "Método no permitido",
  });
}

module.exports = {
  handlePersonnel,
  handleContractPositions,
};
