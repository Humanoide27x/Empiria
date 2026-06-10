const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "payroll_config.json");

const DEFAULT_CONFIG = {
  // Valores Colombia 2026
  smlmv: 1750905,
  transportAllowance: 249095,
  maxTransportSalarySmlmv: 2,
  healthDeductionPct: 0.04,
  pensionDeductionPct: 0.04,
  // Salario por categoría (fuente de verdad = Calculadora de Salario / contract_settings.salary_config)
  modalitySalaries: {
    CAA1:    1750905,            // TC externo: 1 SMLV
    CAA2:    875452,             // MT externo: 0.5 SMLV
    CAARES1: 1750905,            // TC residencia (único): 1 SMLV
    CAARES2: 875452,             // MT asociado a CAARES1: 0.5 SMLV
    CAARES3: 1750905,            // TC residencia (múltiple): 1 SMLV
    CAARES4: 875452,             // MT asociado a CAARES3: 0.5 SMLV
    RI:      1750905,            // Ración industrializada: 1 SMLV
  },
  updatedAt: null,
};

let _payrollConfigCache = null;
let _payrollConfigCacheAt = 0;
const PAYROLL_CONFIG_TTL_MS = 5 * 60 * 1000;

function getPayrollConfig() {
  const now = Date.now();
  if (_payrollConfigCache && (now - _payrollConfigCacheAt) < PAYROLL_CONFIG_TTL_MS) {
    return _payrollConfigCache;
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    _payrollConfigCache = { ...DEFAULT_CONFIG };
    _payrollConfigCacheAt = now;
    return _payrollConfigCache;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw);
    _payrollConfigCache = {
      ...DEFAULT_CONFIG,
      ...saved,
      modalitySalaries: { ...DEFAULT_CONFIG.modalitySalaries, ...(saved.modalitySalaries || {}) },
    };
    _payrollConfigCacheAt = now;
    return _payrollConfigCache;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function updatePayrollConfig(updates) {
  const current = getPayrollConfig();
  const updated = {
    ...current,
    ...updates,
    modalitySalaries: { ...current.modalitySalaries, ...(updates.modalitySalaries || {}) },
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  _payrollConfigCache = updated;
  _payrollConfigCacheAt = Date.now();
  return updated;
}

module.exports = { getPayrollConfig, updatePayrollConfig, DEFAULT_CONFIG };
