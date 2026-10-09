import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QuickBooks change notices (Intuit webhooks). Checked against the app's verifier token (QBO_WEBHOOK_TOKEN):
 * intuit-signature = base64(HMAC-SHA256(token, body)). Each change is recorded in qbo_changes and answered at once;
 * the runner re-reads the ones we have linked and flags edits made in QuickBooks. Handles Intuit's classic format
 * ({ eventNotifications: [...] }) and the CloudEvents format (an array of { type: "qbo.customer.updated.v1", ... }).
 */
export async function POST(req: Request) {
  const token = process.env.QBO_WEBHOOK_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: "Webhook not set up (QBO_WEBHOOK_TOKEN)." }, { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("intuit-signature") || "";
  const want = Buffer.from(createHmac("sha256", token).update(raw).digest("base64"));
  const got = Buffer.from(sig);
  if (!sig || want.length !== got.length || !timingSafeEqual(want, got)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad body" }, { status: 400 }); }
  const rows: { realm_id: string; entity: string; qbo_id: string; operation: string; last_updated: string | null; source: string }[] = [];
  const classic = (body as { eventNotifications?: { realmId?: string; dataChangeEvent?: { entities?: { name?: string; id?: string; operation?: string; lastUpdated?: string }[] } }[] }).eventNotifications;
  if (Array.isArray(classic)) {
    for (const n of classic) for (const e of n.dataChangeEvent?.entities || []) if (e.name && e.id) rows.push({ realm_id: String(n.realmId || ""), entity: e.name, qbo_id: String(e.id), operation: String(e.operation || ""), last_updated: e.lastUpdated || null, source: "webhook" });
  } else if (Array.isArray(body)) {
    for (const ev of body as { type?: string; intuitentityid?: string; intuitaccountid?: string; time?: string }[]) {
      const m = /^qbo\.([a-z]+)\.([a-z]+)\./i.exec(String(ev.type || ""));
      if (m && ev.intuitentityid) rows.push({ realm_id: String(ev.intuitaccountid || ""), entity: m[1][0].toUpperCase() + m[1].slice(1), qbo_id: String(ev.intuitentityid), operation: m[2], last_updated: ev.time || null, source: "webhook" });
    }
  }
  if (rows.length) await createAdminClient().from("qbo_changes").insert(rows.slice(0, 1000));
  return NextResponse.json({ ok: true, recorded: rows.length });
}
