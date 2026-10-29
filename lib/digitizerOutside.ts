import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DIGITIZER } from "@/lib/digitizer";
import type { Group, Imprint } from "@/lib/pricing";
import { digitizerReply, saveAttachments, saveBody, type Acct, type MailMsg, type Outcome } from "@/lib/mail/process";
import type { MailAccount } from "@/lib/mail/config";

/**
 * Digitizing sent outside the portal (Oct 29, Nick: "my wife keeps going around the system… She requested… on her own by
 * just sending it through her email… we sent it back to them, though we didn't do it through you"). Any email to the
 * digitizer from a shop mailbox is caught, from the live mail check (handleSent) and from a sweep of the mailboxes'
 * sent mail (Check now, and every mail sync), so none is missed:
 *   - in the thread of a request we know (the portal's or one caught before): kept on that order; after their files
 *     came in, an email asking for a change (resize, fix…) marks the logo "changes asked", so its next file is version 2
 *   - a new email: put on the open embroidered order it names (its number, a D- logo number, or a word only that order
 *     has: "Order: Embark" → #40188 Embark LL Bean Tote), the print marked requested by email; their reply's files then
 *     come in on their own like any request's
 *   - an email it can't place waits at the top of Digitizing to pick the order (placeDigitizeEmail): nothing is lost.
 */
const lc = (s: string) => (s || "").trim().toLowerCase();
const bare = (id: string) => (id || "").trim().replace(/^<|>$/g, "");
const toDigitizer = (m: Pick<MailMsg, "to" | "cc">) => [...m.to, ...m.cc].some((a) => lc(a.address).endsWith("@" + DIGITIZER.domain));
const STOP = new Set("order orders logo logos digitizing digitize digitized please thanks thank hello team file files embroidery attached attachment new front back left right chest full pocket sleeve inch inches wide tall size sizes dst emb pdf png jpg jpeg art artwork our you your this that with from have need for and the can are will would could just also here there about into fbs print printing com www http https resize change changes fix".split(" "));
const words = (s: string) => [...new Set(lc(s).normalize("NFKD").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d{1,3}$/.test(w)))];
/** the new part of an email (above "On … wrote:" or the quoted reply) */
const fresh = (text: string) => (text || "").split(/\n\s*(?:On .{5,120} wrote:|From: .{3,200}\n|-{2,}\s*Original Message|_{6,})/i)[0].slice(0, 3000);
const ASKS_CHANGE = /\b(resize|re-?size|change|changes|smaller|bigger|larger|wider|narrower|taller|shorter|revise|revision|fix|adjust|edit|redo|update|instead|should be)\b/i;

type Cand = { id: string; number: number; nickname: string | null; customer_id: string | null; company: string; groups: Group[]; designNums: Record<string, number>; designNames: Record<string, string> };
type OrderPick = { order: Cand; prints: Imprint[] };

/** the open embroidered orders, with their prints' logo numbers and names */
async function candidates(admin: SupabaseClient, before: string): Promise<Cand[]> {
  const since = new Date(Date.now() - 150 * 86400000).toISOString();
  // only orders that existed when the email went out: an email can't be about an order made after it (Oct 29: an
  // "Order: Armstrong…" email from Oct 14 was put on #40189, made Oct 27)
  const { data } = await admin.from("orders").select("id, number, nickname, customer_id, groups, customers(company, name)").not("status", "in", "(completed,request)").gte("created_at", since).lte("created_at", before).order("number", { ascending: false }).limit(500);
  const os = ((data || []) as unknown as { id: string; number: number; nickname: string | null; customer_id: string | null; groups: Group[] | null; customers?: { company?: string; name?: string } | null }[])
    .filter((o) => (o.groups || []).some((g) => (g.imprints || []).some((im) => im.method === "embroidery")));
  const ids = [...new Set(os.flatMap((o) => (o.groups || []).flatMap((g) => (g.imprints || []).map((im) => im.design_id).filter(Boolean) as string[])))];
  const { data: ds } = ids.length ? await admin.from("designs").select("id, number, name").in("id", ids) : { data: [] };
  const num: Record<string, number> = {}, name: Record<string, string> = {};
  for (const d of (ds || []) as { id: string; number: number | null; name: string | null }[]) { if (d.number) num[d.id] = d.number; name[d.id] = d.name || ""; }
  return os.map((o) => ({ id: o.id, number: o.number, nickname: o.nickname, customer_id: o.customer_id, company: o.customers?.company || o.customers?.name || "", groups: o.groups || [], designNums: num, designNames: name }));
}

/** the order (and its prints) an email to the digitizer is about, when it's clear; null when it isn't */
export async function findDigitizeOrder(admin: SupabaseClient, m: Pick<MailMsg, "subject" | "text" | "attachments" | "date">): Promise<OrderPick | null> {
  const cands = await candidates(admin, m.date.toISOString());
  if (!cands.length) return null;
  const subject = m.subject || "", body = fresh(m.text), files = m.attachments.map((a) => a.filename || "").join(" ");
  const strong = `${subject} ${files}`, all = `${strong} ${body}`;
  const embOf = (o: Cand) => o.groups.flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery"));
  // every order's own words: its name, its customer and its logos' names
  const own = new Map(cands.map((o) => [o.id, new Set(words([o.nickname || "", o.company, ...embOf(o).map((im) => (im.design_id ? o.designNames[im.design_id] || "" : ""))].join(" ")))]));
  const df = new Map<string, number>();
  for (const s of own.values()) for (const w of s) df.set(w, (df.get(w) || 0) + 1);
  const score = new Map<string, number>();
  const add = (id: string, n: number) => score.set(id, (score.get(id) || 0) + n);
  const nums = new Set([...all.matchAll(/(?:#|\b)(\d{5})\b/g)].map((x) => +x[1]));
  const dnums = new Set([...all.matchAll(/\bD-?(\d{4,6})\b/gi)].map((x) => +x[1]));
  for (const o of cands) {
    if (nums.has(o.number)) add(o.id, 100);
    if (embOf(o).some((im) => im.design_id && dnums.has(o.designNums[im.design_id]))) add(o.id, 100);
    const mine = own.get(o.id)!;
    for (const w of words(strong)) if (mine.has(w)) add(o.id, 40 / (df.get(w) || 1));
    for (const w of words(body)) if (mine.has(w)) add(o.id, 12 / (df.get(w) || 1));
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 30 || (ranked[1] && ranked[1][1] > ranked[0][1] * 0.6)) return null;
  const order = cands.find((o) => o.id === ranked[0][0])!;
  // which of its embroidered prints: the one named (logo number or name, or its spot), else the ones still waiting
  const prints = embOf(order);
  const named = prints.filter((im) => (im.design_id && dnums.has(order.designNums[im.design_id])) || words(`${im.location} ${im.design_id ? order.designNames[im.design_id] || "" : ""}`).some((w) => words(all).includes(w)));
  const waiting = prints.filter((im) => !im.emb?.file && !im.emb?.request);
  return { order, prints: named.length ? named : waiting.length ? waiting : prints };
}

/** the print is asked of the digitizer: on its logo, or on the print itself when there's no logo on file */
async function markRequested(admin: SupabaseClient, orderId: string, im: Imprint, at: string, by: string, changes?: string) {
  const req = { at, by, size: im.size || "", via: "email (outside the portal)", ...(changes ? { changes: changes.slice(0, 600) } : {}) };
  if (im.design_id) {
    const { data: d } = await admin.from("designs").select("specs").eq("id", im.design_id).maybeSingle();
    if (d) {
      const sp = (d.specs || {}) as Record<string, unknown>, emb = (sp.embroidery || {}) as { request?: { at: string } | null };
      // never over a newer request (the portal's own, or a later one)
      if (emb.request && emb.request.at >= at) return;
      await admin.from("designs").update({ specs: { ...sp, embroidery: { ...emb, request: req } } }).eq("id", im.design_id);
      return;
    }
  }
  const { data: o } = await admin.from("orders").select("groups").eq("id", orderId).maybeSingle();
  if (!o) return;
  const cur = ((o.groups || []) as Group[]).flatMap((g) => g.imprints || []).find((x) => x.id === im.id);
  if (cur?.emb?.request && cur.emb.request.at >= at) return;
  const groups = ((o.groups || []) as Group[]).map((g) => ({ ...g, imprints: (g.imprints || []).map((x) => (x.id === im.id ? { ...x, emb: { ...(x.emb || {}), request: req } } : x)) }));
  await admin.from("orders").update({ groups }).eq("id", orderId);
}

type Dz = { order_id: string; imprint_id: string; design_id: string | null; items?: { imprint_id: string; design_id: string | null }[]; outside?: boolean };

/** One email from us to the digitizer: kept, and put on its order (or left to place on Digitizing). Null: not one. */
export async function digitizerSent(admin: SupabaseClient, m: MailMsg, acct: Acct): Promise<Outcome | null> {
  if (!toDigitizer(m)) return null;
  const mid = bare(m.messageId);
  if (mid) { const { data: dup } = await admin.from("activities").select("id").in("external_id", [mid, `<${mid}>`]).limit(1); if (dup?.length) return "duplicate"; }
  // a thread we know: the portal's request, or one caught before
  const ids = [...new Set([m.inReplyTo, ...m.references].filter(Boolean).flatMap((x) => [bare(x), `<${bare(x)}>`]))].slice(-40);
  let dz: Dz | null = null;
  if (ids.length) {
    const { data } = await admin.from("activities").select("meta").in("external_id", ids).order("occurred_at", { ascending: false }).limit(10);
    for (const r of (data || []) as { meta: { digitize?: Dz; digitizer_reply?: Dz } | null }[]) { const x = r.meta?.digitize || r.meta?.digitizer_reply; if (x?.order_id) { dz = { order_id: x.order_id, imprint_id: x.imprint_id, design_id: x.design_id, items: x.items }; break; } }
  }
  const at = m.date.toISOString();
  let unplaced = false;
  if (dz) {
    // after their files came in, our email in the thread asking for a change: the logo waits for its next version
    const text = `${m.subject}\n${fresh(m.text)}`;
    const items = dz.items?.length ? dz.items : [{ imprint_id: dz.imprint_id, design_id: dz.design_id }];
    if (ASKS_CHANGE.test(text)) for (const it of items) {
      const { data: d } = it.design_id ? await admin.from("designs").select("specs").eq("id", it.design_id).maybeSingle() : { data: null };
      const files = ((d?.specs as { embroidery?: { files?: { at?: string }[] } } | null)?.embroidery?.files) || [];
      // a change asked after their newest file came in (one asked before it is what that file answered)
      const last = files.map((f) => f.at || "").sort().pop() || "";
      if (!files.length || at <= last) continue;
      const { data: o } = await admin.from("orders").select("groups").eq("id", dz.order_id).maybeSingle();
      const im = ((o?.groups || []) as Group[]).flatMap((g) => g.imprints || []).find((x) => x.id === it.imprint_id);
      if (im) await markRequested(admin, dz.order_id, im, at, lc(m.from.address), fresh(m.text).trim().split(/\n\s*\n/)[0].slice(0, 400) || m.subject);
    }
  } else {
    const hit = await findDigitizeOrder(admin, m);
    if (hit) {
      dz = { order_id: hit.order.id, imprint_id: hit.prints[0].id, design_id: hit.prints[0].design_id || null, items: hit.prints.map((im) => ({ imprint_id: im.id, design_id: im.design_id || null })), outside: true };
      for (const im of hit.prints) await markRequested(admin, hit.order.id, im, at, lc(m.from.address));
    } else unplaced = true;
  }
  const folder = dz ? `digitizer/${dz.order_id}` : "digitizer/outside";
  const attachments = await saveAttachments(admin, m, folder);
  const body = await saveBody(admin, m, folder);
  const { data: o } = dz ? await admin.from("orders").select("customer_id").eq("id", dz.order_id).maybeSingle() : { data: null };
  await admin.from("activities").insert({
    customer_id: (o?.customer_id as string) || null, order_id: dz?.order_id || null, kind: "email", direction: "out",
    subject: m.subject.slice(0, 500), body: m.text.slice(0, 100000), from_email: lc(m.from.address),
    to_email: [...m.to, ...m.cc].map((x) => x.address).join(", ").slice(0, 500),
    external_id: m.messageId ? m.messageId.slice(0, 500) : null, thread_id: (m.inReplyTo || m.references[0] || m.messageId || "").slice(0, 500) || null,
    occurred_at: at, created_by: "mailbox", ai_processed_at: new Date().toISOString(),
    meta: { references: m.references.slice(-20), cc: m.cc.map((x) => x.address), attachments, ...body, mailbox: "sent", account_id: acct.id, account: acct.email, ...(dz ? { digitize: { ...dz, outside: true } } : {}), ...(unplaced ? { digitize_unplaced: true } : {}) },
  });
  if (dz) await admin.from("order_events").insert({ order_id: dz.order_id, kind: "digitize_outside", detail: `Emailed to ${DIGITIZER.name} from ${acct.email}, outside the portal: "${m.subject.slice(0, 120)}"`, actor: lc(m.from.address) });
  return "digitizer";
}

/** a placed-by-hand email (Digitizing): its order and prints, and the prints marked requested */
export async function placeDigitizeEmail(admin: SupabaseClient, activityId: string, orderId: string, by: string) {
  const { data: a } = await admin.from("activities").select("id, occurred_at, from_email, meta").eq("id", activityId).maybeSingle();
  if (!a) return { ok: false as const, error: "That email isn't there anymore." };
  const { data: o } = await admin.from("orders").select("id, number, customer_id, groups").eq("id", orderId).maybeSingle();
  if (!o) return { ok: false as const, error: "That order isn't there anymore." };
  const prints = ((o.groups || []) as Group[]).flatMap((g) => g.imprints || []).filter((im) => im.method === "embroidery");
  if (!prints.length) return { ok: false as const, error: "That order has no embroidered print." };
  const waiting = prints.filter((im) => !im.emb?.file && !im.emb?.request);
  const mine = waiting.length ? waiting : prints;
  for (const im of mine) await markRequested(admin, o.id, im, a.occurred_at as string, String(a.from_email || by));
  const dz: Dz = { order_id: o.id, imprint_id: mine[0].id, design_id: mine[0].design_id || null, items: mine.map((im) => ({ imprint_id: im.id, design_id: im.design_id || null })), outside: true };
  const meta = { ...((a.meta || {}) as Record<string, unknown>), digitize: dz, digitize_unplaced: null };
  await admin.from("activities").update({ order_id: o.id, customer_id: o.customer_id, meta }).eq("id", activityId);
  await admin.from("order_events").insert({ order_id: o.id, kind: "digitize_outside", detail: `An email to ${DIGITIZER.name} sent outside the portal was put on this order`, actor: by });
  return { ok: true as const, number: o.number as number };
}
/** not about an order (a question, a hello): off the list */
export async function dismissDigitizeEmail(admin: SupabaseClient, activityId: string) {
  const { data: a } = await admin.from("activities").select("meta").eq("id", activityId).maybeSingle();
  if (!a) return;
  await admin.from("activities").update({ meta: { ...((a.meta || {}) as Record<string, unknown>), digitize_unplaced: null, digitize_dismissed: true } }).eq("id", activityId);
}

/** a message from a mailbox, read whole (attachments too): Exchange by its id, else the mail server by folder and uid */
async function readWhole(admin: SupabaseClient, acct: MailAccount, folder: string, uid: number, messageId: string): Promise<MailMsg | null> {
  const { simpleParser } = await import("mailparser");
  const { toMsg } = await import("@/lib/mail/imap");
  const { ewsReady, ewsMimeByMessageId } = await import("@/lib/mail/ewsBox");
  let raw: Buffer | null = null;
  if (messageId && (await ewsReady(admin, acct).catch(() => false))) raw = await ewsMimeByMessageId(acct, `<${bare(messageId)}>`).catch(() => null) || await ewsMimeByMessageId(acct, bare(messageId)).catch(() => null);
  if (!raw) {
    const { withBox } = await import("@/lib/mail/folders");
    raw = await withBox(acct, async (c) => { const lock = await c.getMailboxLock(folder); try { const x = await c.fetchOne(String(uid), { source: true }, { uid: true }); return x && x.source ? Buffer.from(x.source) : null; } finally { lock.release(); } }, Date.now() + 30000).catch(() => null);
  }
  return raw ? toMsg(await simpleParser(raw)) : null;
}

/** how far back the sweep looks: a week (older mail is from before the portal's digitizing, and for jobs long gone) */
export const SWEEP_DAYS = 7;
/**
 * The sweep: every shop mailbox's mail with the digitizer over the last week that the portal doesn't have yet.
 * Our emails to them first (so their answers find their request), then their answers in those threads (their files
 * come in on their own). Returns how many it took in.
 */
export async function sweepDigitizerOutside(admin: SupabaseClient, until = Date.now() + 40000): Promise<number> {
  const since = new Date(Date.now() - SWEEP_DAYS * 86400000).toISOString();
  const { data: rows } = await admin.from("mail_index").select("account_id, folder, uid, message_id, in_reply_to, from_email, to_text, sent_at")
    .gte("sent_at", since).or(`to_text.ilike.%@${DIGITIZER.domain}%,from_email.ilike.%@${DIGITIZER.domain}`).order("sent_at", { ascending: false }).limit(300);
  const list = (rows || []) as { account_id: string; folder: string; uid: number; message_id: string; in_reply_to: string; from_email: string; to_text: string; sent_at: string }[];
  if (!list.length) return 0;
  const { data: accts } = await admin.from("mail_accounts").select("*").eq("enabled", true);
  const byId = new Map(((accts || []) as MailAccount[]).map((a) => [a.id, a]));
  // what the portal already has, looked up at once
  const have = new Set<string>();
  const want = [...new Set(list.flatMap((r) => [bare(r.message_id), bare(r.in_reply_to)]).filter(Boolean))];
  for (let i = 0; i < want.length; i += 80) {
    const part = want.slice(i, i + 80);
    const { data } = await admin.from("activities").select("external_id").in("external_id", [...part, ...part.map((x) => `<${x}>`)]);
    for (const r of (data || []) as { external_id: string }[]) have.add(bare(r.external_id));
  }
  const known = async (mid: string) => { const b = bare(mid); if (!b || have.has(b)) return true; const { data } = await admin.from("activities").select("id").in("external_id", [b, `<${b}>`]).limit(1); if (data?.length) have.add(b); return !!data?.length; };
  const knownNow = (mid: string) => have.has(bare(mid));
  const seen = new Set<string>();
  let n = 0;
  // ours oldest first within the week, so a thread's first email is placed before its follow-ups
  const ours = list.filter((r) => !lc(r.from_email).endsWith("@" + DIGITIZER.domain)).reverse();
  const theirs = list.filter((r) => lc(r.from_email).endsWith("@" + DIGITIZER.domain) && r.in_reply_to);
  for (const r of ours) {
    if (Date.now() > until) break;
    const a = byId.get(r.account_id); const b = bare(r.message_id);
    if (!a || !b || seen.has(b)) continue; seen.add(b);
    if (knownNow(b)) continue;
    const m = await readWhole(admin, a, r.folder, r.uid, b).catch(() => null);
    if (m && (await digitizerSent(admin, m, { id: a.id, email: a.email }).catch(() => null)) === "digitizer") { n++; have.add(b); }
  }
  for (const r of theirs) {
    if (Date.now() > until) break;
    const a = byId.get(r.account_id); const b = bare(r.message_id);
    if (!a || !b || seen.has(b)) continue; seen.add(b);
    if (knownNow(b)) continue;
    // only answers to a request we have (the marketing emails aren't answers to anything)
    if (!(await known(r.in_reply_to))) continue;
    const m = await readWhole(admin, a, r.folder, r.uid, b).catch(() => null);
    if (m && (await digitizerReply(admin, m, lc(m.from.address), { id: a.id, email: a.email }).catch(() => null)) === "digitizer") n++;
  }
  return n;
}
