import { route, dbError } from "@/lib/server/api";
import { requireAdmin } from "@/lib/operations/admin";
import { adminClient } from "@/lib/server/admin";
export async function GET() {
  return route(async () => {
    await requireAdmin();
    const db = adminClient();
    const [metrics, errors, failures, audit] = await Promise.all([
      db.rpc("admin_metrics"),
      db
        .from("api_errors")
        .select("id,service,user_id,error_category,error_code,message,request_id,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("billing_events")
        .select("id,event_type,status,plan_id,created_at")
        .in("event_type", ["invoice.payment_failed", "payment.failed"])
        .order("created_at", { ascending: false })
        .limit(30),
      db
        .from("audit_logs")
        .select("id,action,resource_type,resource_id,metadata,created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    for (const item of [metrics, errors, failures, audit]) dbError(item.error);
    return {
      metrics: metrics.data,
      errors: (errors.data??[]).map(row=>({timestamp:row.created_at,service:row.service,request_id:row.request_id,user_id:row.user_id,error_category:row.error_category??row.error_code,safe_message:row.message})),
      failures: failures.data,
      audit: audit.data,
    };
  });
}
