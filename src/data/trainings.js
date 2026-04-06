const { readCollection, writeCollection } = require("./store");

const TRAININGS_FILE = "trainings.json";
const ATTENDANCE_FILE = "training-attendance.json";

function getTrainings() {
  return readCollection(TRAININGS_FILE);
}

function saveTrainings(trainings) {
  return writeCollection(TRAININGS_FILE, trainings);
}

function getAttendance() {
  return readCollection(ATTENDANCE_FILE);
}

function saveAttendance(attendance) {
  return writeCollection(ATTENDANCE_FILE, attendance);
}

function getNextTrainingId(trainings) {
  const ids = trainings.map((item) => item.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function createTraining(payload) {
  if (
    !payload.title ||
    !payload.date ||
    !payload.municipality ||
    !payload.companyId ||
    !payload.contractId
  ) {
    throw new Error("Faltan datos obligatorios de la capacitacion");
  }

  const trainings = getTrainings();
  const record = {
    id: getNextTrainingId(trainings),
    title: payload.title,
    date: payload.date,
    municipality: payload.municipality,
    site: payload.site || "",
    institution: payload.institution || "",
    modality: payload.modality || "",
    companyId: Number(payload.companyId),
    contractId: Number(payload.contractId),
    status: payload.status || "programada",
    createdByRole: payload.createdByRole || "administrador",
  };

  trainings.push(record);
  saveTrainings(trainings);

  return record;
}

function markAttendance(payload) {
  if (!payload.trainingId || !payload.personnelId || !payload.status) {
    throw new Error("Faltan datos para marcar asistencia");
  }

  const attendance = getAttendance();
  const index = attendance.findIndex(
    (item) =>
      item.trainingId === Number(payload.trainingId) &&
      item.personnelId === Number(payload.personnelId),
  );

  const record = {
    trainingId: Number(payload.trainingId),
    personnelId: Number(payload.personnelId),
    status: payload.status,
    markedByRole: payload.markedByRole || "administrador",
    markedAt: new Date().toISOString(),
  };

  if (index >= 0) {
    attendance[index] = record;
  } else {
    attendance.push(record);
  }

  saveAttendance(attendance);
  return record;
}

module.exports = {
  createTraining,
  getAttendance,
  getTrainings,
  markAttendance,
};
