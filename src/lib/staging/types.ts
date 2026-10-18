export const services = [
  "Supabase",
  "OpenAI",
  "Gemini",
  "Naver",
  "Threads",
  "Payment",
  "Cron",
] as const;
export type StagingService = (typeof services)[number];
export type ResultStatus = "PASS" | "FAIL" | "NOT CONFIGURED";
export type CheckResult = {
  id?: string;
  test_name: string;
  service: StagingService;
  status: ResultStatus;
  safe_message: string;
  request_id: string;
  created_at?: string;
  latency_ms?: number;
  error_category?: string;
  details: Record<string, unknown>;
};
export type ServiceState =
  "Not configured" | "Configured" | "Connection success" | "Connection failed";
export type Checklist = {
  environment: string;
  enabled: boolean;
  services: {
    name: StagingService;
    state: ServiceState;
    missing: string[];
    last?: CheckResult;
  }[];
  results: CheckResult[];
  accounts: { user_id: string; label: string }[];
  brands: { id: string; brand_name: string }[];
  publications: {
    id: string;
    status: string;
    provider_post_id: string | null;
    published_at: string | null;
    scheduled_at: string | null;
    retry_count: number;
    uncertain: boolean;
    error_message: string | null;
    username: string | null;
    history?: { status: string; created_at: string }[];
  }[];
  overrides: { user_id: string; expires_at: string }[];
  errors: {
    timestamp: string;
    service: string;
    request_id: string | null;
    user_id: string;
    error_category: string;
    safe_message: string;
  }[];
};
