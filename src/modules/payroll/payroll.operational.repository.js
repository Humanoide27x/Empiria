"use strict";

const pool = require("../../db/pool");

const OPERARIO_POSITION = "OPERARIO MANIPULADOR DE ALIMENTOS";
const NOVELTY_TYPES = [
  "incapacidad",
  "ausencia",
  "permiso",
  "licencia",
  "reemplazo",
  "turno_adicional",
  "descuento",
  "bonificacion",
  "recargo",
  "suspension",
  "ingreso",
  "retiro",
  "dias_no_laborados",
  "otros",
];

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function id(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function norm(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function isOperario(position) {
  return norm(position) === OPERARIO_POSITION;
}

function workTimeKind(value) {
  const v = norm(value);
  if (["MT", "MEDIO TIEMPO", "MEDIA JORNADA", "HALF TIME"].some((x) => v.includes(x))) return "MT";
  return "TC";
}

function statusIsActive(value) {
  const v = norm(value);
  return !["RETIRADO", "RETIRADA", "INACTIVO", "INACTIVA"].includes(v);
}

function rowEmployee(row) {
  return {
    id: row.employee_id,
    full_name: row.employee_name || "",
    document_number: row.document_number || "",
    real_position: row.operational_position || "",
    work_time_type: row.work_time_type || "",
    municipality_id: row.municipality_id,
    municipality_name: row.municipality_name || "",
    institution_id: row.institution_id,
    institution_name: row.institution_name || "",
    site_id: row.site_id,
    site_name: row.site_name || "",
    modality: row.modality || "",
  };
}

async function salaryConfig(contractId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(salary_config, '{}') AS cfg FROM contract_settings WHERE contract_id = $1`,
    [contractId]
  );
  return rows[0]?.cfg || {};
}

function modalitySalary(cfg, modality) {
  const modalities = cfg.modalities || {};
  const key = Object.keys(modalities).find((k) => norm(k) === norm(modality));
  const mod = key ? modalities[key] : {};
  return {
    salary: n(mod.salary || cfg.smlv || 0),
    transport: n(cfg.aux_transporte || cfg.transport_allowance || 0),
    other: Array.isArray(mod.adicionales) ? mod.adicionales.reduce((sum, item) => sum + n(item.value), 0) : 0,
  };
}

function calculateEmployeeAmounts(employee, cfg, novelties = [], covers = []) {
  const salary = modalitySalary(cfg, employee.modality);
  const discountDays = novelties
    .filter((x) => ["ausencia", "licencia", "suspension", "dias_no_laborados"].includes(text(x.novelty_type)))
    .reduce((sum, x) => sum + n(x.days), 0);
  const bonuses = novelties
    .filter((x) => ["bonificacion", "recargo"].includes(text(x.novelty_type)))
    .reduce((sum, x) => sum + n(x.value), 0);
  const discounts = novelties
    .filter((x) => text(x.novelty_type) === "descuento")
    .reduce((sum, x) => sum + n(x.value), 0);
  const internalCovers = covers
    .filter((x) => x.cover_type === "INTERNA" && String(x.internal_employee_id) === String(employee.employee_id))
    .reduce((sum, x) => sum + n(x.total_value), 0);

  const paidDays = Math.max(0, 30 - discountDays);
  const base = Math.round((salary.salary / 30) * paidDays);
  const transport = Math.round((salary.transport / 30) * paidDays);
  const other = Math.round((salary.other / 30) * paidDays) + bonuses + internalCovers;
  const total = base + transport + other;
  const deductions = Math.ceil((base * 0.08) / 100) * 100;
  return {
    base_salary: base,
    transport_allowance: transport,
    other_earnings: other,
    total_devengado: total,
    total_deducciones: deductions + discounts,
    neto_pagar: total - deductions - discounts,
    calculation: { paidDays, discountDays, bonuses, discounts, internalCovers, salary },
  };
}

async function listOperationalPeriods(filters = {}) {
  const values = [];
  const where = [];
  if (filters.companyId) { values.push(id(filters.companyId)); where.push(`pp.company_id = $${values.length}`); }
  if (filters.contractId) { values.push(id(filters.contractId)); where.push(`pp.contract_id = $${values.length}`); }
  const { rows } = await pool.query(`
    SELECT pp.*,
      COUNT(DISTINCT pi.employee_id)::int AS employee_count,
      COALESCE(SUM(pi.total_devengado), 0)::bigint AS total_devengado,
      COALESCE(SUM(pi.total_deducciones), 0)::bigint AS total_deducciones,
      COALESCE(SUM(pi.neto_pagar), 0)::bigint AS total_neto,
      COUNT(DISTINCT pn.id)::int AS novelty_count,
      COUNT(DISTINCT pn.id) FILTER (WHERE pn.reviewed = true)::int AS reviewed_count,
      COUNT(DISTINCT ns.id) FILTER (WHERE ns.status = 'pendiente')::int AS pending_supports
    FROM payroll_periods pp
    LEFT JOIN payroll_items pi ON pi.period_id = pp.id
    LEFT JOIN payroll_novelties pn ON pn.payroll_period_id = pp.id
    LEFT JOIN novelty_supports ns ON ns.payroll_period_id = pp.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY pp.id
    ORDER BY pp.period_start DESC
  `, values);
  return rows;
}

async function createOperationalPeriod(payload = {}, userId) {
  const companyId = id(payload.companyId || payload.company_id);
  const contractId = id(payload.contractId || payload.contract_id);
  const rawPeriod = text(payload.period || payload.periodMonth || payload.period_month);
  const start = payload.periodStart || payload.period_start || (rawPeriod ? `${rawPeriod}-01` : "");
  if (!companyId || !contractId || !start) throw new Error("Empresa, contrato y periodo son obligatorios");
  const [year, month] = String(start).slice(0, 7).split("-");
  const periodStart = `${year}-${month}-01`;
  const periodEnd = `${year}-${month}-30`;
  const label = text(payload.label) || `${month}/${year}`;
  const { rows } = await pool.query(`
    INSERT INTO payroll_periods (company_id, contract_id, period_start, period_end, label, status, created_by)
    VALUES ($1, $2, $3, $4, $5, 'BORRADOR', $6)
    ON CONFLICT (company_id, contract_id, period_start)
    DO UPDATE SET label = EXCLUDED.label
    RETURNING *
  `, [companyId, contractId, periodStart, periodEnd, label, id(userId)]);
  await ensurePayrollGroups(rows[0].id);
  return rows[0];
}

async function activeEmployeesForPeriod(periodId) {
  const { rows } = await pool.query(`
    SELECT e.id AS employee_id, e.full_name AS employee_name, e.document_number,
      e.company_id, e.contract_id, e.municipality_id, m.name AS municipality_name,
      e.institution_id, i.name AS institution_name, e.site_id, s.name AS site_name,
      e.modality, e.workday_type AS work_time_type, e.real_position AS operational_position, e.status
    FROM payroll_periods pp
    JOIN employees e ON e.contract_id = pp.contract_id
    LEFT JOIN municipalities m ON m.id = e.municipality_id
    LEFT JOIN institutions i ON i.id = e.institution_id
    LEFT JOIN educational_sites s ON s.id = e.site_id
    WHERE pp.id = $1
      AND NULLIF(BTRIM(e.real_position), '') IS NOT NULL
      AND e.municipality_id IS NOT NULL
      AND UPPER(BTRIM(COALESCE(e.status, 'ACTIVO'))) NOT IN ('RETIRADO','RETIRADA','INACTIVO','INACTIVA')
    ORDER BY UPPER(e.real_position), m.name NULLS LAST, e.full_name
  `, [periodId]);
  return rows.filter((r) => statusIsActive(r.status));
}

async function ensurePayrollGroups(periodId) {
  const employees = await activeEmployeesForPeriod(periodId);
  for (const emp of employees) {
    await pool.query(`
      INSERT INTO payroll_groups (period_id, company_id, contract_id, municipality_id, operational_position, group_type)
      SELECT $1, $2, $3, $4, $5, 'MUNICIPAL'
      WHERE NOT EXISTS (
        SELECT 1
        FROM payroll_groups pg
        WHERE pg.period_id = $1
          AND pg.contract_id = $3
          AND COALESCE(pg.municipality_id, 0) = COALESCE($4::integer, 0)
          AND UPPER(BTRIM(pg.operational_position)) = UPPER(BTRIM($5))
      )
    `, [periodId, emp.company_id, emp.contract_id, emp.municipality_id, emp.operational_position]);
  }
}

async function listPayrollGroups(periodId) {
  await ensurePayrollGroups(periodId);
  const activeEmployees = await activeEmployeesForPeriod(periodId);
  const activeCountByGroup = new Map();
  for (const emp of activeEmployees) {
    const key = `${emp.contract_id}|${emp.municipality_id || 0}|${norm(emp.operational_position)}`;
    activeCountByGroup.set(key, (activeCountByGroup.get(key) || 0) + 1);
  }
  const { rows } = await pool.query(`
    SELECT pg.*, m.name AS municipality_name,
      COUNT(DISTINCT pi.employee_id)::int AS employees,
      COUNT(DISTINCT pn.id)::int AS novelties,
      COUNT(DISTINCT pn.id) FILTER (WHERE pn.reviewed = true)::int AS reviewed,
      COUNT(DISTINCT ns.id) FILTER (WHERE ns.status = 'pendiente')::int AS pending_supports,
      COALESCE(SUM(pi.total_devengado),0)::bigint AS total_devengado,
      COALESCE(SUM(pi.total_deducciones),0)::bigint AS total_deducciones,
      COALESCE(SUM(pi.neto_pagar),0)::bigint AS neto
    FROM payroll_groups pg
    LEFT JOIN municipalities m ON m.id = pg.municipality_id
    LEFT JOIN payroll_items pi ON pi.group_id = pg.id
    LEFT JOIN payroll_novelties pn ON pn.payroll_item_id = pi.id
    LEFT JOIN novelty_supports ns ON ns.novelty_id = pn.id
    WHERE pg.period_id = $1
    GROUP BY pg.id, m.name
    ORDER BY UPPER(pg.operational_position), m.name NULLS LAST
  `, [periodId]);

  const positions = new Map();
  for (const row of rows) {
    const key = row.operational_position;
    if (!positions.has(key)) {
      positions.set(key, {
        position: key,
        isOperario: isOperario(key),
        employees: 0,
        novelties: 0,
        reviewed: 0,
        pending_supports: 0,
        total_devengado: 0,
        total_deducciones: 0,
        neto: 0,
        municipalities: [],
      });
    }
    const activeKey = `${row.contract_id}|${row.municipality_id || 0}|${norm(row.operational_position)}`;
    const item = {
      id: row.id,
      municipality_id: row.municipality_id,
      municipality_name: row.municipality_name || "Sin municipio",
      status: row.status,
      employees: Number(row.employees || activeCountByGroup.get(activeKey) || 0),
      novelties: Number(row.novelties || 0),
      reviewed: Number(row.reviewed || 0),
      pending_supports: Number(row.pending_supports || 0),
      total_devengado: Number(row.total_devengado || 0),
      total_deducciones: Number(row.total_deducciones || 0),
      neto: Number(row.neto || 0),
    };
    const pos = positions.get(key);
    pos.employees += item.employees;
    pos.novelties += item.novelties;
    pos.reviewed += item.reviewed;
    pos.pending_supports += item.pending_supports;
    pos.total_devengado += item.total_devengado;
    pos.total_deducciones += item.total_deducciones;
    pos.neto += item.neto;
    pos.municipalities.push(item);
  }
  return { positions: Array.from(positions.values()), groups: rows };
}

async function calculatePayrollGroup(groupId) {
  const group = await getGroup(groupId);
  if (!group) throw new Error("Grupo de nomina no encontrado");
  if (group.status === "cerrada") throw new Error("El grupo ya esta cerrado");

  const cfg = await salaryConfig(group.contract_id);
  const employees = (await activeEmployeesForPeriod(group.period_id)).filter((emp) =>
    emp.contract_id === group.contract_id &&
    emp.municipality_id === group.municipality_id &&
    norm(emp.operational_position) === norm(group.operational_position)
  );

  const { rows: novelties } = await pool.query(
    `SELECT * FROM payroll_novelties WHERE payroll_period_id = $1 AND municipality_id = $2`,
    [group.period_id, group.municipality_id]
  );
  const { rows: covers } = await pool.query(
    `SELECT * FROM payroll_turn_covers WHERE payroll_period_id = $1`,
    [group.period_id]
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const emp of employees) {
      const empNovelties = novelties.filter((x) => String(x.employee_id) === String(emp.employee_id));
      const amounts = calculateEmployeeAmounts(emp, cfg, empNovelties, covers);
      await client.query(`
        INSERT INTO payroll_items (
          group_id, period_id, employee_id, employee_name, document_number, company_id, contract_id,
          municipality_id, municipality_name, institution_id, institution_name, site_id, site_name,
          modality, operational_position, work_time_type, base_salary, transport_allowance,
          other_earnings, total_devengado, total_deducciones, neto_pagar, calculation, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())
        ON CONFLICT (group_id, employee_id) DO UPDATE SET
          employee_name = EXCLUDED.employee_name,
          document_number = EXCLUDED.document_number,
          municipality_name = EXCLUDED.municipality_name,
          institution_id = EXCLUDED.institution_id,
          institution_name = EXCLUDED.institution_name,
          site_id = EXCLUDED.site_id,
          site_name = EXCLUDED.site_name,
          modality = EXCLUDED.modality,
          work_time_type = EXCLUDED.work_time_type,
          base_salary = EXCLUDED.base_salary,
          transport_allowance = EXCLUDED.transport_allowance,
          other_earnings = EXCLUDED.other_earnings,
          total_devengado = EXCLUDED.total_devengado,
          total_deducciones = EXCLUDED.total_deducciones,
          neto_pagar = EXCLUDED.neto_pagar,
          calculation = EXCLUDED.calculation,
          updated_at = NOW()
      `, [
        group.id, group.period_id, emp.employee_id, emp.employee_name, emp.document_number, emp.company_id, emp.contract_id,
        emp.municipality_id, emp.municipality_name, emp.institution_id, emp.institution_name, emp.site_id, emp.site_name,
        emp.modality, emp.operational_position, emp.work_time_type, amounts.base_salary, amounts.transport_allowance,
        amounts.other_earnings, amounts.total_devengado, amounts.total_deducciones, amounts.neto_pagar, JSON.stringify(amounts.calculation),
      ]);
    }
    await client.query(`UPDATE payroll_groups SET status = 'en_revision', updated_at = NOW() WHERE id = $1`, [group.id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getPayrollGroupDetail(group.period_id, group.id);
}

async function getGroup(groupId) {
  const { rows } = await pool.query(`SELECT * FROM payroll_groups WHERE id = $1`, [groupId]);
  return rows[0] || null;
}

async function getPayrollGroupDetail(periodId, groupId) {
  const group = await getGroup(groupId);
  if (!group || Number(group.period_id) !== Number(periodId)) throw new Error("Grupo de nomina no encontrado");
  const { rows: items } = await pool.query(`
    SELECT pi.*,
      COUNT(pn.id)::int AS novelty_count,
      COUNT(pn.id) FILTER (WHERE pn.reviewed = true)::int AS reviewed_count,
      COUNT(ns.id) FILTER (WHERE ns.status = 'pendiente')::int AS pending_supports
    FROM payroll_items pi
    LEFT JOIN payroll_novelties pn ON pn.payroll_item_id = pi.id
    LEFT JOIN novelty_supports ns ON ns.novelty_id = pn.id
    WHERE pi.group_id = $1
    GROUP BY pi.id
    ORDER BY pi.employee_name
  `, [groupId]);
  const { rows: novelties } = await pool.query(`
    SELECT pn.*, pi.employee_name, pi.document_number
    FROM payroll_novelties pn
    LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
    WHERE pn.payroll_period_id = $1
      AND (pn.payroll_item_id IN (SELECT id FROM payroll_items WHERE group_id = $2) OR pn.municipality_id = $3)
    ORDER BY pn.created_at DESC
  `, [periodId, groupId, group.municipality_id]);
  const { rows: supports } = await pool.query(`
    SELECT ns.*, pn.novelty_type, pi.employee_name, pi.document_number, m.name AS municipality_name
    FROM novelty_supports ns
    LEFT JOIN payroll_novelties pn ON pn.id = ns.novelty_id
    LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
    LEFT JOIN municipalities m ON m.id = ns.municipality_id
    WHERE ns.payroll_period_id = $1 AND ns.municipality_id = $2
    ORDER BY ns.created_at DESC
  `, [periodId, group.municipality_id]);

  const totals = items.reduce((acc, item) => {
    acc.employees += 1;
    acc.total_devengado += n(item.total_devengado);
    acc.total_deducciones += n(item.total_deducciones);
    acc.neto += n(item.neto_pagar);
    acc.novelties += n(item.novelty_count);
    acc.reviewed += n(item.reviewed_count);
    acc.pending_supports += n(item.pending_supports);
    return acc;
  }, { employees: 0, total_devengado: 0, total_deducciones: 0, neto: 0, novelties: 0, reviewed: 0, pending_supports: 0 });

  return { group, items, novelties, supports, totals };
}

async function createNoveltyForItem(itemId, payload = {}, userId) {
  const { rows } = await pool.query(`SELECT * FROM payroll_items WHERE id = $1`, [itemId]);
  const item = rows[0];
  if (!item) throw new Error("Empleado de nomina no encontrado");
  const type = text(payload.novelty_type || payload.noveltyType || "otros").toLowerCase();
  if (!NOVELTY_TYPES.includes(type)) throw new Error("Tipo de novedad invalido");
  const supportRequired = Boolean(payload.support_required ?? payload.supportRequired);

  const inserted = await pool.query(`
    INSERT INTO payroll_novelties (
      payroll_item_id, payroll_period_id, employee_id, employee_name, document_number, company_id, contract_id,
      municipality_id, institution_id, site_id, operational_position, novelty_type, start_date, end_date,
      days, value, observations, description, support_required, support_status, status, created_by_user_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'PENDIENTE',$21)
    RETURNING *
  `, [
    item.id, item.period_id, item.employee_id, item.employee_name, item.document_number, item.company_id, item.contract_id,
    item.municipality_id, item.institution_id, item.site_id, item.operational_position, type,
    payload.start_date || payload.startDate || null, payload.end_date || payload.endDate || null,
    n(payload.days), n(payload.value), text(payload.observations || payload.description), text(payload.description || payload.observations),
    supportRequired, supportRequired ? "pendiente" : "aprobado", id(userId),
  ]);

  if (supportRequired) {
    await createSupport({
      novelty_id: inserted.rows[0].id,
      employee_id: item.employee_id,
      payroll_period_id: item.period_id,
      municipality_id: item.municipality_id,
      support_type: payload.support_type || type,
      required: true,
      status: "pendiente",
      observations: "Soporte requerido por novedad",
    }, userId);
  }
  return inserted.rows[0];
}

async function patchNovelty(noveltyId, payload = {}, userId) {
  const current = await pool.query(`SELECT * FROM payroll_novelties WHERE id = $1`, [noveltyId]);
  const novelty = current.rows[0];
  if (!novelty) throw new Error("Novedad no encontrada");
  if (novelty.reviewed) {
    throw new Error("Esta novedad ya fue revisada. Para modificarla debe quitar primero la marca de revisada.");
  }
  const updates = [];
  const values = [noveltyId];
  const allowed = {
    novelty_type: (v) => text(v).toLowerCase(),
    start_date: (v) => v || null,
    end_date: (v) => v || null,
    days: n,
    value: n,
    observations: text,
    description: text,
    support_required: Boolean,
    support_status: text,
  };
  for (const [key, transform] of Object.entries(allowed)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (payload[key] !== undefined || payload[camel] !== undefined) {
      values.push(transform(payload[key] ?? payload[camel]));
      updates.push(`${key} = $${values.length}`);
    }
  }
  if (!updates.length) return novelty;
  values.push(id(userId));
  const { rows } = await pool.query(`
    UPDATE payroll_novelties
    SET ${updates.join(", ")}, updated_at = NOW(), reviewed_by_user_id = COALESCE(reviewed_by_user_id, $${values.length})
    WHERE id = $1
    RETURNING *
  `, values);
  return rows[0];
}

async function setNoveltyReviewed(noveltyId, reviewed, payload = {}, user = {}) {
  const reviewerId = id(user.id);
  const reviewerName = text(user.full_name || user.name || user.username);
  const reason = text(payload.reason || payload.motivo);
  const current = await pool.query(`SELECT * FROM payroll_novelties WHERE id = $1`, [noveltyId]);
  if (!current.rows[0]) throw new Error("Novedad no encontrada");
  if (!reviewed && !reason) throw new Error("Debe indicar el motivo para quitar la revision");
  const { rows } = await pool.query(`
    UPDATE payroll_novelties
    SET reviewed = $2,
        reviewed_by = CASE WHEN $2 THEN $3 ELSE NULL END,
        reviewed_by_user_id = CASE WHEN $2 THEN $3 ELSE reviewed_by_user_id END,
        reviewed_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [noveltyId, Boolean(reviewed), reviewerId]);
  if (!reviewed) {
    await pool.query(`
      INSERT INTO audit_logs(entity_type, entity_id, action, user_id, user_name, reason, payload)
      VALUES ('payroll_novelty', $1, 'unreview', $2, $3, $4, $5)
    `, [String(noveltyId), reviewerId, reviewerName, reason, JSON.stringify(current.rows[0])]);
  }
  return rows[0];
}

async function createTurnCover(noveltyId, payload = {}, userId) {
  const { rows } = await pool.query(`SELECT * FROM payroll_novelties WHERE id = $1`, [noveltyId]);
  const novelty = rows[0];
  if (!novelty) throw new Error("Novedad no encontrada");
  if (novelty.reviewed) throw new Error("Esta novedad ya fue revisada. Para modificarla debe quitar primero la marca de revisada.");
  const coverType = norm(payload.cover_type || payload.coverType) === "EXTERNA" ? "EXTERNA" : "INTERNA";
  const days = n(payload.days || novelty.days || 1) || 1;
  const cfg = await salaryConfig(novelty.contract_id);
  const salary = modalitySalary(cfg, payload.modality || payload.modalidad);
  const valuePerDay = n(payload.value_per_day || payload.valueDay || payload.valor_dia) || Math.round((salary.salary + salary.transport + salary.other) / 30);
  let externalWorkerId = null;
  let internalEmployeeId = null;

  if (coverType === "INTERNA") {
    internalEmployeeId = id(payload.internal_employee_id || payload.employee_id || payload.employeeId);
    if (!internalEmployeeId) throw new Error("Debe seleccionar el empleado interno que cubrio la novedad");
  } else {
    const document = text(payload.document_number || payload.documentNumber || payload.documento);
    if (!document) throw new Error("El documento del externo es obligatorio");
    const worker = await pool.query(`
      INSERT INTO external_turn_workers(full_name, document_number, phone, bank, account_number, municipality_id, site_id, modality, value_day)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (document_number) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        bank = EXCLUDED.bank,
        account_number = EXCLUDED.account_number,
        municipality_id = EXCLUDED.municipality_id,
        site_id = EXCLUDED.site_id,
        modality = EXCLUDED.modality,
        value_day = EXCLUDED.value_day,
        updated_at = NOW()
      RETURNING id
    `, [
      text(payload.full_name || payload.name || payload.nombre),
      document,
      text(payload.phone || payload.telefono),
      text(payload.bank || payload.banco),
      text(payload.account_number || payload.cuenta),
      id(payload.municipality_id || novelty.municipality_id),
      id(payload.site_id || novelty.site_id),
      text(payload.modality || payload.modalidad),
      valuePerDay,
    ]);
    externalWorkerId = worker.rows[0].id;
  }

  const { rows: coverRows } = await pool.query(`
    INSERT INTO payroll_turn_covers (
      novelty_id, payroll_item_id, payroll_period_id, cover_type, internal_employee_id,
      external_worker_id, days, value_per_day, total_value, created_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (novelty_id) DO UPDATE SET
      cover_type = EXCLUDED.cover_type,
      internal_employee_id = EXCLUDED.internal_employee_id,
      external_worker_id = EXCLUDED.external_worker_id,
      days = EXCLUDED.days,
      value_per_day = EXCLUDED.value_per_day,
      total_value = EXCLUDED.total_value
    RETURNING *
  `, [
    novelty.id, novelty.payroll_item_id, novelty.payroll_period_id, coverType, internalEmployeeId,
    externalWorkerId, days, valuePerDay, days * valuePerDay, id(userId),
  ]);
  await pool.query(`UPDATE payroll_novelties SET cover_type = $2, value = $3, updated_at = NOW() WHERE id = $1`, [novelty.id, coverType, days * valuePerDay]);

  if (coverType === "EXTERNA") {
    for (const supportType of ["cedula", "cuenta_cobro", "certificacion_bancaria"]) {
      await createSupport({
        novelty_id: novelty.id,
        employee_id: novelty.employee_id,
        payroll_period_id: novelty.payroll_period_id,
        municipality_id: novelty.municipality_id,
        support_type: supportType,
        required: true,
        status: "pendiente",
        observations: "Soporte de turno externo. No bloquea la nomina.",
      }, userId);
    }
  }
  return coverRows[0];
}

async function listSupports(filters = {}) {
  const values = [];
  const where = [];
  if (filters.periodId) { values.push(id(filters.periodId)); where.push(`ns.payroll_period_id = $${values.length}`); }
  if (filters.status) { values.push(text(filters.status)); where.push(`ns.status = $${values.length}`); }
  if (filters.municipalityId) { values.push(id(filters.municipalityId)); where.push(`ns.municipality_id = $${values.length}`); }
  const { rows } = await pool.query(`
    SELECT ns.*, pn.novelty_type, pn.description, pi.employee_name, pi.document_number,
      m.name AS municipality_name
    FROM novelty_supports ns
    LEFT JOIN payroll_novelties pn ON pn.id = ns.novelty_id
    LEFT JOIN payroll_items pi ON pi.id = pn.payroll_item_id
    LEFT JOIN municipalities m ON m.id = ns.municipality_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ns.created_at DESC
  `, values);
  return rows;
}

async function createSupport(payload = {}, userId) {
  const supportId = id(payload.id);
  if (supportId) {
    const { rows } = await pool.query(`
      UPDATE novelty_supports
      SET status = COALESCE(NULLIF($2, ''), status),
          file_url = COALESCE(NULLIF($3, ''), file_url),
          file_name = COALESCE(NULLIF($4, ''), file_name),
          observations = COALESCE(NULLIF($5, ''), observations),
          uploaded_by = CASE WHEN NULLIF($3, '') IS NOT NULL THEN $6 ELSE uploaded_by END,
          uploaded_at = CASE WHEN NULLIF($3, '') IS NOT NULL THEN NOW() ELSE uploaded_at END,
          reviewed_by = CASE WHEN $2 IN ('aprobado','rechazado') THEN $6 ELSE reviewed_by END,
          reviewed_at = CASE WHEN $2 IN ('aprobado','rechazado') THEN NOW() ELSE reviewed_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [supportId, text(payload.status), text(payload.file_url || payload.fileUrl), text(payload.file_name || payload.fileName), text(payload.observations), id(userId)]);
    return rows[0];
  }
  const { rows } = await pool.query(`
    INSERT INTO novelty_supports (
      novelty_id, employee_id, payroll_period_id, municipality_id, support_type, required,
      status, file_url, file_name, observations, uploaded_by, uploaded_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN NULLIF($8, '') IS NOT NULL THEN NOW() ELSE NULL END)
    RETURNING *
  `, [
    id(payload.novelty_id || payload.noveltyId),
    id(payload.employee_id || payload.employeeId),
    id(payload.payroll_period_id || payload.periodId),
    id(payload.municipality_id || payload.municipalityId),
    text(payload.support_type || payload.supportType || "otros"),
    payload.required !== false,
    text(payload.status || "pendiente"),
    text(payload.file_url || payload.fileUrl),
    text(payload.file_name || payload.fileName),
    text(payload.observations),
    id(userId),
  ]);
  return rows[0];
}

module.exports = {
  listOperationalPeriods,
  createOperationalPeriod,
  listPayrollGroups,
  getPayrollGroupDetail,
  calculatePayrollGroup,
  createNoveltyForItem,
  patchNovelty,
  setNoveltyReviewed,
  createTurnCover,
  listSupports,
  createSupport,
  rowEmployee,
  workTimeKind,
};
