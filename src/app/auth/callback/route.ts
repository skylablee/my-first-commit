import { requestOrigin } from "@/lib/server/origin";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const db = await createClient();
  if (db && code && code.length <= 2000) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(new URL("/", requestOrigin(request)));
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", requestOrigin(request)),
  );
}
