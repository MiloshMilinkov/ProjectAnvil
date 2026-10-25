const assert = require("node:assert/strict");
const startupKeys = require("./compiled/app/lib/note-collaboration-draft-keys");
assert.equal(
  require.cache[require.resolve("yjs")],
  undefined,
  "Ordinary note startup and draft-key checks must not eagerly evaluate Yjs during server rendering",
);
assert.equal(
  startupKeys.sharedNoteDraftKey("startup-note", "startup-tab"),
  "startup-note:startup-tab",
);
const Y = require("yjs");
const {
  createTextDocument,
  documentText,
  serializedDocument,
  decodeDocumentUpdate,
  encodeDocumentUpdate,
  replaceCollaborativeText,
  parseCollaborativeDraft,
} = require("./compiled/app/lib/note-collaboration");

const base = createTextDocument("A shared plan\nNext steps\n");
const alice = new Y.Doc(),
  bob = new Y.Doc();
const bootstrap = Y.encodeStateAsUpdate(base);
Y.applyUpdate(alice, bootstrap);
Y.applyUpdate(bob, bootstrap);
replaceCollaborativeText(alice, "Alice: A shared plan\nNext steps\n");
replaceCollaborativeText(bob, "A shared plan\nNext steps\nBob: Review\n");
const aUpdate = Y.encodeStateAsUpdate(alice, Y.encodeStateVector(base));
const bUpdate = Y.encodeStateAsUpdate(bob, Y.encodeStateVector(base));
Y.applyUpdate(alice, bUpdate);
Y.applyUpdate(bob, aUpdate);
assert.equal(documentText(alice), documentText(bob));
assert.match(documentText(alice), /Alice: A shared plan/);
assert.match(documentText(alice), /Bob: Review/);
const synchronized = documentText(alice);
Y.applyUpdate(alice, aUpdate);
Y.applyUpdate(alice, bUpdate);
assert.equal(
  documentText(alice),
  synchronized,
  "Duplicate retries are idempotent",
);

const reconnect = new Y.Doc();
Y.applyUpdate(reconnect, decodeDocumentUpdate(serializedDocument(bob)));
replaceCollaborativeText(
  reconnect,
  `${documentText(reconnect)}Offline addition\n`,
);
replaceCollaborativeText(alice, `Live addition\n${documentText(alice)}`);
const reconnectUpdate = Y.encodeStateAsUpdate(reconnect);
Y.applyUpdate(alice, reconnectUpdate);
Y.applyUpdate(reconnect, Y.encodeStateAsUpdate(alice));
assert.equal(documentText(alice), documentText(reconnect));
assert.match(documentText(reconnect), /Offline addition/);
assert.match(documentText(reconnect), /Live addition/);

const deleteBase = createTextDocument("abcdef"),
  left = new Y.Doc(),
  right = new Y.Doc();
Y.applyUpdate(left, Y.encodeStateAsUpdate(deleteBase));
Y.applyUpdate(right, Y.encodeStateAsUpdate(deleteBase));
left.getText("content").delete(1, 2);
right.getText("content").delete(2, 3);
left.getText("content").insert(1, "LEFT");
right.getText("content").insert(2, "RIGHT");
const leftChange = Y.encodeStateAsUpdate(left),
  rightChange = Y.encodeStateAsUpdate(right);
Y.applyUpdate(left, rightChange);
Y.applyUpdate(right, leftChange);
assert.equal(documentText(left), documentText(right));
assert.match(documentText(left), /LEFT/);
assert.match(documentText(left), /RIGHT/);

const emoji = createTextDocument("Hi 😊 🌍!");
replaceCollaborativeText(emoji, "Hi 😎 🌍!");
assert.equal(documentText(emoji), "Hi 😎 🌍!");
replaceCollaborativeText(emoji, "Hi 😎!");
assert.equal(documentText(emoji), "Hi 😎!");
assert.throws(() => replaceCollaborativeText(emoji, "\ud800"), /Unicode/);
assert.throws(() => createTextDocument("\udc00"), /Unicode/);
assert.throws(() => createTextDocument("x".repeat(100001)), /100,000/);

const draft = {
  generation: "session-one",
  update: serializedDocument(reconnect),
  content: documentText(reconnect),
};
assert.deepEqual(parseCollaborativeDraft(draft), draft);
assert.equal(parseCollaborativeDraft({ ...draft, content: "tampered" }), null);
assert.equal(parseCollaborativeDraft({ ...draft, update: "malformed" }), null);
assert.equal(
  parseCollaborativeDraft({ ...draft, generation: "../foreign" }),
  null,
);
assert.throws(() => decodeDocumentUpdate("AA=A"), /invalid/);
assert.throws(
  () => decodeDocumentUpdate(encodeDocumentUpdate(new Uint8Array(1_000_001))),
  /large/,
);
const foreign = new Y.Doc();
foreign.getMap("other").set("secret", "not Markdown");
assert.throws(() => serializedDocument(foreign), /only contain note text/);
const rich = createTextDocument("text");
rich.getText("content").format(0, 4, { bold: true });
assert.throws(() => serializedDocument(rich), /plain Markdown/);

for (const doc of [
  base,
  alice,
  bob,
  reconnect,
  emoji,
  foreign,
  rich,
  deleteBase,
  left,
  right,
])
  doc.destroy();

// Isolated fake browser storage: shared editors must never replace each other's key.
class MemoryStorage {
  values = new Map();
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}
global.window = {
  localStorage: new MemoryStorage(),
  addEventListener() {},
  removeEventListener() {},
};
const {
  writeDraft,
  readDraft,
  listDrafts,
} = require("./compiled/app/lib/draft-store");
const {
  sharedNoteDraftKey,
  sharedNoteDrafts,
  mergeSharedNoteDrafts,
  acknowledgeSharedNoteDrafts,
} = require("./compiled/app/lib/note-collaboration-drafts");
const scope = { accountId: "coedit-account", workspaceId: "coedit-workspace" };
const otherScope = { ...scope, workspaceId: "other-workspace" };
const seed = createTextDocument("Base\n"),
  one = new Y.Doc(),
  two = new Y.Doc(),
  server = new Y.Doc();
for (const doc of [one, two, server])
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
replaceCollaborativeText(one, "First tab\nBase\n");
replaceCollaborativeText(two, "Base\nSecond tab\n");
const value = (doc) => ({
  noteId: "shared",
  generation: "same-session",
  content: documentText(doc),
  update: serializedDocument(doc),
});
const keyOne = sharedNoteDraftKey("shared", "tab-one"),
  keyTwo = sharedNoteDraftKey("shared", "tab-two");
assert.notEqual(keyOne, keyTwo);
const firstWrite = writeDraft(scope, "shared-notes", keyOne, value(one), null);
const secondWrite = writeDraft(scope, "shared-notes", keyTwo, value(two), null);
const earlier = createTextDocument("Earlier replacement");
writeDraft(
  scope,
  "shared-notes",
  sharedNoteDraftKey("shared", "earlier-tab"),
  { ...value(earlier), generation: "earlier-session" },
  null,
);
writeDraft(otherScope, "shared-notes", keyOne, value(one), null);
writeDraft(
  scope,
  "shared-notes",
  sharedNoteDraftKey("other-note", "other-tab"),
  { ...value(one), noteId: "other-note" },
  null,
);
const records = sharedNoteDrafts(scope, "shared");
assert.equal(records.length, 3);
const captured = mergeSharedNoteDrafts(server, records, "same-session");
assert.equal(captured.length, 2);
assert.match(documentText(server), /First tab/);
assert.match(documentText(server), /Second tab/);
assert.doesNotMatch(documentText(server), /Earlier replacement/);
assert.equal(
  listDrafts(scope, "recovery-copies").length,
  0,
  "Coediting per-tab drafts must not generate replacement warnings",
);
replaceCollaborativeText(two, `${documentText(two)}Newer unsent edit\n`);
const newer = writeDraft(scope, "shared-notes", keyTwo, value(two), null);
acknowledgeSharedNoteDrafts(scope, captured);
assert.equal(readDraft(scope, "shared-notes", keyOne), null);
assert.equal(
  readDraft(scope, "shared-notes", keyTwo).token,
  newer.record.token,
  "An acknowledgement must preserve newer edits in another active tab",
);
assert(
  readDraft(otherScope, "shared-notes", keyOne),
  "Other workspaces remain untouched",
);
assert.equal(
  sharedNoteDrafts(scope, "shared").filter(
    (item) => item.record.value.generation === "earlier-session",
  ).length,
  1,
  "Stale generations remain available for review",
);
const after = mergeSharedNoteDrafts(
  server,
  sharedNoteDrafts(scope, "shared"),
  "same-session",
);
assert.match(documentText(server), /Newer unsent edit/);
acknowledgeSharedNoteDrafts(scope, after);
assert.equal(readDraft(scope, "shared-notes", keyTwo), null);
const legacy = { ...value(one) };
delete legacy.noteId;
writeDraft(scope, "shared-notes", "shared", legacy, null);
assert(
  sharedNoteDrafts(scope, "shared").some((item) => item.id === "shared"),
  "Earlier per-note draft keys stay recoverable during migration",
);
assert.throws(() => sharedNoteDraftKey("../invalid", "tab"), /valid/);
assert.notEqual(firstWrite.record.token, secondWrite.record.token);
assert.equal(listDrafts(scope, "recovery-copies").length, 0);
for (const doc of [seed, one, two, server, earlier]) doc.destroy();
delete global.window;
console.log(
  "PASS: concurrent Markdown convergence, retries/reconnects, Unicode deltas, bounded updates, plain text, per-tab draft merging without false recovery copies, safe acknowledgement of newer edits, stale generations, and legacy draft migration.",
);
