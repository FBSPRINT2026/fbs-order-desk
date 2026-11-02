import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { findWebBacks, pagePictures, publicUrl, webImage, type WebBack } from "@/lib/backFinder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const sq = (s: string) => (s || "").toLowerCase().replace(/grey/g, "gray").replace(/[^a-z0-9]+/g, "");
type Ci = { front?: string; back?: string; web_backs?: { at: string; found: WebBack[]; searched: string[] } } & Record<string, unknown>;

/** our front photo's bytes (the reference the web photos are matched to) */
async function ourFront(admin: ReturnType<typeof createAdminClient>, path: string) {
  if (!path) return null;
  if (path.startsWith("store:")) {
    const { data } = await admin.storage.from("proofs").download(path.slice(6));
    if (!data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return { buf, type: (data.type === "image/png" ? "image/png" : data.type === "image/webp" ? "image/webp" : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" };
  }
  return webImage(/^https:/i.test(path) ? path : `https://cdn.ssactivewear.com/${path}`);
}

/**
 * POST { garmentId, color, again? } (staff) → a color's flat back (and its front from the same site) found online
 * (lib/backFinder.ts). Kept on the color for 14 days so opening the mockup again doesn't search again; `again` searches anew.
 * GET ?img=<https url> (staff) → that picture through our site, so the Mockup Creator can show it and clean it up.
 */
export async function POST(req: Request) {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { garmentId, color, again, page, pictures } = await req.json().catch(() => ({})) as { garmentId?: string; color?: string; again?: boolean;
    /** a page staff found (Nov 1, Nick: "I could have copied and pasted this URL… oh, I see, I can go get these"): read it deeper */ page?: string;
    /** every picture on a page, this color's first, to click through ("it was sitting right there next to it") */ pictures?: string };
  if (pictures) {
    if (!publicUrl(pictures)) return NextResponse.json({ error: "That isn't a web page link." }, { status: 400 });
    const r = await pagePictures(pictures, String(color || ""));
    return NextResponse.json({ page: r.page, pics: r.pics.slice(0, 60), hits: r.hits });
  }
  if (page && !publicUrl(page)) return NextResponse.json({ error: "Paste the page's https link." }, { status: 400 });
  if (!garmentId || !color?.trim()) return NextResponse.json({ error: "Which garment and color?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: g } = await admin.from("garments").select("id, style, brand, description, color_images").eq("id", garmentId).maybeSingle();
  if (!g) return NextResponse.json({ error: "That garment isn't in the catalog." }, { status: 404 });
  const imgs = (g.color_images || {}) as Record<string, Ci>;
  const name = Object.keys(imgs).find((k) => sq(k) === sq(color)) || color.trim();
  const ci = imgs[name] || {};
  const kept = ci.web_backs;
  if (!again && !page && kept && Date.now() - new Date(kept.at).getTime() < 14 * 86400000) return NextResponse.json({ name, ...kept });
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 400 });
  const front = await ourFront(admin, String(ci.front || "")).catch(() => null);
  const r = await findWebBacks({ model: st.settings.assistant.ai.model || "claude-sonnet-5", admin, by: v.user.email || "staff" },
    { brand: String(g.brand || ""), style: String(g.style || ""), title: String(g.description || "").slice(0, 80), color: name, front }, page ? { pages: [page] } : {});
  const web_backs = { at: new Date().toISOString(), found: r.found, searched: r.searched, looked: r.looked || 0, picked: r.picked || 0 };
  // read again just before saving: another color may have been saved meanwhile
  const { data: g2 } = await admin.from("garments").select("color_images").eq("id", g.id).maybeSingle();
  const cur = (g2?.color_images || imgs) as Record<string, Ci>;
  if (cur[name]) await admin.from("garments").update({ color_images: { ...cur, [name]: { ...cur[name], web_backs } } }).eq("id", g.id);
  return NextResponse.json({ name, ...web_backs });
}

export async function GET(req: Request) {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const u = new URL(req.url).searchParams.get("img") || "";
  if (!publicUrl(u)) return NextResponse.json({ error: "Bad image address" }, { status: 400 });
  const im = await webImage(u, 10000);
  if (!im) return NextResponse.json({ error: "That picture didn't open." }, { status: 404 });
  return new NextResponse(new Uint8Array(im.buf), { headers: { "Content-Type": im.type, "Cache-Control": "private, max-age=86400" } });
}
