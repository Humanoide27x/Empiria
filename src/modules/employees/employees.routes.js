const { handlePersonnel } = require("./employees.controller");

function handleEmployeesRoutes(req, res) {
  if (req.url.startsWith("/personnel")) {
    handlePersonnel(req, res);
    return true;
  }

  return false;
}

module.exports = {
  handleEmployeesRoutes,
};