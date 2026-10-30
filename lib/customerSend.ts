import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { calcOrder, mergeSettings, orderGroups, withoutShopPieces, type Order, type Payment, type PayTerms, type Proof, type Settings } from "@/lib/pricing";
import { upFront } from "@/lib/payTerms";
import { fmtPhone } from "@/lib/phone";
import { fullColorWaiting } from "@/lib/fullColor";
import { proofLinkFor, proofUrl } from "@/lib/proofLinks";

/**
 * Send to customer, all together (Oct 29, Nick, option A: "sometimes we would send a proof without sending an invoice or
 * a quote. Ideally, it all comes together… this should all be one email… it all has to work cohesively").
 *
 * One Send, where staff tick what goes: the proof (the order's current mockups as the next version), the quote, each
 * sew-out. One email holds what was ticked. Its one button opens the order's customer page (/proof/<order link>), where
 * every step waiting on them is listed: approve the proof, each sew-out, approve or decline the quote, pay the deposit.
 * Copy link / Copy as a button does the same without the email, for staff's own email.
 */
type Staff = { email: string; name: string };
export type Pick3 = { proof?: boolean; quote?: boolean; sewouts?: string[]; note?: string };
type SewRow = { id: string; order_id: string; imprint_id: string; version: number; status: string; sent_at: string | null; sent_to: string | null; archived_at: string | null; photo_path: string; created_at: string };

async function load(admin: SupabaseClient, orderId: string) {
  const { data: od } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!od) throw new Error("Order not found.");
  const o = od as Order;
  const [{ data: cu }, { data: s }, { data: pays }] = await Promise.all([
    o.customer_id ? admin.from("customers").select("id, name, company, email, payment_terms").eq("id", o.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("payments").select("amount").eq("order_id", orderId),
  ]);
  return { o, customer: cu as { id: string; name: string; company: string; email: string; payment_terms?: PayTerms | null } | null, settings: mergeSettings(s?.data), pays: (pays || []) as Pick<Payment, "amount">[] };
}

/** what could go to the customer now, and what's ticked to start with (what's ready) */
export async function sendOptions(admin: SupabaseClient, orderId: string) {
  const { o, customer, settings, pays } = await load(admin, orderId);
  const [{ data: mk }, { data: ps }, { data: sw }] = await Promise.all([
    admin.from("mockups").select("id").eq("order_id", orderId).is("archived_at", null),
    admin.from("proofs").select("id, version, status, mockup_id, archived_at").eq("order_id", orderId).not("version", "is", null),
    admin.from("sewouts").select("id, order_id, imprint_id, version, status, sent_at, sent_to, archived_at, photo_path, created_at").eq("order_id", orderId).is("archived_at", null),
  ]);
  const mocks = (mk || []) as { id: string }[], proofs = (ps || []) as Pick<Proof, "id" | "version" | "status" | "mockup_id" | "archived_at">[];
  const live = proofs.filter((p) => !p.archived_at);
  const unsent = mocks.length > 0 && mocks.some((m) => !live.some((p) => p.mockup_id === m.id));
  const nextV = (proofs.length ? Math.max(...proofs.map((p) => p.version || 0)) : 0) + 1;
  const c = calcOrder(o, settings, pays);
  const quoteOpen = ["quote", "request", "quote_sent"].includes(o.status);
  const where = (imprintId: string) => { for (const g of orderGroups(o)) for (const im of g.imprints || []) if (im.id === imprintId) return `${im.location}${im.size ? `, ${im.size}` : ""}`; return "Sew-out"; };
  const sews = ((sw || []) as SewRow[]).filter((x) => x.status === "pending").map((x) => ({ id: x.id, label: `Sew-out v${x.version} · ${where(x.imprint_id)}`, sent: !!x.sent_at }));
  return {
    to: customer?.email || "", name: customer?.name || customer?.company || "",
    proof: mocks.length ? { version: unsent ? nextV : live[0]?.version || nextV, mockups: mocks.length, unsent, waiting: !unsent && live.some((p) => p.status === "pending") } : null,
    // what's due when they approve, by their terms (lib/payTerms.ts)
    quote: quoteOpen ? { total: c.total, status: o.status, deposit: upFront(customer?.payment_terms, c.total, settings.depositPct).amount, due: upFront(customer?.payment_terms, c.total, settings.depositPct).line } : null,
    sewouts: sews,
  };
}

/** the steps an email lists, from what was ticked */
async function emailFor(admin: SupabaseClient, o: Order, customer: { name: string; payment_terms?: PayTerms | null } | null, settings: Settings, pick: Pick3, url: string) {
  const sh = settings.shop;
  const groups = orderGroups(o);
  const blocks: { k: string; title: string; sub: string; pic?: string }[] = [];
  if (pick.proof) {
    const { data: mk } = await admin.from("mockups").select("file_path").eq("order_id", o.id).is("archived_at", null).order("created_at").limit(1).maybeSingle();
    const { data: su } = mk ? await admin.storage.from("proofs").createSignedUrl(String(mk.file_path).replace(/\.png$/, "-thumb.png"), 60 * 60 * 24 * 30) : { data: null };
    const prints = [...new Set(groups.flatMap((g) => (g.imprints || []).map((d) => d.location).filter(Boolean)))].join(", ");
    blocks.push({ k: "proof", title: "Approve your proof", sub: prints, pic: su?.signedUrl || undefined });
  }
  for (const id of pick.sewouts || []) {
    const { data: sw } = await admin.from("sewouts").select("imprint_id, version, photo_path").eq("id", id).maybeSingle();
    if (!sw) continue;
    const { data: su } = await admin.storage.from("proofs").createSignedUrl(sw.photo_path, 60 * 60 * 24 * 30);
    let where = ""; for (const g of groups) for (const im of g.imprints || []) if (im.id === sw.imprint_id) where = `${im.location}${im.size ? `, ${im.size}` : ""}`;
    blocks.push({ k: "sewout", title: "Approve your sew-out", sub: `A photo of your logo stitched on our machine${where ? ` · ${where}` : ""}`, pic: su?.signedUrl || undefined });
  }
  if (pick.quote) {
    const c = calcOrder(o, settings, []);
    const m = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
    // under the title, what's due when they approve, by their terms (Oct 29, Nick: "nothing due, due on receipt, half due today…")
    blocks.push({ k: "quote", title: `Approve your quote · ${m(c.total)}`, sub: upFront(customer?.payment_terms, c.total, settings.depositPct).line });
  }
  const esc = (t: string) => (t || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  const has = (k: string) => blocks.some((b) => b.k === k);
  const head = has("quote") && (has("proof") || has("sewout")) ? `Your ${has("sewout") && !has("proof") ? "sew-out" : "proof"} and quote are ready` : has("quote") ? "Your quote is ready" : has("sewout") && !has("proof") ? "Your sew-out is ready to approve" : "Your proof is ready to approve";
  const job = o.nickname || `order #${o.number}`;
  const up = upFront(customer?.payment_terms, calcOrder(o, settings, []).total, settings.depositPct);
  const payNow = up.kind === "full" ? "pay for it" : up.kind === "deposit" ? "pay the deposit" : "";
  const first = ((customer?.name || "").trim().split(/\s+/)[0]) || "there";
  const many = blocks.length > 1;
  const logo = sh.logoUrl ? (/^https?:/.test(sh.logoUrl) ? sh.logoUrl : `${siteUrl()}${sh.logoUrl.startsWith("/") ? "" : "/"}${sh.logoUrl}`) : `${siteUrl()}/brand/fbs-logo.png`;
  const rows = blocks.map((b, i) => `<tr><td style="padding:6px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E6EAF0;border-radius:8px"><tr>${b.pic ? `<td style="width:60px;padding:10px 0 10px 10px;vertical-align:top"><img src="${b.pic}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:6px" /></td>` : `<td style="width:60px;padding:10px 0 10px 10px;vertical-align:top"><div style="width:56px;height:56px;border-radius:6px;background:#F6F7F9;border:1px solid #E6EAF0;box-sizing:border-box;padding:9px 11px"><div style="height:4px;width:100%;background:#0E9BD8;border-radius:2px;margin-bottom:6px;font-size:0;line-height:0">&nbsp;</div><div style="height:3px;width:100%;background:#C9D0DA;border-radius:2px;margin-bottom:4px;font-size:0;line-height:0">&nbsp;</div><div style="height:3px;width:70%;background:#C9D0DA;border-radius:2px;margin-bottom:4px;font-size:0;line-height:0">&nbsp;</div><div style="height:3px;width:85%;background:#C9D0DA;border-radius:2px;margin-bottom:6px;font-size:0;line-height:0">&nbsp;</div><div style="height:3px;width:45%;background:#141D2B;border-radius:2px;margin-bottom:0px;font-size:0;line-height:0">&nbsp;</div></div></td>`}<td style="padding:10px 12px;vertical-align:top">${many ? `<div style="font-size:11px;color:#6B7686;text-transform:uppercase;letter-spacing:.05em">Step ${i + 1}</div>` : ""}<div style="font-size:14px;font-weight:700;color:#141D2B">${esc(b.title)}</div><div style="font-size:13px;color:#6B7686">${esc(b.sub)}</div></td></tr></table></td></tr>`).join("");
  const intro = many ? `here's everything for <b>${esc(job)}</b> (order #${o.number}). You can approve it all${has("quote") && payNow ? ` and ${payNow}` : ""} from one page.` : has("quote") ? `here's the quote for <b>${esc(job)}</b> (order #${o.number}). You can approve it${payNow ? ` and ${payNow}` : ""} online.` : `here's the ${has("sewout") ? "sew-out" : "proof"} for <b>${esc(job)}</b> (order #${o.number}). Please look it over and approve it, or tell us what to change.`;
  const contact = [fmtPhone(sh.phone), sh.email].filter(Boolean).map(esc).join(" · ");
  const html = `<div style="background:#F3F5F8;padding:24px 12px;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #E3E7EE;border-radius:10px;border-collapse:separate">
<tr><td style="padding:18px 24px;border-bottom:1px solid #EEF1F5"><img src="${logo}" alt="${esc(sh.name)}" height="34" style="display:block;height:34px" /></td></tr>
<tr><td style="padding:22px 24px 4px;color:#141D2B"><div style="font-size:20px;font-weight:700;margin:0 0 10px">${esc(head)}</div>
<div style="font-size:15px;line-height:1.5;color:#3C475A">Hi ${esc(first)}, ${intro}</div>
${pick.note?.trim() ? `<div style="font-size:14px;line-height:1.5;color:#3C475A;margin-top:10px;white-space:pre-line">${esc(pick.note.trim())}</div>` : ""}</td></tr>
<tr><td style="padding:10px 24px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">${rows}</table></td></tr>
<tr><td style="padding:10px 24px 6px;text-align:center"><a href="${url}" style="display:inline-block;background:#0E9BD8;color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:6px;font-weight:700;font-size:15px">Review and approve</a></td></tr>
<tr><td style="padding:8px 24px 18px;text-align:center;font-size:12px;color:#6B7686">Please use the button, not a reply, so it goes straight onto your order.</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #EEF1F5;font-size:12px;color:#6B7686">${esc(sh.name)}${contact ? ` · ${contact}` : ""}</td></tr>
</table></div>`;
  const what = has("quote") && (has("proof") || has("sewout")) ? "Proof and quote" : has("quote") ? "Quote" : has("sewout") && !has("proof") ? "Sew-out" : "Proof";
  return { subject: `${what} ready for your approval: order #${o.number}${o.nickname ? `, ${o.nickname}` : ""}`, html };
}

/** the preview: the email as it would go, before anything is made */
export async function previewSend(admin: SupabaseClient, orderId: string, pick: Pick3) {
  const { o, customer, settings } = await load(admin, orderId);
  if (!pick.proof && !pick.quote && !(pick.sewouts || []).length) return { ok: false as const, error: "Tick what to send." };
  const em = await emailFor(admin, withoutShopPieces(o), customer, settings, pick, `${siteUrl()}/proof/preview`);
  return { ok: true as const, to: customer?.email || "", ...em };
}

/**
 * Make what was ticked (the proof version, the quote sent, the sew-outs sent) and email it (email=false: only made, the
 * link to copy). Returns the order's page link.
 */
export async function sendTogether(admin: SupabaseClient, orderId: string, pick: Pick3, me: Staff, email = true) {
  const { o, customer, settings } = await load(admin, orderId);
  if (!pick.proof && !pick.quote && !(pick.sewouts || []).length) return { ok: false as const, error: "Tick what to send." };
  const to = customer?.email || "";
  if (email && !to) return { ok: false as const, error: "This customer has no email address. Add one, or copy the link and send it yourself." };
  const sentTo = email ? to : "link copied";
  // a full color print waits for production's colors (and so the price) before the quote goes out (Oct 26, Nick)
  if (pick.quote && orderGroups(o).some((g) => (g.imprints || []).some(fullColorWaiting)))
    return { ok: false as const, error: "Production hasn't confirmed the full color print yet (its colors set the price). Send the proof now, and the quote after that." };
  if (pick.quote && !["quote", "request", "quote_sent"].includes(o.status)) return { ok: false as const, error: "This order's quote was already approved." };
  const done: string[] = [];
  if (pick.proof) {
    const { sendProofs } = await import("@/lib/proofs");
    const r = await sendProofs(admin, orderId, me, pick.note || "", { email: false, sentTo });
    if (!r.ok) return r;
    done.push(`proof version ${r.version}`);
  }
  for (const id of pick.sewouts || []) {
    const { data: sw } = await admin.from("sewouts").select("id, version, status, sent_at, archived_at").eq("id", id).eq("order_id", orderId).maybeSingle();
    if (!sw || sw.archived_at || sw.status !== "pending") continue;
    await admin.from("sewouts").update({ sent_at: new Date().toISOString(), sent_to: sentTo }).eq("id", id);
    await admin.from("order_events").insert({ order_id: orderId, kind: "sewout_sent", detail: `Sew-out v${sw.version} ${email ? `to ${to}` : "(link copied to send yourself)"}`, actor: me.email });
    done.push(`sew-out v${sw.version}`);
  }
  if (pick.quote) {
    if (!["quote", "request", "quote_sent"].includes(o.status)) return { ok: false as const, error: "This order's quote was already approved." };
    const patch: Record<string, unknown> = { sent_at: new Date().toISOString() };
    if (o.status !== "quote_sent") patch.status = "quote_sent";
    await admin.from("orders").update(patch).eq("id", orderId);
    if (patch.status) await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: "quote_sent", actor: me.email });
    await admin.from("order_events").insert({ order_id: orderId, kind: "sent", detail: email ? to : "link copied", actor: me.email });
    done.push("the quote");
  }
  // a note starts the message thread they see too (not already said with the proof)
  if (pick.note?.trim() && !pick.proof) await admin.from("messages").insert({ order_id: orderId, author_type: "staff", author_email: me.email, author_name: settings.shop.name, body: pick.note.trim().slice(0, 2000) });
  const url = proofUrl(await proofLinkFor(admin, { kind: "order", orderId, to: email ? to : undefined, by: me.email }));
  if (!email) return { ok: true as const, url, emailed: false, done };
  const { data: fresh } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  const em = await emailFor(admin, withoutShopPieces(fresh as Order), customer, settings, pick, url);
  const emailed = await sendEmail({ to, replyTo: SHOP_NOTIFY_EMAIL, subject: em.subject, html: em.html });
  return { ok: true as const, url, emailed, done };
}

/** The customer's answer on the quote, from their order page: approved (signed) or declined with why. */
export async function decideQuote(admin: SupabaseClient, orderId: string, decision: "approve" | "decline", name: string, reason: string, actor: string, /** the caller sends one shop email for everything */ quiet = false) {
  const { o, settings } = await load(admin, orderId);
  if (o.status !== "quote_sent") return { ok: false as const, error: "This quote was already answered or changed. Refresh the page." };
  const who = name.trim().slice(0, 120), why = reason.trim().slice(0, 2000);
  const now = new Date().toISOString();
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (decision === "approve") {
    if (who.length < 2) return { ok: false as const, error: "Type your full name to approve." };
    const { error } = await admin.from("orders").update({ status: "approved", type: "invoice", approved_at: now, approved_name: who }).eq("id", orderId).eq("status", "quote_sent");
    if (error) return { ok: false as const, error: error.message };
    await admin.from("order_events").insert([{ order_id: orderId, kind: "approved", detail: `Signed "${who}" on their order page`, actor }, { order_id: orderId, kind: "status", detail: "approved", actor }]);
    if (SHOP_NOTIFY_EMAIL && !quiet) await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `Quote #${o.number} approved`, html: emailLayout(settings.shop.name, `${who} approved quote #${o.number}`, `${o.nickname || "Order"} · ${money(o.total || 0)}`, "Open order", `${siteUrl()}/shop/orders/${orderId}`) });
    return { ok: true as const };
  }
  // declined: back to us as a quote to fix, with their reason (Oct 29, Nick: "approve or decline and give the reason for
  // the decline, and then it'll send this back to us")
  if (!why) return { ok: false as const, error: "Tell us why, so we can fix it." };
  await admin.from("orders").update({ status: "quote" }).eq("id", orderId).eq("status", "quote_sent");
  await admin.from("order_events").insert([{ order_id: orderId, kind: "quote_declined", detail: `${who || "The customer"}: ${why.slice(0, 500)}`, actor }, { order_id: orderId, kind: "status", detail: "quote", actor }]);
  await admin.from("messages").insert({ order_id: orderId, author_type: "customer", author_email: actor, author_name: who || "Customer", body: `Declined the quote: ${why}` });
  if (SHOP_NOTIFY_EMAIL) await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `Quote #${o.number} declined`, html: emailLayout(settings.shop.name, `${who || "The customer"} declined quote #${o.number}`, `Why: ${why}`, "Open order", `${siteUrl()}/shop/orders/${orderId}`) });
  return { ok: true as const };
}

export type StepView = {
  key: string; kind: "art" | "sewout" | "quote" | "deposit"; title: string; sub: string;
  state: "todo" | "done" | "changes" | "locked"; pdf: string; sewoutId?: string;
  who?: string; when?: string; comment?: string; amount?: number;
};
/** The order's customer page (an order link): every step waiting on the customer, in order, and where each stands. */
export async function orderSteps(admin: SupabaseClient, linkId: string) {
  const { openLink } = await import("@/lib/proofLinks");
  const link = await openLink(admin, linkId);
  if (!link || link.kind !== "order") return null;
  const { o: raw, customer, settings, pays } = await load(admin, link.order_id);
  const o = withoutShopPieces(raw);
  const [{ data: ps }, { data: sw }] = await Promise.all([
    admin.from("proofs").select("id, version, status, sent_at, decided_at, decided_name, customer_comment, archived_at, approved_via").eq("order_id", o.id).not("version", "is", null).is("archived_at", null),
    admin.from("sewouts").select("id, imprint_id, version, status, sent_at, decided_at, decided_name, customer_comment, archived_at").eq("order_id", o.id).is("archived_at", null).not("sent_at", "is", null).order("created_at"),
  ]);
  const base = `/print/${o.id}`, q = `link=${linkId}`;
  const steps: StepView[] = [];
  const live = (ps || []) as (Proof & { approved_via?: string | null })[];
  if (live.length && live.some((p) => p.sent_at)) {
    const st = live.some((p) => p.status === "pending") ? "todo" : live.some((p) => p.status === "changes") ? "changes" : "done";
    const d = live.find((p) => p.decided_at);
    const prints = [...new Set(orderGroups(o).flatMap((g) => (g.imprints || []).map((x) => x.location).filter(Boolean)))].join(", ");
    steps.push({ key: "art", kind: "art", title: st === "done" ? "Proof approved" : st === "changes" ? "Proof: changes asked" : "Approve your proof", sub: `Version ${live[0].version}${prints ? ` · ${prints}` : ""}`, state: st, pdf: `${base}?proof=1&${q}`, who: d?.decided_name || "", when: d?.decided_at || "", comment: d?.customer_comment || "" });
  }
  for (const s of (sw || []) as { id: string; imprint_id: string; version: number; status: string; decided_at: string | null; decided_name: string | null; customer_comment: string }[]) {
    let where = ""; for (const g of orderGroups(o)) for (const im of g.imprints || []) if (im.id === s.imprint_id) where = im.location;
    const st = s.status === "pending" ? "todo" : s.status === "changes" ? "changes" : "done";
    steps.push({ key: `sew:${s.id}`, kind: "sewout", sewoutId: s.id, title: st === "done" ? "Sew-out approved" : st === "changes" ? "Sew-out: changes asked" : "Approve your sew-out", sub: `Version ${s.version}${where ? ` · ${where}` : ""}`, state: st, pdf: `${base}?sewout=${s.id}&${q}`, who: s.decided_name || "", when: s.decided_at || "", comment: s.customer_comment || "" });
  }
  const proofOpen = steps.some((x) => x.state === "todo");
  const c = calcOrder(o, settings, pays);
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const quoted = o.status === "quote_sent", approved = !["quote", "request", "quote_sent"].includes(o.status);
  if (quoted || (approved && raw.approved_at)) {
    const up = upFront(customer?.payment_terms, c.total, settings.depositPct);
    steps.push({ key: "quote", kind: "quote", title: approved ? "Quote approved" : "Approve your quote", sub: approved ? money(c.total) : `${money(c.total)} · ${up.line}`, state: approved ? "done" : proofOpen ? "locked" : "todo", pdf: `${base}?${q}`, who: raw.approved_name || "", when: raw.approved_at || "", amount: c.total });
  }
  // the payment up front, only when their terms ask for one (lib/payTerms.ts): none on receipt or net 30
  const upNow = upFront(customer?.payment_terms, c.total, settings.depositPct);
  if (approved && c.total > 0 && upNow.kind !== "none") {
    const dep = Math.round(c.total * upNow.pct) / 100;
    const paid = c.paid || 0;
    steps.push({ key: "deposit", kind: "deposit", title: paid >= dep - 0.005 ? (c.balance <= 0.005 ? "Paid in full" : "Deposit paid") : upNow.pay, sub: paid >= dep - 0.005 ? `Balance ${money(Math.max(0, c.balance))}` : upNow.kind === "full" ? `${money(dep)} due` : `${money(dep)} to start`, state: paid >= dep - 0.005 ? "done" : "todo", pdf: `${base}?${q}`, amount: dep });
  }
  return { link, o, customer, settings, steps, total: c.total };
}
