import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The bottom of the sewn front neckline on each garment photo, where every drop is measured from (Oct 20, Nick: "when
 * we say a drop, we mean it right from there … on every garment"; "can't you ask AI vision to find it, and then if it's
 * wrong, I fix it?"). The browser's pixel finder draws the lines it sees across the collar (A, B, C…) on the top of the
 * photo; the AI picks the one that is the seam. Saved per photo in garment_necks; a staff fix replaces it for good.
 *   GET  ?photo=a&photo=b              → { necks: { [photo]: { neck, source } } }
 *   POST { photo, lines: [{ label, y }], image, enhanced?, dry? } → AI pick → { neck, label, why } (saved unless dry)
 *   PUT  { photo, neck } or { items: [{ photo, neck }] } → staff fix / a page checked, saved
 *   GET  ?todo=1&limit=100              → catalog front photos not set yet (the Necklines page)
 */
const key = (p: unknown) => (typeof p === "string" ? p.trim().slice(0, 400) : "");

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  // the Necklines page: catalog front photos nobody has set yet (garments, not bags or hats), a page at a time
  if (sp.get("todo")) {
    if (!v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
    const admin = createAdminClient();
    const [{ data: gs }, { data: done }] = await Promise.all([
      admin.from("garments").select("brand, style, description, color_images").not("color_images", "is", null),
      admin.from("garment_necks").select("photo"),
    ]);
    const have = new Set((done || []).map((r) => r.photo as string)), seen = new Set<string>();
    const all: { photo: string; brand: string; style: string; color: string }[] = [];
    for (const g of (gs || []).sort((a, b) => `${a.brand} ${a.style}`.localeCompare(`${b.brand} ${b.style}`))) {
      if (/(tote|bag|cap|hat|beanie|apron|towel|blanket|sock)/i.test(String(g.description || ""))) continue;
      for (const [color, ci] of Object.entries((g.color_images || {}) as Record<string, { front?: string }>)) {
        const photo = key(ci?.front);
        if (!photo || seen.has(photo)) continue;
        seen.add(photo);
        if (!have.has(photo)) all.push({ photo, brand: String(g.brand || ""), style: String(g.style || ""), color });
      }
    }
    const n = Math.max(1, Math.min(150, Number(sp.get("limit")) || 100));
    return NextResponse.json({ items: all.slice(0, n), left: all.length, done: have.size });
  }
  const photos = sp.getAll("photo").map(key).filter(Boolean).slice(0, 200);
  if (!photos.length) return NextResponse.json({ necks: {} });
  const { data } = await createAdminClient().from("garment_necks").select("photo, neck, source").in("photo", photos);
  const necks: Record<string, { neck: number; source: string }> = {};
  for (const r of data || []) necks[r.photo as string] = { neck: r.neck as number, source: r.source as string };
  return NextResponse.json({ necks });
}

export async function PUT(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { photo?: string; neck?: number; items?: { photo?: string; neck?: number }[] };
  // one photo, or a whole page at once (the Necklines page's "Done": the ones not clicked were right)
  const rows = (Array.isArray(b.items) ? b.items : [b]).slice(0, 200).map((x) => ({ photo: key(x.photo), neck: Math.round(Number(x.neck)) }));
  if (!rows.length || rows.some((x) => !x.photo || !(x.neck > 0 && x.neck < 1250))) return NextResponse.json({ error: "Which photo, and where?" }, { status: 400 });
  const at = new Date().toISOString();
  const { error } = await createAdminClient().from("garment_necks").upsert(rows.map((x) => ({ ...x, source: "staff", set_by: v.email || "staff", updated_at: at })));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, saved: rows.length, neck: rows[0].neck });
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { photo?: string; lines?: { label: string; y: number }[]; image?: string; enhanced?: string; dry?: boolean };
  const photo = key(b.photo);
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l) => typeof l?.label === "string" && Number.isFinite(l?.y)).slice(0, 12);
  const img = (s?: string) => (typeof s === "string" ? s.replace(/^data:image\/\w+;base64,/, "") : "");
  const image = img(b.image), enhanced = img(b.enhanced);
  if (!photo || !lines.length || !image || image.length > 3_000_000) return NextResponse.json({ error: "Send the photo, its lines and the picture." }, { status: 400 });
  const admin = createAdminClient();
  if (!b.dry) {
    // a staff fix is never overwritten by the AI
    const { data: had } = await admin.from("garment_necks").select("neck, source").eq("photo", photo).maybeSingle();
    if (had?.source === "staff") return NextResponse.json({ neck: had.neck, source: "staff" });
  }
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason, off: true }, { status: 503 });
  const r = await askClaude<{ line: string; why?: string }>({
    task: "garment_neck", model: st.settings.assistant.ai.model, maxTokens: 300, timeoutMs: 40_000, admin, ctx: { by: v.email || "staff" },
    images: [{ media_type: "image/jpeg", data: image, label: "The top of the garment photo, with the lines drawn across:" },
      ...(enhanced ? [{ media_type: "image/jpeg" as const, data: enhanced, label: "The same, brightened so a dark collar shows:" }] : [])],
    system: `You help a screen print shop place prints on blank garment photos (flat product photos from S&S Activewear and SanMar, the front of the garment). Every print's drop is measured from the bottom of the sewn front neckline at the center front.
Short colored tick marks at the left and right edges, each with a letter, mark candidate heights; the middle of the photo is left clear so you can see the seams. Imagine a straight line across between the two ticks with the same letter.
Pick the height of the LOWEST edge of the neckline construction at the center front. Below the collar band (the ribbed neck band, or a contrast ringer collar) there is a seam, usually with a row of stitching (sometimes two rows, a cover stitch, or a raised seam ridge with a shadow under it). The answer is just below all of that, where completely plain, flat body fabric begins. When in doubt between two neighboring lines around the seam, choose the lower one: the shop measures from the lowest stitching of the neckline. On a hoodie it is the bottom of the hood at the center front, where the hood meets the body. On a V-neck it is the bottom point of the V.
Never choose a line in the neck opening (the inside back of the neck, the label seen through it) or a line far down in the plain body (creases, heather texture). If no line is within a few pixels of that height, answer "none".`,
    prompt: `Lines (top to bottom): ${lines.map((l) => l.label).join(", ")}. Which one is the bottom of the sewn front neckline?`,
    tool: { name: "neckline", description: "The line at the bottom of the sewn front neckline.", input_schema: { type: "object", properties: { line: { type: "string", description: "the letter, or \"none\"" }, why: { type: "string", description: "a few words: what you see at that line" } }, required: ["line"] } },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  const pick = lines.find((l) => l.label.toUpperCase() === String(r.data.line || "").trim().toUpperCase());
  if (!pick) return NextResponse.json({ neck: null, label: "none", why: r.data.why || "" });
  const neck = Math.round(pick.y);
  if (!b.dry) await admin.from("garment_necks").upsert({ photo, neck, source: "ai", note: (r.data.why || "").slice(0, 300), set_by: v.email || "staff", updated_at: new Date().toISOString() });
  return NextResponse.json({ neck, label: pick.label, why: r.data.why || "" });
}
