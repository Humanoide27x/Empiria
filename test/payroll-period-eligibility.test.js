"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  employeeAppliesToPayrollPeriod,
  calculatePayrollWorkedDays,
  laborDateNoveltiesForPeriod,
  payrollInclusionStatus,
} = require("../src/utils/payroll-period-eligibility");

const MAY_START = "2026-05-01";
const MAY_END = "2026-05-30";

test("activo todo el mes", () => {
  const employee = { labor_start_date: "2026-01-01" };
  assert.equal(employeeAppliesToPayrollPeriod(employee, MAY_START, MAY_END), true);
  assert.equal(calculatePayrollWorkedDays(employee, MAY_START, MAY_END), 30);
});

test("ingreso dentro del mes", () => {
  const employee = { labor_start_date: "2026-05-10" };
  assert.equal(employeeAppliesToPayrollPeriod(employee, MAY_START, MAY_END), true);
  assert.equal(calculatePayrollWorkedDays(employee, MAY_START, MAY_END), 21);
});

test("retiro dentro del mes", () => {
  const employee = { labor_start_date: "2026-01-01", labor_end_date: "2026-05-22" };
  assert.equal(employeeAppliesToPayrollPeriod(employee, MAY_START, MAY_END), true);
  assert.equal(calculatePayrollWorkedDays(employee, MAY_START, MAY_END), 22);
});

test("ingreso y retiro dentro del mismo mes", () => {
  const employee = { labor_start_date: "2026-05-10", labor_end_date: "2026-05-22" };
  assert.equal(employeeAppliesToPayrollPeriod(employee, MAY_START, MAY_END), true);
  assert.equal(calculatePayrollWorkedDays(employee, MAY_START, MAY_END), 13);
});

test("retiro antes del periodo", () => {
  const employee = { labor_start_date: "2026-01-01", labor_end_date: "2026-04-30" };
  assert.equal(employeeAppliesToPayrollPeriod(employee, MAY_START, MAY_END), false);
  assert.equal(calculatePayrollWorkedDays(employee, MAY_START, MAY_END), 0);
});

test("ingreso despues del periodo", () => {
  const employee = { labor_start_date: "2026-06-01" };
  assert.equal(employeeAppliesToPayrollPeriod(employee, MAY_START, MAY_END), false);
  assert.equal(calculatePayrollWorkedDays(employee, MAY_START, MAY_END), 0);
});

test("retiro registrado en Personal genera novedad de retiro para Nomina", () => {
  const employee = { labor_start_date: "2026-01-01", labor_end_date: "2026-05-30" };
  assert.deepEqual(laborDateNoveltiesForPeriod(employee, MAY_START, MAY_END), [{
    novelty_type: "FECHA_RETIRO",
    start_date: "2026-05-30",
    end_date: "2026-05-30",
    days: 30,
    source: "PERSONAL",
  }]);
  assert.equal(payrollInclusionStatus(employee, MAY_START, MAY_END), "RETIRADA_EN_PERIODO");
});

test("retiro fuera del periodo no genera novedad en ese periodo", () => {
  const employee = { labor_start_date: "2026-01-01", labor_end_date: "2026-04-30" };
  assert.deepEqual(laborDateNoveltiesForPeriod(employee, MAY_START, MAY_END), []);
  assert.equal(payrollInclusionStatus(employee, MAY_START, MAY_END), "EXCLUIDA");
});

test("correccion de fecha de retiro recalcula dias sin cambiar la clave de empleado-periodo", () => {
  const before = laborDateNoveltiesForPeriod(
    { labor_start_date: "2026-01-01", labor_end_date: "2026-05-22" },
    MAY_START,
    MAY_END
  )[0];
  const after = laborDateNoveltiesForPeriod(
    { labor_start_date: "2026-01-01", labor_end_date: "2026-05-15" },
    MAY_START,
    MAY_END
  )[0];

  assert.equal(before.novelty_type, after.novelty_type);
  assert.equal(before.days, 22);
  assert.equal(after.days, 15);
});

test("los dias manuales no hacen parte del calculo automatico de rango laboral", () => {
  const employee = {
    labor_start_date: "2026-01-01",
    labor_end_date: "2026-05-15",
    dias_laborados_manual: 30,
    has_manual_override: true,
  };
  assert.equal(calculatePayrollWorkedDays(employee, MAY_START, MAY_END), 15);
});
