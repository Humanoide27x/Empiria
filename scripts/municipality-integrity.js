#!/usr/bin/env node
"use strict";

require("dotenv").config();
const pool = require("../src/db/pool");

async function main() {
  const queries = {
    duplicateMunicipalities: `
      SELECT normalized_name, ARRAY_AGG(id ORDER BY id) AS municipality_ids, ARRAY_AGG(name ORDER BY id) AS municipality_names
      FROM municipalities
      WHERE NULLIF(TRIM(COALESCE(normalized_name, '')), '') IS NOT NULL
      GROUP BY normalized_name
      HAVING COUNT(*) > 1
      ORDER BY normalized_name
    `,
    employeesWithoutMunicipality: `
      SELECT id, full_name, document_number, status
      FROM employees
      WHERE municipality_id IS NULL
      ORDER BY full_name
      LIMIT 200
    `,
    employeesWithInvalidMunicipalityId: `
      SELECT e.id, e.full_name, e.municipality_id
      FROM employees e
      WHERE e.municipality_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM municipalities m WHERE m.id = e.municipality_id)
      ORDER BY e.full_name
      LIMIT 200
    `,
    institutionsWithoutMunicipality: `
      SELECT id, name
      FROM institutions
      WHERE municipality_id IS NULL
      ORDER BY name
      LIMIT 200
    `,
    orphanEducationalSites: `
      SELECT s.id, s.name, s.institution_id
      FROM educational_sites s
      WHERE s.institution_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM institutions i WHERE i.id = s.institution_id)
      ORDER BY s.name
      LIMIT 200
    `,
    coverageRowsWithoutMunicipalityId: `
      SELECT municipality, COUNT(*) AS rows
      FROM coverage_upload_rows
      WHERE municipality_id IS NULL
        AND NULLIF(TRIM(COALESCE(municipality, '')), '') IS NOT NULL
      GROUP BY municipality
      ORDER BY rows DESC, municipality ASC
      LIMIT 100
    `,
    coverageRowsWithInvalidMunicipalityId: `
      SELECT id, upload_id, municipality, municipality_id
      FROM coverage_upload_rows cur
      WHERE municipality_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM municipalities m WHERE m.id = cur.municipality_id)
      ORDER BY upload_id DESC, id DESC
      LIMIT 100
    `,
    payrollGroupsWithoutMunicipality: `
      SELECT id, operational_position AS group_name, municipality_id
      FROM payroll_groups
      WHERE municipality_id IS NULL
      ORDER BY operational_position
      LIMIT 100
    `,
    payrollGroupsWithInvalidMunicipalityId: `
      SELECT id, operational_position AS group_name, municipality_id
      FROM payroll_groups pg
      WHERE municipality_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM municipalities m WHERE m.id = pg.municipality_id)
      ORDER BY operational_position
      LIMIT 100
    `,
  };

  const report = {};
  for (const [key, sql] of Object.entries(queries)) {
    try {
      const { rows } = await pool.query(sql);
      report[key] = { count: rows.length, rows };
    } catch (error) {
      report[key] = { error: error.message };
    }
  }

  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
