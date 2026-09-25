import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Setup check: shows which settings are present (never their values) and whether the database answers.
export async function GET() {
  const has = (k: string) => !!(process.env[k] && process.env[k]!.trim());
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: has("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: has("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: has("SUPABASE_SERVICE_ROLE_KEY"),
    NEXT_PUBLIC_SITE_URL: has("NEXT_PUBLIC_SITE_URL"),
    STRIPE_SECRET_KEY: has("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: has("STRIPE_WEBHOOK_SECRET"),
    BREVO_API_KEY: has("BREVO_API_KEY"),
    EMAIL_FROM: has("EMAIL_FROM"),
    SHOP_NOTIFY_EMAIL: has("SHOP_NOTIFY_EMAIL"),
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const checks: Record<string, string> = {
    supabase_url_format: /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url.trim()) ? "ok" : url ? "looks wrong (should be https://xxxx.supabase.co)" : "missing",
    site_url: process.env.NEXT_PUBLIC_SITE_URL || "missing",
  };
  try {
    if (env.SUPABASE_SERVICE_ROLE_KEY && url) {
      const admin = createClient(url.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
      const { error, count } = await admin.from("staff").select("email", { count: "exact", head: true });
      checks.database_with_secret_key = error ? "error: " + error.message : `ok (${count} staff)`;
    }
    if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY && url) {
      const anon = createClient(url.trim(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), { auth: { persistSession: false } });
      const { error } = await anon.from("settings").select("id").limit(1);
      checks.database_with_public_key = error ? "error: " + error.message : "ok";
    }
  } catch (e) {
    checks.exception = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json({ env, checks });
}
