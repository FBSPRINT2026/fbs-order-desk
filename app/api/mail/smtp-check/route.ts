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
  const tries = [
    { port: 587, method: "LOGIN" }, { port: 587, method: "PLAIN" }, { port: 465, method: "LOGIN" }, { port: 465, method: "PLAIN" },
  ];
  const out: unknown[] = [];
  for (const t of tries) {
    const lines: string[] = [];
    const log = (_o: unknown, ...m: unknown[]) => { const s = m.map(String).join(" "); if (!/AUTH|334|^\s*[A-Za-z0-9+/=]{12,}\s*$|secret/i.test(s) || /^S:|250-AUTH|250 AUTH/i.test(s)) lines.push(s.slice(0, 200)); };
    const logger = { info: log, debug: log, error: log, warn: log, trace: log, fatal: log, level: () => null } as never;
    const smtp = nodemailer.createTransport({ host: c.smtpHost, port: t.port, secure: t.port === 465, requireTLS: t.port !== 465, authMethod: t.method, auth: { user: c.user, pass: c.pass }, logger, debug: true, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000 });
    let result = "ok";
    try { await smtp.verify(); } catch (e) { result = e instanceof Error ? e.message : String(e); }
    out.push({ ...t, result, server: lines.filter((l) => /250[- ]|220|535|530|504|AUTH/i.test(l) && !/C: AUTH/i.test(l)).slice(0, 14) });
    smtp.close();
  }
  return NextResponse.json({ host: c.smtpHost, user: c.user, tries: out });
}
