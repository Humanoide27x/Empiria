"use strict";

function calculatePayrollDeductionBase(salaryBase) {
  return Math.ceil((Number(salaryBase || 0) * 0.04) / 100) * 100;
}

module.exports = {
  calculatePayrollDeductionBase,
};
