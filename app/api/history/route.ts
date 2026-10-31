import { NextResponse } from "next/server";
import { canSeeTexts } from "@/lib/texts";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { designWords } from "@/lib/ai/specHistory";
import { latestSpecs, type DesignSpecs } from "@/lib/designSpecs";
import { designEmails } from "@/lib/designMail";
import { mailboxToRead } from "@/lib/mail/viewing";
import { allRows } from "@/lib/readAll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Design history (Oct 14, Nick: "when we pull up this email, an option to look back on all communications about this
 * product: the original email, the first order, the second email, the second order… a running history for this
 * design"). Everything about one design of one customer, oldest first:
 *  - old Printavo jobs that name it (garments, prints, total, mockups) and the emails saved on them;
 *  - portal orders that name it (prints, and what production confirmed);
 *  - emails with the customer that mention it (the mailbox's copy since Aug 28, 2026, and emails kept in the portal);
 *  - production confirmations saved on the design (designs.specs).
 * Text messages join when the Mac is linked.
 *
 * GET ?customer=<id>&q=<words> (or &text=<an email's subject / summary>, the design's name is picked out of it by the
 * names the customer's jobs and designs use); &count=1 for just the numbers (the link on an email).
 */
type Item =
  | { kind: "order"; src: "printavo" | "portal"; date: string; id: string; number: string; title: string; qty: number; total: number; garments: string[]; prints: string[]; thumbs: string[]; status?: string }
  | { kind: "email"; date: string; from: string; incoming: boolean; subject: string; text: string; on?: string; pics?: string[] }
  | { kind: "confirmed"; date: string; by: string; order: string; spec: string };

const clean = (t: string) => String(t || "").replace(/\r/g, "").split(/\n(?:On .{5,160} wrote:|-----Original Message-----|From: .{3,200}\n(?:Sent|Date): )/)[0].replace(/\n{3,}/g, "\n\n").trim();

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const u = new URL(req.url);
  const cid = u.searchParams.get("customer") || "";
  const countOnly = u.searchParams.get("count") === "1";
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  const admin = createAdminClient();

  // the jobs and designs the customer has, to know which words are design names
  const [{ data: arch }, { data: ords }, { data: dsgs }, { data: cust }] = await Promise.all([
    allRows((r0, r1) => admin.from("archived_orders").select("id, visual_id, nickname, order_date, search_text, total, qty, status_name").eq("customer_id", cid).order("order_date").order("id").range(r0, r1), 2000),
    admin.from("orders").select("id, number, nickname, notes, created_at, status, groups").eq("customer_id", cid).order("created_at").limit(1000),
    admin.from("designs").select("id, name, specs").eq("customer_id", cid).limit(1000),
    admin.from("customers").select("company, name, email").eq("id", cid).maybeSingle(),
  ]);
  const names = [...(arch || []).map((a) => a.nickname), ...(ords || []).map((o) => o.nickname), ...(dsgs || []).map((d) => d.name)].map((n) => String(n || "").toLowerCase()).join(" | ");
  let words = designWords(u.searchParams.get("q"));
  if (!words.length) {
    // the subject first (it names the design); the AI's summary only if the subject doesn't
    for (const k of ["text", "text2"]) { words = designWords(u.searchParams.get(k)).filter((w) => names.includes(w)).slice(0, 3); if (words.length) break; }
  }
  if (!words.length) return NextResponse.json({ words: [], items: [], counts: { orders: 0, emails: 0 }, customer: cust?.company || cust?.name || "" });
  const hit = (t: unknown) => { const x = String(t || "").toLowerCase(); return words.some((w) => x.includes(w)); };

  const jobs = (arch || []).filter((a) => hit(a.nickname) || hit(a.search_text));
  const ours = (ords || []).filter((o) => hit(o.nickname) || hit(o.notes) || (o.groups as { name?: string }[] || []).some((g) => hit(g.name)));
  // emails: the mailbox's copy, with the customer's people (or their company's domain)
  const { data: cts } = await admin.from("customer_contacts").select("email").eq("customer_id", cid);
  const addrs = [cust?.email, ...(cts || []).map((c) => c.email)].map((e) => String(e || "").toLowerCase()).filter((e) => e.includes("@"));
  const domains = [...new Set(addrs.filter((e) => !/@(gmail|yahoo|hotmail|outlook|icloud|aol|live|msn|me)\./.test(e)).map((e) => e.split("@")[1]))];
  const { data: mails } = await admin.from("mail_cache").select("subject, from_email, from_name, to_text, sent_at, body_text, folder").or(words.map((w) => `hay.ilike.%${w}%`).join(",")).is("gone_at", null).order("sent_at").limit(150);
  const mine = (mails || []).filter((m) => { const t = `${m.from_email} ${m.to_text}`.toLowerCase(); return addrs.some((a) => t.includes(a)) || domains.some((d) => t.includes("@" + d)); });
  const { data: acts } = await admin.from("activities").select("occurred_at, direction, subject, body, from_email, meta").eq("customer_id", cid).order("occurred_at").limit(600);
  const kept = (acts || []).filter((a) => hit(a.subject) || hit(a.body));
  const pvMsgs = jobs.length;

  if (countOnly) {
    const seen = new Set([...mine.map((m) => `${String(m.subject || "").toLowerCase()}|${String(m.sent_at).slice(0, 15)}`)]);
    const keptNew = kept.filter((a) => !seen.has(`${String(a.subject || "").toLowerCase()}|${String(a.occurred_at).slice(0, 15)}`)).length;
    // the whole mailbox, when it was searched before (the link never searches it: opening the history does)
    const { data: c } = await admin.from("design_mail_cache").select("emails").like("key", `${cid}:%:${[...words].sort().join(" ")}`).limit(1).maybeSingle();
    return NextResponse.json({ words, counts: { orders: jobs.length + ours.length, emails: Math.max(mine.length + keptNew, ((c?.emails as unknown[]) || []).length), jobs: pvMsgs }, customer: cust?.company || cust?.name || "" });
  }

  const items: Item[] = [];
  const sign = async (paths: string[]) => {
    if (!paths.length) return [] as string[];
    const { data } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
    return (data || []).map((d) => d.signedUrl || "").filter(Boolean);
  };
  for (const j of jobs) {
    const { data: a } = await admin.from("archived_orders").select("data, files").eq("id", j.id).maybeSingle();
    const d = (a?.data || {}) as { groups?: { lines?: { description?: string; itemNumber?: string; color?: string; items?: number }[]; imprints?: { details?: string; typeOfWork?: string }[] }[]; messages?: { at?: string; incoming?: boolean; subject?: string; text?: string; from?: string }[] };
    const pics = Object.values((a?.files || {}) as Record<string, string>).filter((p) => /\.(jpe?g|png|webp)$/i.test(p)).slice(0, 3);
    items.push({
      kind: "order", src: "printavo", date: String(j.order_date || ""), id: j.id, number: String(j.visual_id), title: String(j.nickname || "").trim(), qty: +j.qty || 0, total: +j.total || 0, status: j.status_name || "",
      garments: (d.groups || []).flatMap((g) => (g.lines || []).map((l) => `${[l.itemNumber, l.description].filter(Boolean).join(" ")}${l.color ? `, ${l.color}` : ""}${l.items ? ` (${l.items})` : ""}`)).slice(0, 6),
      prints: (d.groups || []).flatMap((g) => (g.imprints || []).map((im) => `${im.typeOfWork || ""} ${String(im.details || "").replace(/\s+/g, " ")}`.trim())).filter(Boolean).slice(0, 6),
      thumbs: await sign(pics),
    });
    for (const m of d.messages || []) if ((m.text || "").trim()) items.push({ kind: "email", date: String(m.at || j.order_date || ""), from: m.incoming ? (m.from || "The customer") : "FBS", incoming: !!m.incoming, subject: m.subject || "", text: clean(m.text || "").slice(0, 3000), on: `Printavo #${j.visual_id}` });
  }
  for (const o of ours) {
    const groups = (o.groups || []) as { lines?: { style?: string; color?: string; sizes?: Record<string, number> }[]; imprints?: { location?: string; size?: string; inks?: string; colors?: number; confirmed?: { by: string; at: string }; confirm?: unknown }[]; mockupThumbs?: string[]; customerMockups?: { path: string }[] }[];
    items.push({
      kind: "order", src: "portal", date: String(o.created_at), id: o.id, number: String(o.number), title: o.nickname || "", status: o.status,
      qty: groups.reduce((n, g) => n + (g.lines || []).reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, b) => a + (+b || 0), 0), 0), 0), total: 0,
      garments: groups.flatMap((g) => (g.lines || []).map((l) => [l.style, l.color].filter(Boolean).join(", "))).filter(Boolean).slice(0, 6),
      prints: groups.flatMap((g) => (g.imprints || []).map((im) => `${im.location}: ${[im.size, im.inks, im.colors ? `${im.colors} colors` : ""].filter(Boolean).join(", ")}${im.confirmed ? ` ✓ confirmed by ${im.confirmed.by}` : im.confirm ? " (awaiting production)" : ""}`)).slice(0, 6),
      thumbs: await sign(groups.flatMap((g) => [...(g.mockupThumbs || []), ...(g.customerMockups || []).map((c) => c.path)]).filter((p) => /\.(jpe?g|png|webp)$/i.test(p)).slice(0, 3)),
    });
  }
  // emails: the whole mailbox (every year, Exchange's own search), the portal's copy, and emails kept in the portal
  const { acct } = await mailboxToRead(admin, v);
  const found = await designEmails(admin, acct && acct.enabled ? acct : null, cid, words, { fresh: u.searchParams.get("fresh") === "1", pics: sign });
  for (const e of found.emails) items.push({ kind: "email", date: e.date, from: e.from, incoming: e.incoming, subject: e.subject, text: e.text, ...(e.pics?.length ? { pics: e.pics } : {}) });
  // texts with them that name the design, and pictures sent around those (Oct 15: the Mac's texts; owners only)
  if (await canSeeTexts(v.email, v.role)) {
    const { data: tx } = await allRows((r0, r1) => admin.from("text_messages").select("from_me, body, sent_at, files").eq("customer_id", cid).order("sent_at").order("id").range(r0, r1), 3000);
    const all = (tx || []) as { from_me: boolean; body: string; sent_at: string; files: { path: string; type: string }[] }[];
    const near = all.filter((t) => hit(t.body)).map((t) => Date.parse(t.sent_at));
    for (const t of all) {
      const at = Date.parse(t.sent_at), named = hit(t.body), pic = (t.files || []).some((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.path));
      if (!named && !(pic && near.some((n) => Math.abs(n - at) < 2 * 864e5))) continue;
      const pics = await sign((t.files || []).map((f) => f.path).filter((p) => /\.(jpe?g|png|webp)$/i.test(p)).slice(0, 4));
      items.push({ kind: "email", date: t.sent_at, from: t.from_me ? "FBS (text)" : `${cust?.company || cust?.name || "Customer"} (text)`, incoming: !t.from_me, subject: "Text message", text: t.body, ...(pics.length ? { pics } : {}) });
    }
  }
  for (const d of (dsgs || []).filter((x) => hit(x.name)) as { name: string; specs: DesignSpecs }[]) for (const e of latestSpecs(d.specs)) {
    items.push({ kind: "confirmed", date: e.at, by: e.by, order: `#${e.order_number}`, spec: [e.location, e.size, e.drop ? `${e.drop}" drop` : "", e.inks, `${e.colors} colors`, e.underbase === true ? "underbase" : e.underbase === false ? "no underbase" : ""].filter(Boolean).join(" · ") });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return NextResponse.json({ words, items, wholeMailbox: found.wholeMailbox, customer: cust?.company || cust?.name || "", counts: { orders: jobs.length + ours.length, emails: items.filter((i) => i.kind === "email").length } });
}
