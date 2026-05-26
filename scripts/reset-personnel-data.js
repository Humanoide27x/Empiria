"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");

const pool = require("../src/db/pool");

const BACKUP_DIR = path.join(__dirname, "../backups/personnel-reset");
const BACKUP_PREFIX = "empiria_personnel_reset";

const PRESERVED_TABLES = Object.freeze([
  "companies",
  "contracts",
  "users",
  "roles",
  "permissions",
  "master_areas",
  "master_positions",
  "master_document_types",
  "master_modalities",
  "master_experience_types",
  "contract_position_rules",
  "contract_document_rules",
  "contract_experience_rules",
  "contract_coverage_rules",
]);

const RESET_TABLES = Object.freeze([
  {
    name: "employee_assignment_municipalities",
    label: "Cobertura municipal por asignacion",
    required: true,
  },
  {
    name: "employee_assignment_history",
    label: "Historial contractual por asignacion",
    required: true,
  },
  {
    name: "employment_certificates",
    label: "Certificados laborales emitidos",
    required: true,
  },
  {
    name: "employee_experiences",
    label: "Experiencias laborales del empleado",
    required: true,
  },
  {
    name: "employee_documents",
    label: "Documentos cargados por empleado",
    required: true,
  },
  {
    name: "post_hiring_affiliations",
    label: "Afiliaciones post ingreso",
    required: false,
  },
  {
    name: "employee_drafts",
    label: "Borradores operativos de personal",
    required: false,
  },
  {
    name: "employee_import_staging",
    label: "Staging de importacion de personal",
    required: false,
  },
  {
    name: "dotacion_asignaciones",
    label: "Asignaciones operativas de dotacion",
    required: false,
  },
  {
    name: "employee_contract_assignments",
    label: "Asignaciones contractuales del empleado",
    required: true,
  },
  {
    name: "employee_contracts",
    label: "Snapshot legacy de relacion empleado-contrato",
    required: false,
  },
  {
    name: "employees",
    label: "Empleados operativos",
    required: true,
  },
]);

const ROOT_REFERENCE_TABLES = Object.freeze([
  "employees",
  "employee_contract_assignments",
]);

const SAFE_REFERENCE_TABLES = new Set([
  ...PRESERVED_TABLES,
  ...RESET_TABLES.map((item) => item.name),
]);

function parseArgs(argv) {
  const args = {
    execute: false,
    skipBackup: false,
    confirm: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") {
      args.execute = true;
      continue;
    }
    if (arg === "--skip-backup") {
      args.skipBackup = true;
      continue;
    }
    if (arg === "--confirm") {
      args.confirm = String(argv[index + 1] || "");
      index += 1;
    }
  }

  return args;
}

function getDbParams() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const parsed = new URL(dbUrl);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      user: parsed.username,
      password: decodeURIComponent(parsed.password || ""),
      database: parsed.pathname.replace(/^\//, ""),
    };
  }

  return {
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || "5432",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "empiria_db",
  };
}

function timestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

async function loadExistingTargetTables(client) {
  const tableNames = RESET_TABLES.map((item) => item.name);
  const result = await client.query(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
      ORDER BY tablename
    `,
    [tableNames]
  );

  return new Set(result.rows.map((row) => row.tablename));
}

async function loadTableCounts(client, tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    const sql = `SELECT COUNT(*)::bigint AS total FROM public.${quoteIdent(tableName)}`;
    const result = await client.query(sql);
    counts[tableName] = Number(result.rows[0]?.total || 0);
  }
  return counts;
}

async function loadUnexpectedReferences(client) {
  const result = await client.query(
    `
      SELECT
        child_ns.nspname  AS child_schema,
        child.relname     AS child_table,
        parent.relname    AS parent_table,
        con.conname       AS constraint_name,
        pg_get_constraintdef(con.oid) AS constraint_def
      FROM pg_constraint con
      JOIN pg_class child
        ON child.oid = con.conrelid
      JOIN pg_namespace child_ns
        ON child_ns.oid = child.relnamespace
      JOIN pg_class parent
        ON parent.oid = con.confrelid
      JOIN pg_namespace parent_ns
        ON parent_ns.oid = parent.relnamespace
      WHERE con.contype = 'f'
        AND parent_ns.nspname = 'public'
        AND parent.relname = ANY($1::text[])
      ORDER BY parent.relname, child.relname, con.conname
    `,
    [ROOT_REFERENCE_TABLES]
  );

  const unexpected = [];

  for (const row of result.rows) {
    if (row.child_schema !== "public") continue;
    if (SAFE_REFERENCE_TABLES.has(row.child_table)) continue;

    const countSql = `SELECT COUNT(*)::bigint AS total FROM public.${quoteIdent(row.child_table)}`;
    const countResult = await client.query(countSql);
    const rowCount = Number(countResult.rows[0]?.total || 0);

    unexpected.push({
      table: row.child_table,
      parentTable: row.parent_table,
      rowCount,
      constraintName: row.constraint_name,
      constraintDef: row.constraint_def,
    });
  }

  return unexpected;
}

function buildResetPlan(existingTableSet) {
  return RESET_TABLES.filter((item) => existingTableSet.has(item.name));
}

async function exportBackup(tableNames) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const db = getDbParams();
  const suffix = timestampLabel();
  const sqlPath = path.join(BACKUP_DIR, `${BACKUP_PREFIX}_${db.database}_${suffix}.sql`);

  const dumpArgs = [
    `--host=${db.host}`,
    `--port=${db.port}`,
    `--username=${db.user}`,
    `--dbname=${db.database}`,
    "--data-only",
    "--inserts",
    "--column-inserts",
    "--no-owner",
    "--no-acl",
    `--file=${sqlPath}`,
    ...tableNames.map((tableName) => `--table=public.${tableName}`),
  ];

  const result = spawnSync("pg_dump", dumpArgs, {
    env: { ...process.env, PGPASSWORD: db.password },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`No fue posible ejecutar pg_dump: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "pg_dump falló").trim());
  }

  return sqlPath;
}

async function exportJsonBackup(client, dbName, tableNames) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    database: dbName,
    format: "json",
    tables: {},
  };

  for (const tableName of tableNames) {
    const sql = `SELECT * FROM public.${quoteIdent(tableName)} ORDER BY 1`;
    const result = await client.query(sql);
    payload.tables[tableName] = result.rows;
  }

  const jsonPath = path.join(
    BACKUP_DIR,
    `${BACKUP_PREFIX}_${dbName}_${timestampLabel()}.json`
  );

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  return jsonPath;
}

async function writeManifest(dbName, plan, counts, unexpectedRefs, backupPath) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    database: dbName,
    backupPath: backupPath || null,
    preservedTables: PRESERVED_TABLES,
    targetTables: plan.map((item) => ({
      name: item.name,
      label: item.label,
      rowCount: counts[item.name] ?? 0,
      required: item.required,
    })),
    unexpectedReferences: unexpectedRefs,
  };

  const manifestPath = path.join(
    BACKUP_DIR,
    `${BACKUP_PREFIX}_${dbName}_${timestampLabel()}.manifest.json`
  );

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

async function askForConfirmation(expectedPhrase) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Terminal no interactiva. Reintenta con --confirm "${expectedPhrase}"`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question(`Escribe exactamente "${expectedPhrase}" para continuar: `, resolve);
  });

  rl.close();
  return String(answer || "").trim();
}

async function resetOwnedSequences(client, tableName) {
  const result = await client.query(
    `
      SELECT quote_ident(ns.nspname) || '.' || quote_ident(seq.relname) AS sequence_name
      FROM pg_class tbl
      JOIN pg_namespace tbl_ns
        ON tbl_ns.oid = tbl.relnamespace
      JOIN pg_depend dep
        ON dep.refobjid = tbl.oid
       AND dep.classid = 'pg_class'::regclass
       AND dep.deptype IN ('a', 'i')
      JOIN pg_class seq
        ON seq.oid = dep.objid
       AND seq.relkind = 'S'
      JOIN pg_namespace ns
        ON ns.oid = seq.relnamespace
      WHERE tbl_ns.nspname = 'public'
        AND tbl.relname = $1
    `,
    [tableName]
  );

  for (const row of result.rows) {
    await client.query(`ALTER SEQUENCE ${row.sequence_name} RESTART WITH 1`);
  }
}

async function executeReset(client, plan) {
  const executionReport = [];

  await client.query("BEGIN");
  try {
    for (const item of plan) {
      const sql = `DELETE FROM public.${quoteIdent(item.name)}`;
      const result = await client.query(sql);
      await resetOwnedSequences(client, item.name);
      executionReport.push({
        table: item.name,
        deletedRows: result.rowCount ?? null,
      });
    }

    await client.query("COMMIT");
    return executionReport;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = await pool.connect();

  try {
    const db = getDbParams();
    const existingTableSet = await loadExistingTargetTables(client);
    const plan = buildResetPlan(existingTableSet);
    const missingRequired = RESET_TABLES.filter(
      (item) => item.required && !existingTableSet.has(item.name)
    );
    const counts = await loadTableCounts(client, plan.map((item) => item.name));
    const unexpectedRefs = await loadUnexpectedReferences(client);

    printHeader("Reset Controlado de Talento Humano");
    console.log(`Base objetivo: ${db.database}`);
    console.log(`Modo: ${args.execute ? "EXECUTE" : "DRY-RUN"}`);
    console.log(`Backup previo: ${args.skipBackup ? "omitido por flag" : "habilitado"}`);

    printHeader("Tablas preservadas");
    PRESERVED_TABLES.forEach((tableName) => console.log(`- ${tableName}`));

    printHeader("Tablas a limpiar");
    plan.forEach((item) => {
      const count = counts[item.name] ?? 0;
      console.log(`- ${item.name}: ${count} fila(s)${item.required ? "" : " [opcional si existe]"}`);
    });

    if (missingRequired.length > 0) {
      printHeader("Tablas obligatorias ausentes");
      missingRequired.forEach((item) => {
        console.log(`- ${item.name}: no existe en esta base`);
      });
    }

    if (unexpectedRefs.length) {
      printHeader("Referencias no esperadas");
      unexpectedRefs.forEach((ref) => {
        console.log(
          `- ${ref.table} -> ${ref.parentTable} (${ref.rowCount} fila(s)) [${ref.constraintName}]`
        );
      });
      console.log("El reset se bloqueará en modo EXECUTE hasta revisar esas referencias.");
    } else {
      printHeader("Referencias no esperadas");
      console.log("Sin referencias adicionales fuera de la lista blanca.");
    }

    const manifestPath = await writeManifest(db.database, plan, counts, unexpectedRefs, null);
    console.log(`\nManifiesto: ${manifestPath}`);

    if (!args.execute) {
      console.log("\nNo se ejecutó ningún borrado.");
      console.log("Siguiente paso: node scripts/reset-personnel-data.js --execute");
      return;
    }

    if (unexpectedRefs.length > 0) {
      throw new Error("Abortado por referencias no esperadas fuera de la lista blanca.");
    }
    if (missingRequired.length > 0) {
      throw new Error("Abortado porque faltan tablas obligatorias del reset.");
    }

    let backupPath = null;
    if (!args.skipBackup) {
      printHeader("Backup previo");
      try {
        backupPath = await exportBackup(plan.map((item) => item.name));
        console.log(`Backup SQL generado: ${backupPath}`);
      } catch (error) {
        console.warn(`pg_dump no disponible para backup SQL: ${error.message}`);
        backupPath = await exportJsonBackup(client, db.database, plan.map((item) => item.name));
        console.log(`Backup JSON generado: ${backupPath}`);
      }
      const backupManifestPath = await writeManifest(
        db.database,
        plan,
        counts,
        unexpectedRefs,
        backupPath
      );
      console.log(`Manifiesto actualizado: ${backupManifestPath}`);
    }

    const expectedPhrase = `RESET PERSONNEL DATA ${db.database}`;
    const providedPhrase = args.confirm
      ? String(args.confirm).trim()
      : await askForConfirmation(expectedPhrase);

    if (providedPhrase !== expectedPhrase) {
      throw new Error("Confirmación inválida. No se ejecutó ningún cambio.");
    }

    printHeader("Ejecución");
    const report = await executeReset(client, plan);
    report.forEach((row) => {
      console.log(`- ${row.table}: ${row.deletedRows ?? 0} fila(s) eliminada(s)`);
    });

    console.log("\nReset completado sin tocar arquitectura contractual, catálogos maestros ni usuarios.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`\n[reset-personnel-data] ERROR: ${error.message}`);
  process.exit(1);
});
