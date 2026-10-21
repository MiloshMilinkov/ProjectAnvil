import { listDrafts, type DraftScope } from "./draft-store";
import type { Mutation } from "./types";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

function payload(mutation: Mutation): string {
  return JSON.stringify(
    stable(
      Object.fromEntries(
        Object.entries(mutation).filter(([key]) => key !== "operationId"),
      ),
    ),
  );
}

/** A lost response must retry the same operation, including an initial create. */
export function recoverPendingOperation(
  scope: DraftScope,
  mutation: Mutation,
): Mutation {
  if (mutation.operationId) return mutation;
  const expected = payload(mutation);
  const pending = listDrafts<Mutation>(scope, "mutations");
  const match = pending.find(({ record }) => {
    const previous = record.value;
    return (
      previous &&
      typeof previous.operationId === "string" &&
      payload(previous) === expected
    );
  });
  return match
    ? { ...mutation, operationId: match.record.value.operationId }
    : mutation;
}
