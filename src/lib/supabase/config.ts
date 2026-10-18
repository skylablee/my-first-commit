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
  } catch {
    return null;
  }
  return { url, key };
}
