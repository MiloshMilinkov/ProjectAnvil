import { uid, type Mutation, type Mutate, type Notify } from "./types";
import type { DraftScope } from "./draft-store";
import { recoverPendingOperation } from "./editor-mutations";

/** The delete receipt is also the recovery token, including after a lost reply. */
export async function moveToTrash(
  mutate: Mutate,
  notify: Notify,
  input: Pick<Mutation, "entity" | "id" | "base">,
  label: string,
  scope: DraftScope,
) {
  const intent: Mutation = { ...input, action: "delete" };
  const deletion = recoverPendingOperation(scope, intent);
  deletion.operationId ||= uid();
  const workspace = await mutate(deletion);
  notify(`${label} moved to Trash`, { undoId: deletion.operationId });
  return workspace;
}
