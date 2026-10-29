import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { authOptions } from "./auth-options";
import type { AccountUser } from "./access-types";
import { accountPolicy, emailApproved } from "./account-policy";
import { deliverAccountMail } from "./account-mail";
import { ensureDatabaseSchema } from "./database-migrations";
import authSQL from "../../db/auth.sql?raw";
import workspaceSQL from "../../drizzle/0000_dear_mimic.sql?raw";
import accessSQL from "../../db/access.sql?raw";
import workroomSQL from "../../db/workrooms.sql?raw";
import reliabilitySQL from "../../db/reliability.sql?raw";
import collaborationSQL from "../../db/collaboration.sql?raw";
import noteCollaborationSQL from "../../db/note-collaboration.sql?raw";
import releaseSQL from "../../db/release.sql?raw";
import storageSQL from "../../db/storage.sql?raw";

const runtimeMigrationSQL = [
  workspaceSQL,
  authSQL,
  accessSQL,
  workroomSQL,
  reliabilitySQL,
  collaborationSQL,
  noteCollaborationSQL,
  releaseSQL,
  storageSQL,
];

/** Read-only release verification: online mode never bootstraps or applies SQL. */
export async function verifyDatabaseRelease(database: D1Database) {
  await ensureDatabaseSchema(database, "online", runtimeMigrationSQL);
}

let schemaReady: Promise<unknown> | undefined;
const instances = new Map<string, ReturnType<typeof betterAuth>>();
export async function getAuth(request: Request) {
  const policy = accountPolicy(env, request.url);
  if (!env.DB) throw new Error("Account storage is unavailable.");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error(
      policy.public.mode === "local"
        ? "Run the local launcher to initialize the account signing secret."
        : "Configure the production account signing secret before starting.",
    );
  schemaReady ??= ensureDatabaseSchema(
    env.DB,
    policy.public.mode,
    runtimeMigrationSQL,
  ).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  await schemaReady;
  const baseURL = policy.origin;
  const key = `${policy.public.mode}:${baseURL}`;
  let auth = instances.get(key);
  if (!auth) {
    const database = env.DB;
    auth = betterAuth(
      authOptions(database, env.BETTER_AUTH_SECRET, baseURL, {
        policy,
        send: (email, url, kind) =>
          deliverAccountMail(database, env, policy, { email, url, kind }),
      }),
    );
    instances.set(key, auth);
  }
  return auth;
}
export async function getSessionUser(
  request: Request,
): Promise<AccountUser | null> {
  const auth = await getAuth(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const policy = accountPolicy(env, request.url);
  if (
    policy.public.mode === "online" &&
    (!session.user.emailVerified || !emailApproved(policy, session.user.email))
  )
    return null;
  const user = session.user as typeof session.user & { username?: string };
  return {
    id: user.id,
    username: user.username || user.name,
    name: user.username || user.name,
    email: user.email,
    emailVerified: user.emailVerified,
  };
}
