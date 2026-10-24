const assert = require("node:assert/strict");
const {
  parseBrainstormDraft,
  isBrainstormBoard,
  rankedIdeas,
  discardBrainstormDraft,
} = require("./compiled/app/lib/brainstorm-drafts");
const { readDraft, writeDraft } = require("./compiled/app/lib/draft-store");

const board = {
  id: "board",
  title: "",
  description: "",
  projectId: "",
  groups: [{ id: "group", title: "" }],
  votingOpen: true,
  createdAt: "2026-10-24T12:00:00.000Z",
  updatedAt: "2026-10-24T12:00:00.000Z",
  ideas: [
    {
      id: "one",
      title: "First",
      description: "",
      groupId: "group",
      noteId: "",
      taskId: "",
      votes: [],
    },
    {
      id: "two",
      title: "Second",
      description: "",
      groupId: "",
      noteId: "",
      taskId: "",
      votes: ["guest"],
    },
    {
      id: "three",
      title: "Third",
      description: "",
      groupId: "",
      noteId: "",
      taskId: "",
      votes: ["account_member"],
    },
  ],
};
assert.equal(
  isBrainstormBoard(board),
  true,
  "Incomplete names are recoverable drafts",
);
assert.deepEqual(parseBrainstormDraft({ board, operationIds: ["operation"] }), {
  board,
  operationIds: ["operation"],
});
assert.equal(
  parseBrainstormDraft({
    board: { ...board, ideas: [...board.ideas, board.ideas[0]] },
    operationIds: [],
  }),
  null,
);
assert.equal(
  isBrainstormBoard({
    ...board,
    groups: Array.from({ length: 31 }, (_, n) => ({
      id: `group_${n}`,
      title: "",
    })),
  }),
  false,
);
assert.equal(
  isBrainstormBoard({
    ...board,
    ideas: [{ ...board.ideas[0], votes: ["guest", "guest"] }],
  }),
  false,
);
assert.equal(parseBrainstormDraft({ board, operationIds: [null] }), null);
assert.deepEqual(
  rankedIdeas(board, true).map((idea) => idea.id),
  ["two", "three", "one"],
);
assert.deepEqual(
  board.ideas.map((idea) => idea.id),
  ["one", "two", "three"],
  "Ranking does not mutate original order",
);
assert.equal(rankedIdeas(board, false), board.ideas);

const scope = { accountId: "brainstorm_test", workspaceId: "workspace" };
const otherScope = { ...scope, workspaceId: "other_workspace" };
const save = {
  action: "upsert",
  entity: "brainstorms",
  item: { id: board.id, title: "Edited" },
  operationId: "captured",
};
writeDraft(scope, "mutations", "captured", save, null);
writeDraft(
  scope,
  "mutations",
  "unrelated",
  { ...save, operationId: "unrelated" },
  null,
);
writeDraft(
  scope,
  "mutations",
  "other_board",
  { ...save, item: { id: "other" }, operationId: "other_board" },
  null,
);
writeDraft(otherScope, "mutations", "captured", save, null);
const form = writeDraft(
  scope,
  "brainstorm-forms",
  board.id,
  { board, operationIds: ["captured"] },
  board,
);
discardBrainstormDraft(
  scope,
  board.id,
  board.id,
  ["captured", "other_board"],
  form.record.token,
);
assert.equal(readDraft(scope, "brainstorm-forms", board.id), null);
assert.equal(readDraft(scope, "mutations", "captured"), null);
assert.ok(
  readDraft(scope, "mutations", "unrelated"),
  "Uncaptured board writes survive discard",
);
assert.ok(
  readDraft(scope, "mutations", "other_board"),
  "Different board writes survive discard",
);
assert.ok(
  readDraft(otherScope, "mutations", "captured"),
  "Other workspace writes survive discard",
);
console.log(
  "PASS: brainstorming recovery validation, bounded groups/votes, stable ranking, and scoped failed-operation cancellation.",
);
