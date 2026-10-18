import "server-only";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
import { appEnvironment } from "../environment";
import { serviceConfiguration } from "./config";
import { stagingEnabled } from "./safety";
import type { CheckResult, Checklist, ServiceState } from "./types";
export async function checklist(adminId: string): Promise<Checklist> {
  const db = adminClient();
  const [checks, accounts, brands, resources, overrides, errors] =
    await Promise.all([
      db
        .from("staging_checks")
        .select(
          "id,test_name,service,status,safe_message,request_id,latency_ms,error_category,details,created_at",
        )
        .eq("admin_id", adminId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("staging_accounts")
        .select("user_id,label")
        .eq("admin_id", adminId)
        .order("label"),
      db
        .from("brands")
        .select("id,brand_name")
        .eq("user_id", adminId)
        .order("created_at"),
      db
        .from("staging_resources")
        .select("resource_id")
        .eq("admin_id", adminId)
        .in("kind", ["threads_job", "threads_schedule_job"]),
      db
        .from("staging_usage_overrides")
        .select("user_id,expires_at")
        .eq("admin_id", adminId),
      db
        .from("api_errors")
        .select(
          "created_at,service,request_id,user_id,error_category,message,error_code",
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
  for (const r of [checks, accounts, brands, resources, overrides, errors])
    dbError(r.error);
  const results = (checks.data ?? []) as CheckResult[],
    ids = (resources.data ?? []).map((r) => r.resource_id);
  let publications: Checklist["publications"] = [];
  if (ids.length) {
    const jobs = await db
      .from("publications")
      .select(
        "id,status,provider_post_id,published_at,scheduled_at,retry_count,uncertain,error_message,username",
      )
      .eq("user_id", adminId)
      .in("id", ids)
      .order("created_at", { ascending: false })
      .limit(30);
    dbError(jobs.error);
    publications = jobs.data ?? [];
  }
  return {
    environment: appEnvironment(),
    enabled: stagingEnabled(),
    services: serviceConfiguration().map((c) => {
      const last = results.find(
        (r) => r.service === c.name && r.test_name === "connect",
      );
      let state: ServiceState = c.missing.length
        ? "Not configured"
        : "Configured";
      if (!c.missing.length && last?.details.api_called === true)
        state =
          last.status === "PASS"
            ? "Connection success"
            : last.status === "FAIL"
              ? "Connection failed"
              : "Configured";
      return { name: c.name, missing: c.missing, state, last };
    }),
    results,
    accounts: accounts.data ?? [],
    brands: brands.data ?? [],
    publications,
    overrides: overrides.data ?? [],
    errors: (errors.data ?? []).map((r) => ({
      timestamp: r.created_at,
      service: r.service,
      request_id: r.request_id,
      user_id: r.user_id,
      error_category: r.error_category ?? r.error_code,
      safe_message: r.message,
    })),
  };
}
