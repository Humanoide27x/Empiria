"use strict";

const { requireAuth } = require("../auth/auth.helpers");
const { sendJson }    = require("../../http/response");
const {
  getCoordinadoresTH,
  getMetricasCoordinador,
  getDetalleMunicipios,
  getMunicipiosByCoordinador,
  getDocumentosFaltantesByMunicipio,
} = require("./evaluacion-th.repository");
const {
  generarChecklistMunicipio,
  generarChecklistCompleto,
} = require("./evaluacion-th.excel");

// Roles que pueden ver todos los coordinadores y todos los municipios
const UNRESTRICTED_ROLES = new Set(["administrador", "auditores_internos"]);

function isUnrestricted(user) {
  const role = String(user?.role || user?.role_code || "").toLowerCase();
  return UNRESTRICTED_ROLES.has(role);
}

// IDs de municipio asignados al usuario autenticado (vacío = sin restricción explícita)
function userMunicipalityIds(user) {
  const ids = Array.isArray(user?.municipality_ids) ? user.municipality_ids.map(Number) : [];
  return new Set(ids.filter(Boolean));
}

/**
 * Pondera los tres pilares:
 *   docs 40% + datos 30% + nómina 30%
 */
function calcScoreGeneral(pDocs, pDatos, pNomina) {
  return Math.round(pDocs * 0.4 + pDatos * 0.3 + pNomina * 0.3);
}

function pct(num, den) {
  if (!den || den <= 0) return null; // null = sin dato
  return Math.min(100, Math.round((num / den) * 100));
}

/**
 * GET /evaluacion-th/coordinadores
 * Roles permitidos: administrador, talento_humano
 */
async function handleGetCoordinadores(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  try {
    const user      = auth.user;
    const companyId = user.companyId ?? user.company_id ?? null;
    let coordinadores = await getCoordinadoresTH(companyId);

    // Roles restringidos: solo ven su propio registro
    if (!isUnrestricted(user)) {
      coordinadores = coordinadores.filter(c => Number(c.id) === Number(user.id));
    }

    const data = await Promise.all(
      coordinadores.map(async (c) => {
        const m = await getMetricasCoordinador(c.municipality_ids, companyId);

        const pDocs   = pct(m.docs_completados, m.docs_requeridos)   ?? 0;
        const pDatos  = pct(m.datos_actualizados, m.empleados_cargo)  ?? 0;
        // Sin períodos = sin incumplimiento documentado → 100%
        const pNomina = m.periodos_total > 0
          ? pct(m.periodos_procesados, m.periodos_total)
          : 100;

        return {
          id:                c.id,
          nombre:            c.name || c.username || `Coordinador ${c.id}`,
          email:             c.email,
          municipios:        c.municipality_names,
          municipalityIds:   c.municipality_ids,
          metricas: {
            empleados_a_cargo:          m.empleados_cargo,
            documentos_completados:     m.docs_completados,
            documentos_requeridos:      m.docs_requeridos,
            porcentaje_docs:            pDocs,
            empleados_datos_actualizados: m.datos_actualizados,
            porcentaje_datos:           pDatos,
            nominas_procesadas:         m.periodos_procesados,
            nominas_total:              m.periodos_total,
            porcentaje_nomina:          pNomina,
            score_general:              calcScoreGeneral(pDocs, pDatos, pNomina),
          },
        };
      })
    );

    sendJson(res, 200, { ok: true, data });
  } catch (err) {
    console.error("[evaluacion-th] getCoordinadores:", err.message);
    sendJson(res, 500, { ok: false, message: "Error al calcular métricas." });
  }
}

/**
 * GET /evaluacion-th/coordinadores/:id/detalle
 */
async function handleGetDetalle(req, res, coordinadorId) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  try {
    const companyId = auth.user.companyId ?? auth.user.company_id ?? null;
    const data      = await getDetalleMunicipios(Number(coordinadorId), companyId);
    sendJson(res, 200, { ok: true, data });
  } catch (err) {
    console.error("[evaluacion-th] getDetalle:", err.message);
    sendJson(res, 500, { ok: false, message: "Error al cargar detalle." });
  }
}

/**
 * GET /evaluacion-th/coordinadores/:id/municipios
 * Municipios del coordinador con docs_faltantes y estado Completo/En progreso/Crítico.
 */
async function handleGetMunicipios(req, res, coordinadorId) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const user = auth.user;
  if (!isUnrestricted(user) && Number(coordinadorId) !== Number(user.id)) {
    return sendJson(res, 403, { ok: false, message: "Sin acceso a los municipios de este coordinador." });
  }

  try {
    const companyId = user.companyId ?? user.company_id ?? null;
    const data = await getMunicipiosByCoordinador(Number(coordinadorId), companyId);
    sendJson(res, 200, { ok: true, data });
  } catch (err) {
    console.error("[evaluacion-th] getMunicipios:", err.message);
    sendJson(res, 500, { ok: false, message: "Error al cargar municipios." });
  }
}

/**
 * GET /evaluacion-th/municipios/:municipioId/documentos-faltantes
 * Empleados del municipio con lista de tipos documentales faltantes por empleado.
 */
async function handleGetDocsFaltantes(req, res, municipioId) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const user = auth.user;
  if (!isUnrestricted(user)) {
    const allowed = userMunicipalityIds(user);
    if (allowed.size > 0 && !allowed.has(Number(municipioId))) {
      return sendJson(res, 403, { ok: false, message: "Sin acceso a este municipio." });
    }
  }

  try {
    const companyId = user.companyId ?? user.company_id ?? null;
    const data = await getDocumentosFaltantesByMunicipio(Number(municipioId), companyId);
    sendJson(res, 200, { ok: true, data });
  } catch (err) {
    console.error("[evaluacion-th] getDocsFaltantes:", err.message);
    sendJson(res, 500, { ok: false, message: "Error al cargar documentos faltantes." });
  }
}

/**
 * GET /evaluacion-th/municipios/:municipioId/checklist-excel
 * Descarga checklist Excel de un municipio.
 */
async function handleGetChecklistMunicipio(req, res, municipioId) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const user = auth.user;
  if (!isUnrestricted(user)) {
    const allowed = userMunicipalityIds(user);
    if (allowed.size > 0 && !allowed.has(Number(municipioId))) {
      return sendJson(res, 403, { ok: false, message: "Sin acceso a este municipio." });
    }
  }

  try {
    const companyId = user.companyId ?? user.company_id ?? null;
    const { wb }    = await generarChecklistMunicipio(Number(municipioId), companyId, null);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="checklist-municipio-${municipioId}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[evaluacion-th] checklistMunicipio:", err.message);
    sendJson(res, 500, { ok: false, message: "Error al generar checklist Excel." });
  }
}

/**
 * GET /evaluacion-th/coordinadores/:coordinadorId/checklist-excel-completo
 * Descarga checklist Excel de todos los municipios del coordinador (multi-hoja).
 */
async function handleGetChecklistCompleto(req, res, coordinadorId) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const user = auth.user;
  if (!isUnrestricted(user) && Number(coordinadorId) !== Number(user.id)) {
    return sendJson(res, 403, { ok: false, message: "Sin acceso al checklist de este coordinador." });
  }

  try {
    const companyId     = user.companyId ?? user.company_id ?? null;
    const coordinadores = await getCoordinadoresTH(companyId);
    const coord         = coordinadores.find(c => c.id === Number(coordinadorId));
    const coordNombre   = coord ? (coord.name || coord.username || `Coordinador ${coordinadorId}`) : "";

    const municipios    = await getMunicipiosByCoordinador(Number(coordinadorId), companyId);
    if (!municipios.length) {
      return sendJson(res, 404, { ok: false, message: "El coordinador no tiene municipios asignados." });
    }

    const { wb } = await generarChecklistCompleto(municipios, companyId, coordNombre);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="checklist-coordinador-${coordinadorId}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[evaluacion-th] checklistCompleto:", err.message);
    sendJson(res, 500, { ok: false, message: "Error al generar checklist Excel completo." });
  }
}

module.exports = {
  handleGetCoordinadores,
  handleGetDetalle,
  handleGetMunicipios,
  handleGetDocsFaltantes,
  handleGetChecklistMunicipio,
  handleGetChecklistCompleto,
};
