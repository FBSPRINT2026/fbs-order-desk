"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { domainOf, junkReason, phoneKey } from "@/lib/siteJunk";

/**
 * Leads → Website submissions: Ignore, or Ignore and block (Nov 6, Nick). Blocking keeps the sender's email, their
 * company's email domain (not Gmail and the like), their IP and their phone in site_blocks: what they send next is kept
 * as spam and never shows (app/site/actions.ts), and what they sent becomes an example of junk for the check that flags
 * the next one (lib/siteJunk.ts).
 */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}
type Sub = { id: string; email: string | null; ip: string | null; detail: Record<string, unknown> | null };
async function subOf(admin: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: sr } = await admin.from("site_requests").select("id, email, ip, detail").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: o } = await admin.from("orders").select("notes, customer_id, source").eq("id", orderId).maybeSingle();
  const { data: c } = o?.customer_id ? await admin.from("customers").select("email, phone").eq("id", o.customer_id).maybeSingle() : { data: null };
  return { sr: (sr || null) as Sub | null, notes: String(o?.notes || ""), web: o?.source === "website", email: String(sr?.email || c?.email || "").toLowerCase(), phone: String(c?.phone || "") };
}

/** what's known about a website submission: who sent it and whether it reads like junk (checked once, then kept) */
export async function leadInfo(orderId: string): Promise<{ ok: true; email: string; domain: string; ip: string; phone: string; junk: string } | { ok: false; error: string }> {
  try {
    await staff();
    const admin = createAdminClient();
    const x = await subOf(admin, orderId);
    if (!x.web) return { ok: false, error: "Not a website submission." };
    let junk = String(x.sr?.detail?.junk || "");
    if (x.sr && !x.sr.detail?.checked) {
      junk = await junkReason(admin, x.notes);
      await admin.from("site_requests").update({ detail: { ...(x.sr.detail || {}), junk: junk || null, checked: true } }).eq("id", x.sr.id);
    }
    return { ok: true, email: x.email, domain: domainOf(x.email), ip: x.sr?.ip || "", phone: x.phone, junk };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

export async function ignoreLead(orderId: string, block: boolean): Promise<{ ok: true; blocked: string[] } | { ok: false; error: string }> {
  try {
    const v = await staff();
    const admin = createAdminClient();
    const x = await subOf(admin, orderId);
    const { error } = await admin.from("orders").update({ discarded_at: new Date().toISOString() }).eq("id", orderId).eq("status", "request");
    if (error) return { ok: false, error: error.message };
    const blocked: string[] = [];
    if (block && x.web) {
      const reason = String(x.sr?.detail?.junk || "") || "Blocked by staff";
      const ip = x.sr?.ip && x.sr.ip !== "unknown" ? x.sr.ip : "";
      const rows = ([["email", x.email], ["domain", domainOf(x.email)], ["ip", ip], ["phone", phoneKey(x.phone)]] as const)
        .filter(([, val]) => val && val.length > 3)
        .map(([kind, value], i) => ({ kind, value, reason, sample: i === 0 ? x.notes.slice(0, 2000) : null, order_id: orderId, created_by: v.email }));
      for (const r of rows) {
        const { data: had } = await admin.from("site_blocks").select("id").eq("kind", r.kind).eq("value", r.value).is("removed_at", null).maybeSingle();
        if (had) continue;
        const { error: e2 } = await admin.from("site_blocks").insert(r);
        if (!e2) blocked.push(r.value);
      }
    }
    await admin.from("order_events").insert({ order_id: orderId, kind: "request_put_away", detail: block ? `Ignored and blocked in Leads${blocked.length ? ` (${blocked.join(", ")})` : ""}` : "Ignored in Leads", actor: v.email });
    return { ok: true, blocked };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
