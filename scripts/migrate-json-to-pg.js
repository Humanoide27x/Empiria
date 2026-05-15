/**
 * EMPIRIA V1 — Migración de datos JSON → PostgreSQL
 *
 * Ejecutar DESPUÉS de correr 001_alter_existing_tables.sql
 * Uso: node scripts/migrate-json-to-pg.js
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pool = require("../src/db/pool");

// ── Constantes ────────────────────────────────────────────────────────────────

const DEFAULT_COMPANY_ID  = 1;
const DEFAULT_CONTRACT_ID = 1;
const DEFAULT_TENANT_ID   = 1;

// Mapeo de nombres de municipio (JSON) → ID en PostgreSQL
const MUNICIPALITY_MAP = {
  "acacias":               9,
  "acacías":               9,
  "barranca de upia":      4,
  "barranca de upía":      4,
  "cabuyaro":              13,
  "castilla la nueva":     22,
  "cumaral":               15,
  "el calvario":           23,
  "el castillo":           11,
  "el dorado":             28,
  "fuente de oro":         2,
  "granada":               17,
  "guamal":                5,
  "la macarena":           29,
  "lejanias":              21,
  "lejanías":              21,
  "mapiripa":              3,
  "mapiripán":             3,
  "mapiripan":             3,
  "mesetas":               7,
  "puerto concordia":      20,
  "puerto gaitan":         14,
  "puerto gaitán":         14,
  "puerto lleras":         1,
  "puerto lopez":          12,
  "puerto lópez":          12,
  "puerto rico":           16,
  "restrepo":              25,
  "san carlos de guaroa":  19,
  "san juan de arama":     10,
  "san juanito":           24,
  "cubarral":              18,
  "san luis de cubarral":  18,
  "san martin":            27,
  "san martín":            27,
  "la uribe":              8,
  "uribe":                 8,
  "vista hermosa":         6,
  "vistahermosa":          6,
};

// Mapeo de roles JSON → ID en roles PG
const ROLE_ID_MAP = {
  "administrador":       1,
  "talento_humano":      2,
  "operacion":           3,
  "calidad":             4,
  "auditores_internos":  5,
  "empleado":            6,
  "gestores_auxiliares": 7,
  "interventoria":       8,
};

// Mapeo de company_id JSON (stale) → company_id PG real
const COMPANY_MAP = {
  1:    1,
  2:    2,
  3:    3,
  10:   1,   // ID legacy de pruebas → empresa principal
  null: null,
};

// Mapeo de contract_id JSON (stale) → contract_id PG real
const CONTRACT_MAP = {
  1:    1,
  1001: 1,   // ID legacy de pruebas → contrato principal
  null: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeMunicipalityName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function getMunicipalityId(name) {
  if (!name) return null;
  const normalized = normalizeMunicipalityName(name);
  return MUNICIPALITY_MAP[normalized] || MUNICIPALITY_MAP[name?.toLowerCase().trim()] || null;
}

function parseDate(value) {
  if (!value) return null;
  const num = typeof value === "number" ? value : /^\d{4,6}$/.test(String(value).trim()) ? Number(value) : NaN;
  if (!isNaN(num) && num > 1000 && num < 200000) {
    // Excel serial date: days since Dec 30, 1899 (accounts for Excel's 1900 leap year bug)
    const date = new Date(Date.UTC(1899, 11, 30) + num * 86400000);
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  // ISO date string or parseable date
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mapSex(value) {
  if (!value) return null;
  const v = String(value).toUpperCase().trim();
  if (v === "HOMBRE" || v === "MASCULINO" || v === "M") return "M";
  if (v === "MUJER" || v === "FEMENINO" || v === "F") return "F";
  return null;
}

function mapStatus(value) {
  if (!value) return "activo";
  const v = String(value).toUpperCase().trim();
  if (v === "ACTIVO" || v === "ACTIVE") return "activo";
  if (v === "INACTIVO" || v === "RETIRADO" || v === "RETIRED") return "retirado";
  if (v === "VACACIONES") return "vacaciones";
  return "activo";
}

// ── Migraciones ───────────────────────────────────────────────────────────────

async function migrateUsers(client) {
  const usersPath = path.join(__dirname, "../data/users.json");
  if (!fs.existsSync(usersPath)) {
    console.log("⚠  data/users.json no encontrado — saltando migración de usuarios");
    return;
  }

  const users = JSON.parse(fs.readFileSync(usersPath, "utf8"));
  console.log(`\n👥 Migrando ${users.length} usuarios...`);

  let ok = 0;
  let skipped = 0;

  for (const u of users) {
    const roleId = ROLE_ID_MAP[u.role] || 1;
    const companyId = COMPANY_MAP[u.companyId] !== undefined ? COMPANY_MAP[u.companyId] : null;
    const contractId = CONTRACT_MAP[u.contractId] !== undefined ? CONTRACT_MAP[u.contractId] : null;

    const result = await client.query(
      `INSERT INTO users
         (id, username, password_hash, full_name, role_id, company_id, contract_id,
          active, mfa_enabled, mfa_secret, mfa_confirmed_at, tenant_id, role_code, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (id) DO UPDATE SET
         username       = EXCLUDED.username,
         password_hash  = EXCLUDED.password_hash,
         full_name      = EXCLUDED.full_name,
         role_id        = EXCLUDED.role_id,
         role_code      = EXCLUDED.role_code,
         updated_at     = NOW()
       RETURNING id`,
      [
        u.id,
        u.username,
        u.passwordHash,
        u.name || u.username,
        roleId,
        companyId,
        contractId,
        u.active !== false,
        u.mfaEnabled || false,
        u.mfaSecret || null,
        (u.mfaConfirmedAt && !isNaN(new Date(u.mfaConfirmedAt).getTime()))
          ? new Date(u.mfaConfirmedAt)
          : null,
        DEFAULT_TENANT_ID,
        u.role || null,
      ]
    );

    if (result.rows.length > 0) ok++;
    else skipped++;
  }

  // Resetear la secuencia del serial para evitar conflictos
  await client.query(
    "SELECT setval('users_id_seq', (SELECT MAX(id) FROM users) + 1)"
  );

  console.log(`   ✅ Usuarios migrados: ${ok} | omitidos: ${skipped}`);
}

async function migratePersonnel(client) {
  const personnelPath = path.join(__dirname, "../src/data/personnel.json");
  if (!fs.existsSync(personnelPath)) {
    console.log("⚠  src/data/personnel.json no encontrado");
    return;
  }

  const personnel = JSON.parse(fs.readFileSync(personnelPath, "utf8"));
  console.log(`\n👤 Migrando ${personnel.length} empleados...`);

  let ok = 0;
  let skipped = 0;
  let errors = 0;
  let savepointIdx = 0;

  for (const p of personnel) {
    const sp = `sp_emp_${savepointIdx++}`;
    await client.query(`SAVEPOINT ${sp}`);

    try {
      const municipalityId = getMunicipalityId(
        p.municipalityName || p.municipio || p.municipality
      );
      const birthDate =
        parseDate(p.birthDate) ||
        (p.birthYear && p.birthMonth && p.birthDay
          ? `${p.birthYear}-${String(p.birthMonth).padStart(2, "0")}-${String(p.birthDay).padStart(2, "0")}`
          : null);
      const expeditionDate =
        parseDate(p.expeditionDate) ||
        (p.expeditionYear && p.expeditionMonth && p.expeditionDay
          ? `${p.expeditionYear}-${String(p.expeditionMonth).padStart(2, "0")}-${String(p.expeditionDay).padStart(2, "0")}`
          : null);

      const result = await client.query(
        `INSERT INTO employees (
          legacy_json_id, company_id, contract_id, tenant_id,
          full_name, first_name, second_name, first_last_name, second_last_name,
          document_type, document_number,
          cargo, real_position, offered_position, modality, workday_type,
          sex, birth_date, expedition_date, expedition_municipality,
          address, neighborhood, phone, email, civil_status_text,
          municipality_id,
          status, start_date, coverage_start_date,
          eps, pension_fund, compensation_box, arl,
          food_handling_course_issue_date, food_handling_course_expiry_date,
          food_handling_exam_issue_date, food_handling_exam_expiry_date,
          gestor_zona,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,$9,
          $10,$11,
          $12,$13,$14,$15,$16,
          $17,$18,$19,$20,
          $21,$22,$23,$24,$25,
          $26,
          $27,$28,$29,
          $30,$31,$32,$33,
          $34,$35,$36,$37,
          $38,
          NOW(),NOW()
        )
        ON CONFLICT (legacy_json_id) DO UPDATE SET
          status     = EXCLUDED.status,
          full_name  = EXCLUDED.full_name,
          updated_at = NOW()
        RETURNING id`,
        [
          p.id,
          DEFAULT_COMPANY_ID,
          DEFAULT_CONTRACT_ID,
          DEFAULT_TENANT_ID,
          // nombres
          p.fullName || p.nombre || p.name || "",
          p.firstName || p.primer_nombre || "",
          p.secondName || p.segundo_nombre || "",
          p.firstLastName || p.primer_apellido || "",
          p.secondLastName || p.segundo_apellido || "",
          // documento
          p.documentType || p.tipo_documento || "CC",
          String(p.documentNumber || p.numero_documento || ""),
          // cargo
          p.cargo_real || p.real_position || p.position || "",
          p.cargo_real || p.real_position || "",
          p.offerPosition || p.offered_position || p.cargo_presentado_en_licitacion || "",
          p.modalidad || p.educationalModality || null,
          p.workTimeType || p.work_time_type || p.tipo_tiempo || null,
          // datos personales
          mapSex(p.sex || p.biologicalSex || p.genero),
          birthDate,
          expeditionDate,
          p.expeditionPlace || p.expeditionMunicipality || p.expedition_municipality || "",
          // contacto
          p.address || "",
          p.neighborhood || "",
          String(p.phone || p.telefono || ""),
          String(p.email || p.correo || "").toLowerCase(),
          p.civilStatus || p.estado_civil || "",
          // ubicación
          municipalityId,
          // estado laboral
          mapStatus(p.status || p.estado),
          parseDate(p.startDate || p.fecha_ingreso),
          parseDate(p.coverageStartDate || p.coverage_start_date || p.fecha_inicio_cobertura),
          // afiliaciones
          p.eps || "",
          p.pensionFund || p.pension_fund || p.fondo_pension || "",
          p.compensationBox || p.compensation_box || p.caja_compensacion || "",
          p.arl || "",
          // documentos manejo alimentos
          parseDate(p.foodHandlingCourseIssueDate) || null,
          parseDate(p.foodHandlingCourseExpirationDate) || null,
          parseDate(p.foodHandlingExamIssueDate) || null,
          parseDate(p.foodHandlingExamExpirationDate) || null,
          // gestor
          p.gestorZona || p.gestor_zona || null,
        ]
      );

      await client.query(`RELEASE SAVEPOINT ${sp}`);
      if (result.rows.length > 0) ok++;
      else skipped++;
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      errors++;
      if (errors <= 5) {
        console.error(`   ❌ Error empleado ${p.id} (${p.fullName}): ${err.message.substring(0, 100)}`);
      }
    }
  }

  console.log(`   ✅ Empleados migrados: ${ok} | omitidos: ${skipped} | errores: ${errors}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runMigration() {
  console.log("🚀 EMPIRIA V1 — Migración JSON → PostgreSQL");
  console.log("============================================");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await migrateUsers(client);
    await migratePersonnel(client);

    await client.query("COMMIT");
    console.log("\n✅ Migración completada exitosamente.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Error en migración — ROLLBACK ejecutado:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});
