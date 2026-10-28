import handler from "vinext/server/fetch-handler";
import { secureResponse } from "../app/lib/http-security";

const worker = {
  async fetch(...args: Parameters<typeof handler.fetch>) {
    return secureResponse(args[0], await handler.fetch(...args));
  },
};

export default worker;
