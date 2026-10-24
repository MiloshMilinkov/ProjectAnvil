import {
  mutatePersonalTemplate,
  readPersonalTemplates,
} from "../../lib/personal-template-store";
import { readBoundedBody } from "../../lib/request-body";
import { routeError } from "../../lib/workspace-store";
import { WorkspaceError } from "../../lib/workspace-model";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    return Response.json(
      { templates: await readPersonalTemplates(request) },
      { headers },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const bytes = await readBoundedBody(
      request,
      180_000,
      "Keep a template request below 180 KB.",
    );
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new WorkspaceError("Send a valid template request.");
    }
    return Response.json(
      { templates: await mutatePersonalTemplate(request, input) },
      { headers },
    );
  } catch (error) {
    return routeError(error);
  }
}
