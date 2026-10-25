import assert from "node:assert/strict";
import { applyPostAction, draftCopy, undoPostAction, POST_UNDO_LIFETIME } from "../src/post-actions.js";

const now = "2026-10-23T12:00:00.000Z";
const media = { id: "media-1", name: "studio.jpg", type: "image/jpeg" };
const queue = { id: "queue", text: "Studio update", status: "scheduled", scheduleAt: "2026-10-24T12:00:00Z", attachments: [media], channels: [0], createdAt: now };
const sent = { ...queue, id: "sent", status: "published", publishResults: [{ provider: "instagram", status: "published", remoteId: "remote-1" }] };
const processing = { ...queue, id: "processing", status: "publishing" };
const records = [queue, sent, processing];
const checks = [];
const check = (name, run) => { run(); checks.push(name); console.log(`PASS ${name}`); };

check("Draft copies retain content and media while clearing publishing and schedule state", () => {
  const copy = draftCopy(sent, now, "copy");
  assert.equal(copy.status, "draft");
  assert.deepEqual(copy.publishResults, []);
  assert.equal(copy.scheduleAt, null);
  assert.equal(copy.dateTimeSet, false);
  assert.deepEqual(copy.attachments, [media]);
  assert.deepEqual(copy.channels, [0]);
  assert.equal(sent.publishResults[0].remoteId, "remote-1");
});

check("Bulk actions affect only requested, eligible posts", () => {
  const result = applyPostAction(records, ["queue", "sent", "processing"], "draft", { now });
  assert.equal(result.records.find(record => record.id === "queue").status, "draft");
  assert.equal(result.records.find(record => record.id === "sent"), sent);
  assert.equal(result.records.find(record => record.id === "processing"), processing);
  assert.equal(result.undo.expiresAt, Date.parse(now) + POST_UNDO_LIFETIME);
  assert.deepEqual(result.undo.before, [queue]);
});

check("Deleting and undoing preserves media and unrelated new posts", () => {
  const result = applyPostAction(records, ["queue"], "delete", { now });
  const extra = { id: "later", text: "New draft", status: "draft" };
  const restored = undoPostAction([...result.records, extra], result.undo);
  assert.deepEqual(restored.find(record => record.id === "queue"), queue);
  assert.equal(restored.find(record => record.id === "later"), extra);
});

check("Undo keeps edits made after moving a post", () => {
  const result = applyPostAction(records, ["queue"], "draft", { now });
  const edited = result.records.map(record => record.id === "queue" ? { ...record, text: "Newer edit" } : record);
  assert.equal(undoPostAction(edited, result.undo).find(record => record.id === "queue").text, "Newer edit");
  assert.deepEqual(undoPostAction(result.records, result.undo).find(record => record.id === "queue"), queue);
});

check("Undo preserves concurrent media and per-channel result edits", () => {
  const result = applyPostAction(records, ["queue"], "draft", { now });
  const laterEdit = { ...result.records.find(record => record.id === "queue"), attachments: [{ ...media, id: "new-media", name: "newer.jpg" }], publishResults: [{ provider: "instagram", status: "failed", error: "Newer provider result" }] };
  const current = result.records.map(record => record.id === "queue" ? laterEdit : record);
  assert.deepEqual(undoPostAction(current, result.undo).find(record => record.id === "queue"), laterEdit);
});

check("Undo duplicate removes only the unchanged copies", () => {
  const result = applyPostAction(records, ["sent"], "duplicate", { now, makeId: () => "copy" });
  assert.equal(result.records.length, 4);
  assert.equal(undoPostAction(result.records, result.undo).length, 3);
  const edited = result.records.map(record => record.id === "copy" ? { ...record, text: "Keep this edit" } : record);
  assert.equal(undoPostAction(edited, result.undo).find(record => record.id === "copy").text, "Keep this edit");
});

check("Unsupported actions, empty selections, and processing deletions change nothing", () => {
  assert.equal(applyPostAction(records, ["queue"], "publish"), null);
  assert.equal(applyPostAction(records, [], "delete"), null);
  assert.equal(applyPostAction(records, ["processing"], "delete"), null);
});

console.log(`SUCCESS ${checks.length} post action checks`);
