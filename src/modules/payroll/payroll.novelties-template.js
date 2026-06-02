"use strict";

/**
 * Plantilla mensual de novedades por días.
 *
 * - generateNoveltiesTemplate(periodId)         → Buffer Excel
 * - importNoveltiesTemplate(periodId, buf, uid)  → { ok, created, total, errors }
 */

const XLSX = require("xlsx");
const pool = require("../../db/pool");
const { createNoveltyForItem } = require("./payroll.operational.repository");

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

/** Convierte el número de columna (1-based offset desde period_start) en fecha ISO. */
function colToDate(periodStart, col) {
  const d = new Date(periodStart + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + col - 1);
  return toDateStr(d);
}

/** Número de días entre dos fechas ISO (inclusive). */
function daysBetween(startStr, endStr) {
  const a = new Date(startStr + "T00:00:00Z");
  const b = new Date(endStr + "T00:00:00Z");
  return Math.round((b - a) / 86400000) + 1;
}

/** Diferencia en días entre dos fechas ISO (b - a), sin +1. */
function dayOffset(periodStart, dateStr) {
  const a = new Date(periodStart + "T00:00:00Z");
  const b = new Date(dateStr + "T00:00:00Z");
  return Math.round((b - a) / 86400000) + 1; // columna 1-based
}

// ── Estilos Excel ─────────────────────────────────────────────────────────────

const STYLE_HDR_INFO = {
  font:      { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill:      { fgColor: { rgb: "1E3A5F" }, type: "pattern", patternType: "solid" },
  alignment: { horizontal: "center", vertical: "center" },
  border:    { bottom: { style: "thin", color: { rgb: "64748B" } } },
};

const STYLE_HDR_DAY = {
  font:      { bold: true, color: { rgb: "1E293B" }, sz: 9 },
  fill:      { fgColor: { rgb: "E2E8F0" }, type: "pattern", patternType: "solid" },
  alignment: { horizontal: "center", vertical: "center" },
  border:    { bottom: { style: "thin", color: { rgb: "CBD5E1" } } },
};

const STYLE_INACTIVE = {
  font:      { color: { rgb: "94A3B8" }, sz: 9 },
  fill:      { fgColor: { rgb: "F1F5F9" }, type: "pattern", patternType: "solid" },
  alignment: { horizontal: "center", vertical: "center" },
};

const STYLE_CELL = {
  font:      { sz: 9 },
  alignment: { horizontal: "center", vertical: "center" },
  border:    {
    right:  { style: "hair", color: { rgb: "E2E8F0" } },
    bottom: { style: "hair", color: { rgb: "E2E8F0" } },
  },
};

const STYLE_INFO_CELL = {
  font:      { sz: 10 },
  alignment: { horizontal: "left", vertical: "center" },
  border:    { bottom: { style: "hair", color: { rgb: "E2E8F0" } } },
};

const STYLE_CAT_HDR = {
  font:      { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill:      { fgColor: { rgb: "0F766E" }, type: "pattern", patternType: "solid" },
  alignment: { horizontal: "left", vertical: "center" },
};

function applyStyle(ws, cellAddr, style) {
  if (!ws[cellAddr]) return;
  ws[cellAddr].s = style;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERAR PLANTILLA
// ─────────────────────────────────────────────────────────────────────────────
async function generateNoveltiesTemplate(periodId) {
  // 1. Período
  const { rows: pRows } = await pool.query(
    `SELECT id, label, period_start, period_end FROM payroll_periods WHERE id = $1`,
    [Number(periodId)]
  );
  const period = pRows[0];
  if (!period) throw new Error("Período no encontrado");

  const pStartStr = toDateStr(new Date(period.period_start));
  const pEndStr   = toDateStr(new Date(period.period_end));
  const numDays   = daysBetween(pStartStr, pEndStr);

  // 2. Items del período (todos los empleados)
  const { rows: items } = await pool.query(
    `SELECT pi.id, pi.document_number, pi.employee_name, pi.operational_position,
            COALESCE(s.name, pi.site_name, '') AS site_name,
            COALESCE(i.name, pi.institution_name, '') AS institution_name
       FROM payroll_items pi
       LEFT JOIN educational_sites s ON s.id = pi.site_id
       LEFT JOIN institutions i      ON i.id = pi.institution_id
      WHERE pi.period_id = $1
      ORDER BY site_name, pi.employee_name`,
    [Number(periodId)]
  );
  if (!items.length) throw new Error("No hay colaboradores registrados en este período");

  // 3. Novedades de ingreso/retiro para marcar días inactivos
  const { rows: ingrRet } = await pool.query(
    `SELECT payroll_item_id, novelty_type, start_date
       FROM payroll_novelties
      WHERE payroll_item_id = ANY($1::int[])
        AND novelty_type IN ('FECHA_INGRESO', 'FECHA_RETIRO')`,
    [items.map((it) => it.id)]
  );
  const ingrByItem = new Map();
  const retByItem  = new Map();
  for (const n of ingrRet) {
    const dateStr = toDateStr(new Date(n.start_date));
    if (n.novelty_type === "FECHA_INGRESO") ingrByItem.set(Number(n.payroll_item_id), dateStr);
    else                                     retByItem.set(Number(n.payroll_item_id),  dateStr);
  }

  // 4. Tipos de novedad con template_code
  const { rows: ntRows } = await pool.query(
    `SELECT code, name, template_code
       FROM payroll_novelty_types
      WHERE template_code IS NOT NULL AND active = true
      ORDER BY name`
  );
  const hasStyle = typeof XLSX.utils.aoa_to_sheet === "function";

  // 5. Construir hoja Plantilla
  const BASE_COLS = 4; // Documento | Colaborador | Sede | Cargo
  const dayNums   = Array.from({ length: numDays }, (_, i) => i + 1);

  // Fila de cabecera
  const headerRow = ["Documento", "Colaborador", "Sede", "Cargo", ...dayNums];

  // Fila de fechas (sub-cabecera)
  const dateSubRow = ["", "", "", "", ...dayNums.map((d) => colToDate(pStartStr, d).slice(5))]; // "MM-DD"

  // Filas de datos
  const dataRows = items.map((item) => {
    const ingrDateStr = ingrByItem.get(item.id);
    const retDateStr  = retByItem.get(item.id);
    const ingrCol = ingrDateStr ? dayOffset(pStartStr, ingrDateStr) : null;
    const retCol  = retDateStr  ? dayOffset(pStartStr, retDateStr)  : null;

    const cells = dayNums.map((d) => {
      if (ingrCol && d < ingrCol) return "—";
      if (retCol  && d > retCol)  return "—";
      return "";
    });

    return [
      item.document_number,
      item.employee_name,
      item.site_name,
      item.operational_position || "",
      ...cells,
    ];
  });

  const allRows = [headerRow, dateSubRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // Aplicar estilos
  const totalCols = BASE_COLS + numDays;
  for (let c = 0; c < totalCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    applyStyle(ws, addr, c < BASE_COLS ? STYLE_HDR_INFO : STYLE_HDR_DAY);
    const addr2 = XLSX.utils.encode_cell({ r: 1, c });
    applyStyle(ws, addr2, STYLE_HDR_DAY);
  }

  // Estilos en celdas de datos
  for (let r = 2; r < allRows.length; r++) {
    for (let c = 0; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) continue;
      const val = ws[addr].v;
      if (c < BASE_COLS) {
        applyStyle(ws, addr, STYLE_INFO_CELL);
      } else if (val === "—") {
        applyStyle(ws, addr, STYLE_INACTIVE);
      } else {
        applyStyle(ws, addr, STYLE_CELL);
      }
    }
  }

  // Anchos de columna
  const colWidths = [
    { wch: 14 },  // Documento
    { wch: 28 },  // Colaborador
    { wch: 20 },  // Sede
    { wch: 18 },  // Cargo
    ...dayNums.map(() => ({ wch: 3.5 })),
  ];
  ws["!cols"] = colWidths;

  // Freeze primeras 2 filas + 4 columnas
  ws["!freeze"] = { xSplit: BASE_COLS, ySplit: 2 };

  // Nota al pie con el período
  const noteRow = allRows.length + 1;
  const noteAddr = XLSX.utils.encode_cell({ r: noteRow, c: 0 });
  ws[noteAddr] = { v: `Período: ${period.label}  |  Del ${pStartStr} al ${pEndStr}  |  T = Trabajó (vacío), — = día inactivo`, t: "s" };

  // Actualizar rango
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: noteRow, c: totalCols - 1 },
  });

  // 6. Hoja Catálogo
  const catHeaders = ["Código", "Tipo de Novedad", "Código interno"];
  const catRows = [
    ["T", "Trabajó (o celda vacía)", "(sin novedad)"],
    ["—", "Día inactivo (automático)", "(sin novedad)"],
    ...ntRows.map((nt) => [nt.template_code, nt.name, nt.code]),
  ];
  const wsCat = XLSX.utils.aoa_to_sheet([catHeaders, ...catRows]);

  for (let c = 0; c < 3; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    applyStyle(wsCat, addr, STYLE_CAT_HDR);
  }
  wsCat["!cols"] = [{ wch: 10 }, { wch: 35 }, { wch: 35 }];
  wsCat["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws,     "Plantilla");
  XLSX.utils.book_append_sheet(wb, wsCat,  "Catálogo");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTAR PLANTILLA
// ─────────────────────────────────────────────────────────────────────────────
async function importNoveltiesTemplate(periodId, fileBuffer, userId) {
  // 1. Parsear Excel
  let wb;
  try {
    wb = XLSX.read(fileBuffer, { type: "buffer" });
  } catch (e) {
    throw new Error("No se pudo leer el archivo. Asegúrese de subir un Excel (.xlsx) válido.");
  }

  const ws = wb.Sheets["Plantilla"];
  if (!ws) throw new Error('El archivo no contiene la hoja "Plantilla". Descargue la plantilla oficial.');

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length < 3) throw new Error("La plantilla no tiene datos (se esperan al menos 3 filas: cabecera, sub-cabecera y datos).");

  const headerRow = raw[0];  // [Documento, Colaborador, Sede, Cargo, 1, 2, ..., N]
  // raw[1] = sub-cabecera de fechas, se ignora en importación

  // Identificar columnas de días (headers numéricos)
  const BASE_COLS = 4;
  const dayCols = [];  // { colIndex, dayNum }
  for (let c = BASE_COLS; c < headerRow.length; c++) {
    const v = Number(headerRow[c]);
    if (Number.isInteger(v) && v >= 1 && v <= 31) {
      dayCols.push({ colIndex: c, dayNum: v });
    }
  }
  if (!dayCols.length) throw new Error("No se encontraron columnas de días. Verifique que está usando la plantilla oficial.");

  // 2. Período
  const { rows: pRows } = await pool.query(
    `SELECT id, label, period_start, period_end FROM payroll_periods WHERE id = $1`,
    [Number(periodId)]
  );
  const period = pRows[0];
  if (!period) throw new Error("Período no encontrado");
  const pStartStr = toDateStr(new Date(period.period_start));
  const pEndStr   = toDateStr(new Date(period.period_end));

  // 3. Mapa código → tipo de novedad
  const { rows: ntRows } = await pool.query(
    `SELECT code, name, template_code
       FROM payroll_novelty_types
      WHERE template_code IS NOT NULL AND active = true`
  );
  const codeMap = new Map();  // template_code.toUpperCase() → { code, name }
  for (const nt of ntRows) {
    codeMap.set(nt.template_code.toUpperCase(), { code: nt.code, name: nt.name });
  }

  // 4. Items del período indexados por documento
  const { rows: items } = await pool.query(
    `SELECT id, document_number, employee_name FROM payroll_items WHERE period_id = $1`,
    [Number(periodId)]
  );
  const itemByDoc = new Map();
  for (const it of items) {
    itemByDoc.set(String(it.document_number).trim(), it);
  }

  // 5. Parsear filas de datos y validar
  const errors     = [];
  const batch      = [];  // novedades a crear

  // Tipos que requieren fecha única (no rango)
  const SINGLE_DATE_TYPES = new Set(["FECHA_INGRESO", "FECHA_RETIRO", "CORRECCION_SEGURIDAD_SOCIAL"]);

  const dataRows = raw.slice(2);  // salta header + sub-header

  for (let ri = 0; ri < dataRows.length; ri++) {
    const row    = dataRows[ri];
    const rowNum = ri + 3;  // número de fila en el Excel (1-indexed)

    // Fila completamente vacía
    if (!row || row.every((c) => String(c || "").trim() === "")) continue;

    const docNum = String(row[0] || "").trim();
    if (!docNum) continue;

    const item = itemByDoc.get(docNum);
    if (!item) {
      errors.push({ row: rowNum, day: null, message: `Fila ${rowNum}: Documento "${docNum}" no encontrado en el período.` });
      continue;
    }

    // Agrupar días consecutivos con el mismo código
    const segments = [];  // { code, startDay, endDay }
    let curCode  = null;
    let segStart = null;
    let prevDay  = null;

    for (const { colIndex, dayNum } of dayCols) {
      const raw_val = String(row[colIndex] || "").trim().toUpperCase();
      const isNovDay = raw_val && raw_val !== "T" && raw_val !== "—";

      if (!isNovDay) {
        if (curCode !== null) {
          segments.push({ code: curCode, startDay: segStart, endDay: prevDay });
          curCode = null; segStart = null;
        }
      } else if (raw_val === curCode) {
        // mismo código — extiende el segmento
      } else {
        if (curCode !== null) {
          segments.push({ code: curCode, startDay: segStart, endDay: prevDay });
        }
        curCode  = raw_val;
        segStart = dayNum;
      }
      prevDay = dayNum;
    }
    if (curCode !== null) {
      segments.push({ code: curCode, startDay: segStart, endDay: prevDay });
    }

    // Construir novedades a partir de segmentos
    for (const seg of segments) {
      const nt = codeMap.get(seg.code);
      if (!nt) {
        errors.push({ row: rowNum, day: seg.startDay, message: `Fila ${rowNum} — Día ${seg.startDay}: Código de novedad inválido: "${seg.code}".` });
        continue;
      }

      const startDateStr = colToDate(pStartStr, seg.startDay);
      const endDateStr   = colToDate(pStartStr, seg.endDay);

      // Validar rango dentro del período
      if (startDateStr < pStartStr || endDateStr > pEndStr) {
        errors.push({ row: rowNum, day: seg.startDay, message: `Fila ${rowNum} — Día ${seg.startDay}: La fecha ${startDateStr} está fuera del período (${pStartStr} — ${pEndStr}).` });
        continue;
      }

      const isSingle = SINGLE_DATE_TYPES.has(nt.code);
      const days     = daysBetween(startDateStr, endDateStr);

      const payload = isSingle
        ? { novelty_type: nt.code, start_date: startDateStr }
        : { novelty_type: nt.code, start_date: startDateStr, end_date: endDateStr, days };

      batch.push({ itemId: item.id, payload, rowNum, day: seg.startDay, label: `${nt.name} (${startDateStr}→${endDateStr})` });
    }
  }

  // Si hay errores de validación, no crear nada
  if (errors.length > 0) {
    return { ok: false, errors, created: 0, total: batch.length };
  }

  if (!batch.length) {
    return { ok: true, created: 0, total: 0, errors: [], message: "No se encontraron novedades para importar (todas las celdas están vacías o marcadas como T)." };
  }

  // 6. Crear novedades
  let created = 0;
  const creationErrors = [];

  for (const entry of batch) {
    try {
      await createNoveltyForItem(entry.itemId, entry.payload, userId);
      created++;
    } catch (err) {
      creationErrors.push({ row: entry.rowNum, day: entry.day, message: `${entry.label}: ${err.message}` });
    }
  }

  return {
    ok:      creationErrors.length === 0,
    created,
    total:   batch.length,
    errors:  creationErrors,
  };
}

module.exports = { generateNoveltiesTemplate, importNoveltiesTemplate };
