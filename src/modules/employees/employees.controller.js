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

const pool = require("../../db/pool");

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

// Cache del catálogo educativo — se reconstruye máximo una vez cada 5 minutos
let _catalogCache = null;
let _catalogCacheTs = 0;
const CATALOG_TTL = 5 * 60 * 1000;

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

async function getEducationalCatalog() {
  if (_catalogCache && Date.now() - _catalogCacheTs < CATALOG_TTL) {
    return _catalogCache;
  }

  const result = await pool.query(`
    SELECT
      TRIM(m.name) AS municipality,
      TRIM(i.name) AS institution,
      TRIM(s.name) AS site,
      TRIM(sm.modality) AS modality
    FROM municipalities m
    JOIN institutions i ON i.municipality_id = m.id
    JOIN educational_sites s ON s.institution_id = i.id
    JOIN site_modalities sm ON sm.site_id = s.id
    WHERE m.name IS NOT NULL
      AND i.name IS NOT NULL
      AND s.name IS NOT NULL
      AND sm.modality IS NOT NULL
    ORDER BY m.name, i.name, s.name, sm.modality
  `);

  const catalog = {};

  for (const row of result.rows) {
    const municipality = String(row.municipality || "").trim();
    const institution = String(row.institution || "").trim();
    const site = String(row.site || "").trim();
    const modality = String(row.modality || "").trim();

    if (!municipality || !institution || !site || !modality) continue;

    if (!catalog[municipality]) catalog[municipality] = {};
    if (!catalog[municipality][institution]) catalog[municipality][institution] = {};
    if (!catalog[municipality][institution][site]) catalog[municipality][institution][site] = [];

    if (!catalog[municipality][institution][site].includes(modality)) {
      catalog[municipality][institution][site].push(modality);
    }
  }

  _catalogCache = catalog;
  _catalogCacheTs = Date.now();
  return catalog;
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
          const educationalCatalog = await measureEndpoint("GET /personnel/catalog educationalCatalog", () => getEducationalCatalog())
            .catch(err => { console.error("ERROR CATALOGO EDUCATIVO:", err); return {}; });
          return sendJson(res, 200, { ok: true, educationalCatalog });
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
      async (req, res) => {
        const body = await readJsonBody(req);
        const id = body.id || body.employeeId || body.personnelId;

        if (!id) {
          return sendJson(res, 400, {
            ok: false,
            message: "ID requerido para actualizar el empleado",
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
