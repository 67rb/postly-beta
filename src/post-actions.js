export const POST_UNDO_LIFETIME = 5 * 60 * 1000;

export function draftCopy(record, now, id) {
  return { ...record, id, status: "draft", publishResults: [], scheduleAt: null, selectedTime: "", dateTimeSet: false, scheduleMode: "Next Available", summary: "Saved draft", createdAt: now, updatedAt: now };
}

export function applyPostAction(records, ids, action, { now = new Date().toISOString(), makeId = () => crypto.randomUUID() } = {}) {
  const chosen = new Set(ids);
  const selected = records.filter(record => chosen.has(record.id) && (action === "duplicate" || record.status !== "publishing") && (action !== "draft" || record.status === "scheduled"));
  if (!selected.length || !["delete", "duplicate", "draft"].includes(action)) return null;
  let before = selected, after = [];
  if (action === "duplicate") {
    before = [];
    after = selected.map(record => draftCopy(record, now, makeId()));
  }
  if (action === "draft") after = selected.map(record => ({ ...record, status: "draft", scheduleAt: null, selectedTime: "", dateTimeSet: false, scheduleMode: "Next Available", publishResults: [], summary: "Saved draft", updatedAt: now }));
  const affected = new Set(before.map(record => record.id));
  const nextRecords = [...after, ...records.filter(record => !affected.has(record.id))];
  const noun = selected.length === 1 ? "post" : "posts";
  const message = action === "delete" ? `Deleted ${selected.length} ${noun} from this workspace` : action === "draft" ? `Moved ${selected.length} ${noun} to drafts` : `Copied ${selected.length} ${noun} to drafts`;
  return { records: nextRecords, undo: { before, after, message, expiresAt: Date.parse(now) + POST_UNDO_LIFETIME } };
}

// Only reverse records that still match the action. Later edits and new posts
// must survive an Undo, including after a page reload.
export function undoPostAction(records, change) {
  const before = new Map(change.before.map(record => [record.id, record]));
  const after = new Map(change.after.map(record => [record.id, record]));
  const existing = new Set(records.map(record => record.id));
  const restored = records.flatMap(record => {
    const applied = after.get(record.id);
    if (!applied || JSON.stringify(record) !== JSON.stringify(applied)) return [record];
    return before.has(record.id) ? [before.get(record.id)] : [];
  });
  for (const record of change.before) if (!after.has(record.id) && !existing.has(record.id)) restored.push(record);
  return restored;
}
