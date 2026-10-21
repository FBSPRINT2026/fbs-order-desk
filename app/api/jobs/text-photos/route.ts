import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canSeeTexts } from "@/lib/texts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pictures from the customer's texts and emails, for a job's production photos (Oct 21, Nick: "find photos… look at
 * the messages to Brooke… I sent this one"; "add from my messages" on the phone). The texts come from the Mac bridge
 * (lib/texts.ts), the emails are the ones kept in the portal; one picked is copied to the job's photos (job_files, tag
 * "Sample"): a portal order (kind "o") or an old Printavo job (kind "a": photos of what we did last time go on the job
 * they're of). Owners, Jose and Claudia (the ones who can see texts). Read only, apart from that copy.
 *  GET ?kind=o|a&id → { items: [{ key, src, url, name, date, fromMe, body, job, here }] } (here = filed to this job)
 *  POST { kind, id, key, note } → copies it to the job's photos
 */
type TextRow = { id: string; from_me: boolean; body: string; sent_at: string; job_ref: string | null; chat: string; chat_name: string; handle: string; files_missing: { id: string; name: string }[] | null; files: { name: string; type: string; path: string; size?: number }[] | null };
type ActRow = { id: string; direction: string; subject: string; occurred_at: string; meta: { attachments?: { name?: string; path?: string; size?: number; type?: string; signature?: boolean }[] } | null };

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff || !(await canSeeTexts(v.email, v.role))) return null;
  return { by_name: String((v as { staff?: { name?: string } }).staff?.name || "") || v.email.split("@")[0], by_email: v.email };
}

const isPic = (t?: string, n?: string) => /^image\//i.test(t || "") || /\.(jpe?g|png|heic|webp|gif)$/i.test(n || "");

type Ref = { kind: "o" | "a"; id: string };
const refOf = (k: unknown, id: unknown): Ref | null => ((k === "o" || k === "a") && typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? { kind: k, id } : null);

async function candidates(admin: ReturnType<typeof createAdminClient>, r: Ref) {
  const { data: o } = await admin.from(r.kind === "o" ? "orders" : "archived_orders").select("id, customer_id").eq("id", r.id).maybeSingle();
  if (!o?.customer_id) return null;
  const here = new Set([r.kind === "o" ? `o:${r.id}` : `pv:${r.id}`]);
  const [{ data: tx }, { data: acts }] = await Promise.all([
    // only texts with a picture (most texts have none: a plain limit cut the older pictures off), or one still on the phone
    admin.from("text_messages").select("id, from_me, body, sent_at, job_ref, files, chat, chat_name, handle, files_missing").eq("customer_id", o.customer_id).or("files.neq.[],files_missing.not.is.null").order("sent_at", { ascending: false }).limit(600),
    admin.from("activities").select("id, direction, subject, occurred_at, meta").eq("customer_id", o.customer_id).not("meta->attachments", "is", null).order("occurred_at", { ascending: false }).limit(200),
  ]);
  type Item = { /** the picture isn't on the Mac (kept in iCloud only): shown, can't be added yet */ missing?: boolean; key: string; src: "text" | "email"; path: string; name: string; type: string; date: string; fromMe: boolean; body: string; ref: string; /** the text chain */ chat?: string; chatName?: string; handle?: string };
  const items: Item[] = [];
  for (const t of (tx || []) as TextRow[]) for (const f of t.files || []) if (f?.path && isPic(f.type, f.name)) items.push({ key: `t:${t.id}:${f.path}`, src: "text", path: f.path, name: f.name, type: f.type || "image/jpeg", date: t.sent_at, fromMe: t.from_me, body: (t.body || "").slice(0, 200), ref: t.job_ref || "", chat: t.chat || t.handle, chatName: t.chat_name || "", handle: t.handle });
  for (const t of (tx || []) as TextRow[]) for (const f of t.files_missing || []) items.push({ missing: true, key: `m:${t.id}:${f.id}`, src: "text", path: "", name: f.name || "picture", type: "", date: t.sent_at, fromMe: t.from_me, body: (t.body || "").slice(0, 200), ref: t.job_ref || "", chat: t.chat || t.handle, chatName: t.chat_name || "", handle: t.handle });
  // emails: a picture that turns up in many emails (the same size) is a signature logo, not a photo
  const atts = ((acts || []) as ActRow[]).flatMap((a) => (a.meta?.attachments || []).filter((f) => f.path && !f.signature && isPic(f.type, f.name)).map((f) => ({ a, f })));
  const seen = new Map<number, number>();
  for (const { f } of atts) if (f.size) seen.set(f.size, (seen.get(f.size) || 0) + 1);
  for (const { a, f } of atts) {
    if (f.size && (seen.get(f.size) || 0) > 2) continue;
    if (/^(Outlook-|image\d{3}\.)/i.test(f.name || "") && (f.size || 0) < 120_000) continue;
    items.push({ key: `e:${a.id}:${f.path}`, src: "email", path: f.path!, name: f.name || "picture", type: f.type || "image/png", date: a.occurred_at, fromMe: a.direction === "out", body: a.subject || "", ref: "" });
  }
  return { customer: o.customer_id as string, here, items };
}

export async function GET(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: "Only the owners, Jose and Claudia can look through the customer's messages." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const r = refOf(sp.get("kind"), sp.get("id"));
  if (!r) return NextResponse.json({ error: "Which job?" }, { status: 400 });
  const admin = createAdminClient();
  const c = await candidates(admin, r);
  if (!c) return NextResponse.json({ error: "That job isn't here." }, { status: 404 });
  // this job's first (and the job it's a reorder of), then the newest
  const list = [...c.items].sort((a, b) => Number(c.here.has(b.ref)) - Number(c.here.has(a.ref)) || b.date.localeCompare(a.date)).slice(0, 300);
  // the text chains by who they're with (Oct 21, Nick: "select the text chain and then see the photos I've sent")
  const { data: cu } = await admin.from("customers").select("name, company, phone, email").eq("id", c.customer).maybeSingle();
  const { data: cts } = await admin.from("customer_contacts").select("name, phone, email").eq("customer_id", c.customer);
  const dig = (s: string | null | undefined) => String(s || "").replace(/\D/g, "").slice(-10);
  const people = [...((cts || []) as { name: string; phone: string; email: string }[]), ...(cu ? [{ name: cu.name, phone: cu.phone, email: cu.email }] : [])];
  const nameOf = (h: string) => { const d = dig(h); return people.find((x) => (d.length === 10 && dig(x.phone) === d) || (x.email && x.email.toLowerCase() === h.toLowerCase()))?.name || ""; };
  const chatLabel = new Map<string, string>();
  for (const x of list) if (x.src === "text" && x.chat && !chatLabel.has(x.chat)) {
    const isGroup = !!x.chat && x.chat !== x.handle && !/^\+?\d+$|@/.test(x.chat);
    chatLabel.set(x.chat, x.chatName || (isGroup ? `Group text with ${nameOf(x.handle || "") || cu?.company || "them"}` : nameOf(x.handle || "") || x.handle || "Text"));
  }
  const paths = [...new Set(list.map((x) => x.path).filter(Boolean))];
  const signed = new Map<string, string>();
  if (paths.length) { const { data } = await admin.storage.from("proofs").createSignedUrls(paths, 3600); for (const s of data || []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl); }
  // job numbers for the texts filed to a job
  const oIds = [...new Set(list.map((x) => x.ref).filter((r) => r.startsWith("o:")).map((r) => r.slice(2)))];
  const aIds = [...new Set(list.map((x) => x.ref).filter((r) => r.startsWith("pv:")).map((r) => r.slice(3)))];
  const [{ data: os }, { data: as }] = await Promise.all([
    oIds.length ? admin.from("orders").select("id, number, nickname").in("id", oIds) : Promise.resolve({ data: [] }),
    aIds.length ? admin.from("archived_orders").select("id, visual_id, nickname").in("id", aIds) : Promise.resolve({ data: [] }),
  ]);
  const jobs = new Map<string, string>([
    ...((os || []) as { id: string; number: number; nickname: string }[]).map((o) => [`o:${o.id}`, `#${o.number} ${o.nickname || ""}`.trim()] as [string, string]),
    ...((as || []) as { id: string; visual_id: string; nickname: string }[]).map((o) => [`pv:${o.id}`, `#${o.visual_id} ${o.nickname || ""}`.trim()] as [string, string]),
  ]);
  return NextResponse.json({ items: list.filter((x) => x.missing || signed.get(x.path)).map((x) => ({ key: x.key, src: x.src, url: x.missing ? "" : signed.get(x.path), ...(x.missing ? { missing: true } : {}), name: x.name, date: x.date, fromMe: x.fromMe, body: x.body, job: jobs.get(x.ref) || "", here: c.here.has(x.ref), ...(x.src === "text" ? { chat: x.chat, with: chatLabel.get(x.chat || "") || "" } : {}) })), customer: cu?.company || cu?.name || "" });
}

export async function POST(req: Request) {
  const who = await staff();
  if (!who) return NextResponse.json({ error: "Only the owners, Jose and Claudia." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; id?: string; key?: string; note?: string };
  const r = refOf(b.kind, b.id);
  if (!r) return NextResponse.json({ error: "Which job?" }, { status: 400 });
  const admin = createAdminClient();
  const c = await candidates(admin, r);
  if (!c) return NextResponse.json({ error: "That job isn't here." }, { status: 404 });
  const col = r.kind === "o" ? "order_id" : "archived_order_id";
  // only one of this customer's own pictures
  const it = c.items.find((x) => x.key === b.key);
  if (!it) return NextResponse.json({ error: "That picture isn't in this customer's messages." }, { status: 404 });
  if (it.missing) return NextResponse.json({ error: "That picture is on your iPhone only: Messages on the Mac mini hasn't downloaded it yet." }, { status: 409 });
  const { data: had } = await admin.from("job_files").select("id").eq(col, r.id).eq("archived", false).eq("tag", "Sample").like("body", `%[${it.key.slice(0, 2)}${it.path.split("/").pop()}]%`).limit(1);
  if (had?.length) return NextResponse.json({ error: "That one is already on the job." }, { status: 409 });
  const name = it.name.replace(/[^\w.-]+/g, "_").slice(-80) || "photo.jpg";
  const path = `production/jobs/${r.kind}-${r.id}/${Date.now()}-${name}`;
  const cp = await admin.storage.from("proofs").copy(it.path, path);
  if (cp.error) return NextResponse.json({ error: `Couldn't copy the picture: ${cp.error.message}` }, { status: 500 });
  const when = new Date(it.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  const body = `${String(b.note || "").trim().slice(0, 300) || `From a ${it.src === "text" ? "text" : "email"} ${it.fromMe ? "we sent" : "from the customer"}, ${when}`} [${it.key.slice(0, 2)}${it.path.split("/").pop()}]`;
  const { data, error } = await admin.from("job_files").insert({ [col]: r.id, customer_id: c.customer, kind: "photo", tag: "Sample", body, file_path: path, file_name: name, file_type: it.type, size: null, ...who }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
