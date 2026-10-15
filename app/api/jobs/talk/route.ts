import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { organizerFor } from "@/lib/mail/mirror";
import { mailboxToRead } from "@/lib/mail/viewing";
import { aiState } from "@/lib/ai/claude";
import { designWords } from "@/lib/ai/specHistory";
import { designEmails } from "@/lib/designMail";
import { canSeeTexts, sha } from "@/lib/texts";
import { createHmac } from "node:crypto";
import type { MailAccount } from "@/lib/mail/config";
import { customerJobs, fileCustomerTexts, jobKeys, squash, type Job } from "@/lib/textJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * A job's emails and texts (Oct 15, Nick: "on invoice 27166… a shop-side tab that shows the emails and texts for this
 * order"). Owners only; read only (nothing goes to Printavo or the customer).
 *  GET ?ref=pv:<archived order id> | o:<order id>: the job's texts (filed by lib/textJobs.ts, the AI when jobs
 *    overlap), its emails (Printavo's, the portal's, and the mailbox: ones naming the job number, or its name while it
 *    was open), and the AI's "what happened" with the approvals it saw (kept until the items change).
 *  POST { ref, not: <text id> }: "Not this job": that stretch of texts is filed again elsewhere.
 */
type Item =
  | { kind: "text"; id: string; date: string; from_me: boolean; who: string; body: string; files: { name: string; type: string; url: string }[]; how: string }
  | { kind: "email"; id: string; date: string; incoming: boolean; from: string; subject: string; text: string; pics?: string[]; src: string; folder?: string; uid?: number; act?: string; acct?: string; t?: string };

/**
 * Jose and Claudia see the job's emails too (Oct 15, Nick: "only the emails that pull up because they're attached to a
 * job, not like logging into my email"): each mailbox email on the job carries a signature for that job, and only a
 * signed one opens (with its attachments) for someone who isn't the mailbox's owner. Nothing else in the mailbox can be
 * reached from here.
 */
const sign = (s: string) => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY || "fbs").update(s).digest("base64url").slice(0, 32);
const okSig = (t: string | null, s: string) => !!t && t === sign(s);
type Talk = { sig: string; summary: string; approvals: { id: string; what: string }[] };

/** the owners, Jose and Claudia (lib/texts.ts TEXT_VIEWERS); mailbox emails only for the owners */
async function owner() {
  const v = await getViewer();
  if (!v.user || !v.isStaff || !(await canSeeTexts(v.email, v.role))) return null;
  return { ...v, boss: organizerFor(v.email, v.role) };
}

async function jobOf(admin: ReturnType<typeof createAdminClient>, ref: string) {
  const [k, id] = ref.split(":");
  if (k === "pv") {
    const { data } = await admin.from("archived_orders").select("id, visual_id, nickname, customer_id, data").eq("id", id).maybeSingle();
    return data ? { customer: data.customer_id as string, number: String(data.visual_id), name: String(data.nickname || ""), pvMsgs: (((data.data || {}) as { messages?: { at?: string; incoming?: boolean; from?: string; subject?: string; text?: string }[] }).messages || []) } : null;
  }
  if (k === "o") {
    const { data } = await admin.from("orders").select("id, number, nickname, customer_id").eq("id", id).maybeSingle();
    return data ? { customer: data.customer_id as string, number: String(data.number), name: String(data.nickname || ""), pvMsgs: [] } : null;
  }
  return null;
}

export async function GET(req: Request) {
  const v = await owner();
  if (!v) return NextResponse.json({ error: "Only the owners, Jose and Claudia." }, { status: 403 });
  const u = new URL(req.url), ref = u.searchParams.get("ref") || "";
  const admin = createAdminClient();
  // ?acct&folder&uid&t: a mailbox email on this job, in full; ?acct&att&t: one of its attachments (signed for this job)
  const acctId = u.searchParams.get("acct");
  if (acctId) {
    const { data: a } = await admin.from("mail_accounts").select("*").eq("id", acctId).maybeSingle();
    if (!a) return NextResponse.json({ error: "That mailbox isn't connected any more." }, { status: 404 });
    const att = u.searchParams.get("att");
    if (att) {
      if (!okSig(u.searchParams.get("t"), `${acctId}|att|${att}|${ref}`)) return NextResponse.json({ error: "Not on this job." }, { status: 403 });
      const { ewsAttachment } = await import("@/lib/mail/ews");
      const f = await ewsAttachment(a as MailAccount, att);
      if (!f) return NextResponse.json({ error: "That attachment isn't there any more." }, { status: 404 });
      const dl = u.searchParams.get("dl") === "1";
      return new Response(new Uint8Array(f.content), { headers: { "Content-Type": f.type, "Content-Disposition": `${!dl && /^(image\/|application\/pdf)/.test(f.type) ? "inline" : "attachment"}; filename="${f.name.replace(/["\\\r\n]/g, "_")}"`, "Cache-Control": "private, max-age=3600" } });
    }
    const folder = u.searchParams.get("folder") || "", uid = Number(u.searchParams.get("uid") || 0);
    if (!okSig(u.searchParams.get("t"), `${acctId}|${folder}|${uid}|${ref}`)) return NextResponse.json({ error: "Not on this job." }, { status: 403 });
    const attUrl = (id: string, dl = false) => `/api/jobs/talk?${new URLSearchParams({ ref, acct: acctId, att: id, t: sign(`${acctId}|att|${id}|${ref}`), ...(dl ? { dl: "1" } : {}) })}`;
    const { ewsOpen } = await import("@/lib/mail/ewsBox");
    const m = await ewsOpen(admin, a as MailAccount, folder, uid, (id) => attUrl(id)).catch(() => null);
    if (!m) return NextResponse.json({ error: "That email isn't in the mailbox any more." }, { status: 404 });
    const atts = ((m as unknown as { ews?: { id: string; name: string; size?: number; inline?: boolean }[] }).ews || []).filter((x) => !x.inline);
    return NextResponse.json({ html: m.html, text: m.text, from: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress, to: m.to, cc: m.cc, date: m.date, subject: m.subject,
      attachments: atts.map((x) => ({ name: x.name, size: x.size || 0, type: "", url: attUrl(x.id), download: attUrl(x.id, true) })) });
  }
  // ?act=<activity id>: an email kept in the portal, in full (its HTML, as Outlook shows it, and its attachments)
  const actId = u.searchParams.get("act");
  if (actId) {
    if (!v.boss && !okSig(u.searchParams.get("t"), `act|${actId}|${ref}`)) return NextResponse.json({ error: "Not on this job." }, { status: 403 });
    const { data: a } = await admin.from("activities").select("subject, body, from_email, to_email, occurred_at, direction, meta").eq("id", actId).maybeSingle();
    if (!a) return NextResponse.json({ error: "That email isn't here any more." }, { status: 404 });
    const meta = (a.meta || {}) as { html?: string; cc?: string[] | string; from_name?: string; attachments?: { path?: string; name?: string; size?: number; type?: string; signature?: boolean }[] };
    const atts = (meta.attachments || []).filter((f) => f.path && !f.signature);
    const { data: s } = atts.length ? await admin.storage.from("proofs").createSignedUrls(atts.map((f) => f.path!), 3600, ) : { data: [] };
    const { data: dl } = atts.length ? await admin.storage.from("proofs").createSignedUrls(atts.map((f) => f.path!), 3600, { download: true }) : { data: [] };
    return NextResponse.json({ html: meta.html || "", text: a.body || "", from: meta.from_name ? `${meta.from_name} <${a.from_email}>` : a.from_email, to: a.to_email || "", cc: Array.isArray(meta.cc) ? meta.cc.join(", ") : meta.cc || "", date: a.occurred_at, subject: a.subject || "",
      attachments: atts.map((f, i) => ({ name: f.name || f.path!.split("/").pop(), size: f.size || 0, type: f.type || "", url: s?.[i]?.signedUrl || "", download: dl?.[i]?.signedUrl || "" })) });
  }
  const job = await jobOf(admin, ref);
  if (!job?.customer) return NextResponse.json({ error: "No such job." }, { status: 404 });
  const st = await aiState(admin);
  const { askClaude } = await import("@/lib/ai/claude");
  const model = st.ready ? st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model : "";
  const fmt = (j: Job) => `#${j.number} "${j.name}" (ordered ${new Date(j.start + 2 * 864e5).toISOString().slice(0, 10)}, due ${j.due || "?"})`;

  // 1. file this customer's texts (the AI picks when several jobs were open)
  await fileCustomerTexts(admin, job.customer, st.ready ? async (session, jobs, around) => {
    const r = await askClaude<{ job: string | null }>({
      task: "text_job", model, maxTokens: 200, admin, ctx: { by: v.email }, timeoutMs: 20_000,
      tool: { name: "pick", description: "Which job these texts are about.", input_schema: { type: "object", properties: { job: { type: ["string", "null"], description: "The job number, or null when they're about none of these (or can't tell)." } }, required: ["job"] } },
      system: "You file a print shop's texts with a customer to the job they're about. Use the names, garments, sizes, colors and timing: a job already past its due date was probably done; texts about sizing, samples or proofs are about a job still being made. Answer null when it isn't clear.",
      prompt: `Jobs open then:\n${jobs.map(fmt).join("\n")}\n\nThe texts (${session[0].sent_at.slice(0, 10)}):\n${session.map((x) => `${x.from_me ? "Shop" : "Customer"}: ${x.body || "(a picture)"}`).join("\n").slice(0, 4000)}${around ? `\n\nTexts a few days before/after (context):\n${around}` : ""}`,
    });
    const n = r.ok ? String(r.data.job || "").replace(/^#/, "") : "";
    return jobs.find((j) => j.number === n)?.ref || null;
  } : undefined).catch(() => 0);

  // 2. its texts
  const { data: tx } = await admin.from("text_messages").select("id, from_me, body, sent_at, handle, owner, files, job_how").eq("job_ref", ref).order("sent_at").limit(1000);
  const texts = (tx || []) as { id: string; from_me: boolean; body: string; sent_at: string; handle: string; owner: string; files: { name: string; type: string; path: string }[]; job_how: string | null }[];
  const paths = texts.flatMap((t) => (t.files || []).map((f) => f.path));
  const signed = new Map<string, string>();
  if (paths.length) { const { data: s } = await admin.storage.from("proofs").createSignedUrls(paths, 3600); for (const x of s || []) if (x.path && x.signedUrl) signed.set(x.path, x.signedUrl); }
  const [{ data: c }, { data: cts }, { data: staff }] = await Promise.all([
    admin.from("customers").select("company, name, phone, email").eq("id", job.customer).maybeSingle(),
    admin.from("customer_contacts").select("name, phone, email").eq("customer_id", job.customer),
    admin.from("staff").select("email, name"),
  ]);
  const digits = (s: string | null | undefined) => String(s || "").replace(/\D/g, "").slice(-10);
  const nameOf = (h: string) => { const d = digits(h); const p = [...((cts || []) as { name: string; phone: string; email: string }[]), ...(c ? [{ name: c.name, phone: c.phone, email: c.email }] : [])].find((x) => (d.length === 10 && digits(x.phone) === d) || (x.email && x.email.toLowerCase() === h.toLowerCase())); return p?.name || h; };
  const mine = (e: string) => (((staff || []) as { email: string; name: string | null }[]).find((x) => x.email.toLowerCase() === e.toLowerCase())?.name || e.split("@")[0]).split(/\s+/)[0].replace(/^./, (x) => x.toUpperCase());
  const items: Item[] = texts.map((t) => ({ kind: "text", id: t.id, date: t.sent_at, from_me: t.from_me, who: t.from_me ? mine(t.owner) : nameOf(t.handle), body: t.body, files: (t.files || []).map((f) => ({ name: f.name, type: f.type, url: signed.get(f.path) || "" })), how: t.job_how || "" }));

  // 3. its emails: Printavo's, then the mailbox and the portal's (naming the job number, or its name while it was open)
  const jobs = await customerJobs(admin, job.customer);
  const me = jobs.find((j) => j.ref === ref);
  job.pvMsgs.forEach((m, i) => { if ((m.text || m.subject || "").trim()) items.push({ kind: "email", id: `pv${i}`, date: String(m.at || ""), incoming: !!m.incoming, from: m.incoming ? m.from || c?.name || "Customer" : "FBS (Printavo)", subject: m.subject || "", text: String(m.text || "").slice(0, 3000), src: "Printavo" }); });
  const { acct } = v.boss ? await mailboxToRead(admin, v) : { acct: null };
  // Jose and Claudia: the owners' mailboxes (only what's on this job comes back)
  let boxes: MailAccount[] = acct && acct.enabled ? [acct] : [];
  if (!v.boss) {
    const { data: accts } = await admin.from("mail_accounts").select("*").eq("enabled", true);
    const { data: st2 } = await admin.from("staff").select("email, role");
    boxes = ((accts || []) as MailAccount[]).filter((x) => { const r = ((st2 || []) as { email: string; role: string }[]).find((y) => y.email.toLowerCase() === x.email.toLowerCase()); return organizerFor(x.email, r?.role || ""); });
  }
  const words = [...new Set([...designWords(job.name), job.number])];
  const keys = jobKeys(job.name);
  const signUrls = async (p: string[]) => { if (!p.length) return [] as string[]; const { data } = await admin.storage.from("proofs").createSignedUrls(p, 3600); return (data || []).map((d) => d.signedUrl || "").filter(Boolean); };
  const found: { emails: (Awaited<ReturnType<typeof designEmails>>["emails"][number] & { acct?: string })[] } = { emails: [] };
  for (const bx of boxes.length ? boxes : [null]) {
    const r = await designEmails(admin, bx, job.customer, words, { pics: signUrls }).catch(() => ({ emails: [] as never[] }));
    for (const e of r.emails) found.emails.push({ ...e, ...(bx && e.folder && e.uid ? { acct: bx.id } : {}) });
  }
  const seen = new Set(items.filter((i) => i.kind === "email").map((i) => `${(i as { subject: string }).subject}|${i.date.slice(0, 10)}`));
  found.emails.forEach((e, i) => {
    const hay = `${e.subject} ${e.text}`, at = Date.parse(e.date);
    const byNumber = new RegExp(`\\b${job.number}\\b`).test(hay);
    const byName = me && at >= me.start && at <= me.end && keys.some((k) => squash(hay).includes(k));
    if (!byNumber && !byName) return;
    const k = `${e.subject}|${e.date.slice(0, 10)}`; if (seen.has(k)) return; seen.add(k);
    items.push({ kind: "email", id: `m${i}`, date: e.date, incoming: e.incoming, from: e.from, subject: e.subject, text: e.text, ...(e.pics?.length ? { pics: e.pics } : {}), ...(e.folder && e.uid && e.acct ? { folder: e.folder, uid: e.uid, acct: e.acct, t: sign(`${e.acct}|${e.folder}|${e.uid}|${ref}`) } : {}), ...(e.act ? { act: e.act, ...(e.folder && e.uid && e.acct ? {} : { t: sign(`act|${e.act}|${ref}`) }) } : {}), src: byNumber ? `names #${job.number}` : "names the job, while it was open" });
  });
  items.sort((a, b) => a.date.localeCompare(b.date));

  // 4. what happened, and the approvals (kept until the items change)
  const sig = sha(items.map((i) => i.id).join(",")).slice(0, 16);
  const key = `job_talk:${ref}`;
  const { data: had } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", key).maybeSingle();
  let talk = (had?.payload as Talk | undefined) || null;
  if ((!talk || talk.sig !== sig) && items.length && st.ready) {
    const r = await askClaude<{ summary: string; approvals: unknown }>({
      task: "job_talk", model, maxTokens: 700, admin, ctx: { by: v.email }, timeoutMs: 30_000,
      tool: { name: "talk", description: "What happened on this job, from its emails and texts.", input_schema: { type: "object", properties: {
        summary: { type: "string", description: "2-3 short sentences: what the customer asked for or approved, any changes, problems, pickup/delivery. Dates as \"Nov 5\". No filler." },
        approvals: { type: "array", items: { type: "object", properties: { id: { type: "string", description: "The id of the customer's message that approved something" }, what: { type: "string", description: "What they approved, 2-4 words: \"the sizing\", \"the sample\", \"the mockup\", \"the price\"" } }, required: ["id", "what"] } },
      }, required: ["summary", "approvals"] } },
      system: "You read a screen printing shop's emails and texts with a customer about one job. An approval is the customer clearly okaying something the shop showed or asked (a photo, a mockup, sizing, a sample, a price), e.g. \"Yep!\" right after \"Sizing look ok?\" with photos.",
      prompt: `Job #${job.number} "${job.name}" for ${c?.company || c?.name || "the customer"}.\n\n${items.map((i) => i.kind === "text" ? `[${i.id}] ${i.date.slice(0, 16)} TEXT ${i.from_me ? "shop" : "customer"}: ${i.body || ""}${i.files.length ? ` (+${i.files.length} picture${i.files.length === 1 ? "" : "s"})` : ""}` : `[${i.id}] ${i.date.slice(0, 16)} EMAIL ${i.incoming ? "customer" : "shop"}: "${i.subject}" ${i.text.replace(/\s+/g, " ").slice(0, 700)}`).join("\n").slice(0, 30000)}`,
    });
    if (r.ok) {
      const ap = (Array.isArray(r.data.approvals) ? r.data.approvals : []) as { id: string; what: string }[];
      talk = { sig, summary: String(r.data.summary || "").slice(0, 800), approvals: ap.filter((a) => items.some((i) => i.id === a.id)).map((a) => ({ id: a.id, what: String(a.what).slice(0, 40) })) };
      await admin.from("ai_suggestions").upsert({ kind: "job_talk", dedupe_key: key, source: "ai", status: "done", priority: 3, customer_id: job.customer, title: `Emails & texts #${job.number}`, body: talk.summary, payload: talk, model: r.model }, { onConflict: "dedupe_key" });
    }
  }
  return NextResponse.json({ customer: c?.company || c?.name || "", number: job.number, name: job.name, items, summary: talk?.summary || "", approvals: talk?.approvals || [] });
}

export async function POST(req: Request) {
  const v = await owner();
  if (!v) return NextResponse.json({ error: "Only the owners, Jose and Claudia." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { ref?: string; not?: string };
  if (!b.ref || !b.not) return NextResponse.json({ error: "ref and not" }, { status: 400 });
  const admin = createAdminClient();
  const { data: t } = await admin.from("text_messages").select("sent_at, customer_id").eq("id", b.not).eq("job_ref", b.ref).maybeSingle();
  if (!t) return NextResponse.json({ error: "That text isn't on this job." }, { status: 404 });
  // the stretch of texts it's in (6 hours either side), filed again somewhere else
  const at = Date.parse(t.sent_at as string);
  const { data: rows } = await admin.from("text_messages").select("id, job_not").eq("job_ref", b.ref).gte("sent_at", new Date(at - 6 * 3600e3).toISOString()).lte("sent_at", new Date(at + 6 * 3600e3).toISOString());
  for (const r of (rows || []) as { id: string; job_not: string[] | null }[]) await admin.from("text_messages").update({ job_ref: null, job_how: null, job_checked_at: null, job_not: [...new Set([...(r.job_not || []), b.ref])] }).eq("id", r.id);
  return NextResponse.json({ ok: true, moved: (rows || []).length });
}
