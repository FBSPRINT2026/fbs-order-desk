import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appleDate, customerHandles, decodeAttributed, deviceFor, handleKey } from "@/lib/texts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type In = { rowid?: number; guid?: string; text?: string | null; hex?: string | null; from_me?: number; date?: number | string; service?: string; handle?: string; chat?: string; chat_name?: string; parts?: string | null; files?: string | { id: number; name: string; mime: string; size: number }[] | null };
type FileIn = { id: number; name: string; mime: string; size: number };
type Kept = { id: string; name: string; type: string; size: number; path: string };

/** pictures and PDFs worth keeping (not stickers, voice memos or videos) */
const wanted = (f: FileIn) => (/^image\//.test(f.mime) || /\.(heic|heif|jpe?g|png|gif|webp|tiff?|pdf|ai|eps|svg)$/i.test(f.name) || f.mime === "application/pdf") && !/pluginPayloadAttachment|\.caf$/i.test(f.name) && (f.size || 0) < 40e6;

/**
 * FBS Texts (the Mac) sends a batch of texts from customer conversations. Each is filed to the customer by the number
 * (or, in a group text, whoever in it is a customer); one with no customer is dropped. Answers with the pictures it
 * still needs (`?fmt=lines`: "guid<TAB>attachment id" per line) and remembers how far through Messages the Mac is.
 */
export async function POST(req: Request) {
  const admin = createAdminClient();
  const d = await deviceFor(admin, req);
  if (!d) return new Response("Not a known Mac (set it up again from Settings > Texts).", { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { rowid?: number; backfill?: boolean; handles_v?: string; messages?: In[]; error?: string };
  const now = new Date().toISOString();
  if (b.error) {
    await admin.from("text_devices").update({ last_seen_at: now, last_error: String(b.error).slice(0, 300) }).eq("id", d.id);
    return new Response("ok\n");
  }
  const who = await customerHandles(admin);
  const rows: Record<string, unknown>[] = [], files = new Map<string, FileIn[]>();
  for (const m of (b.messages || []).slice(0, 500)) {
    if (!m.guid) continue;
    const parts = String(m.parts || "").split(",").map((x) => x.trim()).filter(Boolean);
    const cust = who.get(handleKey(m.handle)) || parts.map((p) => who.get(handleKey(p))).find(Boolean);
    if (!cust) continue; // not a customer's: never kept
    let fs: FileIn[] = [];
    try { fs = (typeof m.files === "string" ? JSON.parse(m.files) : m.files || []) as FileIn[]; } catch { fs = []; }
    fs = (fs || []).filter((f) => f && f.id);
    const body = (m.text || decodeAttributed(m.hex) || "").replace(/￼/g, "").trim();
    if (!body && !fs.length) continue;
    const isGroup = parts.length > 1;
    rows.push({
      guid: m.guid, device_id: d.id, owner: d.owner, handle: m.handle || (isGroup ? m.chat || "" : parts[0] || ""), chat: m.chat || "", chat_name: m.chat_name || "",
      from_me: !!Number(m.from_me), body: body.slice(0, 20000), sent_at: appleDate(m.date), service: m.service || "", customer_id: cust,
    });
    const want = fs.filter(wanted);
    if (want.length) files.set(m.guid, want);
  }
  if (rows.length) {
    const { error } = await admin.from("text_messages").upsert(rows, { onConflict: "guid", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // file them to jobs where it's clear (the job's dates and name); overlaps wait for the AI when a job is opened
  if (rows.length) {
    const { fileCustomerTexts } = await import("@/lib/textJobs");
    for (const cid of new Set(rows.map((r) => String(r.customer_id)))) await fileCustomerTexts(admin, cid).catch(() => 0);
  }
  // the pictures not kept yet
  const lines: string[] = [];
  if (files.size) {
    const { data: have } = await admin.from("text_messages").select("guid, files").in("guid", [...files.keys()]);
    const got = new Map(((have || []) as { guid: string; files: Kept[] }[]).map((r) => [r.guid, new Set((r.files || []).map((f) => String(f.id)))]));
    for (const [g, fs] of files) for (const f of fs) if (got.has(g) && !got.get(g)!.has(String(f.id))) lines.push(`${g}\t${f.id}`);
  }
  await admin.from("text_devices").update({
    last_seen_at: now, last_error: null, ...(b.handles_v ? { handles_v: b.handles_v } : {}),
    ...(!b.backfill && Number(b.rowid) > d.last_rowid ? { last_rowid: Number(b.rowid) } : {}),
  }).eq("id", d.id);
  if (new URL(req.url).searchParams.get("fmt") === "lines") return new Response(lines.join("\n") + (lines.length ? "\n" : ""), { headers: { "Content-Type": "text/plain" } });
  return NextResponse.json({ saved: rows.length, want: lines.map((l) => { const [guid, id] = l.split("\t"); return { guid, id }; }) });
}
