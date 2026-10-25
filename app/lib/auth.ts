import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { authOptions } from "./auth-options";
import type { AccountUser } from "./access-types";
import authSQL from "../../db/auth.sql?raw";
import workspaceSQL from "../../drizzle/0000_dear_mimic.sql?raw";
import accessSQL from "../../db/access.sql?raw";
import workroomSQL from "../../db/workrooms.sql?raw";
import reliabilitySQL from "../../db/reliability.sql?raw";
import collaborationSQL from "../../db/collaboration.sql?raw";
import noteCollaborationSQL from "../../db/note-collaboration.sql?raw";

let schemaReady: Promise<unknown> | undefined;
const instances = new Map<string, ReturnType<typeof betterAuth>>();
export async function getAuth(request: Request) {
  if (!env.DB) throw new Error("Account storage is unavailable.");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error(
      "Run the local launcher to initialize the account signing secret.",
    );
  schemaReady ??= env.DB.batch(
    (
      workspaceSQL.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ") +
      "\n" +
      authSQL +
      "\n" +
      accessSQL +
      "\n" +
      workroomSQL +
      "\n" +
      reliabilitySQL +
      "\n" +
      collaborationSQL +
      "\n" +
      noteCollaborationSQL
    )
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((sql) => sql.trim())
      .filter((sql) => sql && !/^--[^\n]*$/.test(sql))
      .map((sql) => env.DB!.prepare(sql)),
  ).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  await schemaReady;
  const configured = new URL(env.BETTER_AUTH_URL || "http://127.0.0.1:5173")
    .origin;
  const requested = new URL(request.url).origin;
  const baseURL =
    !env.BETTER_AUTH_URL &&
    ["http://127.0.0.1:5173", "http://localhost:5173"].includes(requested)
      ? requested
      : configured;
  let auth = instances.get(baseURL);
  if (!auth) {
    auth = betterAuth(authOptions(env.DB, env.BETTER_AUTH_SECRET, baseURL));
    instances.set(baseURL, auth);
  }
  return auth;
}
export async function getSessionUser(
  request: Request,
): Promise<AccountUser | null> {
  const auth = await getAuth(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const user = session.user as typeof session.user & { username?: string };
  return {
    id: user.id,
    username: user.username || user.name,
    name: user.username || user.name,
    email: user.email,
  };
}
