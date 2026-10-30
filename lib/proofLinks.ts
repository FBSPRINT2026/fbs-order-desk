import "server-only";
import { orderSubject } from "@/lib/orderSubject";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { lineQty, mergeSettings, orderGroups, withoutShopPieces, type Order, type Proof, type Settings } from "@/lib/pricing";
import { fmtPhone } from "@/lib/phone";

/**
 * The customer's proof link (Oct 29, Nick: "you send a link to the customer, says your proof is available. I click this
 * link and this screen pops up. You can see the PDF on the right. And some basic details on the left… the customer can
 * put in change notes and approve it, requires changes… make a minor change, but no need to reproof").
 *
 * - One link per proof sent: an order's art proof version (all its mockups), or one sew-out. /proof/<id> opens with no
 *   sign-in; the long random id is the key. Sending again (Remind) uses the same link.
 * - The page shows the same PDF the shop downloads (/print/<order>?proof=1 or ?sewout=<id>, opened with the link).
 * - The customer's answer lands where the portal's would: the proofs (or the sew-out) get their status, the order's
 *   history says it, and the shop is emailed. Approve, approve with a small change (no new proof), or changes with a new
 *   proof. A link to a version that was replaced says so.
 */
export type LinkKind = "art" | "sewout" | "order";
export type ProofLinkRow = { id: string; kind: LinkKind; order_id: string; version: number | null; sewout_id: string | null; sent_to: string; created_by: string; created_at: string };
export type LinkDecision = "approved" | "approved_changes" | "changes";

export const proofUrl = (id: string) => `${siteUrl()}/proof/${id}`;

/** the link for this proof (the one already made for it, else a new one) */
export async function proofLinkFor(admin: SupabaseClient, x: { kind: LinkKind; orderId: string; version?: number | null; sewoutId?: string | null; to?: string; by?: string }) {
  let q = admin.from("proof_links").select("id").eq("kind", x.kind).eq("order_id", x.orderId);
  q = x.kind === "art" ? q.eq("version", x.version || 0) : x.kind === "sewout" ? q.eq("sewout_id", x.sewoutId || "") : q;
  const { data: had } = await q.limit(1).maybeSingle();
  if (had?.id) {
    if (x.to) await admin.from("proof_links").update({ sent_to: x.to }).eq("id", had.id);
    return had.id as string;
  }
  const id = randomBytes(18).toString("base64url");
  const { error } = await admin.from("proof_links").insert({ id, kind: x.kind, order_id: x.orderId, version: x.kind === "art" ? x.version || 0 : null, sewout_id: x.kind === "sewout" ? x.sewoutId : null, sent_to: x.to || "", created_by: x.by || "" });
  if (error) throw new Error(`Couldn't make the proof link: ${error.message}`);
  return id;
}

export async function openLink(admin: SupabaseClient, id: string): Promise<ProofLinkRow | null> {
  if (!/^[\w-]{16,64}$/.test(id || "")) return null;
  const { data } = await admin.from("proof_links").select("*").eq("id", id).maybeSingle();
  return (data as ProofLinkRow | null) || null;
}

type SewoutRow = { id: string; order_id: string; imprint_id: string; design_id: string | null; version: number; photo_path: string; placement_path?: string | null; status: "pending" | "approved" | "changes"; customer_comment: string; decided_at: string | null; decided_name: string | null; archived_at: string | null; note: string; sent_at: string | null; sewn?: { file?: { wIn: number; hIn: number; stitches: number } | null; threads?: { needle?: number; sewn: string }[] } | null };

/** Everything the link's page needs, from the link alone. */
export type Step = { kind: "art" } | { kind: "sewout"; id: string };
export async function linkPage(admin: SupabaseClient, id: string, step?: Step) {
  const link0 = await openLink(admin, id);
  if (!link0) return null;
  // the order's page (lib/customerSend.ts): one of its steps, as if it had its own link (the proof version out now, or a
  // sew-out of this order)
  let link = link0;
  if (link0.kind === "order") {
    if (!step) return null;
    if (step.kind === "art") {
      const { data: lv } = await admin.from("proofs").select("version").eq("order_id", link0.order_id).not("version", "is", null).is("archived_at", null).limit(1).maybeSingle();
      link = { ...link0, kind: "art", version: (lv?.version as number) || 0 };
    } else {
      const { data: so } = await admin.from("sewouts").select("id").eq("id", step.id).eq("order_id", link0.order_id).maybeSingle();
      if (!so) return null;
      link = { ...link0, kind: "sewout", sewout_id: step.id };
    }
  }
  const { data: od } = await admin.from("orders").select("*").eq("id", link.order_id).maybeSingle();
  if (!od) return null;
  const o = withoutShopPieces(od as Order);
  const [{ data: cu }, { data: s }] = await Promise.all([
    o.customer_id ? admin.from("customers").select("id, name, company, email").eq("id", o.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
  ]);
  const settings = mergeSettings(s?.data);
  const customer = cu as { id: string; name: string; company: string; email: string } | null;
  if (link.kind === "art") {
    const { data: ps } = await admin.from("proofs").select("*").eq("order_id", o.id).eq("version", link.version || 0).order("created_at");
    const proofs = (ps || []) as Proof[];
    const replaced = proofs.length > 0 && proofs.every((p) => p.archived_at);
    const status = !proofs.length ? "gone" : replaced ? "replaced" : proofs.some((p) => p.status === "pending") ? "pending" : proofs.some((p) => p.status === "changes") ? "changes" : "approved";
    const done = proofs.find((p) => p.decided_at);
    return { link, o, customer, settings, proofs, sewout: null as SewoutRow | null, status, decidedName: done?.decided_name || "", decidedAt: done?.decided_at || "", comment: done?.customer_comment || "" };
  }
  const { data: sw } = await admin.from("sewouts").select("*").eq("id", link.sewout_id || "").maybeSingle();
  const sewout = sw as SewoutRow | null;
  const status = !sewout ? "gone" : sewout.archived_at && sewout.status === "pending" ? "replaced" : sewout.status;
  return { link, o, customer, settings, proofs: [] as Proof[], sewout, status, decidedName: sewout?.decided_name || "", decidedAt: sewout?.decided_at || "", comment: sewout?.customer_comment || "" };
}
export type LinkPage = NonNullable<Awaited<ReturnType<typeof linkPage>>>;

/** The customer opened their proof link: the proof's first, last and count of views (the same as the portal's). */
export async function linkViewed(admin: SupabaseClient, p: LinkPage) {
  const at = new Date().toISOString();
  if (p.link.kind === "art") {
    for (const x of p.proofs.filter((y) => !y.archived_at)) await admin.from("proofs").update({ viewed_at: x.viewed_at || at, last_viewed_at: at, view_count: (x.view_count || 0) + 1 }).eq("id", x.id);
  } else if (p.sewout) {
    const { sewoutViewed } = await import("@/lib/sewouts");
    await sewoutViewed(admin, p.sewout.id);
  }
}

/** The customer's answer on the link's page. */
export async function decideByLink(admin: SupabaseClient, id: string, decision: LinkDecision, name: string, note: string, step?: Step, /** one shop email for several answers at once (the caller sends it) */ quiet = false) {
  const p = await linkPage(admin, id, step);
  if (!p) return { ok: false as const, error: "This proof link doesn't work anymore. Ask us for a new one." };
  if (p.status === "replaced") return { ok: false as const, error: "A newer proof was sent after this one. Please open the newest proof email." };
  if (p.status !== "pending") return { ok: false as const, error: "This proof was already answered. Refresh the page." };
  const who = name.trim().slice(0, 120), text = note.trim().slice(0, 2000);
  if (decision !== "changes" && who.length < 2) return { ok: false as const, error: "Type your name to approve." };
  if (decision !== "approved" && !text) return { ok: false as const, error: "Tell us what to change." };
  const actor = p.link.sent_to || p.customer?.email || "customer";
  const at = new Date().toISOString();
  const label = p.link.kind === "art" ? `Proof version ${p.link.version}` : `Sew-out v${p.sewout!.version}`;
  if (p.link.kind === "art") {
    const live = p.proofs.filter((x) => !x.archived_at && x.status === "pending");
    const status = decision === "changes" ? "changes" : "approved";
    await admin.from("proofs").update({ status, customer_comment: text, decided_at: at, decided_name: who || actor }).in("id", live.map((x) => x.id));
    await admin.from("order_events").insert({ order_id: p.o.id, kind: status === "approved" ? "proof_approved" : "proof_changes", detail: `${label}${decision === "approved_changes" ? " (with a small change, no new proof)" : decision === "changes" ? " (send a new proof)" : ""} on the proof link${text ? `: ${text.slice(0, 300)}` : ""}`, actor });
  } else {
    const { decideSewout } = await import("@/lib/sewouts");
    const r = await decideSewout(admin, p.sewout as never, p.o, decision === "changes" ? "changes" : "approved", who, text, actor, quiet);
    if (!r.ok) return r;
  }
  // what they wrote goes in the order's Messages too, where the team reads the customer
  if (text) await admin.from("messages").insert({ order_id: p.o.id, author_type: "customer", author_email: actor, author_name: who || p.customer?.name || "Customer", body: `${label}: ${decision === "approved_changes" ? "approved with a small change (no new proof)" : decision === "changes" ? "changes, send a new proof" : "approved"}. ${text}` });
  if (p.link.kind === "art" && SHOP_NOTIFY_EMAIL && !quiet) {
    const head = decision === "approved" ? `${who} approved ${label.toLowerCase()}` : decision === "approved_changes" ? `${who} approved ${label.toLowerCase()} with a small change` : `${who || "The customer"} wants changes to ${label.toLowerCase()}`;
    await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `${decision === "changes" ? "Proof changes" : decision === "approved_changes" ? "Proof approved with a change" : "Proof approved"} on #${p.o.number}`, html: emailLayout(p.settings.shop.name, head, decision === "approved_changes" ? `Make this change before production (no new proof):\n\n${text}` : text || "No comment.", "Open order", `${siteUrl()}/shop/orders/${p.o.id}`) });
  }
  return { ok: true as const };
}

/** What a proof is, in a few rows, for its email and its page: how many, the prints, in hands. */
export function proofRows(o: Order, kind: LinkKind, sw?: SewoutRow | null): [string, string][] {
  const groups = orderGroups(o);
  const qty = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + lineQty(l), 0), 0);
  const due = o.due_date ? new Date(`${o.due_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  if (kind === "sewout" && sw) {
    let where = "";
    for (const g of groups) for (const im of g.imprints || []) if (im.id === sw.imprint_id) where = `${im.location}${im.size ? `, ${im.size}` : ""}`;
    const threads = [...new Set((sw.sewn?.threads || []).map((t) => t.sewn))].join(", ");
    return [["Print", where], ...(sw.sewn?.file ? [["Stitches", sw.sewn.file.stitches.toLocaleString()] as [string, string]] : []), ...(threads ? [["Thread", threads] as [string, string]] : []), ["Quantity", qty ? qty.toLocaleString() : ""], ["In hands", due]].filter(([, v]) => v) as [string, string][];
  }
  const prints = [...new Set(groups.flatMap((g) => (g.imprints || []).map((d) => d.location).filter(Boolean)))].join(", ");
  return ([["Quantity", qty ? qty.toLocaleString() : ""], ["Prints", prints], ["In hands", due]] as [string, string][]).filter(([, v]) => v);
}

const esc = (s: string) => (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The proof email (Oct 29, Nick: "here is the email I get too… it looks ugly but the functionality is nice"): our logo,
 * one heading, a short note, a small picture of it with what it is, one button to the proof page, and the ask to use the
 * button rather than a reply.
 */
export function proofEmail(x: { settings: Settings; first: string; kind: LinkKind; o: Order; picture?: string; rows: [string, string][]; url: string; reminder?: boolean; note?: string }) {
  const sh = x.settings.shop;
  const logo = sh.logoUrl ? (/^https?:/.test(sh.logoUrl) ? sh.logoUrl : `${siteUrl()}${sh.logoUrl.startsWith("/") ? "" : "/"}${sh.logoUrl}`) : `${siteUrl()}/brand/fbs-logo.png`;
  const what = x.kind === "art" ? "proof" : "sew-out";
  const job = x.o.nickname || `order #${x.o.number}`;
  const head = x.reminder ? `Your ${what} is waiting for you` : x.kind === "art" ? "Your proof is ready to approve" : "Your sew-out is ready to approve";
  const intro = x.kind === "art"
    ? `here's the proof for <b>${esc(job)}</b> (order #${x.o.number}). Please look it over and approve it, or tell us what to change. We start once it's approved.`
    : `here's a photo of your logo stitched on our machine for <b>${esc(job)}</b> (order #${x.o.number}), the same way the whole run will sew. Please approve it, or tell us what to change.`;
  const rows = x.rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6B7686;font-size:13px;white-space:nowrap">${esc(k)}</td><td style="padding:2px 0;font-size:13px;font-weight:600;color:#141D2B">${esc(v)}</td></tr>`).join("");
  const pic = x.picture ? `<td style="width:84px;padding-right:14px;vertical-align:top"><a href="${x.url}"><img src="${x.picture}" width="84" height="84" alt="" style="display:block;width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid #E3E7EE" /></a></td>` : "";
  const contact = [fmtPhone(sh.phone), sh.email].filter(Boolean).map(esc).join(" · ");
  const html = `<div style="background:#F3F5F8;padding:24px 12px;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #E3E7EE;border-radius:10px;border-collapse:separate">
<tr><td style="padding:18px 24px;border-bottom:1px solid #EEF1F5"><img src="${logo}" alt="${esc(sh.name)}" height="34" style="display:block;height:34px" /></td></tr>
<tr><td style="padding:22px 24px 6px;color:#141D2B">
<div style="font-size:20px;font-weight:700;margin:0 0 10px">${esc(head)}</div>
<div style="font-size:15px;line-height:1.5;color:#3C475A">Hi ${esc(x.first || "there")}, ${intro}</div>
${x.note ? `<div style="font-size:14px;line-height:1.5;color:#3C475A;margin-top:10px;white-space:pre-line">${esc(x.note)}</div>` : ""}
</td></tr>
<tr><td style="padding:12px 24px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F6F7F9;border-radius:8px"><tr><td style="padding:12px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${pic}<td style="vertical-align:top"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table></td></tr></table></td></tr>
<tr><td style="padding:10px 24px 6px;text-align:center"><a href="${x.url}" style="display:inline-block;background:#0E9BD8;color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:6px;font-weight:700;font-size:15px">Review and approve</a></td></tr>
<tr><td style="padding:8px 24px 18px;text-align:center;font-size:12px;color:#6B7686">Please use the button to approve, not a reply, so it goes straight onto your order.</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #EEF1F5;font-size:12px;color:#6B7686">${esc(sh.name)}${contact ? ` · ${contact}` : ""}</td></tr>
</table></div>`;
  const subject = orderSubject(x.o.number, `${x.reminder ? "Reminder: " : ""}${x.kind === "art" ? "Proof" : "Sew-out"} ready for approval`, x.o.nickname);
  return { subject, html };
}

/** the customer's first name for the email ("Peter Sleiman" → Peter) */
export const firstName = (c: { name?: string; company?: string } | null) => ((c?.name || "").trim().split(/\s+/)[0] || "");
