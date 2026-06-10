"use strict";

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function getEmployeeLaborStartDate(employee = {}) {
  return dateOnly(
    employee.fecha_inicio_laboral ||
    employee.labor_start_date ||
    employee.fecha_inicio ||
    employee.fecha_ingreso ||
    employee.start_date ||
    employee.startDate ||
    employee.coverage_start_date ||
    employee.coverageStartDate ||
    employee.contract_start_date ||
    employee.assignment_start_date
  );
}

function getEmployeeLaborEndDate(employee = {}) {
  return dateOnly(
    employee.fecha_finalizacion_laboral ||
    employee.labor_end_date ||
    employee.fecha_finalizacion ||
    employee.fecha_retiro ||
    employee.retirement_date ||
    employee.termination_date ||
    employee.contract_end_date ||
    employee.assignment_end_date
  );
}

function employeeAppliesToPayrollPeriod(employee, periodStart, periodEnd) {
  const start = getEmployeeLaborStartDate(employee);
  const end = getEmployeeLaborEndDate(employee);
  const pStart = dateOnly(periodStart);
  const pEnd = dateOnly(periodEnd);

  if (!pStart || !pEnd) return false;
  // Sin fecha de inicio: empleado ingresó antes del sistema de registro →
  // tratar como "siempre activo desde antes del período", evaluar solo fecha fin.
  if (!start) return !end || end >= pStart;
  return start <= pEnd && (!end || end >= pStart);
}

function samePayrollMonth(a, b) {
  const left = dateOnly(a);
  const right = dateOnly(b);
  return Boolean(left && right && left.slice(0, 7) === right.slice(0, 7));
}

function day(value) {
  const clean = dateOnly(value);
  return clean ? Number(clean.slice(8, 10)) : 0;
}

function maxDate(a, b) {
  const left = dateOnly(a);
  const right = dateOnly(b);
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function minDate(a, b) {
  const left = dateOnly(a);
  const right = dateOnly(b);
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

function calculatePayrollWorkedDays(employee, periodStart, periodEnd) {
  const payrollBaseDays = 30;
  const start = getEmployeeLaborStartDate(employee);
  const end = getEmployeeLaborEndDate(employee);
  const pStart = dateOnly(periodStart);
  const pEnd = dateOnly(periodEnd);

  if (!pStart || !pEnd) return 0;
  // Sin fecha de inicio: tratar como ingresado antes del período → inicio efectivo = inicio del período.
  const effectiveStart = start ? maxDate(start, pStart) : pStart;
  const effectiveEnd = end ? minDate(end, pEnd) : pEnd;

  if (effectiveStart > pEnd) return 0;
  if (effectiveEnd < pStart) return 0;

  const startDay = Math.min(day(effectiveStart), payrollBaseDays);
  const endDay = Math.min(day(effectiveEnd), payrollBaseDays);

  if (samePayrollMonth(effectiveStart, pStart) && samePayrollMonth(effectiveEnd, pStart)) {
    return Math.max(0, endDay - startDay + 1);
  }

  if (samePayrollMonth(effectiveStart, pStart)) {
    return Math.max(0, payrollBaseDays - startDay + 1);
  }

  if (samePayrollMonth(effectiveEnd, pStart)) {
    return Math.max(0, endDay);
  }

  return payrollBaseDays;
}

function laborDateNoveltiesForPeriod(employee, periodStart, periodEnd) {
  const start = getEmployeeLaborStartDate(employee);
  const end = getEmployeeLaborEndDate(employee);
  const pStart = dateOnly(periodStart);
  const pEnd = dateOnly(periodEnd);
  const novelties = [];

  if (start && start >= pStart && start <= pEnd) {
    const d = Number(start.slice(8, 10));
    novelties.push({
      novelty_type: "FECHA_INGRESO",
      start_date: start,
      end_date: start,
      days: Math.max(1, Math.min(30, 30 - d + 1)),
      source: "PERSONAL",
    });
  }

  if (end && end >= pStart && end <= pEnd) {
    const d = Number(end.slice(8, 10));
    novelties.push({
      novelty_type: "FECHA_RETIRO",
      start_date: end,
      end_date: end,
      days: Math.max(1, Math.min(30, d)),
      source: "PERSONAL",
    });
  }

  return novelties;
}

function payrollInclusionStatus(employee, periodStart, periodEnd) {
  const end = getEmployeeLaborEndDate(employee);
  if (end && end >= dateOnly(periodStart) && end <= dateOnly(periodEnd)) {
    return "RETIRADA_EN_PERIODO";
  }
  return employeeAppliesToPayrollPeriod(employee, periodStart, periodEnd) ? "INCLUIDA" : "EXCLUIDA";
}

module.exports = {
  dateOnly,
  getEmployeeLaborStartDate,
  getEmployeeLaborEndDate,
  employeeAppliesToPayrollPeriod,
  calculatePayrollWorkedDays,
  laborDateNoveltiesForPeriod,
  payrollInclusionStatus,
};
