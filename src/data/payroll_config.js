const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "payroll_config.json");

const DEFAULT_CONFIG = {
  // Colombian 2025 values
  smlmv: 1423500,
  transportAllowance: 202050,
  maxTransportSalarySmlmv: 2,
  healthDeductionPct: 0.04,
  pensionDeductionPct: 0.04,
  // Salary per modality classification
  modalitySalaries: {
    CAARES1: 1423500,
    CAARES2: 1423500,
    CAARES3: 1423500,
    CAARES4: 1423500,
    CAA1: 1423500,
    CAA2: 711750,
    RI: 1423500,
  },
  updatedAt: null,
};

function getPayrollConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      modalitySalaries: { ...DEFAULT_CONFIG.modalitySalaries, ...(saved.modalitySalaries || {}) },
    };
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
  return updated;
}

module.exports = { getPayrollConfig, updatePayrollConfig, DEFAULT_CONFIG };
