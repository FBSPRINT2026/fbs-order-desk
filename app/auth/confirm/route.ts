import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Target of the sign-in email link. Works even if the customer opens the
// email on a different device than the one they asked from.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type") || "email";
  const type = (["signup", "magiclink", "recovery", "invite", "email_change"].includes(rawType) ? rawType : "email") as "email";
  const code = url.searchParams.get("code");
  let next = url.searchParams.get("next") || "/";
  if (!next.startsWith("/")) next = "/";
  const supabase = await createClient();
  let ok = false;
  if (token_hash) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }
  return NextResponse.redirect(new URL(ok ? next : "/login?error=link", url.origin));
}
