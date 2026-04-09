const {
  handleTrainings,
  handleTrainingAttendance,
} = require("./trainings.controller");

async function handleTrainingsRoutes(req, res, url) {
  if (url.pathname === "/trainings") {
    handleTrainings(req, res, url);
    return true;
  }

  if (url.pathname === "/training-attendance") {
    handleTrainingAttendance(req, res, url);
    return true;
  }

  return false;
}

module.exports = {
  handleTrainingsRoutes,
};