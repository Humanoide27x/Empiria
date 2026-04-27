const repository = require("./drafts.repository");

async function saveDraft(payload, user) {
  const draftKey = payload.draftKey || payload.draft_key;
  const sectionKey = payload.sectionKey || payload.section_key;

  return await repository.saveDraft({
    employeeId: payload.employeeId || payload.employee_id || null,
    draftKey,
    sectionKey,
    data: payload.data || {},
    progress: Number(payload.progress || 0),
    userId: user?.id || null,
  });
}

module.exports = {
  saveDraft,
};