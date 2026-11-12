import "server-only";
import { approveItems } from "@/lib/simpleOrdersServer";
import { orderSubject } from "@/lib/orderSubject";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { EMAIL_DOC_PIC, emailBrandBar, emailButton, emailLayout, emailThumb, sendEmail, siteUrl } from "@/lib/email";
import { calcOrder, mergeSettings, orderGroups, withoutShopPieces, type Order, type Payment, type PayTerms, type Proof, type Settings } from "@/lib/pricing";
import { upFront } from "@/lib/payTerms";
import { fmtPhone } from "@/lib/phone";
import { fullColorWaiting } from "@/lib/fullColor";
import { proofLinkFor, proofUrl } from "@/lib/proofLinks";
import { matchGoodsSoon } from "@/lib/goodsSoon";

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
export type Pick3 = { proof?: boolean; quote?: boolean; sewouts?: string[]; note?: string;
  /** who gets it this time (Nov 3, Nick: "four different people… I don't need to send Stephanie… override settings and just
   *  send to this person"): the account's people ticked; unset, their email settings decide. Never saved as the settings. */ to?: string[];
  /** from the staff member's own mailbox instead of the portal's (Nov 3, Nick: "send it through my own email… the look and
   *  feel of the email"), and the email of theirs it answers (the same thread) */ fromMe?: boolean; reply?: { messageId: string } | null;
  /** from their own mailbox: what they wrote to go under the card ("Please let me know if this is approved.") */ after?: string };
/** a staff member's own mailbox (lib/mail/config.ts) */
type Box = import("@/lib/mail/config").MailAccount & { signature_html?: string | null; signature_css?: string | null; signature_on?: boolean | null };
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

/** the final invoice's terms line, under its title */
function invoiceTerms(terms: PayTerms | null | undefined, c: { total: number; paid: number; balance: number }, depositPct: number) {
  const m = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (c.paid > 0.005) return `${m(c.paid)} paid · ${m(Math.max(0, c.balance))} balance`;
  const up = upFront(terms, c.total, depositPct);
  return terms === "net30" ? "Net 30 terms" : up.kind === "full" ? "Paid up front" : up.kind === "deposit" ? `${up.pct === 50 ? "Half" : `${up.pct}%`} to start, the rest when it's ready` : "Due on receipt";
}

/** who at the customer gets proofs and approvals, as one line ("a@x.com, b@x.com"; lib/customerEmails.ts) */
async function approvalsTo(admin: SupabaseClient, o: Order, customer: { email?: string | null } | null) {
  if (!o.customer_id) return customer?.email || "";
  const { peopleOf } = await import("@/lib/customerEmailServer"); const { recipientsOf } = await import("@/lib/customerEmails");
  const pp = await peopleOf(admin, o.customer_id);
  return recipientsOf(pp.prefs, "approvals", pp.people).join(", ") || customer?.email || "";
}

/** the account's people (who can get email) and who gets this one: the ones picked for this send, else whoever their
 *  email settings send approvals to, else the main email */
async function recipientsFor(admin: SupabaseClient, o: Order, customer: { email?: string | null } | null, pick?: Pick3) {
  let people: { email: string; name: string }[] = [], list: string[] = [];
  if (o.customer_id) {
    const { peopleOf } = await import("@/lib/customerEmailServer"); const { recipientsOf } = await import("@/lib/customerEmails");
    const pp = await peopleOf(admin, o.customer_id);
    people = pp.people.map((x) => ({ email: x.email.toLowerCase(), name: x.name }));
    list = recipientsOf(pp.prefs, "approvals", pp.people);
  }
  if (!list.length && customer?.email) list = [customer.email.toLowerCase()];
  // billed to a department (lib/billTo.ts): its contact gets it first, the account's own people still copied
  const bill = (o as { bill_to?: { dept?: string; email?: string } | null }).bill_to, be = String(bill?.dept ? bill.email || "" : "").trim().toLowerCase();
  if (be) { list = [be, ...list.filter((e) => e !== be)]; if (!people.some((x) => x.email === be)) people.unshift({ email: be, name: "" }); }
  if (customer?.email && !people.some((x) => x.email === customer.email!.toLowerCase())) people.unshift({ email: customer.email.toLowerCase(), name: "" });
  if (pick?.to) {
    // a person on file, or someone else at the company's own domain (a new person who wrote in)
    const doms = companyDomains(people.map((x) => x.email));
    list = [...new Set(pick.to.map((e) => e.trim().toLowerCase()))].filter((e) => people.some((x) => x.email === e) || (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e) && doms.includes(domainOf(e))));
    for (const e of list) if (!people.some((x) => x.email === e)) people.push({ email: e, name: "" });
  }
  return { people, list };
}

/** free mail providers: a shared domain there says nothing about which company someone's with */
const PUBLIC_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|comcast|att|sbcglobal|verizon|protonmail|proton|gmx|mail)\./i;
const domainOf = (e: string) => (e.split("@")[1] || "").toLowerCase();
/** the company email domains of these addresses (not gmail and the like) */
export const companyDomains = (emails: string[]) => [...new Set(emails.map(domainOf).filter((d) => d.includes(".") && !PUBLIC_MAIL.test(d)))];

export type ReplyChoice = { messageId: string; subject: string; from: string; fromEmail: string; at: string; /** the one we think this send answers */ likely?: boolean;
  /** a message on the order's own thread (the message center / portal), not an email: messageId is "msg:<id>" */ thread?: boolean };
/** the order's own thread messages are offered as "msg:<id>" beside emails */
export const THREAD_PREFIX = "msg:";

/**
 * The emails this person has had lately from the account: from any of its people or anyone else at the company's own
 * domain (a new person at Fossil counts), newest first, with the one this send most likely answers marked and first
 * (Nov 3, Nick: "Fossil hasn't emailed me in like 4 weeks. All of a sudden I'm emailing them a quote… can't you just read
 * and go like, hey, we think you're responding to Michael here"). Likely = the newest that names this job (its words or
 * its number), else the newest from the last 30 days; nothing when no one's written in that time.
 */
export async function replyChoices(admin: SupabaseClient, box: Box, emails: string[], job?: { name?: string; number?: number | null; orderId?: string }) {
  const em = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  const doms = companyDomains(em).filter((d) => d !== domainOf(box.email || ""));
  // what the customer wrote on this order itself (the message center, the portal, a text): it's about this job by
  // definition, so it's what a send answers before any email (Nov 5, Nick: Michael asked for changes on #40472 in the
  // message center; the send offered to answer Kayla's email about another job)
  const { data: tm } = job?.orderId ? await admin.from("messages").select("id, body, author_name, author_email, created_at").eq("order_id", job.orderId)
    .eq("author_type", "customer").is("hidden_at", null).gte("created_at", new Date(Date.now() - 90 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(5) : { data: [] };
  const thread: ReplyChoice[] = ((tm || []) as { id: string; body: string | null; author_name: string | null; author_email: string | null; created_at: string }[])
    .filter((m) => /@/.test(m.author_email || ""))
    .map((m) => ({ messageId: `${THREAD_PREFIX}${m.id}`, subject: `Message center: ${String(m.body || "").replace(/\s+/g, " ").slice(0, 60)}`, from: m.author_name || String(m.author_email), fromEmail: String(m.author_email).toLowerCase(), at: m.created_at, thread: true }));
  if (!em.length && !doms.length) { if (thread[0]) thread[0].likely = true; return thread; }
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  // the mailbox's saved emails (mail_cache: what came in today is there first) and its search index (older ones), newest first
  // (Nov 3, Nick: Michael's email from that morning wasn't offered: it wasn't in the index yet)
  const clean = (x: string) => x.replace(/[,()%*]/g, "");
  const who = [...em.map((e) => `from_email.ilike.${clean(e)}`), ...doms.map((d) => `from_email.ilike.%@${clean(d)}`)].join(",");
  const [{ data: a }, { data: b }] = await Promise.all([
    admin.from("mail_cache").select("message_id, subject, from_name, from_email, sent_at").eq("account_id", box.id).or(who).is("gone_at", null).gte("sent_at", since).not("message_id", "is", null).order("sent_at", { ascending: false }).limit(40),
    admin.from("mail_index").select("message_id, subject, from_name, from_email, sent_at").eq("account_id", box.id).or(who).gte("sent_at", since).not("message_id", "is", null).order("sent_at", { ascending: false }).limit(40),
  ]);
  const data = [...(a || []), ...(b || [])].sort((x, y) => String(y.sent_at).localeCompare(String(x.sent_at)));
  const seen = new Set<string>(), out: ReplyChoice[] = [];
  for (const r of data as { message_id: string; subject: string | null; from_name: string | null; from_email: string; sent_at: string }[]) {
    if (!r.message_id || seen.has(r.message_id)) continue; seen.add(r.message_id);
    out.push({ messageId: r.message_id, subject: r.subject || "(no subject)", from: r.from_name || r.from_email, fromEmail: String(r.from_email || "").toLowerCase(), at: r.sent_at });
    if (out.length >= 10) break;
  }
  // which one this send answers: one that names the job, else the newest lately
  const STOP = new Set(["the", "and", "for", "with", "shirts", "shirt", "tees", "order", "quote", "new"]);
  const words = String(job?.name || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const names = (subj: string) => { const t = subj.toLowerCase(); return (!!job?.number && t.includes(String(job.number))) || (words.length > 0 && words.filter((w) => t.includes(w)).length >= Math.min(2, words.length)); };
  const fresh = (c: ReplyChoice) => Date.now() - new Date(c.at).getTime() < 30 * 864e5;
  // the newest of: their messages on this order and the emails that name this job; an email about nothing in particular
  // only when neither exists
  const about = [...thread, ...out.filter((c) => names(c.subject))].sort((x, y) => y.at.localeCompare(x.at));
  const all = [...thread, ...out];
  const best = about[0] || out.find(fresh);
  if (best) { best.likely = true; all.splice(all.indexOf(best), 1); all.unshift(best); }
  return all;
}

/** the email as it goes from someone's own mailbox: what they wrote, the portal email's card (the look and the Review
 *  button), their signature, and the email it answers quoted under it, in the same thread */
async function mineEmail(admin: SupabaseClient, box: Box, card: { subject: string; html: string }, pick: Pick3, firstName: string) {
  const { replyHtml, replyText, inlineImages } = await import("@/lib/mail/compose");
  let quote: { from: string; sent: string; to: string; cc?: string; subject: string; html?: string; text: string } | undefined, subject = card.subject, refs: string[] = [], inReplyTo = "";
  if (pick.reply?.messageId?.startsWith(THREAD_PREFIX)) {
    // answering their message on the order's thread: it's quoted under the email (the reply itself lands on the thread too)
    const { data: m } = await admin.from("messages").select("body, author_name, author_email, created_at").eq("id", pick.reply.messageId.slice(THREAD_PREFIX.length)).maybeSingle();
    if (m) {
      const sent = new Date(m.created_at).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" at ", " ");
      quote = { from: `${m.author_name || ""} <${m.author_email || ""}>`.trim(), sent, to: "FBS message center", subject: card.subject, text: String(m.body || "") };
    }
  } else if (pick.reply?.messageId) {
    // the saved copy first (newest emails are there before the index), else the index
    const { data: mc } = await admin.from("mail_cache").select("message_id, in_reply_to, subject, from_name, from_email, to_text, sent_at, body_text, body_html, refs, cc_text").eq("account_id", box.id).eq("message_id", pick.reply.messageId).limit(1).maybeSingle();
    const { data: ix0 } = mc ? { data: null } : await admin.from("mail_index").select("message_id, in_reply_to, subject, from_name, from_email, to_text, sent_at").eq("account_id", box.id).eq("message_id", pick.reply.messageId).limit(1).maybeSingle();
    const ix = mc || ix0;
    if (ix) {
      const x = ix as { message_id: string; in_reply_to: string | null; subject: string | null; from_name: string | null; from_email: string; to_text: string | null; sent_at: string };
      const c = mc as { body_text: string | null; body_html: string | null; refs: string[] | null; cc_text: string | null } | null;
      inReplyTo = x.message_id; refs = [...(c?.refs || (x.in_reply_to ? [x.in_reply_to] : [])), x.message_id].filter(Boolean).slice(-20);
      subject = /^re:/i.test(x.subject || "") ? String(x.subject) : `Re: ${x.subject || card.subject}`;
      const sent = new Date(x.sent_at).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" at ", " ");
      if (c?.body_text || c?.body_html) quote = { from: `${x.from_name || ""} <${x.from_email}>`.trim(), sent, to: x.to_text || "", cc: c?.cc_text || "", subject: x.subject || "", html: c?.body_html && c.body_html.length < 1_500_000 ? c.body_html : "", text: c?.body_text || "" };
    }
  }
  const typed = pick.note?.trim() || `Hi ${firstName},\n\nThank you for the quote request. Please review your quote below.`;
  const after = pick.after ?? "Please let me know if this is approved.";
  const signature = box.signature_on !== false ? box.signature_html || "" : "";
  const page = replyHtml({ body: typed, signature, css: signature ? box.signature_css : "", quote, card: card.html, after });
  const { html, attachments } = inlineImages(page);
  return { subject, html, attachments, text: replyText({ body: typed, after, signature, quote }), inReplyTo, refs };
}

/** what could go to the customer now, and what's ticked to start with (what's ready) */
export async function sendOptions(admin: SupabaseClient, orderId: string) {
  const { o, customer, settings, pays } = await load(admin, orderId);
  const [{ data: mk }, { data: ps }, { data: sw }] = await Promise.all([
    admin.from("mockups").select("id").eq("order_id", orderId).is("archived_at", null),
    admin.from("proofs").select("id, version, status, mockup_id, archived_at, approved_via, decided_name, decided_at").eq("order_id", orderId).not("version", "is", null),
    admin.from("sewouts").select("id, order_id, imprint_id, version, status, sent_at, sent_to, archived_at, photo_path, created_at").eq("order_id", orderId).is("archived_at", null),
  ]);
  const mocks = (mk || []) as { id: string }[], proofs = (ps || []) as (Pick<Proof, "id" | "version" | "status" | "mockup_id" | "archived_at"> & { approved_via?: string | null; decided_name?: string | null; decided_at?: string | null })[];
  const live = proofs.filter((p) => !p.archived_at);
  const unsent = mocks.length > 0 && mocks.some((m) => !live.some((p) => p.mockup_id === m.id));
  const nextV = (proofs.length ? Math.max(...proofs.map((p) => p.version || 0)) : 0) + 1;
  const c = calcOrder(o, settings, pays);
  const quoteOpen = ["quote", "request", "quote_sent"].includes(o.status);
  // after the quote's approved, the price goes as the final invoice: embroidery isn't final until the sew-out gives the
  // stitch count (Oct 29, Nick: "now that you've got the sew-out… you know exactly what it's going to cost, you send")
  const invoiceOpen = !quoteOpen && !["completed", "void"].includes(o.status);
  const { data: invSent } = invoiceOpen ? await admin.from("order_events").select("id").eq("order_id", orderId).eq("kind", "invoice_sent").limit(1) : { data: [] };
  const where = (imprintId: string) => { for (const g of orderGroups(o)) for (const im of g.imprints || []) if (im.id === imprintId) return `${im.location}${im.size ? `, ${im.size}` : ""}`; return "Sew-out"; };
  const sews = ((sw || []) as SewRow[]).filter((x) => x.status === "pending").map((x) => ({ id: x.id, label: `Sew-out v${x.version} · ${where(x.imprint_id)}`, sent: !!x.sent_at }));
  const rc = await recipientsFor(admin, o, customer);
  return {
    to: await approvalsTo(admin, o, customer), name: customer?.company || customer?.name || "",
    people: rc.people.map((x) => ({ ...x, on: rc.list.includes(x.email) })),
    proof: mocks.length ? { version: unsent ? nextV : live[0]?.version || nextV, mockups: mocks.length, unsent, waiting: !unsent && live.some((p) => p.status === "pending"),
      /** the art out there is already approved (Nov 10, Nick, #40444): who and how, so sending a new proof is never a surprise */
      approved: live.length > 0 && live.every((p) => p.status === "approved") ? { version: live[0].version, by: live[0].decided_name || "", at: live[0].decided_at || "", another: live.some((p) => p.approved_via === "staff") } : null } : null,
    // what's due when they approve, by their terms (lib/payTerms.ts)
    quote: quoteOpen ? { kind: "quote" as const, total: c.total, status: o.status, sent: o.status === "quote_sent", deposit: upFront(customer?.payment_terms, c.total, settings.depositPct).amount, due: upFront(customer?.payment_terms, c.total, settings.depositPct).line }
      : invoiceOpen ? { kind: "invoice" as const, total: c.total, status: o.status, sent: !!(invSent || []).length, deposit: 0, due: invoiceTerms(customer?.payment_terms, c, settings.depositPct) } : null,
    sewouts: sews,
  };
}

/** the steps an email lists, from what was ticked */
async function emailFor(admin: SupabaseClient, o: Order, customer: { name: string; company?: string | null; payment_terms?: PayTerms | null } | null, settings: Settings, pick: Pick3, url: string,
  /** under someone's own reply (Nov 3, Nick: "I'm going to type… hi Michael, please see below… it's a little redundant for it to
   *  say the same thing in the thing below… just say your proof is ready… make that box a little smaller"): no greeting or
   *  lines of its own, smaller */ compact = false) {
  const sh = settings.shop;
  const groups = orderGroups(o);
  const blocks: { k: string; title: string; /** each its own line (Oct 29, Nick: "no cutoffs… everything should be its own kind of line") */ sub: string[]; pic?: string }[] = [];
  if (pick.proof) {
    const { data: mk } = await admin.from("mockups").select("file_path").eq("order_id", o.id).is("archived_at", null).order("created_at").limit(1).maybeSingle();
    const { data: su } = mk ? await admin.storage.from("proofs").createSignedUrl(String(mk.file_path).replace(/\.png$/, "-thumb.png"), 60 * 60 * 24 * 30) : { data: null };
    const prints = [...new Set(groups.flatMap((g) => (g.imprints || []).map((d) => d.location).filter(Boolean)))].join(", ");
    blocks.push({ k: "proof", title: "Approve your proof", sub: [prints], pic: su?.signedUrl || undefined });
  }
  for (const id of pick.sewouts || []) {
    const { data: sw } = await admin.from("sewouts").select("imprint_id, version, photo_path").eq("id", id).maybeSingle();
    if (!sw) continue;
    const { data: su } = await admin.storage.from("proofs").createSignedUrl(sw.photo_path, 60 * 60 * 24 * 30);
    let where = ""; for (const g of groups) for (const im of g.imprints || []) if (im.id === sw.imprint_id) where = `${im.location}${im.size ? `, ${im.size}` : ""}`;
    blocks.push({ k: "sewout", title: "Approve your sew-out", sub: ["A photo of your logo stitched on our machine", where], pic: su?.signedUrl || undefined });
  }
  if (pick.quote) {
    const c = calcOrder(o, settings, []);
    const m = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
    // under the title, what's due when they approve, by their terms (Oct 29, Nick: "nothing due, due on receipt, half due today…")
    if (["quote", "request", "quote_sent"].includes(o.status)) blocks.push({ k: "quote", title: `Approve your quote · ${m(c.total)}`, sub: upFront(customer?.payment_terms, c.total, settings.depositPct).line.split(" · ") });
    else blocks.push({ k: "quote", title: `Review your final invoice · ${m(c.total)}`, sub: [(pick.sewouts || []).length ? "With the stitch count from your sew-out" : "", invoiceTerms(customer?.payment_terms, c, settings.depositPct)] });
  }
  const esc = (t: string) => (t || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  const has = (k: string) => blocks.some((b) => b.k === k);
  const inv = has("quote") && !["quote", "request", "quote_sent"].includes(o.status), price = inv ? "final invoice" : "quote";
  const head = has("quote") && (has("proof") || has("sewout")) ? `Your ${has("sewout") && !has("proof") ? "sew-out" : "proof"} and ${price} are ready` : has("quote") ? `Your ${price} is ready` : has("sewout") && !has("proof") ? "Your sew-out is ready to approve" : "Your proof is ready to approve";
  const job = o.nickname || `order #${o.number}`;
  const up = upFront(customer?.payment_terms, calcOrder(o, settings, []).total, settings.depositPct);
  const payNow = up.kind === "full" ? "pay for it" : up.kind === "deposit" ? "pay the deposit" : "";
  const first = ((customer?.name || "").trim().split(/\s+/)[0]) || "there";
  const many = blocks.length > 1;
  const logo = sh.logoUrl ? (/^https?:/.test(sh.logoUrl) ? sh.logoUrl : `${siteUrl()}${sh.logoUrl.startsWith("/") ? "" : "/"}${sh.logoUrl}`) : `${siteUrl()}/brand/fbs-logo.png`;
  const rows = blocks.map((b, i) => `<tr><td style="padding:6px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E6EAF0;border-radius:8px"><tr><td style="width:60px;padding:10px 0 10px 10px;vertical-align:top">${emailThumb(b.pic || EMAIL_DOC_PIC(), 56)}</td><td style="padding:10px 12px;vertical-align:top">${many ? `<div style="font-size:11px;color:#6B7686;text-transform:uppercase;letter-spacing:.05em">Step ${i + 1}</div>` : ""}<div style="font-size:14px;font-weight:700;color:#141D2B">${esc(b.title)}</div>${b.sub.filter(Boolean).map((x) => `<div style="font-size:13px;color:#6B7686">${esc(x)}</div>`).join("")}</td></tr></table></td></tr>`).join("");
  // the greeting, what's ready, the order, what to do: each its own line
  // plain words (Nov 2, Nick: "hi name… with the company… please see your proof and quote below. Let us know if this is
  // approved")
  const seeWhat = has("quote") && (has("proof") || has("sewout")) ? `${has("sewout") && !has("proof") ? "sew-out" : "proof"} and ${price}` : has("quote") ? price : has("sewout") && !has("proof") ? "sew-out" : "proof";
  const lead = `Please see your ${seeWhat} below.`;
  const ending = "Let us know if this is approved.";
  const intro = `<div>${esc(lead)}</div><div style="margin-top:12px;padding:10px 12px;background:#F6F7F9;border-radius:8px"><div style="font-weight:700;color:#141D2B">${esc(job)}</div><div style="font-size:13px;color:#6B7686">Order #${o.number}</div></div><div style="margin-top:12px">${esc(ending)}</div>`;
  const contact = [fmtPhone(sh.phone), sh.email].filter(Boolean).map(esc).join(" · ");
  const html = compact ? `<div style="padding:8px 0;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:420px;width:100%;margin:0;background:#ffffff;border:1px solid #E3E7EE;border-radius:10px;border-collapse:separate;box-shadow:0 2px 12px rgba(20,29,43,0.14)">
${emailBrandBar(siteUrl(), sh.name, sh.logoUrl ? logo : "")}
<tr><td style="padding:16px 18px 2px;color:#141D2B"><div style="font-size:17px;font-weight:700;margin:0 0 8px">${esc(head)}</div>
<div style="padding:8px 10px;background:#F6F7F9;border-radius:8px"><div style="font-size:14px;font-weight:700;color:#141D2B">${esc(job)}</div><div style="font-size:12px;color:#6B7686">Order #${o.number}</div></div></td></tr>
<tr><td style="padding:6px 18px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">${rows}</table></td></tr>
<tr><td style="padding:8px 18px 16px;text-align:center">${emailButton(url, "Review and approve")}</td></tr>
</table></div>` : `<div style="padding:16px 12px;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #E3E7EE;border-radius:10px;border-collapse:separate;box-shadow:0 2px 12px rgba(20,29,43,0.14)">
${emailBrandBar(siteUrl(), sh.name, sh.logoUrl ? logo : "")}
<tr><td style="padding:22px 24px 4px;color:#141D2B"><div style="font-size:20px;font-weight:700;margin:0 0 10px">${esc(head)}</div>
<div style="font-size:15px;line-height:1.5;color:#3C475A"><div style="margin-bottom:6px">Hi ${esc(first)}${customer?.company && customer.company.trim().toLowerCase() !== (customer?.name || "").trim().toLowerCase() ? ` with ${esc(customer.company.trim())}` : ""},</div>${intro}</div>
${pick.note?.trim() ? `<div style="font-size:14px;line-height:1.5;color:#3C475A;margin-top:10px;white-space:pre-line">${esc(pick.note.trim())}</div>` : ""}</td></tr>
<tr><td style="padding:10px 24px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">${rows}</table></td></tr>
<tr><td style="padding:10px 24px 6px;text-align:center">${emailButton(url, "Review and approve")}</td></tr>
<tr><td style="padding:8px 24px 18px;text-align:center;font-size:12px;color:#6B7686">Please use the button, not a reply, so it goes straight onto your order.</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #EEF1F5;font-size:12px;color:#6B7686">${esc(sh.name)}${contact ? ` · ${contact}` : ""}</td></tr>
</table></div>`;
  const what = has("quote") && (has("proof") || has("sewout")) ? `${has("sewout") && !has("proof") ? "Sew-out" : "Proof"} and ${inv ? "invoice" : "quote"}` : has("quote") ? (inv ? "Invoice" : "Quote") : has("sewout") && !has("proof") ? "Sew-out" : "Proof";
  return { subject: orderSubject(o.number, `${what} ready for approval`, o.nickname), html };
}

/** the preview: the email as it would go, before anything is made */
export async function previewSend(admin: SupabaseClient, orderId: string, pick: Pick3, box?: Box | null) {
  const { o, customer, settings } = await load(admin, orderId);
  if (!pick.proof && !pick.quote && !(pick.sewouts || []).length) return { ok: false as const, error: "Tick what to send." };
  const { list, people } = await recipientsFor(admin, o, customer, pick);
  const hi = firstOf(customer, list, people);
  if (pick.fromMe && box) {
    const card = await emailFor(admin, withoutShopPieces(o), greeted(customer, hi), settings, { ...pick, note: "" }, `${siteUrl()}/proof/preview`, true);
    const mine = await mineEmail(admin, box, card, pick, hi);
    // the preview shows the pictures as they are (the attached copies are for the real email)
    return { ok: true as const, to: list.join(", "), subject: mine.subject, html: previewOf(mine.html, mine.attachments), from: `${box.name || box.email} <${box.email}>` };
  }
  // the portal sends one to each person, each greeted by name: the preview greets the first
  const em = await emailFor(admin, withoutShopPieces(o), greeted(customer, firstOf(customer, list.slice(0, 1), people)), settings, pick, `${siteUrl()}/proof/preview`);
  return { ok: true as const, to: list.join(", "), ...em, from: "" };
}
/** the first names to greet: the people it goes to ("Michael", "Michael and Anna"), else the customer's main contact
 *  (Nov 3, Nick: sent to Michael, it said "Hi Stephanie", the main contact) */
function firstOf(customer: { name?: string | null } | null, list: string[], people: { email: string; name: string }[] = []) {
  // a name that's only an email address isn't a name to greet
  const firsts = list.map((e) => (people.find((p) => p.email === e)?.name || "").trim().split(/\s+/)[0]).filter((x) => x && !x.includes("@"));
  if (firsts.length && firsts.length === list.length && firsts.length <= 3) return firsts.length === 1 ? firsts[0] : `${firsts.slice(0, -1).join(", ")} and ${firsts[firsts.length - 1]}`;
  return ((customer?.name || "").trim().split(/\s+/)[0]) || "there";
}
/** the customer as the email greets them: by the people it goes to */
const greeted = <T extends { name: string } | null>(customer: T, first: string): T => (customer ? { ...customer, name: first } : customer);
/** an email with attached pictures (cid:) shown as it will look, the pictures put back in */
function previewOf(html: string, atts: { cid?: string; content: Buffer; contentType: string }[]) {
  let out = html;
  for (const a of atts) if (a.cid) out = out.split(`cid:${a.cid}`).join(`data:${a.contentType};base64,${a.content.toString("base64")}`);
  return out;
}

/**
 * Make what was ticked (the proof version, the quote sent, the sew-outs sent) and email it (email=false: only made, the
 * link to copy). Returns the order's page link.
 */
export async function sendTogether(admin: SupabaseClient, orderId: string, pick: Pick3, me: Staff, email = true, box?: Box | null) {
  const { o, customer, settings } = await load(admin, orderId);
  if (!pick.proof && !pick.quote && !(pick.sewouts || []).length) return { ok: false as const, error: "Tick what to send." };
  // who gets it: the people picked for this send, else who at the customer gets proofs and approvals (their email
  // settings, lib/customerEmails.ts; the main email if unset)
  const { list, people } = await recipientsFor(admin, o, customer, pick);
  const to = list.join(", ");
  if (email && !to) return { ok: false as const, error: pick.to ? "Tick who gets it." : "This customer has no email address. Add one, or copy the link and send it yourself." };
  if (email && pick.fromMe && !box) return { ok: false as const, error: "Your mailbox isn't connected here. Send it from FBS Print, or connect your email in Settings first." };
  const sentTo = email ? to : "link copied";
  // a full color print waits for production's colors (and so the price) before the quote goes out (Oct 26, Nick)
  if (pick.quote && orderGroups(o).some((g) => (g.imprints || []).some(fullColorWaiting)))
    return { ok: false as const, error: "Production hasn't confirmed the full color print yet (its colors set the price). Send the proof now, and the quote after that." };
  if (pick.quote && ["completed", "void"].includes(o.status)) return { ok: false as const, error: "This order is closed." };
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
  if (pick.quote && !["quote", "request", "quote_sent"].includes(o.status)) {
    // approved already: the final invoice goes for them to look over (and approve, on their order page)
    await admin.from("order_events").insert({ order_id: orderId, kind: "invoice_sent", detail: email ? to : "link copied", actor: me.email });
    done.push("the invoice");
  } else if (pick.quote) {
    const patch: Record<string, unknown> = { sent_at: new Date().toISOString() };
    if (o.status !== "quote_sent") patch.status = "quote_sent";
    await admin.from("orders").update(patch).eq("id", orderId);
    if (patch.status) await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: "quote_sent", actor: me.email });
    await admin.from("order_events").insert({ order_id: orderId, kind: "sent", detail: email ? to : "link copied", actor: me.email });
    done.push("the quote");
    // sent to the customer: the order teaches Create order (lib/ai/orderExamples.ts), as the old quote-only send did
    { const { saveExample } = await import("@/lib/ai/orderExamples"); await saveExample(admin, orderId, me.email).catch((e) => console.warn("saveExample", e)); }
  }
  // sent to the customer: its goods may already be here or on the way (lib/goodsSoon.ts)
  matchGoodsSoon();
  // a note starts the message thread they see too (not already said with the proof)
  if (pick.note?.trim() && !pick.proof) await admin.from("messages").insert({ order_id: orderId, author_type: "staff", author_email: me.email, author_name: settings.shop.name, body: pick.note.trim().slice(0, 2000) });
  // anything sent is an answer: with no proof or note said on the thread, say what went, so the Message Center sees the
  // conversation as replied (Nov 5, Nick: "we replied to Michael… it shouldn't be there now")
  else if (email && !pick.proof && done.length) await admin.from("messages").insert({ order_id: orderId, author_type: "staff", author_email: me.email, author_name: settings.shop.name, body: `Sent ${done.join(" and ")}.` });
  const url = proofUrl(await proofLinkFor(admin, { kind: "order", orderId, to: email ? list[0] : undefined, by: me.email }));
  if (!email) return { ok: true as const, url, emailed: false, done };
  const { data: fresh } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  let emailed = false;
  if (pick.fromMe && box) {
    // one email from their own mailbox to everyone picked, in the thread it answers, kept in their Sent Items
    const hi = firstOf(customer, list, people);
    const card = await emailFor(admin, withoutShopPieces(fresh as Order), greeted(customer, hi), settings, { ...pick, note: "" }, url, true);
    const mine = await mineEmail(admin, box, card, pick, hi);
    const { cfgOf } = await import("@/lib/mail/config"); const { sendFromMailbox } = await import("@/lib/mail/send");
    const { ewsReady, ewsSaveSent } = await import("@/lib/mail/ewsBox");
    const ews = await ewsReady(admin, box).catch(() => false);
    await sendFromMailbox(cfgOf(box), { to, subject: mine.subject, text: mine.text, html: mine.html, attachments: mine.attachments, inReplyTo: mine.inReplyTo || undefined, references: mine.refs },
      ews ? (raw) => ewsSaveSent(box, raw) : undefined);
    emailed = true;
    await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: `Sent from ${box.email}${mine.inReplyTo ? ` as a reply to "${mine.subject.replace(/^re:\s*/i, "")}"` : ""} to ${to}`, actor: me.email });
    return { ok: true as const, url, emailed, done };
  }
  for (const t of list) {
    const em = await emailFor(admin, withoutShopPieces(fresh as Order), greeted(customer, firstOf(customer, [t], people)), settings, pick, url);
    if (await sendEmail({ to: t, replyTo: SHOP_NOTIFY_EMAIL, subject: em.subject, html: em.html })) emailed = true;
  }
  return { ok: true as const, url, emailed, done };
}

/**
 * The customer's answer on the price, from their order page (Oct 29, Nick: "two small buttons under submit approval, one
 * that should say request changes and one that should say decline the quote… you got the sizes wrong"):
 *  approve  · the quote signed (the order's approved)
 *  changes  · the quote, or the final invoice, back to us with what to change (Revisions in the Job Center)
 *  decline  · they don't want it: a closed quote (completed, still a quote; lib/pricing.ts statusKey), marked declined
 *             with why (Declined in the Job Center)
 */
export async function decideQuote(admin: SupabaseClient, orderId: string, decision: "approve" | "changes" | "decline", name: string, reason: string, actor: string, /** the caller sends one shop email for everything */ quiet = false) {
  const { o, settings } = await load(admin, orderId);
  const who = name.trim().slice(0, 120), why = reason.trim().slice(0, 2000);
  const now = new Date().toISOString();
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  // the shop's email names the company, what they did and the order, with its picture (lib/shopNotice.ts)
  const shop = (did: string, head: string, body: string) => SHOP_NOTIFY_EMAIL && !quiet ? import("@/lib/shopNotice").then((m) => m.notifyShopAbout(admin, orderId, { did, head, body, shopName: settings.shop.name })) : Promise.resolve(false);
  // changes on the final invoice (the order's already approved): it stays approved, the shop fixes the invoice
  if (decision === "changes" && o.status !== "quote_sent") {
    if (["quote", "request", "completed", "void"].includes(o.status)) return { ok: false as const, error: "This was already answered or changed. Refresh the page." };
    if (!why) return { ok: false as const, error: "Tell us what to change." };
    await admin.from("order_events").insert({ order_id: orderId, kind: "invoice_changes", detail: `${who || "The customer"}: ${why.slice(0, 500)}`, actor });
    await admin.from("messages").insert({ order_id: orderId, author_type: "customer", author_email: actor, author_name: who || "Customer", body: `Changes to the final invoice: ${why}` });
    await shop("asked for invoice changes", `${who || "The customer"} asked for changes to the final invoice on #${o.number}`, why);
    return { ok: true as const };
  }
  if (o.status !== "quote_sent") return { ok: false as const, error: "This quote was already answered or changed. Refresh the page." };
  if (decision === "approve") {
    if (who.length < 2) return { ok: false as const, error: "Type your full name to approve." };
    const { error } = await admin.from("orders").update({ status: "approved", type: "invoice", approved_at: now, approved_name: who }).eq("id", orderId).eq("status", "quote_sent");
    if (error) return { ok: false as const, error: error.message };
    await approveItems(admin, orderId, who || actor || "customer", now);
    await admin.from("order_events").insert([{ order_id: orderId, kind: "approved", detail: `Signed "${who}" on their order page`, actor }, { order_id: orderId, kind: "status", detail: "approved", actor }]);
    await (await import("@/lib/autoSeps")).autoSeparations(admin, orderId, "quote approved");
    await shop("approved the quote", `${who} approved quote #${o.number}`, `${o.nickname || "Order"} · ${money(o.total || 0)}`);
    matchGoodsSoon();
    return { ok: true as const };
  }
  if (!why) return { ok: false as const, error: decision === "changes" ? "Tell us what to change." : "Tell us why, so we can fix it." };
  // changes: the quote comes back to us to work on; a decline closes it (a closed quote) and marks the job declined
  await admin.from("orders").update(decision === "decline" ? { status: "completed", declined_at: now, declined_reason: why.slice(0, 500) } : { status: "quote" }).eq("id", orderId).eq("status", "quote_sent");
  if (decision === "decline") await (await import("@/lib/closedQuote")).shelveClosedQuoteArt(admin, orderId, true);
  await admin.from("order_events").insert([
    { order_id: orderId, kind: decision === "decline" ? "quote_declined" : "quote_changes", detail: `${who || "The customer"}: ${why.slice(0, 500)}`, actor },
    { order_id: orderId, kind: "status", detail: decision === "decline" ? "closed" : "quote", actor },
    ...(decision === "decline" ? [{ order_id: orderId, kind: "job_declined", detail: `By the customer: ${why.slice(0, 300)}`, actor }] : []),
  ]);
  await admin.from("messages").insert({ order_id: orderId, author_type: "customer", author_email: actor, author_name: who || "Customer", body: `${decision === "decline" ? "Declined the quote" : "Changes to the quote"}: ${why}` });
  await shop(decision === "decline" ? "declined the quote" : "asked for quote changes", `${who || "The customer"} ${decision === "decline" ? "declined" : "asked for changes to"} quote #${o.number}`, `${decision === "decline" ? "Why" : "What to change"}: ${why}`);
  return { ok: true as const };
}

export type StepView = {
  key: string; kind: "art" | "sewout" | "quote" | "invoice" | "deposit"; title: string; sub: string;
  state: "todo" | "done" | "changes" | "locked"; pdf: string; sewoutId?: string;
  who?: string; when?: string; comment?: string; amount?: number;
  /** the quote is paid (in full or a deposit) as soon as it's approved: its button says so (Nov 3, Nick) */ payFirst?: boolean;
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
  // a closed quote (declined) was never approved: it shows as declined, with nothing to pay
  const closedQ = o.status === "completed" && o.type === "quote";
  const quoted = o.status === "quote_sent", approved = !closedQ && !["quote", "request", "quote_sent"].includes(o.status);
  // the quote sent back (changes asked, or declined): the customer's page says so rather than dropping the step
  const { data: qev } = await admin.from("order_events").select("kind, detail, created_at").eq("order_id", o.id).in("kind", ["sent", "quote_changes", "quote_declined", "invoice_sent", "invoice_changes", "invoice_approved"]).order("created_at");
  const qevs = (qev || []) as { kind: string; detail: string; created_at: string }[];
  const qSent = [...qevs].reverse().find((e) => e.kind === "sent");
  const qBack = [...qevs].reverse().find((e) => (e.kind === "quote_changes" || e.kind === "quote_declined") && (!qSent || e.created_at > qSent.created_at));
  if ((o.status === "quote" || closedQ) && qSent && qBack) {
    steps.push({ key: "quote", kind: "quote", title: qBack.kind === "quote_declined" ? "Quote declined" : "Quote: changes requested", sub: money(c.total), state: "changes", pdf: `${base}?${q}`, who: qBack.detail.split(":")[0], when: qBack.created_at, comment: qBack.detail.replace(/^[^:]*:\s*/, "") });
  }
  if (quoted || (approved && raw.approved_at)) {
    const up = upFront(customer?.payment_terms, c.total, settings.depositPct);
    steps.push({ key: "quote", kind: "quote", title: approved ? "Quote approved" : "Approve your quote", sub: approved ? money(c.total) : `${money(c.total)} · ${up.line}`, state: approved ? "done" : proofOpen ? "locked" : "todo", pdf: `${base}?${q}`, who: raw.approved_name || "", when: raw.approved_at || "", amount: c.total, payFirst: !approved && up.kind !== "none" && c.total > 0 });
  }
  // the final invoice, once it's been sent after approval (embroidery: the price is final with the sew-out's stitch count)
  if (approved && !["completed", "void"].includes(o.status)) {
    const { data: iev } = await admin.from("order_events").select("kind, detail, created_at").eq("order_id", o.id).in("kind", ["invoice_sent", "invoice_approved"]).order("created_at");
    const evs = (iev || []) as { kind: string; detail: string; created_at: string }[];
    const lastSent = [...evs].reverse().find((e) => e.kind === "invoice_sent");
    if (lastSent) {
      const ok = [...evs].reverse().find((e) => e.kind === "invoice_approved" && e.created_at > lastSent.created_at);
      const back = [...qevs].reverse().find((e) => e.kind === "invoice_changes" && e.created_at > lastSent.created_at);
      steps.push({ key: "invoice", kind: "invoice", title: ok ? "Invoice approved" : back ? "Invoice: changes requested" : "Review your final invoice", sub: `${money(c.total)} · ${invoiceTerms(customer?.payment_terms, c, settings.depositPct)}`, state: ok ? "done" : back ? "changes" : proofOpen ? "locked" : "todo", comment: back ? back.detail.replace(/^[^:]*:\s*/, "") : undefined, pdf: `${base}?${q}`, who: ok ? ok.detail.replace(/^Signed "(.*)".*$/, "$1") : "", when: ok?.created_at || "", amount: c.total });
    }
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
