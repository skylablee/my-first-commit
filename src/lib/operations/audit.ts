import "server-only";
import { adminClient } from "../server/admin";
import { logError } from "./logger";
export async function audit(
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string | null = null,
  metadata: Record<string, string | number | boolean> = {},
) {
  // Allowlist safe fields; never store free-form upstream payloads or credentials.
  const safe = Object.fromEntries(
    Object.entries(metadata).filter(([k]) =>
      ["plan", "provider", "status", "mock", "request_id"].includes(k),
    ),
  );
  try {
    const { error } = await adminClient().from("audit_logs").insert({
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata: safe,
    });
    if (error) logError("database", "AUDIT_WRITE_FAILED");
  } catch {
    logError("database", "AUDIT_WRITE_FAILED");
  }
}
