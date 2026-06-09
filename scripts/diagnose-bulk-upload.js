"use strict";

process.env.EMPIRIA_DIAG = process.env.EMPIRIA_DIAG || "1";

const HARD_TIMEOUT_MS = 30_000;
let stage = "boot";
const hardTimeout = setTimeout(() => {
  console.error("[DIAG][TIMEOUT]", { stage, ms: HARD_TIMEOUT_MS });
  process.exit(124);
}, HARD_TIMEOUT_MS);

hardTimeout.unref?.();

console.log("[DIAG] boot");
stage = "requires";
console.log("[DIAG] requires");

process.on("beforeExit", (code) => {
  console.log("[DIAG][beforeExit]", { stage, code });
});
process.on("exit", (code) => {
  console.log("[DIAG][exit]", { stage, code });
});
process.on("uncaughtException", (err) => {
  console.error("[DIAG][uncaughtException]", { stage, message: err.message });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error("[DIAG][unhandledRejection]", { stage, message });
  process.exit(1);
});

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = require("../src/app");
const pool = require("../src/db/pool");
const { createSession } = require("../src/auth/tokens");
const { getUsers } = require("../src/data/users");
const { createEmployee } = require("../src/db/employees.repository");

const TEST_TIMEOUT_MS = HARD_TIMEOUT_MS;
const DB_POLL_INTERVAL_MS = 10_000;

stage = "start";
const trackedStreams = new Set();

function now() {
  return new Date().toISOString();
}

function setStage(nextStage, message, extra) {
  stage = nextStage;
  log(nextStage, message, extra);
}

function log(stage, message, extra) {
  const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  console.log(`[diag-bulk][${now()}][${stage}] ${message}${suffix}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactDocumentNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function buildPdfBuffer() {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 20 100 Td (Empiria diag) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n0\n%%EOF\n",
    "utf8"
  );
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function hasAnyColumns(row, names) {
  return names.some((name) => Object.prototype.hasOwnProperty.call(row, name));
}

function isValidEmployeeRow(row) {
  if (!row || row.id == null) return false;
  const documentNumber = firstNonEmpty(
    row.document_number,
    row.identification_number,
    row.numero_documento
  );
  if (!documentNumber) return false;

  const nameColumns = ["name", "full_name", "first_name"];
  if (hasAnyColumns(row, nameColumns)) {
    const nameValue = firstNonEmpty(row.full_name, row.name, row.first_name);
    if (!nameValue) return false;
  }

  return true;
}

function createMultipartForm() {
  const boundary = `----empiriaDiag${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts = [];

  return {
    appendField(name, value) {
      parts.push({
        type: "field",
        name,
        value: String(value ?? ""),
      });
    },

    appendFile(name, filePath, fileName, contentType = "application/pdf") {
      const stream = require("fs").createReadStream(filePath);
      trackedStreams.add(stream);
      stream.on("open", () => log("form_created", "archivo abierto", { filePath }));
      stream.on("end", () => log("form_created", "archivo stream end", { filePath }));
      stream.on("close", () => {
        trackedStreams.delete(stream);
        log("form_created", "archivo stream close", { filePath });
      });
      stream.on("error", (err) => log("form_created", "archivo stream error", { filePath, error: err.message }));
      parts.push({
        type: "file",
        name,
        filePath,
        fileName,
        contentType,
        stream,
      });
    },

    getHeaders() {
      return {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      };
    },

    async pipe(req) {
      for (const part of parts) {
        req.write(`--${boundary}\r\n`);
        if (part.type === "field") {
          req.write(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`);
          req.write(`${part.value}\r\n`);
          continue;
        }

        req.write(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.fileName}"\r\n`
        );
        req.write(`Content-Type: ${part.contentType}\r\n\r\n`);

        await new Promise((resolve, reject) => {
          part.stream.on("error", reject);
          part.stream.on("end", resolve);
          part.stream.pipe(req, { end: false });
        });

        req.write("\r\n");
      }

      req.end(`--${boundary}--\r\n`);
    },
  };
}

function pickAuthUser() {
  const users = getUsers().filter(Boolean);
  const preferred = users.find((user) => Number(user.companyId || user.company_id || 0) > 0) || users[0] || null;
  if (!preferred) {
    throw new Error("No hay usuarios cargados en memoria para crear una sesion de prueba");
  }

  return preferred;
}

async function loadTestContext(client, authUser) {
  const companyId = Number(authUser.companyId || authUser.company_id || 0) || null;

  setStage("db_connect", "conexión DB");
  const columnsResult = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employees'
    ORDER BY ordinal_position
  `);
  const columnsDetected = columnsResult.rows.map((row) => row.column_name);

  const employeeResult = await client.query(`
    SELECT *
    FROM employees
    ORDER BY id ASC
    LIMIT 500
  `);

  const documentTypeResult = await client.query(`
    SELECT *
    FROM document_types
    WHERE COALESCE(active, true) = true
    ORDER BY CASE
      WHEN UPPER(COALESCE(code, '')) = 'CC' THEN 0
      WHEN UPPER(COALESCE(code, '')) LIKE '%CEDULA%' THEN 1
      ELSE 2
    END, id ASC
    LIMIT 1
  `);

  const contractResult = companyId
    ? await client.query(
        `
          SELECT *
          FROM contracts
          WHERE company_id = $1
          ORDER BY id ASC
          LIMIT 1
        `,
        [companyId]
      ).catch(() => ({ rows: [] }))
    : { rows: [] };

  const companyResult = await client.query(`
    SELECT id
    FROM companies
    ORDER BY id ASC
    LIMIT 1
  `).catch(() => ({ rows: [] }));

  const companyRow = companyResult.rows[0] || null;
  const documentType = documentTypeResult.rows[0] || null;
  const contract = contractResult.rows[0] || null;
  const candidates = employeeResult.rows.filter(isValidEmployeeRow);
  let employee = candidates[0] || null;
  let createdTempEmployee = false;
  let employeeSource = "employees";

  if (!employee) {
    const created = await createEmployee({
      tenantId: 1,
      companyId: companyId || companyRow?.id || null,
      contractId: contract?.id || null,
      documentType: "CC",
      tipo_documento: "CC",
      documentNumber: "9999999999",
      numero_documento: "9999999999",
      firstName: "PRUEBA",
      primer_nombre: "PRUEBA",
      firstLastName: "DIAGNOSTICO",
      primer_apellido: "DIAGNOSTICO",
      status: "ACTIVO",
      estado: "ACTIVO",
      employmentStatus: "ACTIVO",
      employment_status: "ACTIVO",
    });

    if (!created) {
      throw new Error("No se pudo crear un empleado temporal de diagnóstico");
    }

    employee = created;
    createdTempEmployee = true;
    employeeSource = "employees.createEmployee";
  }

  if (!documentType) {
    throw new Error("No se encontró un tipo documental activo en la base de datos");
  }

  setStage("test_data_created", "test_data_created", {
    table: "employees",
    columnsDetected,
    createdTempEmployee,
    employeeSource,
    employeeId: employee.id,
    employeeDocumentNumber: firstNonEmpty(employee.document_number, employee.identification_number, employee.numero_documento, employee.documentNumber),
    employeeName: firstNonEmpty(employee.full_name, employee.name, employee.fullName, employee.first_name, employee.firstName),
    companyId: employee.company_id || employee.companyId || null,
    contractId: contract?.id || employee.contract_id || employee.contractId || null,
    documentTypeId: documentType.id,
    documentTypeCode: documentType.code || null,
  });

  return {
    employee,
    documentType,
    contract,
    companyId: companyId || Number(employee.company_id || employee.companyId || 0) || null,
    columnsDetected,
    createdTempEmployee,
    employeeSource,
  };
}

async function inspectDbState(client, label, employeeId = null) {
  const selfPidResult = await client.query("SELECT pg_backend_pid() AS pid");
  const selfPid = Number(selfPidResult.rows[0]?.pid || 0);

  const activityResult = await client.query(
    `
      SELECT
        pid,
        state,
        wait_event_type,
        wait_event,
        COALESCE(EXTRACT(EPOCH FROM (now() - COALESCE(xact_start, query_start))), 0) AS age_seconds,
        LEFT(REPLACE(query, E'\n', ' '), 180) AS query_preview
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> $1
        AND (
          state = 'idle in transaction'
          OR xact_start IS NOT NULL
          OR wait_event_type IS NOT NULL
        )
      ORDER BY xact_start DESC NULLS LAST, query_start DESC NULLS LAST
      LIMIT 10
    `,
    [selfPid]
  );

  const docCountResult = employeeId
    ? await client.query(
        `
          SELECT COUNT(*)::bigint AS total
          FROM employee_documents
          WHERE employee_id = $1
        `,
        [employeeId]
      ).catch(() => ({ rows: [{ total: 0 }] }))
    : { rows: [{ total: 0 }] };

  setStage("db_validation", `validación DB (${label})`, {
    openTransactions: activityResult.rows.map((row) => ({
      pid: row.pid,
      state: row.state,
      waitEventType: row.wait_event_type,
      waitEvent: row.wait_event,
      ageSeconds: Number(row.age_seconds || 0),
      queryPreview: row.query_preview,
    })),
    employeeDocumentRows: Number(docCountResult.rows[0]?.total || 0),
  });
}

function createTrackedServer() {
  return http.createServer((req, res) => {
    if (req.url?.startsWith("/documents/")) {
      const startedAt = Date.now();
      log("http", "petición HTTP recibida", {
        method: req.method,
        url: req.url,
      });
      req.on("aborted", () => log("http", "petición HTTP abortada", { url: req.url, elapsedMs: Date.now() - startedAt }));
      req.on("close", () => log("http", "stream/request cerrado", { url: req.url, elapsedMs: Date.now() - startedAt }));
      res.on("finish", () => log("http", "respuesta HTTP", {
        url: req.url,
        statusCode: res.statusCode,
        elapsedMs: Date.now() - startedAt,
      }));
      res.on("close", () => log("http", "conexión cerrada", {
        url: req.url,
        statusCode: res.statusCode,
        elapsedMs: Date.now() - startedAt,
      }));
    }

    app(req, res);
  });
}

function sendMultipartRequest(urlString, form, abortSignal) {
  const url = new URL(urlString);
  const headers = form.getHeaders();
  log("form_created", "form.getHeaders()", headers);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers,
      },
      (res) => {
        setStage("response_headers", "response headers recibidos", {
          statusCode: res.statusCode,
          headers: res.headers,
        });

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          setStage("response_data", "response data chunk", { bytes: Buffer.byteLength(chunk) });
          body += chunk;
        });
        res.on("end", () => {
          setStage("response_end", "response end", { bytes: Buffer.byteLength(body) });
          resolve({
            status: res.statusCode || 0,
            ok: Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
            headers: res.headers,
            text: body,
            json: safeJsonParse(body),
          });
        });
        res.on("close", () => {
          log("response_end", "response close", { statusCode: res.statusCode });
        });
      }
    );

    setStage("request_created", "request_created", {
      method: "POST",
      path: `${url.pathname}${url.search}`,
      host: url.host,
    });

    req.setTimeout(TEST_TIMEOUT_MS, () => {
      log("timeout", "HTTP timeout alcanzado");
      req.destroy(new Error("HTTP timeout"));
    });

    req.on("finish", () => {
      setStage("request_finished", "request_finished");
    });
    req.on("close", () => {
      log("request_created", "request close", { destroyed: req.destroyed, finished: req.writableFinished });
    });
    req.on("error", (err) => {
      log("request_created", "request error", { error: err.message });
      reject(err);
    });

    if (abortSignal) {
      abortSignal.addEventListener(
        "abort",
        () => {
          req.destroy(abortSignal.reason || new Error("aborted"));
        },
        { once: true }
      );
    }

    Promise.resolve()
      .then(async () => {
        setStage("form_piped", "form_piped");
        await form.pipe(req);
      })
      .catch((err) => {
        req.destroy(err);
        reject(err);
      });
  });
}

async function run() {
  const runCommit = process.argv.includes("--commit");
  const authUser = pickAuthUser();
  const sessionToken = createSession(authUser);
  const pdfBuffer = buildPdfBuffer();

  const client = await pool.connect();
  const server = createTrackedServer();
  let uploadUrl = "";
  let commitUrl = "";
  let poller = null;
  let hardTimeoutTimer = null;
  let cleanupStarted = false;
  let clientReleased = false;
  let tempPdfPath = "";
  let finalExitCode = 0;

  const releaseClient = () => {
    if (clientReleased) return;
    clientReleased = true;
    client.release();
  };

  const closeServer = async () => {
    if (!server.listening) return;
    await new Promise((resolve) => server.close(resolve));
  };

  const closePool = async () => {
    await pool.end().catch((err) => {
      log("cleanup_done", "pool.end() falló", { error: err.message });
    });
  };

  const cleanup = async ({ reason = "normal" } = {}) => {
    if (cleanupStarted) return;
    cleanupStarted = true;

    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
    if (poller) clearInterval(poller);

    for (const stream of [...trackedStreams]) {
      try {
        stream.destroy();
      } catch (_) {
        // ignore
      }
    }

    releaseClient();
    log("cleanup_done", "cerrando server.close()", { reason });
    await closeServer().catch((err) => {
      log("cleanup_done", "server.close() falló", { error: err.message, reason });
    });
    server.closeAllConnections?.();
    server.closeIdleConnections?.();

    log("cleanup_done", "omitiendo pool.end() por pool global compartido", { reason });
    clearTimeout(hardTimeout);
    setStage("cleanup_done", "cleanup_done", { reason });

    console.log(
      "[DIAG][HANDLES]",
      process._getActiveHandles().map((h) => ({
        type: h.constructor?.name,
        hasRef: typeof h.hasRef === "function" ? h.hasRef() : undefined,
      }))
    );

    console.log(
      "[DIAG][REQUESTS]",
      process._getActiveRequests().map((r) => ({
        type: r.constructor?.name,
      }))
    );

    process.exitCode = finalExitCode;
    const exitTimer = setTimeout(() => process.exit(process.exitCode), 100);
    exitTimer.unref?.();
  };

  try {
    setStage("start", "inicio de prueba", {
      timeoutMs: TEST_TIMEOUT_MS,
      runCommit,
      userId: authUser.id,
      userName: authUser.full_name || authUser.name || authUser.username || null,
    });

    const context = await loadTestContext(client, authUser);
    const employeeDocumentNumber = compactDocumentNumber(context.employee.document_number || context.employee.documentNumber || "");
    const documentTypeCode = String(context.documentType.code || context.documentType.name || "DOC").trim().replace(/\s+/g, "_");
    const fileName = `${documentTypeCode}_${employeeDocumentNumber || "SIN_DOC"}.pdf`;
    log("test_data_created", "empleado usado", {
      table: "employees",
      employeeSource: context.employeeSource,
      createdTempEmployee: context.createdTempEmployee,
      employeeId: context.employee.id,
      employeeDocumentNumber: firstNonEmpty(context.employee.document_number, context.employee.identification_number, context.employee.numero_documento, context.employee.documentNumber),
      employeeName: firstNonEmpty(context.employee.full_name, context.employee.name, context.employee.fullName, context.employee.first_name, context.employee.firstName),
      columnsDetected: context.columnsDetected,
    });
    tempPdfPath = path.join(os.tmpdir(), `empiria-diag-${Date.now()}.pdf`);
    await fs.promises.writeFile(tempPdfPath, pdfBuffer);
    setStage("test_data_created", "test_data_created", {
      employeeId: context.employee.id,
      documentTypeId: context.documentType.id,
      fileName,
      tempPdfPath,
    });

    setStage("server", "levantando servidor local de diagnóstico");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    uploadUrl = `http://127.0.0.1:${address.port}/documents/bulk/preview`;
    commitUrl = `http://127.0.0.1:${address.port}/documents/bulk/commit`;
    server.requestTimeout = TEST_TIMEOUT_MS;
    server.headersTimeout = TEST_TIMEOUT_MS + 5_000;
    server.keepAliveTimeout = 5_000;

    poller = setInterval(() => {
      inspectDbState(client, "poll", context.employee.id).catch((err) => {
        log("poll", "error al validar DB", { error: err.message });
      });
    }, DB_POLL_INTERVAL_MS);
    poller.unref?.();

    await inspectDbState(client, "antes-de-enviar", context.employee.id);

    hardTimeoutTimer = setTimeout(async () => {
      log("timeout", "se alcanzó el límite de 30 segundos", { stage });
      try {
        await cleanup({ reason: "timeout" });
      } catch (err) {
        log("timeout", "cleanup falló", { error: err.message, stage });
      } finally {
        process.exit(124);
      }
    }, TEST_TIMEOUT_MS);
    hardTimeoutTimer.unref?.();

    const runPhase = async (label, url, includeRows = null) => {
      setStage(label, "form_created", {
        url,
        includeRows: Boolean(includeRows),
      });
      const form = createMultipartForm();
      form.appendField("companyId", String(context.companyId || ""));
      form.appendFile("documents", tempPdfPath, fileName, "application/pdf");
      if (includeRows) {
        form.appendField("rows", JSON.stringify(includeRows));
      }

      const request = await new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
          {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port,
            path: `${parsed.pathname}${parsed.search}`,
            method: "POST",
            headers: {
              Authorization: `Bearer ${sessionToken}`,
              ...form.getHeaders(),
            },
          },
          (res) => {
            setStage("response_headers", "response_headers", {
              label,
              statusCode: res.statusCode,
              headers: res.headers,
            });

            let body = "";
            res.on("data", (chunk) => {
              setStage("response_data", "response_data", {
                label,
                bytes: Buffer.byteLength(chunk),
              });
              body += chunk;
            });
            res.on("end", () => {
              setStage("response_end", "response_end", {
                label,
                bytes: Buffer.byteLength(body),
              });
              resolve({
                status: res.statusCode || 0,
                ok: Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
                headers: res.headers,
                text: body,
                json: safeJsonParse(body),
              });
            });
            res.on("close", () => {
              log("response_end", "res.close", { label, statusCode: res.statusCode });
            });
          }
        );

        setStage("request_created", "request_created", {
          label,
          host: parsed.host,
          path: `${parsed.pathname}${parsed.search}`,
        });

        req.setTimeout(TEST_TIMEOUT_MS, () => {
          log("timeout", "HTTP timeout", { label, stage });
          req.destroy(new Error("HTTP timeout"));
        });

        req.on("finish", () => {
          setStage("request_finished", "request_finished", { label });
        });
        req.on("close", () => {
          log("request_created", "req.close", { label, destroyed: req.destroyed, finished: req.writableFinished });
        });
        req.on("error", (err) => {
          log("request_created", "req.error", { label, error: err.message });
          reject(err);
        });

        form.pipe(req)
          .then(() => {
            setStage("form_piped", "form_piped", { label });
          })
          .catch((err) => {
            log("form_piped", "form.pipe error", { label, error: err.message });
            req.destroy(err);
            reject(err);
          });
      });

      log(label, "respuesta HTTP recibida", {
        status: request.status,
        ok: request.ok,
        hasJson: Boolean(request.json),
      });
      log(label, "respuesta HTTP body", {
        textPreview: request.text.slice(0, 400),
      });
      return request;
    };

    const previewResponse = await runPhase("preview", uploadUrl);

    if (!previewResponse.ok || !previewResponse.json?.ok) {
      throw new Error(previewResponse.json?.message || `La previsualización respondió con ${previewResponse.status}`);
    }

    const previewRows = Array.isArray(previewResponse.json?.data?.rows) ? previewResponse.json.data.rows : [];
    log("preview", "validación DB", {
      rows: previewRows.length,
      previewSummary: previewResponse.json?.data?.summary || null,
    });
    await inspectDbState(client, "después-de-preview", context.employee.id);

    if (runCommit) {
      const commitResponse = await runPhase("commit", commitUrl, previewRows);

      if (!commitResponse.ok || !commitResponse.json?.ok) {
        throw new Error(commitResponse.json?.message || `La confirmación respondió con ${commitResponse.status}`);
      }

      await inspectDbState(client, "después-de-commit", context.employee.id);
    }

    log("final", "prueba completada", {
      mode: runCommit ? "preview+commit" : "preview-only",
      endpoint: uploadUrl,
    });
  } catch (error) {
    finalExitCode = 1;
    log("error", "la prueba falló", {
      message: error.message,
      name: error.name,
      stage,
    });
    process.exitCode = 1;
  } finally {
    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
    try {
      if (tempPdfPath) {
        await fs.promises.unlink(tempPdfPath).catch(() => {});
      }
    } catch (_) {
      // ignore cleanup errors
    }
    await cleanup({ reason: "finally" });
    clearTimeout(hardTimeout);
  }
}

run().catch((error) => {
  console.error("[diag-bulk] ERROR FATAL:", error.message);
  process.exit(1);
});
