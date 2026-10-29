import type { AccountPolicy } from "./access-types";
import { WorkspaceError } from "./workspace-model";
import {
  resolveAccountConfiguration,
  ReleaseConfigurationError,
} from "./release-config";
import type { ReleaseEnvironment } from "./release-config";
export { isLoopback } from "./release-config";

export type AccountEnvironment = ReleaseEnvironment;

export interface RuntimeAccountPolicy {
  origin: string;
  approvedEmails: ReadonlySet<string>;
  public: AccountPolicy;
}

/** Configuration is authoritative; a request header can never enable guest access. */
export function accountPolicy(
  configuration: AccountEnvironment,
  requestURL: string,
): RuntimeAccountPolicy {
  try {
    return resolveAccountConfiguration(configuration, requestURL);
  } catch (error) {
    if (error instanceof ReleaseConfigurationError)
      throw new WorkspaceError(error.message, error.status);
    throw error;
  }
}

export function emailApproved(
  policy: RuntimeAccountPolicy,
  email: string,
): boolean {
  return (
    policy.public.mode === "local" ||
    policy.approvedEmails.has(email.toLowerCase())
  );
}

/** Recovery links may return only to this app, never to an external callback. */
export function accountCallback(
  value: unknown,
  origin: string,
  kind: "reset" | "verified",
): string {
  const expected = `${origin}/?account=${kind}`;
  if (value === undefined || value === "") return expected;
  if (typeof value !== "string" || value !== expected)
    throw new WorkspaceError(
      "Use the account recovery link from this application.",
      400,
    );
  return expected;
}
