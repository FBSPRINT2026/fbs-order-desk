import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Target of the sign-in email link. Works even if the customer opens the email on a different device than the one they
 * asked from.
 *
 * Opening the link never signs in by itself (Nov 16 2026, Liz at E-Lead Promo: "when I enter the code it says it's been
 * used already… the next code says the same thing"). Company mail filters (Microsoft Safe Links, Mimecast, Proofpoint)
 * open every link in an email before the person sees it; the link and the code are one sign-in, so the filter's visit
 * used it up and the code she typed was "already used". The link now opens a page with one button: pressing it signs in
 * (a POST, which filters never send), and the code in the email still works until then.
 */
type T = "email" | "signup" | "magiclink" | "recovery" | "invite" | "email_change";
const typeOf = (raw: string | null) => (["signup", "magiclink", "recovery", "invite", "email_change"].includes(raw || "") ? raw : "email") as T;
const safe = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safe(url.searchParams.get("next"));
  const supabase = await createClient();
  // already signed in on this browser (the code was typed first): just go in (Oct 12)
  const { data } = await supabase.auth.getUser();
  if (data.user) return NextResponse.redirect(new URL(next, url.origin));
  const token_hash = url.searchParams.get("token_hash"), code = url.searchParams.get("code");
  if (!token_hash && !code) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  const field = (k: string, v: string | null) => (v ? `<input type="hidden" name="${k}" value="${esc(v)}">` : "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f4f7;font-family:"Public Sans",system-ui,sans-serif;color:#141d2b}
.c{background:#fff;border:1px solid #e1e6ec;border-radius:10px;padding:28px 26px;max-width:360px;width:calc(100% - 32px);box-sizing:border-box}
h1{font-size:20px;margin:0 0 6px}p{font-size:14px;color:#4a566b;margin:0 0 18px;line-height:1.45}
button{width:100%;height:42px;border:0;border-radius:6px;background:#0e9bd8;color:#fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer}</style></head>
<body><form class="c" method="post" action="/auth/confirm"><h1>Sign in to the portal</h1><p>Press the button to finish signing in.</p>
${field("token_hash", token_hash)}${field("code", code)}${field("type", url.searchParams.get("type"))}${field("next", next)}
<button type="submit">Sign in</button></form></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const f = await request.formData();
  const token_hash = String(f.get("token_hash") || ""), code = String(f.get("code") || "");
  const next = safe(String(f.get("next") || "/"));
  const supabase = await createClient();
  let ok = false;
  if (token_hash) ok = !(await supabase.auth.verifyOtp({ type: typeOf(String(f.get("type") || "")), token_hash })).error;
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  // the link didn't work (already used: the code from the same email was typed in first), but this browser is signed in
  if (!ok) { const { data } = await supabase.auth.getUser(); ok = !!data.user; }
  return NextResponse.redirect(new URL(ok ? next : "/login?error=link", url.origin), 303);
}
