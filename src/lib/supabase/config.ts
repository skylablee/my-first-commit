export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      !(
        ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
        parsed.protocol === "http:"
      )
    )
      return null;
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !["/", "/rest/v1", "/rest/v1/"].includes(parsed.pathname)
    )
      return null;
    // The dashboard's Data API URL includes /rest/v1. The SDK adds that path
    // itself, so pass the project origin to both server and browser clients.
    return { url: parsed.origin, key };
  } catch {
    return null;
  }
}
