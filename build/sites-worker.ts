import handler from "vinext/server/fetch-handler";
import {
  createSecurityContext,
  secureResponse,
} from "../app/lib/http-security";

const worker = {
  async fetch(...args: Parameters<typeof handler.fetch>) {
    const originalRequest = args[0];
    const context = createSecurityContext(originalRequest);
    args[0] = context.request;
    return secureResponse(
      originalRequest,
      await handler.fetch(...args),
      context.policy,
    );
  },
};

export default worker;
