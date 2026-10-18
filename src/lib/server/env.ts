import "server-only";
import { getSupabaseConfig } from "../supabase/config";
import { environmentNames, validateEnvironment } from "../environment";
export function configurationStatus() {
  return {
    variables: environmentNames.map((name) => ({
      name,
      configured: Boolean(
        name === "NEXT_PUBLIC_SUPABASE_ANON_KEY"
          ? process.env[name] ||
              process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
          : process.env[name],
      ),
    })),
    supabaseReady: Boolean(getSupabaseConfig()),
    aiReady: Boolean(
      getSupabaseConfig() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      (process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY),
    ),
    validation: validateEnvironment(),
  };
}
