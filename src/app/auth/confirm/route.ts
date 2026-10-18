import { requestOrigin } from "@/lib/server/origin";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const db = await createClient();
  if (db && token_hash && type === "email") {
    const { error } = await db.auth.verifyOtp({
      token_hash,
      type: type as EmailOtpType,
    });
    if (!error)
      return NextResponse.redirect(new URL("/", requestOrigin(request)));
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", requestOrigin(request)),
  );
}
