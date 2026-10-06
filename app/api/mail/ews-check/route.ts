import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cfgOf, type MailAccount } from "@/lib/mail/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Can this mailbox use Exchange Web Services (sync token only)? Reads the Sent Items folder's name; sends nothing. */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const { data: a } = await admin.from("mail_accounts").select("*").eq("id", new URL(req.url).searchParams.get("account") || "").maybeSingle();
  if (!a) return NextResponse.json({ error: "no account" });
  const c = cfgOf(a as MailAccount);
  const soap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"><soap:Header><t:RequestServerVersion Version="Exchange2013"/></soap:Header><soap:Body><m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="folder:DisplayName"/></t:AdditionalProperties></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id="sentitems"/></m:FolderIds></m:GetFolder></soap:Body></soap:Envelope>`;
  const out: unknown[] = [];
  for (const host of [c.imapHost, c.imapHost.replace(/^east\./, "")]) {
    const url = `https://${host}/EWS/Exchange.asmx`;
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", Authorization: `Basic ${Buffer.from(`${c.user}:${c.pass}`).toString("base64")}` }, body: soap, signal: AbortSignal.timeout(12000) });
      const t = await r.text();
      out.push({ url, status: r.status, auth: r.headers.get("www-authenticate"), result: (t.match(/ResponseClass="(\w+)"/) || [])[1] || null, name: (t.match(/<t:DisplayName>([^<]*)</) || [])[1] || null, error: (t.match(/<m:MessageText>([^<]*)</) || [])[1] || (r.ok ? null : t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)) });
    } catch (e) { out.push({ url, error: e instanceof Error ? e.message : String(e) }); }
  }
  return NextResponse.json({ tries: out });
}
