import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { jobsNamed, pastJobs } from "@/lib/ai/emailOrder";
import { looksLikeSignature, type PastJob } from "@/lib/emailOrderShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Which past job is the one in their picture (Oct 23, Nick, Peticolas "VH shirt reorder": "customer gave me an actual
 * picture of the mock-up that we sent him, and it's in Printavo. That visual should be matched… you should be able to say,
 * oh, this is the last one that used this artwork… or if the customer gives a link to a previous order").
 * POST { activity } → { ref, label, why, sure } or { none: true }. The pictures in the email (not signatures) are put
 * next to the mockups of the customer's likeliest past jobs (named in the email first, then the newest), and the AI says
 * which one is the same design and shirt. A link to one of our orders in the email is that job outright.
 * Kept on the email (meta.look) so it's asked once.
 */
type Look = { ref: string; label: string; why: string; sure: "high" | "medium" | "low" } | { none: true; why?: string };
export async function POST(req: Request) {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { activity, again } = await req.json().catch(() => ({})) as { activity?: string; again?: boolean };
  if (!activity || !/^[0-9a-f-]{36}$/i.test(activity)) return NextResponse.json({ error: "Which email?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: a } = await admin.from("activities").select("id, customer_id, subject, body, meta").eq("id", activity).maybeSingle();
  if (!a) return NextResponse.json({ error: "Email not found." }, { status: 404 });
  const meta = (a.meta || {}) as { attachments?: { name: string; path: string; type: string; size: number }[]; look?: Look };
  if (meta.look && !again) return NextResponse.json(meta.look);
  const save = async (look: Look) => { await admin.from("activities").update({ meta: { ...meta, look } }).eq("id", a.id); return NextResponse.json(look); };
  const said = `${a.subject || ""} ${String(a.body || "").slice(0, 4000)}`;
  const recent = await pastJobs(admin, (a.customer_id as string) || null).catch(() => [] as PastJob[]);
  const named = await jobsNamed(admin, said, (a.customer_id as string) || null, recent).catch(() => [] as PastJob[]);
  // a link to one of our orders: that job
  const link = said.match(/\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
  if (link) {
    const { data: o } = await admin.from("orders").select("id, number, nickname").eq("id", link).maybeSingle();
    if (o) return save({ ref: `o:${o.id}`, label: `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}`, why: "The email links to this order.", sure: "high" });
  }
  const pics = (meta.attachments || []).filter((f) => /^image\/(png|jpe?g|webp|gif)$/i.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name)).filter((f) => !looksLikeSignature(f) && f.size > 25 * 1024).slice(0, 3);
  if (!pics.length) return save({ none: true, why: "No picture in the email." });
  // the candidates: jobs the email names, then ones whose name shares a word with it, then the newest
  const words = new Set(said.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const share = (j: PastJob) => j.label.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && words.has(w)).length;
  const all = [...named, ...recent].filter((j, i, l) => l.findIndex((x) => x.ref === j.ref) === i);
  const cands = [...all].sort((x, y) => Number(named.includes(y)) - Number(named.includes(x)) || share(y) - share(x) || y.date.localeCompare(x.date)).slice(0, 10);
  // each candidate's mockup: a Printavo job's picture (asked bigger from Printavo's image service), else ours
  const aIds = cands.filter((j) => j.ref.startsWith("a:")).map((j) => j.ref.slice(2)), oIds = cands.filter((j) => j.ref.startsWith("o:")).map((j) => j.ref.slice(2));
  const [{ data: as }, { data: os }] = await Promise.all([
    aIds.length ? admin.from("archived_orders").select("id, files").in("id", aIds) : Promise.resolve({ data: [] }),
    oIds.length ? admin.from("orders").select("id, groups").in("id", oIds) : Promise.resolve({ data: [] }),
  ]);
  const load = async (path: string) => { const { data } = await admin.storage.from("proofs").download(path); return data ? Buffer.from(await data.arrayBuffer()) : null; };
  const big = async (src: string) => {
    const m = src.match(/^(https:\/\/cdn\.filepicker\.io\/[^/]+\/output=format:png)\/resize=width:\d+,height:\d+\/(https:\/\/cdn\.filepicker\.io\/[A-Za-z0-9]+)$/);
    if (!m) return null;
    const r = await fetch(`${m[1]}/resize=width:600/${m[2]}`, { signal: AbortSignal.timeout(12_000) }).catch(() => null);
    return r?.ok ? Buffer.from(await r.arrayBuffer()) : null;
  };
  const looks: { j: PastJob; buf: Buffer; mt: "image/png" | "image/jpeg" }[] = [];
  for (const j of cands) {
    let buf: Buffer | null = null;
    if (j.ref.startsWith("a:")) {
      const files = ((as || []) as { id: string; files: Record<string, string> | null }[]).find((x) => x.id === j.ref.slice(2))?.files || {};
      const pic = Object.entries(files).find(([, p]) => /\.(png|jpe?g)$/i.test(p));
      if (pic) buf = (await big(pic[0]).catch(() => null)) || (await load(pic[1]).catch(() => null));
    } else {
      const g = ((os || []) as { id: string; groups: { mockupThumbs?: string[] }[] | null }[]).find((x) => x.id === j.ref.slice(2));
      const t = (g?.groups || []).flatMap((x) => x.mockupThumbs || []).find(Boolean);
      if (t) buf = await load(t).catch(() => null);
    }
    if (buf && buf.length > 500) looks.push({ j, buf, mt: buf[0] === 0x89 ? "image/png" : "image/jpeg" });
  }
  if (!looks.length) return save({ none: true, why: "None of their past jobs has a mockup to compare." });
  const theirs = (await Promise.all(pics.map(async (f) => ({ f, buf: await load(f.path).catch(() => null) })))).filter((x) => x.buf) as { f: { name: string; type: string }; buf: Buffer }[];
  if (!theirs.length) return save({ none: true, why: "Their picture couldn't be opened." });
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ none: true, why: "The AI is off." });
  const r = await askClaude<{ job: number | null; sure: "high" | "medium" | "low"; why: string }>({
    task: "reorder_look", model: st.settings.assistant.ai.model, maxTokens: 500, timeoutMs: 60_000, admin, ctx: { by: v.email || "staff", activity_id: a.id, customer_id: (a.customer_id as string) || null },
    images: [
      ...theirs.map((x, i) => ({ media_type: (/png/i.test(x.f.type) || /\.png$/i.test(x.f.name) ? "image/png" : "image/jpeg") as "image/png", data: x.buf.toString("base64"), label: `THEIRS ${i + 1}` })),
      ...looks.map((x, i) => ({ media_type: x.mt, data: x.buf.toString("base64"), label: `J${i + 1}` })),
    ],
    system: "You match a customer's picture to one of a screen print shop's past jobs. THEIRS pictures come from the customer's reorder email (often a screenshot of the mockup the shop sent them). J pictures are the mockups of their past jobs. Say which J job shows the same design (the same art, layout and print colors; the shirt color may differ when they reorder in other colors). Look closely at the art: versions of one design (a gradient, a different word, a different badge) are different jobs. If none is clearly the same, say null.",
    prompt: `The email: "${String(a.subject || "")}"\n${String(a.body || "").slice(0, 1500)}\n\nTheir past jobs:\n${looks.map((x, i) => `J${i + 1}: ${x.j.label.replace(/\s*\(Printavo\)$/, "")} (${x.j.date}, ${x.j.qty} pcs)`).join("\n")}`,
    tool: { name: "match", description: "Which past job is the same as their picture.", input_schema: { type: "object", properties: { job: { type: ["integer", "null"], description: "the J number, or null" }, sure: { type: "string", enum: ["high", "medium", "low"] }, why: { type: "string", description: "one short sentence: what matches (or why none does)" } }, required: ["job", "sure", "why"] } },
  });
  if (!r.ok) return NextResponse.json({ none: true, why: r.error });
  const hit = r.data.job ? looks[Math.floor(r.data.job) - 1] : undefined;
  if (!hit) return save({ none: true, why: String(r.data.why || "None of their past mockups is the same.").slice(0, 300) });
  return save({ ref: hit.j.ref, label: hit.j.label.replace(/\s*\(Printavo\)$/, ""), why: String(r.data.why || "").slice(0, 300), sure: r.data.sure === "high" || r.data.sure === "low" ? r.data.sure : "medium" });
}
