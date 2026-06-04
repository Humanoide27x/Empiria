const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function loadSegmentation() {
  const modulePath = path.join(process.cwd(), "public/js/modules/payroll-segmentation.js");
  const source = fs.readFileSync(modulePath, "utf8");
  const specifier = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
  return import(specifier);
}

test("operario aparece en Operario Manipulador de Alimentos", async () => {
  const mod = await loadSegmentation();
  assert.equal(mod.classifyPayrollDivision("OPERARIO MANIPULADOR DE ALIMENTOS"), "OPERARIO");
});

test("gestor aparece en Equipo Minimo", async () => {
  const mod = await loadSegmentation();
  assert.equal(mod.classifyPayrollDivision("GESTOR DE ZONA"), "EQUIPO_MINIMO");
  assert.equal(mod.classifyPayrollArea("GESTOR DE ZONA"), "GESTORES DE ZONA");
});

test("clasifica SST, talento humano, facturacion y calidad en sus areas", async () => {
  const mod = await loadSegmentation();
  assert.equal(mod.classifyPayrollArea("PROFESIONAL SST"), "AREA DE SEGURIDAD Y SALUD EN EL TRABAJO");
  assert.equal(mod.classifyPayrollArea("ANALISTA TALENTO HUMANO"), "AREA DE TALENTO HUMANO");
  assert.equal(mod.classifyPayrollArea("AUXILIAR DE FACTURACION"), "AREA DE FACTURACION");
  assert.equal(mod.classifyPayrollArea("INSPECTOR DE CALIDAD"), "AREA DE CALIDAD");
});

test("clasifica Bodega RI y Bodega RP correctamente", async () => {
  const mod = await loadSegmentation();
  assert.equal(mod.classifyPayrollArea("AUXILIAR BODEGA RI"), "BODEGA RI");
  assert.equal(mod.classifyPayrollArea("COORDINADOR BODEGA RP"), "BODEGA RP");
});

test("resuelve exportacion por municipio y por area", async () => {
  const mod = await loadSegmentation();
  const positions = [
    {
      position: "OPERARIO MANIPULADOR DE ALIMENTOS",
      municipalities: [{ id: 11 }, { id: 12 }],
    },
    {
      position: "GESTOR DE ZONA",
      municipalities: [{ id: 21 }],
    },
    {
      position: "AUXILIAR DE FACTURACION",
      municipalities: [{ id: 22 }],
    },
  ];
  assert.deepEqual(
    mod.resolvePayrollScopeGroupIds({ divisionKey: "OPERARIO", positions, municipalityId: "ALL" }),
    [11, 12]
  );
  assert.deepEqual(
    mod.resolvePayrollScopeGroupIds({ divisionKey: "OPERARIO", positions, municipalityId: 12 }),
    [12]
  );
  assert.deepEqual(
    mod.resolvePayrollScopeGroupIds({ divisionKey: "EQUIPO_MINIMO", positions, areaKey: "AREA DE FACTURACION" }),
    [22]
  );
});

test("deduplica empleados y calcula resumen sin duplicados", async () => {
  const mod = await loadSegmentation();
  const deduped = mod.dedupePayrollItems([
    { id: 1, employee_id: 100, total_devengado: 2000, total_deducciones: 300, neto_pagar: 1700, base_salary: 1500, reviewed: true },
    { id: 2, employee_id: 100, total_devengado: 2000, total_deducciones: 300, neto_pagar: 1700, base_salary: 1500, reviewed: true },
    { id: 3, employee_id: 101, total_devengado: 2400, total_deducciones: 400, neto_pagar: 2000, base_salary: 1600, reviewed: false },
  ]);
  assert.equal(deduped.length, 2);
  const summary = mod.summarizePayrollItems(deduped);
  assert.equal(summary.employees, 2);
  assert.equal(summary.total_devengado, 4400);
  assert.equal(summary.total_deducciones, 700);
  assert.equal(summary.neto, 3700);
  assert.equal(summary.average_salary, 1550);
});
