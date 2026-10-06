import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { cfgOf, type MailAccount } from "@/lib/mail/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Check a mailbox's sending (SMTP) sign-in a few ways, without sending anything (sync token only). Reports what the
 * server offers and which sign-in it accepts. Passwords never appear: sign-in lines are hidden.
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("account") || "";
  const { data: a } = await admin.from("mail_accounts").select("*").eq("id", id).maybeSingle();
  if (!a) return NextResponse.json({ error: "no account" });
  const c = cfgOf(a as MailAccount);
  const ntlm = (await import("nodemailer-ntlm-auth")).default;
  const name = c.user.split("@")[0], dom = (c.user.split("@")[1] || "").split(".")[0];
  const tries: { port: number; method: string; user?: string; domain?: string }[] = [
    { port: 587, method: "LOGIN" }, { port: 25, method: "LOGIN" },
    { port: 587, method: "NTLM", user: c.user, domain: "" }, { port: 587, method: "NTLM", user: name, domain: dom.toUpperCase() },
    { port: 587, method: "LOGIN", user: `${dom}\\${name}` },
  ];
  const out: unknown[] = [];
  for (const t of tries) {
    const lines: string[] = [];
    const log = (_o: unknown, ...m: unknown[]) => { const s = m.map(String).join(" "); if (!/AUTH|334|^\s*[A-Za-z0-9+/=]{12,}\s*$|secret/i.test(s) || /^S:|250-AUTH|250 AUTH/i.test(s)) lines.push(s.slice(0, 200)); };
    const logger = { info: log, debug: log, error: log, warn: log, trace: log, fatal: log, level: () => null } as never;
    const base = { host: c.smtpHost, port: t.port, secure: t.port === 465, requireTLS: t.port !== 465, logger, debug: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 };
    const smtp = t.method === "NTLM"
      ? nodemailer.createTransport({ ...base, auth: { type: "custom", method: "NTLM", user: t.user, pass: c.pass, options: { domain: t.domain, workstation: "PORTAL" } }, customAuth: { NTLM: ntlm } } as never)
      : nodemailer.createTransport({ ...base, authMethod: t.method, auth: { user: t.user || c.user, pass: c.pass } } as never);
    let result = "ok";
    try { await smtp.verify(); } catch (e) { result = e instanceof Error ? e.message : String(e); }
    out.push({ port: t.port, method: t.method, as: t.user ? (t.user.includes("\\") ? "DOMAIN\\name" : t.user.includes("@") ? "email" : `name, domain ${t.domain}`) : "email", result, server: lines.filter((l) => /250[- ]|220|535|530|504|AUTH/i.test(l) && !/C: AUTH/i.test(l)).slice(0, 14) });
    smtp.close();
  }
  return NextResponse.json({ host: c.smtpHost, user: c.user, tries: out });
}
