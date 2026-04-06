const { readCollection } = require("./store");

const RESUMES_FILE = "resumes.json";

function getResumeDocuments() {
  return readCollection(RESUMES_FILE);
}

module.exports = {
  getResumeDocuments,
};
