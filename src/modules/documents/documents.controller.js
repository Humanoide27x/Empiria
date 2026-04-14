const { sendJson } = require("../../http/response");
const { protectedHandler } = require("../../http/protection");
const {
  getVisibleResumeRecords,
} = require("../../data/personnel");

function handleResumeView(req, res) {
  return protectedHandler(req, res, ["documents.view"], async (user) => {
    const records = getVisibleResumeRecords(user);
    return sendJson(res, 200, { data: records });
  });
}

module.exports = {
  handleResumeView,
};