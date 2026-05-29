"use strict";

const { sendJson } = require("../../http/response");
const { readJsonBody } = require("../../http/request");
const { requireAuth } = require("../auth/auth.helpers");
const { createAccessLog } = require("../../data/accessLogin");
const {
  createPreview,
  getBatchRows,
  getCatalogs,
  resolveBatch,
  commitBatch,
} = require("./employee-import.repository");

function isAllowed(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "administrador" || role === "talento_humano";
}

function deny(res) {
  return sendJson(res, 403, {
    ok: false,
    message: "Solo administrador y talento humano pueden usar importacion de empleados.",
  });
}

async function handleEmployeeImport(req, res, url) {
  const auth = requireAuth(req, res);
  if (!auth) return true;
  if (!isAllowed(auth.user)) {
    deny(res);
    return true;
  }

  const pathname = url.pathname;
  const method = req.method;

  try {
    if (pathname === "/employee-import/catalogs" && method === "GET") {
      const catalogs = await getCatalogs();
      sendJson(res, 200, { ok: true, catalogs });
      return true;
    }

    if (pathname === "/employee-import/preview" && method === "POST") {
      const body = await readJsonBody(req);
      const summary = await createPreview({
        fileBase64: body.fileBase64,
        fileName: body.fileName || "empleados.xlsx",
        defaults: {
          companyId: body.companyId || auth.user.companyId || auth.user.company_id || null,
          contractId: body.contractId || auth.user.contractId || auth.user.contract_id || null,
        },
        user: auth.user,
      });
      const [rows, catalogs] = await Promise.all([
        getBatchRows(summary.importBatchId, true),
        getCatalogs(),
      ]);
      sendJson(res, 200, { ok: true, summary, rows, catalogs });
      return true;
    }

    const errorsMatch = pathname.match(/^\/employee-import\/([0-9a-fA-F-]+)\/errors$/);
    if (errorsMatch && method === "GET") {
      const rows = await getBatchRows(errorsMatch[1], true);
      sendJson(res, 200, { ok: true, rows });
      return true;
    }

    const resolveMatch = pathname.match(/^\/employee-import\/([0-9a-fA-F-]+)\/resolve$/);
    if (resolveMatch && method === "POST") {
      const body = await readJsonBody(req);
      const summary = await resolveBatch(resolveMatch[1], body);
      const rows = await getBatchRows(resolveMatch[1], true);
      createAccessLog({
        username: auth.user.username,
        userId: auth.user.id,
        role: auth.user.role,
        success: true,
        status: "success",
        reason: `employee_import_resolve batch=${resolveMatch[1]} corrected=${summary.correctedRows || 0}`,
        ip: req.socket?.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      });
      sendJson(res, 200, { ok: true, summary, rows });
      return true;
    }

    const commitMatch = pathname.match(/^\/employee-import\/([0-9a-fA-F-]+)\/commit$/);
    if (commitMatch && method === "POST") {
      const batchId = commitMatch[1];
      const body    = await readJsonBody(req);

      const defaultCompanyId  = body.companyId  || auth.user.companyId  || auth.user.company_id  || null;
      const defaultContractId = body.contractId || auth.user.contractId || auth.user.contract_id || null;

      console.info("[employee-import commit] request recibido", {
        batchId,
        defaultCompanyId,
        defaultContractId,
        userCompanyId:  auth.user.companyId  || auth.user.company_id,
        userContractId: auth.user.contractId || auth.user.contract_id,
        updateFields:   body.updateFields?.length || 0,
      });

      const summary = await commitBatch(batchId, {
        updateFields:        Array.isArray(body.updateFields) ? body.updateFields : [],
        overrideValues:      body.overrideValues && typeof body.overrideValues === "object" ? body.overrideValues : {},
        allowOverwriteEmpty: Boolean(body.allowOverwriteEmpty),
        defaultCompanyId,
        defaultContractId,
      });

      const rows = await getBatchRows(batchId, true);
      createAccessLog({
        username:  auth.user.username,
        userId:    auth.user.id,
        role:      auth.user.role,
        success:   true,
        status:    "success",
        reason:    `employee_import_commit batch=${batchId} imported=${summary.importedRows || 0} updated=${summary.updatedRows || 0} failed=${summary.failedOnCommit || 0}`,
        ip:        req.socket?.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      });
      sendJson(res, 200, { ok: true, summary, rows });
      return true;
    }

    sendJson(res, 404, { ok: false, message: "Ruta de importacion no encontrada." });
    return true;
  } catch (error) {
    // Log detallado de cualquier 400
    const batchId = url.pathname.match(/\/employee-import\/([0-9a-fA-F-]+)\//)?.[1] || "desconocido";
    console.error("[employee-import commit 400]", {
      batchId,
      reason:          error.message,
      endpoint:        url.pathname,
      userCompanyId:   auth?.user?.companyId  || auth?.user?.company_id,
      userContractId:  auth?.user?.contractId || auth?.user?.contract_id,
      stack:           error.stack?.split("\n").slice(0, 5).join(" | "),
    });
    sendJson(res, 400, {
      ok:      false,
      message: error.message || "Error en importacion de empleados.",
      reason:  error.message,
      errors:  error.payload?.errors || [],
    });
    return true;
  }
}

module.exports = {
  handleEmployeeImport,
};
