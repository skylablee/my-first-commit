import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
export const requestContext = new AsyncLocalStorage<{
  requestId: string;
  userId?: string;
}>();
export type Category =
  "auth" | "database" | "AI" | "news" | "threads" | "billing" | "scheduler";
// Deliberately no error object, headers, URLs, token, SQL or arbitrary metadata.
export function logError(
  category: Category,
  code: string,
  requestId: string = requestContext.getStore()?.requestId ?? randomUUID(),
) {
  console.error(
    JSON.stringify({
      level: "error",
      category,
      code: code.replace(/[^A-Z0-9_]/g, "").slice(0, 80),
      request_id: requestId,
      time: new Date().toISOString(),
    }),
  );
  return requestId;
}
