"use strict";

/**
 * Generación de Checklist Excel para auditoría documental por municipio.
 * Usa ExcelJS para crear una matriz empleado × tipo_de_documento dinámica,
 * leyendo todos los tipos de la BD (nunca hardcodeados).
 *
 * Estructura:
 *   Fila 1  — Título empresa (merged)
 *   Fila 2  — Municipio | Coordinador | Fecha | Total empleados
 *   Fila 3  — Categorías por phase (merged) + cols fijas merged con fila 4
 *   Fila 4  — Nombres de documentos (texto rotado 90°)
 *   Filas 5+ — Empleados: ✓ verde / ✗ rojo / ⚠ naranja
 *   Última  — Totales por columna
 */

const ExcelJS = require("exceljs");
const pool    = require("../../db/pool");

// ── Paleta de colores por phase ───────────────────────────────────────────────
const PHASE_CFG = {
  preingreso:        { bg: "FF1e3a5f", light: "FFdbeafe", label: "PREINGRESO"        },
  contratacion:      { bg: "FF0e7490", light: "FFcffafe", label: "CONTRATACIÓN"      },
  post_contratacion: { bg: "FF6d28d9", light: "FFede9fe", label: "POST-CONTRATACIÓN" },
  nomina:            { bg: "FF166534", light: "FFdcfce7", label: "NÓMINA"            },
  otros:             { bg: "FF475569", light: "FFf1f5f9", label: "OTROS"             },
};
const DEFAULT_PHASE = { bg: "FF374151", light: "FFf1f5f9", label: "OTROS" };

// ── Estilos de celdas de empleado ─────────────────────────────────────────────
const FILLS = {
  ok:      { type: "pattern", pattern: "solid", fgColor: { argb: "FFd1fae5" } },
  missing: { type: "pattern", pattern: "solid", fgColor: { argb: "FFfee2e2" } },
  warn:    { type: "pattern", pattern: "solid", fgColor: { argb: "FFffedd5" } },
  even:    { type: "pattern", pattern: "solid", fgColor: { argb: "FFf9fafb" } },
  odd:     { type: "pattern", pattern: "solid", fgColor: { argb: "FFffffff" } },
};
const FONTS = {
  ok:      { bold: true, size: 11, color: { argb: "FF166534" } },
  missing: { bold: true, size: 11, color: { argb: "FF991b1b" } },
  warn:    { bold: true, size: 11, color: { argb: "FF7c2d12" } },
};
const THIN_BORDER = {
  top:    { style: "thin", color: { argb: "FFd1d5db" } },
  left:   { style: "thin", color: { argb: "FFd1d5db" } },
  bottom: { style: "thin", color: { argb: "FFd1d5db" } },
  right:  { style: "thin", color: { argb: "FFd1d5db" } },
};
const ALIGN_CTR = { horizontal: "center", vertical: "middle" };

// ── Helper: aplicar estilo a celda ────────────────────────────────────────────
function styleCell(cell, { fill, font, alignment, border } = {}) {
  if (fill)      cell.fill      = fill;
  if (font)      cell.font      = font;
  if (alignment) cell.alignment = alignment;
  if (border)    cell.border    = border;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN PRINCIPAL: genera una hoja por municipio
// ─────────────────────────────────────────────────────────────────────────────
async function generarHojaMunicipio(wb, municipioId, companyId, coordinadorNombre) {
  // ── 1. Tipos de documento activos (dinámico) ────────────────────────────────
  const { rows: tiposDocs } = await pool.query(
    `SELECT id, code, name, phase, required
     FROM document_types
     WHERE active = true
       AND LOWER(name) NOT IN (
         'tarjeta profesional',
         'vigencia tarjeta profesional',
         'acta de grado',
         'diploma profesional'
       )
     ORDER BY
       CASE phase
         WHEN 'preingreso'        THEN 1
         WHEN 'contratacion'      THEN 2
         WHEN 'post_contratacion' THEN 3
         WHEN 'nomina'            THEN 4
         ELSE 5
       END, name`
  );
  console.log(`[checklist-excel] municipio ${municipioId}: ${tiposDocs.length} tipos de documento`);

  // ── 2. Nombre del municipio ────────────────────────────────────────────────
  const { rows: munRows } = await pool.query(
    "SELECT name FROM municipalities WHERE id = $1", [Number(municipioId)]
  );
  const munNombre = munRows[0]?.name || `Municipio ${municipioId}`;

  // ── 3. Empleados activos ───────────────────────────────────────────────────
  const { rows: empleados } = await pool.query(
    `SELECT id, full_name, real_position AS cargo
     FROM employees
     WHERE municipality_id = $1
       AND status = 'ACTIVO'
       AND real_position ILIKE '%OPERARIO MANIPULADOR DE ALIMENTOS%'
       AND ($2::int IS NULL OR company_id = $2)
     ORDER BY full_name`,
    [Number(municipioId), companyId ?? null]
  );

  // ── 4. Documentos de esos empleados (en una sola query) ───────────────────
  const empIds = empleados.map(e => e.id);
  const docMatrix = {}; // empId → { docTypeId → { status, expiration_date } }

  if (empIds.length > 0) {
    const { rows: docs } = await pool.query(
      `SELECT DISTINCT ON (employee_id, document_type_id)
         employee_id, document_type_id, status, expiration_date
       FROM employee_documents
       WHERE employee_id = ANY($1::int[])
         AND deleted_at IS NULL
         AND UPPER(TRIM(COALESCE(status,''))) NOT IN ('DELETED')
       ORDER BY employee_id, document_type_id, uploaded_at DESC`,
      [empIds]
    );
    for (const d of docs) {
      if (!docMatrix[d.employee_id]) docMatrix[d.employee_id] = {};
      docMatrix[d.employee_id][d.document_type_id] = d;
    }
  }

  // ── 5. Calcular grupos de phase ────────────────────────────────────────────
  const phaseGroups = [];
  let currPhase = null;
  let currStart = 4; // columna inicial (1-indexed: 1=#, 2=Nombre, 3=Cargo, 4=primer doc)
  for (let i = 0; i < tiposDocs.length; i++) {
    const phase = tiposDocs[i].phase || "otros";
    if (phase !== currPhase) {
      if (currPhase !== null) phaseGroups.push({ phase: currPhase, colStart: currStart, colEnd: 3 + i });
      currPhase  = phase;
      currStart  = 4 + i;
    }
  }
  if (currPhase) phaseGroups.push({ phase: currPhase, colStart: currStart, colEnd: 3 + tiposDocs.length });

  const totalCols = 3 + tiposDocs.length + 1; // # + Nombre + Cargo + docs + Total

  // ── 6. Crear hoja ──────────────────────────────────────────────────────────
  const sheetName = munNombre.substring(0, 31).replace(/[*?:/\[\]\\]/g, "");
  const ws = wb.addWorksheet(sheetName);

  const fecha = new Date().toLocaleDateString("es-CO",
    { day: "2-digit", month: "2-digit", year: "numeric" });

  // ── FILA 1: Título ─────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, totalCols);
  const titleCell = ws.getCell("A1");
  titleCell.value     = "CONSORCIO COMPLEMENTOS PAE META-26 — Checklist Documental";
  titleCell.font      = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  titleCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a2744" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 22;

  // ── FILA 2: Info ───────────────────────────────────────────────────────────
  // Municipio | Coordinador | Fecha | Total empleados
  const infoData = [
    [1, Math.floor(totalCols / 4),     `Municipio: ${munNombre}`],
    [Math.floor(totalCols / 4) + 1, Math.floor(totalCols / 2), `Coordinador TH: ${coordinadorNombre || "—"}`],
    [Math.floor(totalCols / 2) + 1, totalCols - 4, `Fecha: ${fecha}`],
    [totalCols - 3, totalCols,         `Empleados: ${empleados.length}`],
  ];
  for (const [sc, ec, val] of infoData) {
    if (sc < ec) ws.mergeCells(2, sc, 2, ec);
    const c   = ws.getCell(2, sc);
    c.value   = val;
    c.font    = { bold: true, size: 10 };
    c.fill    = { type: "pattern", pattern: "solid", fgColor: { argb: "FFdbeafe" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  }
  ws.getRow(2).height = 17;

  // ── FILA 3: Encabezados de phase + cols fijas (merged 3-4) ────────────────
  // Cols fijas: # | Nombre | Cargo  → merged rows 3-4
  const fixedHdr = ["#", "Nombre empleado", "Cargo"];
  for (let ci = 1; ci <= 3; ci++) {
    ws.mergeCells(3, ci, 4, ci);
    const c     = ws.getCell(3, ci);
    c.value     = fixedHdr[ci - 1];
    c.font      = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a2744" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border    = { bottom: { style: "medium", color: { argb: "FFFFFFFF" } } };
  }

  // Phase groups en fila 3
  for (const pg of phaseGroups) {
    if (pg.colStart < pg.colEnd) ws.mergeCells(3, pg.colStart, 3, pg.colEnd);
    const cfg  = PHASE_CFG[pg.phase] || DEFAULT_PHASE;
    const c    = ws.getCell(3, pg.colStart);
    c.value    = cfg.label;
    c.font     = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill     = { type: "pattern", pattern: "solid", fgColor: { argb: cfg.bg } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border   = {
      left:   { style: "medium", color: { argb: "FFFFFFFF" } },
      right:  { style: "medium", color: { argb: "FFFFFFFF" } },
      bottom: { style: "thin",   color: { argb: "FFFFFFFF" } },
    };
  }

  // Total faltantes header (merged 3-4)
  ws.mergeCells(3, totalCols, 4, totalCols);
  const totHdr     = ws.getCell(3, totalCols);
  totHdr.value     = "Total\nFaltantes";
  totHdr.font      = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
  totHdr.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
  totHdr.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(3).height = 18;

  // ── FILA 4: Nombres de documentos (texto rotado) ───────────────────────────
  for (let i = 0; i < tiposDocs.length; i++) {
    const dt   = tiposDocs[i];
    const cfg  = PHASE_CFG[dt.phase || "otros"] || DEFAULT_PHASE;
    const col  = 4 + i;
    const c    = ws.getCell(4, col);
    c.value    = dt.name;
    c.font     = { bold: false, size: 9, color: { argb: "FFFFFFFF" } };
    c.fill     = { type: "pattern", pattern: "solid", fgColor: { argb: cfg.bg } };
    c.alignment = { horizontal: "center", vertical: "bottom", textRotation: 90, wrapText: false };
    c.border   = {
      top:   { style: "thin", color: { argb: "FF4b5563" } },
      left:  { style: "thin", color: { argb: "FF4b5563" } },
      right: { style: "thin", color: { argb: "FF4b5563" } },
    };
  }
  ws.getRow(4).height = 100; // alto para texto rotado

  // ── FILAS DE EMPLEADOS ─────────────────────────────────────────────────────
  const today          = new Date();
  const faltantesPorDoc = new Array(tiposDocs.length).fill(0);

  for (let ei = 0; ei < empleados.length; ei++) {
    const emp    = empleados[ei];
    const rowNum = 5 + ei;
    const empDoc = docMatrix[emp.id] || {};
    let   faltEmp = 0;
    const rowFill = ei % 2 === 0 ? FILLS.even : FILLS.odd;

    // Cols fijas
    ws.getCell(rowNum, 1).value     = ei + 1;
    ws.getCell(rowNum, 2).value     = emp.full_name;
    ws.getCell(rowNum, 3).value     = emp.cargo || "—";

    styleCell(ws.getCell(rowNum, 1), { fill: rowFill, alignment: ALIGN_CTR, border: THIN_BORDER, font: { size: 9 } });
    styleCell(ws.getCell(rowNum, 2), { fill: rowFill, alignment: { vertical: "middle" }, border: THIN_BORDER, font: { bold: true, size: 9 } });
    styleCell(ws.getCell(rowNum, 3), { fill: rowFill, alignment: { vertical: "middle" }, border: THIN_BORDER, font: { size: 9, color: { argb: "FF475569" } } });

    // Columnas de documentos
    for (let di = 0; di < tiposDocs.length; di++) {
      const dt   = tiposDocs[di];
      const col  = 4 + di;
      const cell = ws.getCell(rowNum, col);
      const doc  = empDoc[dt.id];

      cell.alignment = ALIGN_CTR;
      cell.border    = THIN_BORDER;

      if (!doc) {
        // Sin documento
        cell.value = "✗";
        cell.fill  = FILLS.missing;
        cell.font  = FONTS.missing;
        faltEmp++;
        faltantesPorDoc[di]++;
      } else {
        const expired  = doc.expiration_date && new Date(doc.expiration_date) < today;
        const rejected = ["rechazado", "rejected"].includes(String(doc.status || "").toLowerCase());
        if (expired || rejected) {
          cell.value = "⚠";
          cell.fill  = FILLS.warn;
          cell.font  = FONTS.warn;
          faltEmp++;
          faltantesPorDoc[di]++;
        } else {
          cell.value = "✓";
          cell.fill  = FILLS.ok;
          cell.font  = FONTS.ok;
        }
      }
    }

    // Total faltantes del empleado
    const totEmpCell     = ws.getCell(rowNum, totalCols);
    totEmpCell.value     = faltEmp;
    totEmpCell.alignment = ALIGN_CTR;
    totEmpCell.border    = THIN_BORDER;
    totEmpCell.font      = faltEmp > 0
      ? { bold: true, size: 11, color: { argb: "FFdc2626" } }
      : { bold: true, size: 11, color: { argb: "FF16a34a" } };
    totEmpCell.fill = faltEmp > 0
      ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFfee2e2" } }
      : { type: "pattern", pattern: "solid", fgColor: { argb: "FFd1fae5" } };

    ws.getRow(rowNum).height = 16;
  }

  // ── FILA TOTALES por documento ─────────────────────────────────────────────
  const totRow = 5 + empleados.length;
  ws.mergeCells(totRow, 1, totRow, 3);
  const totLabel     = ws.getCell(totRow, 1);
  totLabel.value     = "TOTAL FALTANTES";
  totLabel.font      = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  totLabel.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1e293b" } };
  totLabel.alignment = ALIGN_CTR;

  let grandTotal = 0;
  for (let di = 0; di < tiposDocs.length; di++) {
    const cnt  = faltantesPorDoc[di];
    grandTotal += cnt;
    const cell = ws.getCell(totRow, 4 + di);
    cell.value     = cnt > 0 ? cnt : "";
    cell.alignment = ALIGN_CTR;
    cell.font      = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill      = cnt > 0
      ? { type: "pattern", pattern: "solid", fgColor: { argb: "FF9f1239" } }
      : { type: "pattern", pattern: "solid", fgColor: { argb: "FF166534" } };
    cell.border = {
      top:   { style: "medium", color: { argb: "FF374151" } },
      left:  { style: "thin",   color: { argb: "FF4b5563" } },
      right: { style: "thin",   color: { argb: "FF4b5563" } },
    };
  }

  const gtCell     = ws.getCell(totRow, totalCols);
  gtCell.value     = grandTotal;
  gtCell.font      = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  gtCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1e293b" } };
  gtCell.alignment = ALIGN_CTR;
  ws.getRow(totRow).height = 20;

  // ── Anchos de columna ──────────────────────────────────────────────────────
  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 33;
  ws.getColumn(3).width = 20;
  for (let i = 4; i <= 3 + tiposDocs.length; i++) {
    ws.getColumn(i).width = 4.5; // estrecho → texto rotado legible
  }
  ws.getColumn(totalCols).width = 10;

  // ── Freeze panes ───────────────────────────────────────────────────────────
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 4 }];

  // ── Tab color por sheet (cicla entre fases) ────────────────────────────────
  const tabColors = ["FF1e3a5f", "FF0e7490", "FF6d28d9", "FF166534", "FF374151"];
  const tabIdx    = wb.worksheets.length - 1;
  ws.properties = { tabColor: { argb: tabColors[tabIdx % tabColors.length] } };

  return { munNombre, empleadosCount: empleados.length, tiposCount: tiposDocs.length, grandTotal };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT: un municipio
// ─────────────────────────────────────────────────────────────────────────────
async function generarChecklistMunicipio(municipioId, companyId, coordinadorNombre) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Empiria - Evaluación TH";
  wb.created = new Date();

  const stats = await generarHojaMunicipio(wb, municipioId, companyId, coordinadorNombre);
  return { wb, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT: todos los municipios de un coordinador (multi-hoja)
// ─────────────────────────────────────────────────────────────────────────────
async function generarChecklistCompleto(municipios, companyId, coordinadorNombre) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Empiria - Evaluación TH";
  wb.created = new Date();

  const allStats = [];
  for (const mun of municipios) {
    const stats = await generarHojaMunicipio(wb, mun.municipio_id, companyId, coordinadorNombre);
    allStats.push(stats);
  }

  // Hoja resumen
  if (allStats.length > 1) agregarHojaResumen(wb, allStats, coordinadorNombre);

  return { wb, allStats };
}

function agregarHojaResumen(wb, allStats, coordinadorNombre) {
  const ws = wb.addWorksheet("RESUMEN", { properties: { tabColor: { argb: "FF374151" } } });
  ws.mergeCells("A1:E1");
  ws.getCell("A1").value     = `Resumen general — Coordinador: ${coordinadorNombre}`;
  ws.getCell("A1").font      = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a2744" } };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height        = 22;

  const hdr = ["Municipio", "Empleados", "Tipos doc.", "Docs faltantes", "% Completitud"];
  hdr.forEach((h, i) => {
    const c     = ws.getCell(2, i + 1);
    c.value     = h;
    c.font      = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  ws.getRow(2).height = 16;

  let totalFaltantes = 0;
  let totalEmp       = 0;
  allStats.forEach((s, i) => {
    const requeridos = s.empleadosCount * s.tiposCount;
    const pct        = requeridos > 0
      ? Math.round(((requeridos - s.grandTotal) / requeridos) * 100)
      : 100;
    const row = 3 + i;
    ws.getCell(row, 1).value = s.munNombre;
    ws.getCell(row, 2).value = s.empleadosCount;
    ws.getCell(row, 3).value = s.tiposCount;
    ws.getCell(row, 4).value = s.grandTotal;
    ws.getCell(row, 5).value = `${pct}%`;
    totalFaltantes += s.grandTotal;
    totalEmp       += s.empleadosCount;

    const fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? "FFf9fafb" : "FFffffff" } };
    for (let c = 1; c <= 5; c++) {
      ws.getCell(row, c).fill   = fill;
      ws.getCell(row, c).border = THIN_BORDER;
      ws.getCell(row, c).alignment = c === 1 ? { vertical: "middle" } : { horizontal: "center", vertical: "middle" };
    }
    if (s.grandTotal > 0) {
      ws.getCell(row, 4).font = { bold: true, color: { argb: "FFdc2626" } };
    }
  });

  // Fila total
  const totRow = 3 + allStats.length;
  ws.getCell(totRow, 1).value = "TOTAL";
  ws.getCell(totRow, 2).value = totalEmp;
  ws.getCell(totRow, 4).value = totalFaltantes;
  for (let c = 1; c <= 5; c++) {
    ws.getCell(totRow, c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getCell(totRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1e293b" } };
    ws.getCell(totRow, c).alignment = { horizontal: "center", vertical: "middle" };
  }

  [1, 2, 3, 4, 5].forEach((w, i) => ws.getColumn(i + 1).width = [28, 12, 12, 16, 14][i]);
}

module.exports = { generarChecklistMunicipio, generarChecklistCompleto };
