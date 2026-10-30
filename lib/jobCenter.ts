import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcOrder, lineQty, mergeSettings, orderGroups, type Imprint, type Order } from "@/lib/pricing";
import { digitizeState } from "@/lib/digitizeStatus";
import { accountOwners } from "@/lib/accountOwners";
import { mailRows, type MailAct, type MailSug } from "@/lib/inbox";

/**
 * The Job Center (Oct 29, Nick: "this is basically where I'm going to keep everything pre-production… it doesn't always
 * flow… it goes 1, 2, 3, 4, 5, 6… and it goes 1, 4, 3, 5, 6… it brings the whole website together for our sales team").
 *
 * A job isn't one status walking steps in order: it has tracks that move on their own (the art, a sew-out, the numbers),
 * and it shows at every step it's at:
 *  Incoming     · Leads (orders the AI found in email or ClickUp, not made yet) · Requests (portal orders sent in)
 *  In the works · Mockups (mockups without numbers: the art is made, the price or sizes aren't, or there's no order
 *                 yet) · Numbers (numbers without mockups: priced and sized, no mockup yet). A job with neither shows at
 *                 both (Oct 29, Nick: "mockups without numbers… numbers without mockups")
 *  Quotes       · Ready (made, not sent) · Sent (with the customer)
 *  Revisions    · Make changes (changes asked on the art, or the quote declined with why)
 *  Sew-outs     · Sew-outs (embroidery only: the stitched sample to take, send and get approved, its own step after the
 *                 quote; Oct 29, Nick: "a small step in there between quotes and approval")
 *  Done         · Approved (everything approved; stays until the job is completed) · Declined (the customer walked
 *                 away; two weeks)
 * Each job carries its account owner (lib/accountOwners.ts) for the My accounts / Everyone switch.
 * Read from the records every page already uses: orders, mockups, proofs, sewouts, the order's history, and the AI's
 * draft orders.
 */
export type Step = "leads" | "requests" | "mockups" | "numbers" | "ready" | "sent" | "changes" | "sewouts" | "approved" | "declined";
export type TrackState = "needed" | "made" | "sent" | "changes" | "done";
export type Track = { k: "art" | "sewout" | "numbers"; state: TrackState; label: string; note?: string };
export type Dept = "screen" | "embroidery" | "heat";
export type JobItem = {
  key: string; type: "lead" | "request" | "artonly" | "order";
  steps: Step[]; at: string; due: string | null;
  orderId?: string; number?: number; customer: string; customerId?: string | null; title: string; sub?: string;
  depts: Dept[]; tracks: Track[]; qty?: number; total?: number;
  /** a lead's email or ClickUp task, for Create order */ activityId?: string | null; leadText?: string; suggestionId?: string;
  /** art-only: the mockups */ mockupIds?: string[];
  /** sew-outs taken, not sent (Send); sent, not answered (Remind) */ sewoutIds?: string[]; sentSewoutIds?: string[];
  /** the first group with prints and no mockup (Mockup Creator opens on it) */ mockGroup?: { id: string; mockupKind?: "logo" };
  declined?: string; status?: string; /** came back with changes at some point */ revised?: boolean;
  /** when what's out with the customer went (the newest) */ sentAt?: string | null;
  /** the account owner's first name, lowercase ("" when nobody owns it) */ owner?: string;
};

const TWO_WEEKS = 14 * 864e5;
const deptOf = (m?: string): Dept => (m === "embroidery" ? "embroidery" : m === "dtf" ? "heat" : "screen");
/** everything not completed: approved jobs stay on (under Approved) until the job is done (Oct 29, Nick) */
const OPEN = ["request", "quote", "quote_sent", "approved", "art", "blanks", "production", "ready"];
/** before production: what's still needed (a mockup, a sew-out) counts; once it's in production it's past that */
const EARLY = ["quote", "quote_sent", "approved", "art"];

async function inChunks<T>(ids: string[], f: (part: string[]) => PromiseLike<{ data: T[] | null }>, size = 40): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) { const r = await f(ids.slice(i, i + size)); out.push(...(r.data || [])); }
  return out;
}

/** an embroidered print's sew-out track, from where it is in digitizing (lib/digitizeStatus.ts digitizeState) */
function sewTrack(im: Imprint, d: { specs: unknown } | undefined, sws: { imprint_id: string; status: string; sent_at: string | null; customer_comment: string; order_id: string }[]): Track | null {
  const where = im.location || "Embroidery";
  const live = sws.find((x) => x.imprint_id === im.id);
  if (live) return live.status === "approved" ? { k: "sewout", state: "done", label: `Sew-out approved · ${where}` }
    : live.status === "changes" ? { k: "sewout", state: "changes", label: `Sew-out: changes · ${where}`, note: live.customer_comment || undefined }
    : { k: "sewout", state: live.sent_at ? "sent" : "made", label: live.sent_at ? `Sew-out sent · ${where}` : `Sew-out taken, not sent · ${where}` };
  const st = digitizeState(im, d as never, undefined);
  if (st.state === "ok") return st.repeat ? null : { k: "sewout", state: "done", label: `Sew-out approved · ${where}` };
  return { k: "sewout", state: "needed", label: `${st.state === "need" ? "Needs digitizing" : st.state === "asked" ? (st.changes ? "Changes asked of the digitizer" : "With the digitizer") : "File in, sew it out"} · ${where}` };
}

export async function loadJobCenter(admin: SupabaseClient): Promise<JobItem[]> {
  const now = Date.now();
  const since = new Date(now - TWO_WEEKS).toISOString();
  const [{ data: os }, { data: dec }, { data: s }, { data: leads }, { data: am }] = await Promise.all([
    admin.from("orders").select("id, number, nickname, status, type, due_date, groups, lines, fees, discount_pct, discount_amt, discount_type, tax_exempt, tax_rate, waive_setup, price_type, total, qty, customer_id, approved_at, approved_name, submitted_at, created_at, updated_at, declined_at, declined_reason, customers(company, name)").in("status", OPEN).is("declined_at", null).eq("draft", false).is("discarded_at", null).order("number", { ascending: false }).limit(800),
    admin.from("orders").select("id, number, nickname, status, due_date, groups, customer_id, declined_at, declined_reason, customers(company, name)").gte("declined_at", since).limit(200),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("ai_suggestions").select("id, title, body, customer_id, activity_id, created_at, customers(company, name)").eq("kind", "draft_order").eq("status", "open").gte("created_at", new Date(now - 30 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(300),
    admin.from("mockups").select("id, customer_id, title, created_at, customers(company, name)").is("order_id", null).is("archived_at", null).is("shelved_at", null).gte("created_at", new Date(now - 45 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(300),
  ]);
  const settings = mergeSettings(s?.data);
  type O = Order & { customers?: { company?: string; name?: string } | null };
  const orders = (os || []) as unknown as O[];
  const ids = orders.map((o) => o.id);
  const [mks, pfs, sws, evs] = await Promise.all([
    inChunks<{ id: string; order_id: string; group_id: string | null }>(ids, (p) => admin.from("mockups").select("id, order_id, group_id").in("order_id", p).is("archived_at", null)),
    inChunks<{ order_id: string; version: number; status: string; mockup_id: string | null; sent_at: string | null; decided_at: string | null; customer_comment: string; archived_at: string | null }>(ids, (p) => admin.from("proofs").select("order_id, version, status, mockup_id, sent_at, decided_at, customer_comment, archived_at").in("order_id", p).not("version", "is", null)),
    inChunks<{ id: string; order_id: string; imprint_id: string; status: string; sent_at: string | null; customer_comment: string; created_at: string }>(ids, (p) => admin.from("sewouts").select("id, order_id, imprint_id, status, sent_at, customer_comment, created_at").in("order_id", p).is("archived_at", null)),
    inChunks<{ order_id: string; kind: string; detail: string; created_at: string }>(ids, (p) => admin.from("order_events").select("order_id, kind, detail, created_at").in("order_id", p).in("kind", ["quote_declined", "quote_changes", "sent", "approved", "invoice_sent", "invoice_changes", "invoice_approved"]).order("created_at", { ascending: false })),
  ]);
  // the logos on embroidered prints: where each is in digitizing comes from them (lib/digitizeStatus.ts)
  const embDesignIds = [...new Set(orders.flatMap((o) => orderGroups(o).flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery" && im.design_id).map((im) => String(im.design_id)))))];
  const embDesigns = new Map((await inChunks<{ id: string; specs: unknown }>(embDesignIds, (p) => admin.from("designs").select("id, specs").in("id", p), 100)).map((d) => [d.id, d]));
  const cust = (c?: { company?: string; name?: string } | null) => c?.company || c?.name || "";
  const out: JobItem[] = [];

  // Incoming · Leads: orders the AI read in an email or a ClickUp job, not made yet
  type Lead = { id: string; title: string; body: string; customer_id: string | null; activity_id: string | null; created_at: string; customers?: { company?: string; name?: string } | null };
  const ls = (leads || []) as unknown as Lead[];
  type Act = MailAct & { subject: string | null; kind: string; order_id: string | null };
  const acts = await inChunks<Act>(ls.map((l) => l.activity_id || "").filter(Boolean), (p) => admin.from("activities").select("id, subject, kind, order_id, direction, occurred_at, external_id, thread_id, customer_id, from_email, to_email, meta").in("id", p), 100);
  const actOf = new Map(acts.map((a) => [a.id, a]));
  // a lead stays only while its source still waits on us, by the rules the Inbox and ClickUp Jobs already use: an email
  // that still needs us (not answered, archived or marked no reply: lib/inbox.ts), a ClickUp job still waiting (not
  // ticked In Printavo, not closed, no order: clickup_tasks.waiting); neither once an order was made from it
  const mails = acts.filter((a) => a.kind === "email");
  const mailFrom = mails.reduce((m, a) => (a.occurred_at < m ? a.occurred_at : m), new Date().toISOString());
  const { data: outs } = mails.length ? await admin.from("activities").select("id, direction, occurred_at, external_id, thread_id, customer_id, from_email, to_email, meta").eq("kind", "email").eq("direction", "out").gte("occurred_at", mailFrom).limit(5000) : { data: [] };
  const needs = new Set(mailRows([...mails, ...((outs || []) as MailAct[])], [] as MailSug[]).filter((r) => !r.answered && !r.archived && !r.ccOnly && !r.x.meta?.no_reply).map((r) => r.x.id));
  const cuIds = acts.filter((a) => a.kind === "clickup").map((a) => String((a.meta as { clickup?: { id?: string } } | null)?.clickup?.id || "")).filter(Boolean);
  const cuWaiting = new Set((await inChunks<{ id: string }>(cuIds, (p) => admin.from("clickup_tasks").select("id").in("id", p).eq("waiting", true), 100)).map((t) => t.id));
  const stillOpen = (a?: Act) => !a ? true : a.order_id ? false : a.kind === "clickup" ? cuWaiting.has(String((a.meta as { clickup?: { id?: string } } | null)?.clickup?.id || "")) : a.kind === "email" ? needs.has(a.id) : true;
  for (const l of ls) {
    const a = l.activity_id ? actOf.get(l.activity_id) : undefined;
    if (!stillOpen(a)) continue;
    const said = (l.body || "").split("\n")[0].trim();
    out.push({ key: `lead:${l.id}`, type: "lead", steps: ["leads"], at: l.created_at, due: null, customer: cust(l.customers) || l.title.replace(/^New order in (.*)'s email$/, "$1"), customerId: l.customer_id,
      title: a?.subject || said || l.title, sub: `${a?.kind === "clickup" ? "ClickUp" : "Email"}${said && a?.subject ? ` · ${said}` : ""}`, depts: [], tracks: (l.body || "").includes("Still need:") ? [{ k: "numbers", state: "needed", label: "Has questions to answer" }] : [],
      activityId: l.activity_id, leadText: `${a?.subject || ""} ${said}`.slice(0, 600), suggestionId: l.id });
  }
  // In the works · art with no order yet (made for a customer before the details)
  const amByCust = new Map<string, { ids: string[]; at: string; title: string; c: string }>();
  for (const m of (am || []) as unknown as { id: string; customer_id: string | null; title: string; created_at: string; customers?: { company?: string; name?: string } | null }[]) {
    if (!m.customer_id) continue;
    const key = `${m.customer_id}|${(m.title || "").split(" — ")[0]}`;
    const g = amByCust.get(key);
    if (g) g.ids.push(m.id); else amByCust.set(key, { ids: [m.id], at: m.created_at, title: (m.title || "Mockup").split(" — ")[0], c: cust(m.customers) });
  }
  for (const [key, g] of amByCust) out.push({ key: `art:${key}`, type: "artonly", steps: ["mockups"], at: g.at, due: null, customer: g.c, customerId: key.split("|")[0], title: g.title, depts: [], tracks: [{ k: "art", state: "made", label: "Mockup made" }, { k: "numbers", state: "needed", label: "No order yet" }], mockupIds: g.ids });

  for (const o of orders) {
    const gs = orderGroups(o);
    const depts = [...new Set(gs.flatMap((g) => (g.imprints || []).map((im) => deptOf(im.method))))];
    const base = { orderId: o.id, number: o.number, customer: cust(o.customers), customerId: o.customer_id, title: o.nickname || "Order", depts, due: o.due_date || null, qty: o.qty || 0 };
    // Incoming · Requests: built in the portal and sent in
    if (o.status === "request") { if (o.submitted_at) out.push({ ...base, key: `req:${o.id}`, type: "request", steps: ["requests"], at: o.submitted_at, tracks: [], status: o.status }); continue; }
    const quoting = o.status === "quote" || o.status === "quote_sent", early = EARLY.includes(o.status);
    const tracks: Track[] = [];
    // the art: the current mockups and the newest proof version out with the customer
    const all = pfs.filter((p) => p.order_id === o.id), cur = all.filter((p) => !p.archived_at), top = Math.max(0, ...cur.map((p) => p.version));
    const mine = mks.filter((m) => m.order_id === o.id), live = cur.filter((p) => p.version === top);
    const unsent = early && mine.length > 0 && mine.some((m) => !cur.some((p) => p.mockup_id === m.id));
    const hasPrints = gs.some((g) => (g.imprints || []).length > 0);
    if (unsent) tracks.push({ k: "art", state: "made", label: `Mockup v${Math.max(0, ...all.map((p) => p.version)) + 1} made` });
    else if (live.length) {
      const st = live.some((p) => p.status === "pending") ? "sent" : live.some((p) => p.status === "changes") ? "changes" : "done";
      const ch = live.find((p) => p.status === "changes");
      tracks.push({ k: "art", state: st, label: st === "sent" ? `Mockup v${live[0].version} sent` : st === "changes" ? "Mockup: changes asked" : `Mockup v${live[0].version} approved`, note: ch?.customer_comment || undefined });
    } else if (quoting && hasPrints) tracks.push({ k: "art", state: "needed", label: "No mockup yet" });
    else if (quoting && !hasPrints) tracks.push({ k: "art", state: "needed", label: "No prints yet" });
    // each embroidered print in the Digitizing Center: where it is there (Oct 29, Nick: "on sew-outs… a list of all of the
    // jobs that are in the Digitizing Center right now"), by the same answer the Digitizing page and the order use
    for (const g of gs) for (const im of g.imprints || []) {
      if (im.method !== "embroidery") continue;
      const t = sewTrack(im, embDesigns.get(String(im.design_id || "")), sws.filter((x) => x.order_id === o.id));
      if (t) tracks.push(t);
    }
    // the numbers: the price and the sizes, the quote out with them, or declined
    const c = calcOrder(o, settings, []);
    const sized = gs.some((g) => g.lines.some((l) => lineQty(l) > 0));
    const lastDecl = evs.find((e) => e.order_id === o.id && (e.kind === "quote_declined" || e.kind === "quote_changes"));
    const invSent = evs.find((e) => e.order_id === o.id && e.kind === "invoice_sent"), invBack = evs.find((e) => e.order_id === o.id && e.kind === "invoice_changes" && (!invSent || e.created_at > invSent.created_at)), invOk = evs.find((e) => e.order_id === o.id && e.kind === "invoice_approved" && (!invSent || e.created_at > invSent.created_at));
    const lastSent = evs.find((e) => e.order_id === o.id && e.kind === "sent");
    if (o.status === "quote_sent") tracks.push({ k: "numbers", state: "sent", label: "Quote sent" });
    else if (o.status === "quote") {
      if (lastDecl && (!lastSent || lastDecl.created_at > lastSent.created_at)) tracks.push({ k: "numbers", state: "changes", label: lastDecl.kind === "quote_changes" ? "Quote: changes asked" : "Quote declined", note: lastDecl.detail.replace(/^[^:]*:\s*/, "") });
      else if (!sized) tracks.push({ k: "numbers", state: "needed", label: "No sizes yet" });
      else if (!(c.total > 0)) tracks.push({ k: "numbers", state: "needed", label: "No price yet" });
      else tracks.push({ k: "numbers", state: "made", label: "Quote ready" });
    } else if (invSent && invBack && !invOk) tracks.push({ k: "numbers", state: "changes", label: "Invoice: changes asked", note: invBack.detail.replace(/^[^:]*:\s*/, "") });
    else if (invSent && !invOk) tracks.push({ k: "numbers", state: "sent", label: "Final invoice sent" });
    else tracks.push({ k: "numbers", state: "done", label: "Order approved" });

    const steps: Step[] = [];
    // In the works: mockups without numbers, numbers without mockups; a job missing both is at both
    const artNeed = tracks.some((t) => t.k === "art" && t.state === "needed"), numNeed = tracks.some((t) => t.k === "numbers" && t.state === "needed");
    if (numNeed) steps.push("mockups");
    if (artNeed) steps.push("numbers");
    // the mockup and the quote go through Ready, Sent and Make changes; a sew-out is its own step (Sew-outs)
    const mq = tracks.filter((t) => t.k !== "sewout");
    if (mq.some((t) => t.state === "made")) steps.push("ready");
    if (mq.some((t) => t.state === "sent")) steps.push("sent");
    if (mq.some((t) => t.state === "changes")) steps.push("changes");
    if (tracks.some((t) => t.k === "sewout" && t.state !== "done")) steps.push("sewouts");
    const allDone = tracks.every((t) => t.state === "done");
    const appr = o.approved_at || evs.find((e) => e.order_id === o.id && e.kind === "approved")?.created_at || "";
    // approved, with nothing left out with the customer: stays under Approved until the job is completed
    if (!quoting && allDone) steps.push("approved");
    if (!steps.length) continue;
    const mg = gs.find((g) => (g.imprints || []).length && !mine.some((m) => m.group_id === g.id)) || gs.find((g) => (g.imprints || []).length);
    const sw0 = sws.filter((x) => x.order_id === o.id && x.status === "pending");
    // came back with changes before (a proof or sew-out sent back, the quote declined), even if it's moved on since
    const revised = all.some((p) => p.status === "changes" || !!p.customer_comment) || !!lastDecl || sws.some((x) => x.order_id === o.id && (x.status === "changes" || !!x.customer_comment));
    const sentAt = [...live.filter((p) => p.status === "pending").map((p) => p.sent_at), ...sws.filter((x) => x.order_id === o.id && x.status === "pending").map((x) => x.sent_at), o.status === "quote_sent" ? lastSent?.created_at : null].filter(Boolean).sort().pop() || null;
    out.push({ ...base, key: `ord:${o.id}`, type: "order", steps, at: appr || o.updated_at || o.created_at, tracks, total: c.total, status: o.status, revised, sentAt,
      sewoutIds: sw0.filter((x) => !x.sent_at).map((x) => x.id), sentSewoutIds: sw0.filter((x) => x.sent_at).map((x) => x.id), mockGroup: mg ? { id: mg.id, mockupKind: mg.mockupKind } : undefined });
  }
  // Done · Declined: the customer walked away (two weeks)
  for (const o of (dec || []) as unknown as O[]) {
    const gs = orderGroups(o);
    out.push({ key: `dec:${o.id}`, type: "order", steps: ["declined"], at: o.declined_at || "", due: o.due_date || null, orderId: o.id, number: o.number, customer: cust(o.customers), customerId: o.customer_id, title: o.nickname || "Order", depts: [...new Set(gs.flatMap((g) => (g.imprints || []).map((im) => deptOf(im.method))))], tracks: [], declined: o.declined_reason || "", owner: "" });
  }
  // whose account each one is
  const acct = await accountOwners(admin, out.map((x) => x.customerId || ""));
  for (const x of out) x.owner = (x.customerId && acct.get(x.customerId)) || "";
  return out;
}

/** One job's timeline: what was sent, opened, answered, from the order's history and its proofs. */
export async function jobTimeline(admin: SupabaseClient, orderId: string) {
  const KINDS = ["created", "request_submitted", "accepted", "sent", "approved", "quote_declined", "proofs_requested", "proof_reminder", "proof_approved", "proof_changes", "art_approved", "sewout_saved", "sewout_sent", "sewout_reminder", "sewout_approved", "sewout_changes", "job_declined", "job_reopened", "invoice_sent", "invoice_approved", "invoice_changes", "quote_changes"];
  const [{ data: ev }, { data: pf }, { data: sw }] = await Promise.all([
    admin.from("order_events").select("kind, detail, actor, created_at").eq("order_id", orderId).in("kind", KINDS).order("created_at").limit(200),
    admin.from("proofs").select("version, viewed_at, view_count").eq("order_id", orderId).not("viewed_at", "is", null).order("version"),
    admin.from("sewouts").select("version, viewed_at, view_count").eq("order_id", orderId).not("viewed_at", "is", null),
  ]);
  const WORD: Record<string, string> = {
    created: "Order made", request_submitted: "Request came in", accepted: "Request accepted", sent: "Quote sent", approved: "Quote approved", quote_declined: "Quote declined",
    proofs_requested: "Mockup sent", proof_reminder: "Reminder sent", proof_approved: "Mockup approved", proof_changes: "Mockup: changes asked", art_approved: "Art approved",
    sewout_saved: "Sew-out photo taken", sewout_sent: "Sew-out sent", sewout_reminder: "Sew-out reminder sent", sewout_approved: "Sew-out approved", sewout_changes: "Sew-out: changes asked", job_declined: "Marked declined", job_reopened: "Back on (not declined)", invoice_sent: "Final invoice sent", invoice_approved: "Final invoice approved", invoice_changes: "Invoice: changes asked", quote_changes: "Quote: changes asked",
  };
  const rows = ((ev || []) as { kind: string; detail: string; actor: string; created_at: string }[])
    .map((e) => ({ at: e.created_at, what: WORD[e.kind] || e.kind, detail: e.kind === "sent" ? (e.detail === "link copied" ? "link copied" : `to ${e.detail}`) : e.detail, who: e.actor, tone: /approved/.test(e.kind) ? "ok" : /changes|declined/.test(e.kind) ? "bad" : "" }));
  const seen = new Set<number>();
  for (const p of (pf || []) as { version: number; viewed_at: string; view_count: number }[]) { if (seen.has(p.version)) continue; seen.add(p.version); rows.push({ at: p.viewed_at, what: `Mockup v${p.version} opened`, detail: p.view_count > 1 ? `${p.view_count} times` : "", who: "", tone: "" }); }
  for (const s of (sw || []) as { version: number; viewed_at: string; view_count: number }[]) rows.push({ at: s.viewed_at, what: `Sew-out v${s.version} opened`, detail: s.view_count > 1 ? `${s.view_count} times` : "", who: "", tone: "" });
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/** One job, for the Job Center's right panel: its pieces with pictures and what happened to each, what the customer
 * said last, the messages, the history and the customer's page link (Oct 29, Nick: "you click on it and say, here's the
 * order… view the mockup… or the sew-out… copy link… view the messages, what was sent… if it was opened or not… proof
 * approved, changes to art"). */
export type PieceState = "needed" | "made" | "sent" | "changes" | "done";
export type ProofVersion = { v: number; state: PieceState | "replaced"; sentAt: string | null; sentTo: string | null; viewedAt: string | null; views: number; decidedAt: string | null; decidedName: string | null; comment: string; pics: string[] };
export type JobPiece =
  | { k: "art"; state: PieceState; versions: ProofVersion[]; next: string[] | null; pdf: string }
  | { k: "sewout"; id: string | null; where: string; imprintId: string; state: PieceState; /** before a sew-out: where it is in digitizing */ dz?: string; v: number; sentAt: string | null; sentTo: string | null; viewedAt: string | null; views: number; decidedAt: string | null; decidedName: string | null; comment: string; pic: string; pdf: string }
  | { k: "quote"; state: PieceState; total: number; qty: number; sentAt: string | null; decidedAt: string | null; decidedName: string | null; comment: string; pdf: string };
export type JobDetail = {
  id: string; number: number; title: string; status: string; due: string | null; qty: number; customer: string; contact: string; email: string;
  depts: Dept[]; pieces: JobPiece[]; said: { who: string; at: string; text: string; on: string; after: string } | null;
  msgs: { at: string; who: string; us: boolean; text: string }[]; link: string | null; mockGroup?: { id: string; mockupKind?: "logo" };
  declinedAt: string | null; declinedWhy: string;
};

export async function jobDetail(admin: SupabaseClient, orderId: string): Promise<JobDetail> {
  const { data: od } = await admin.from("orders").select("*, customers(company, name, email)").eq("id", orderId).maybeSingle();
  if (!od) throw new Error("That order isn't there any more.");
  const o = od as unknown as Order & { customers?: { company?: string; name?: string; email?: string } | null; declined_at?: string | null; declined_reason?: string };
  const [{ data: s }, { data: pf }, { data: mk }, { data: sw }, { data: ev }, { data: ms }, { data: lk }] = await Promise.all([
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("proofs").select("version, status, file_path, sent_at, sent_to, viewed_at, view_count, decided_at, decided_name, customer_comment, archived_at, mockup_id, created_at").eq("order_id", orderId).not("version", "is", null).order("created_at"),
    admin.from("mockups").select("id, file_path, group_id").eq("order_id", orderId).is("archived_at", null).order("created_at"),
    admin.from("sewouts").select("id, imprint_id, version, status, photo_path, sent_at, sent_to, viewed_at, view_count, decided_at, decided_name, customer_comment, created_at").eq("order_id", orderId).is("archived_at", null).order("version", { ascending: false }),
    admin.from("order_events").select("kind, detail, actor, created_at").eq("order_id", orderId).in("kind", ["sent", "proofs_requested", "sewout_sent", "quote_declined", "quote_changes", "approved", "invoice_sent", "invoice_changes", "invoice_approved"]).order("created_at"),
    admin.from("messages").select("author_type, author_name, author_email, body, created_at").eq("order_id", orderId).order("created_at", { ascending: false }).limit(8),
    admin.from("proof_links").select("id").eq("order_id", orderId).eq("kind", "order").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const settings = mergeSettings(s?.data);
  const gs = orderGroups(o);
  type P = { version: number; status: string; file_path: string; sent_at: string | null; sent_to: string | null; viewed_at: string | null; view_count: number; decided_at: string | null; decided_name: string | null; customer_comment: string; archived_at: string | null; mockup_id: string | null };
  type S = { id: string; imprint_id: string; version: number; status: string; photo_path: string; sent_at: string | null; sent_to: string | null; viewed_at: string | null; view_count: number; decided_at: string | null; decided_name: string | null; customer_comment: string };
  const ps = (pf || []) as P[], mks = (mk || []) as { id: string; file_path: string; group_id: string | null }[], sws = (sw || []) as S[];
  const evs = (ev || []) as { kind: string; detail: string; actor: string; created_at: string }[];
  // every picture, signed once
  const paths = [...new Set([...ps.map((p) => p.file_path), ...mks.map((m) => m.file_path), ...sws.map((x) => x.photo_path)].filter(Boolean))];
  const url = new Map<string, string>();
  if (paths.length) { const { data: sg } = await admin.storage.from("proofs").createSignedUrls(paths, 3600); (sg || []).forEach((r, i) => { if (r.signedUrl) url.set(paths[i], r.signedUrl); }); }
  const pics = (xs: string[]) => xs.map((x) => url.get(x) || "").filter(Boolean);
  const pieces: JobPiece[] = [];
  const early = EARLY.includes(o.status), quoting = o.status === "quote" || o.status === "quote_sent";

  // the mockup, by version (the newest first)
  const live = ps.filter((p) => !p.archived_at);
  const top = Math.max(0, ...live.map((p) => p.version));
  const vs = [...new Set(ps.map((p) => p.version))].sort((a, b) => b - a).map((v): ProofVersion => {
    const rs = ps.filter((p) => p.version === v), r0 = rs.find((p) => p.decided_at) || rs[0];
    const isLive = v === top && rs.some((p) => !p.archived_at);
    const state: ProofVersion["state"] = !isLive ? (rs.some((p) => p.status === "changes") ? "changes" : rs.every((p) => p.status === "approved") ? "done" : "replaced")
      : rs.some((p) => p.status === "pending") ? "sent" : rs.some((p) => p.status === "changes") ? "changes" : "done";
    return { v, state, sentAt: r0.sent_at, sentTo: r0.sent_to, viewedAt: rs.map((p) => p.viewed_at).filter(Boolean).sort()[0] || null, views: Math.max(0, ...rs.map((p) => p.view_count || 0)),
      decidedAt: r0.decided_at, decidedName: r0.decided_name, comment: rs.map((p) => p.customer_comment).find(Boolean) || "", pics: pics(rs.map((p) => p.file_path)) };
  });
  const unsent = early && mks.length > 0 && mks.some((m) => !live.some((p) => p.mockup_id === m.id));
  const hasPrints = gs.some((g) => (g.imprints || []).length);
  if (vs.length || unsent || (quoting && hasPrints)) pieces.push({ k: "art", state: unsent ? "made" : vs[0] ? (vs[0].state === "replaced" ? "done" : vs[0].state) : "needed", versions: vs, next: unsent ? pics(mks.map((m) => m.file_path)) : null, pdf: `/print/${orderId}?proof=1` });
  // each embroidered print's sew-out, or where it is in digitizing before there is one (lib/digitizeStatus.ts)
  const dIds = [...new Set(gs.flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery" && im.design_id).map((im) => String(im.design_id))))];
  const { data: dzs } = dIds.length ? await admin.from("designs").select("id, specs").in("id", dIds) : { data: [] };
  for (const g of gs) for (const im of g.imprints || []) {
    if (im.method !== "embroidery") continue;
    const x = sws.find((y) => y.imprint_id === im.id);
    const where = `${im.location || "Embroidery"}${im.size ? `, ${im.size}` : ""}`;
    if (!x) {
      const st = digitizeState(im, ((dzs || []) as { id: string; specs: unknown }[]).find((z) => z.id === im.design_id) as never, undefined);
      if (st.state === "ok" && st.repeat) continue;
      pieces.push({ k: "sewout", id: null, where, imprintId: im.id, state: st.state === "ok" ? "done" : "needed", v: 0, sentAt: null, sentTo: null, viewedAt: null, views: 0, decidedAt: null, decidedName: null, comment: "", pic: "", pdf: "",
        dz: st.state === "need" ? "Needs digitizing" : st.state === "asked" ? (st.changes ? "Changes asked of the digitizer" : "With the digitizer") : st.state === "done" ? "The file is in: sew it out" : "" });
      continue;
    }
    pieces.push({ k: "sewout", id: x.id, where, imprintId: im.id, state: x.status === "approved" ? "done" : x.status === "changes" ? "changes" : x.sent_at ? "sent" : "made", v: x.version, sentAt: x.sent_at, sentTo: x.sent_to,
      viewedAt: x.viewed_at, views: x.view_count || 0, decidedAt: x.decided_at, decidedName: x.decided_name, comment: x.customer_comment || "", pic: url.get(x.photo_path) || "", pdf: `/print/${orderId}?sewout=${x.id}` });
  }
  // the quote
  const c = calcOrder(o, settings, []);
  const sized = gs.some((g) => g.lines.some((l) => lineQty(l) > 0));
  const lastSent = [...evs].reverse().find((e) => e.kind === "sent"), lastDecl = [...evs].reverse().find((e) => e.kind === "quote_declined" || e.kind === "quote_changes");
  const invSent = [...evs].reverse().find((e) => e.kind === "invoice_sent"), invBack = invSent && [...evs].reverse().find((e) => e.kind === "invoice_changes" && e.created_at > invSent.created_at), invOk = invSent && [...evs].reverse().find((e) => e.kind === "invoice_approved" && e.created_at > invSent.created_at);
  const qState: PieceState = o.status === "quote_sent" ? "sent" : o.status === "quote" ? (lastDecl && (!lastSent || lastDecl.created_at > lastSent.created_at) ? "changes" : !sized || !(c.total > 0) ? "needed" : "made") : invBack && !invOk ? "changes" : invSent && !invOk ? "sent" : "done";
  pieces.push({ k: "quote", state: qState, total: c.total, qty: o.qty || 0, sentAt: lastSent?.created_at || o.sent_at || null, decidedAt: qState === "changes" ? (invBack || lastDecl)!.created_at : o.approved_at, decidedName: qState === "changes" ? (invBack || lastDecl)!.detail.split(":")[0] : o.approved_name,
    comment: qState === "changes" ? (invBack || lastDecl)!.detail.replace(/^[^:]*:\s*/, "") : "", pdf: `/print/${orderId}` });

  // what the customer said last: a proof or sew-out answer, a declined quote, or a message
  const words: { who: string; at: string; text: string; on: string }[] = [
    ...vs.filter((v) => v.comment && v.decidedAt).map((v) => ({ who: v.decidedName || "The customer", at: v.decidedAt!, text: v.comment, on: `${v.state === "changes" ? "Changes asked" : "Approved with a change"} on mockup v${v.v}` })),
    ...pieces.filter((p): p is Extract<JobPiece, { k: "sewout" }> => p.k === "sewout" && !!p.comment && !!p.decidedAt).map((p) => ({ who: p.decidedName || "The customer", at: p.decidedAt!, text: p.comment, on: `On the sew-out, ${p.where}` })),
    ...evs.filter((e) => e.kind === "quote_declined" || e.kind === "quote_changes" || e.kind === "invoice_changes").map((e) => ({ who: e.detail.split(":")[0], at: e.created_at, text: e.detail.replace(/^[^:]*:\s*/, ""), on: e.kind === "quote_declined" ? "Declined the quote" : e.kind === "quote_changes" ? "Changes to the quote" : "Changes to the final invoice" })),
    ...((ms || []) as { author_type: string; author_name: string; body: string; created_at: string }[]).filter((m) => m.author_type === "customer" && !/^(Declined the quote|Changes to the quote|Changes to the final invoice):/.test(m.body)).map((m) => ({ who: m.author_name || "The customer", at: m.created_at, text: m.body, on: "Message" })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const said0 = words[0];
  const sentAfter = said0 ? evs.find((e) => e.created_at > said0.at && (e.kind === "proofs_requested" || e.kind === "sewout_sent" || e.kind === "sent")) : undefined;
  const said = said0 ? { ...said0, after: sentAfter ? `${sentAfter.kind === "proofs_requested" ? sentAfter.detail.replace(/\s*\(.*$/, "") : sentAfter.kind === "sewout_sent" ? "A new sew-out" : "The quote"} went out after this, ${new Date(sentAfter.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}` : "" } : null;

  // messages: what we sent them and what's been written, newest first
  const msgs = [
    ...evs.filter((e) => e.kind === "proofs_requested" || e.kind === "sewout_sent" || e.kind === "sent").map((e) => ({ at: e.created_at, who: (e.actor || "").split("@")[0], us: true,
      text: e.kind === "sent" ? (e.detail === "link copied" ? "Quote · link copied to send yourself" : `Quote · to ${e.detail}`) : e.detail.replace(/^Version (\d+)/, "Mockup v$1") })),
    ...((ms || []) as { author_type: string; author_name: string; author_email: string; body: string; created_at: string }[]).map((m) => ({ at: m.created_at, who: m.author_name || (m.author_email || "").split("@")[0], us: m.author_type !== "customer", text: m.body })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const mg = gs.find((g) => (g.imprints || []).length && !mks.some((m) => m.group_id === g.id)) || gs.find((g) => (g.imprints || []).length);
  return {
    id: o.id, number: o.number, title: o.nickname || "Order", status: o.status, due: o.due_date || null, qty: o.qty || 0,
    customer: o.customers?.company || o.customers?.name || "", contact: o.customers?.company ? (o.customers?.name || "") : "", email: o.customers?.email || "",
    depts: [...new Set(gs.flatMap((g) => (g.imprints || []).map((im) => deptOf(im.method))))], pieces, said, msgs, link: lk?.id ? `/proof/${lk.id}` : null,
    mockGroup: mg ? { id: mg.id, mockupKind: mg.mockupKind } : undefined, declinedAt: o.declined_at || null, declinedWhy: o.declined_reason || "",
  };
}
