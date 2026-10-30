import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcOrder, lineQty, mergeSettings, orderGroups, type Order } from "@/lib/pricing";
import { accountOwners } from "@/lib/accountOwners";

/**
 * The Job Center (Oct 29, Nick: "this is basically where I'm going to keep everything pre-production… it doesn't always
 * flow… it goes 1, 2, 3, 4, 5, 6… and it goes 1, 4, 3, 5, 6… it brings the whole website together for our sales team").
 *
 * A job isn't one status walking steps in order: it has tracks that move on their own (the art, a sew-out, the numbers),
 * and it shows at every step it's at:
 *  Incoming     · Leads (orders the AI found in email or ClickUp, not made yet) · Requests (portal orders sent in)
 *  In the works · Mockups (art or a sew-out to make) · Numbers (no price or no sizes yet; art made with no order)
 *  Quotes       · Ready (made, not sent) · Sent (with the customer)
 *  Revisions    · Make changes (changes asked on art or a sew-out, or the quote declined with why)
 *  Done         · Approved (everything approved; stays until the job is completed) · Declined (the customer walked
 *                 away; two weeks)
 * Each job carries its account owner (lib/accountOwners.ts) for the My accounts / Everyone switch.
 * Read from the records every page already uses: orders, mockups, proofs, sewouts, the order's history, and the AI's
 * draft orders.
 */
export type Step = "leads" | "requests" | "mockups" | "numbers" | "ready" | "sent" | "changes" | "approved" | "declined";
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
    inChunks<{ order_id: string; kind: string; detail: string; created_at: string }>(ids, (p) => admin.from("order_events").select("order_id, kind, detail, created_at").in("order_id", p).in("kind", ["quote_declined", "sent", "approved"]).order("created_at", { ascending: false })),
  ]);
  const cust = (c?: { company?: string; name?: string } | null) => c?.company || c?.name || "";
  const out: JobItem[] = [];

  // Incoming · Leads: orders the AI read in an email or a ClickUp job, not made yet
  type Lead = { id: string; title: string; body: string; customer_id: string | null; activity_id: string | null; created_at: string; customers?: { company?: string; name?: string } | null };
  const ls = (leads || []) as unknown as Lead[];
  const acts = await inChunks<{ id: string; subject: string | null; kind: string }>(ls.map((l) => l.activity_id || "").filter(Boolean), (p) => admin.from("activities").select("id, subject, kind").in("id", p), 100);
  const actOf = new Map(acts.map((a) => [a.id, a]));
  for (const l of ls) {
    const a = l.activity_id ? actOf.get(l.activity_id) : undefined;
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
  for (const [key, g] of amByCust) out.push({ key: `art:${key}`, type: "artonly", steps: ["numbers"], at: g.at, due: null, customer: g.c, customerId: key.split("|")[0], title: g.title, depts: [], tracks: [{ k: "art", state: "made", label: "Mockup made" }, { k: "numbers", state: "needed", label: "No order yet" }], mockupIds: g.ids });

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
    // each embroidered print with its stitch file in: its sew-out
    for (const g of gs) for (const im of g.imprints || []) {
      if (im.method !== "embroidery" || !im.emb?.file) continue;
      const sw = sws.filter((x) => x.order_id === o.id && x.imprint_id === im.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const where = im.location || "Embroidery";
      if (!sw) { if (early) tracks.push({ k: "sewout", state: "needed", label: `Sew-out not taken · ${where}` }); }
      else if (sw.status === "approved") tracks.push({ k: "sewout", state: "done", label: `Sew-out approved · ${where}` });
      else if (sw.status === "changes") tracks.push({ k: "sewout", state: "changes", label: `Sew-out: changes · ${where}`, note: sw.customer_comment || undefined });
      else tracks.push({ k: "sewout", state: sw.sent_at ? "sent" : "made", label: `Sew-out ${sw.sent_at ? "sent" : "taken"} · ${where}` });
    }
    // the numbers: the price and the sizes, the quote out with them, or declined
    const c = calcOrder(o, settings, []);
    const sized = gs.some((g) => g.lines.some((l) => lineQty(l) > 0));
    const lastDecl = evs.find((e) => e.order_id === o.id && e.kind === "quote_declined");
    const lastSent = evs.find((e) => e.order_id === o.id && e.kind === "sent");
    if (o.status === "quote_sent") tracks.push({ k: "numbers", state: "sent", label: "Quote sent" });
    else if (o.status === "quote") {
      if (lastDecl && (!lastSent || lastDecl.created_at > lastSent.created_at)) tracks.push({ k: "numbers", state: "changes", label: "Quote declined", note: lastDecl.detail.replace(/^[^:]*:\s*/, "") });
      else if (!sized) tracks.push({ k: "numbers", state: "needed", label: "No sizes yet" });
      else if (!(c.total > 0)) tracks.push({ k: "numbers", state: "needed", label: "No price yet" });
      else tracks.push({ k: "numbers", state: "made", label: "Quote ready" });
    } else tracks.push({ k: "numbers", state: "done", label: "Order approved" });

    const steps: Step[] = [];
    if (tracks.some((t) => (t.k === "art" || t.k === "sewout") && t.state === "needed")) steps.push("mockups");
    if (tracks.some((t) => t.k === "numbers" && t.state === "needed")) steps.push("numbers");
    if (tracks.some((t) => t.state === "made")) steps.push("ready");
    if (tracks.some((t) => t.state === "sent")) steps.push("sent");
    if (tracks.some((t) => t.state === "changes")) steps.push("changes");
    const allDone = tracks.every((t) => t.state === "done");
    const appr = o.approved_at || evs.find((e) => e.order_id === o.id && e.kind === "approved")?.created_at || "";
    // approved, with nothing left out with the customer: stays under Approved until the job is completed
    if (!quoting && allDone) steps.push("approved");
    if (!steps.length) continue;
    const mg = gs.find((g) => (g.imprints || []).length && !mine.some((m) => m.group_id === g.id)) || gs.find((g) => (g.imprints || []).length);
    const sw0 = sws.filter((x) => x.order_id === o.id && x.status === "pending");
    // came back with changes before (a proof or sew-out sent back, the quote declined), even if it's moved on since
    const revised = all.some((p) => p.status === "changes" || !!p.customer_comment) || !!lastDecl || sws.some((x) => x.order_id === o.id && (x.status === "changes" || !!x.customer_comment));
    out.push({ ...base, key: `ord:${o.id}`, type: "order", steps, at: appr || o.updated_at || o.created_at, tracks, total: c.total, status: o.status, revised,
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
  const KINDS = ["created", "request_submitted", "accepted", "sent", "approved", "quote_declined", "proofs_requested", "proof_reminder", "proof_approved", "proof_changes", "art_approved", "sewout_saved", "sewout_sent", "sewout_reminder", "sewout_approved", "sewout_changes", "job_declined", "job_reopened"];
  const [{ data: ev }, { data: pf }, { data: sw }] = await Promise.all([
    admin.from("order_events").select("kind, detail, actor, created_at").eq("order_id", orderId).in("kind", KINDS).order("created_at").limit(200),
    admin.from("proofs").select("version, viewed_at, view_count").eq("order_id", orderId).not("viewed_at", "is", null).order("version"),
    admin.from("sewouts").select("version, viewed_at, view_count").eq("order_id", orderId).not("viewed_at", "is", null),
  ]);
  const WORD: Record<string, string> = {
    created: "Order made", request_submitted: "Request came in", accepted: "Request accepted", sent: "Quote sent", approved: "Quote approved", quote_declined: "Quote declined",
    proofs_requested: "Mockup sent", proof_reminder: "Reminder sent", proof_approved: "Mockup approved", proof_changes: "Mockup: changes asked", art_approved: "Art approved",
    sewout_saved: "Sew-out photo taken", sewout_sent: "Sew-out sent", sewout_reminder: "Sew-out reminder sent", sewout_approved: "Sew-out approved", sewout_changes: "Sew-out: changes asked", job_declined: "Marked declined", job_reopened: "Back on (not declined)",
  };
  const rows = ((ev || []) as { kind: string; detail: string; actor: string; created_at: string }[])
    .map((e) => ({ at: e.created_at, what: WORD[e.kind] || e.kind, detail: e.kind === "sent" ? (e.detail === "link copied" ? "link copied" : `to ${e.detail}`) : e.detail, who: e.actor, tone: /approved/.test(e.kind) ? "ok" : /changes|declined/.test(e.kind) ? "bad" : "" }));
  const seen = new Set<number>();
  for (const p of (pf || []) as { version: number; viewed_at: string; view_count: number }[]) { if (seen.has(p.version)) continue; seen.add(p.version); rows.push({ at: p.viewed_at, what: `Mockup v${p.version} opened`, detail: p.view_count > 1 ? `${p.view_count} times` : "", who: "", tone: "" }); }
  for (const s of (sw || []) as { version: number; viewed_at: string; view_count: number }[]) rows.push({ at: s.viewed_at, what: `Sew-out v${s.version} opened`, detail: s.view_count > 1 ? `${s.view_count} times` : "", who: "", tone: "" });
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}
