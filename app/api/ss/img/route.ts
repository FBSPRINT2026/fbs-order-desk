import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Serves S&S and SanMar garment photos from our own site so the mockup builder can draw and save them.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const p = sp.get("p") || "", u = sp.get("u") || "", st = sp.get("s") || "";
  // a back photo staff uploaded for a garment color with none (Oct 26): only that folder
  if (st) {
    if (!/^garment-backs\/[\w\/.\-]+\.(jpe?g|png|webp)$/i.test(st) || st.includes("..")) return NextResponse.json({ error: "Bad image path" }, { status: 400 });
    const { data, error } = await createAdminClient().storage.from("proofs").download(st);
    if (error || !data) return NextResponse.json({ error: "Image not found" }, { status: 404 });
    return new NextResponse(await data.arrayBuffer(), { headers: { "Content-Type": data.type || "image/jpeg", "Cache-Control": "public, max-age=604800, immutable" } });
  }
  let src = "";
  if (u) {
    // SanMar photos: full URL on a sanmar.com host
    if (!/^https:\/\/([\w-]+\.)*sanmar\.com\/[\w\/.\-%~]+\.(jpe?g|png|webp)(\?[\w=&.\-]*)?$/i.test(u)) return NextResponse.json({ error: "Bad image address" }, { status: 400 });
    src = u;
  } else {
    if (!/^Images\/[\w\/.\-]+\.(jpe?g|png|webp)$/i.test(p)) return NextResponse.json({ error: "Bad image path" }, { status: 400 });
    src = `https://cdn.ssactivewear.com/${p}`;
  }
  const r = await fetch(src, { cache: "force-cache" });
  const type = r.headers.get("content-type") || "image/jpeg";
  if (!r.ok || !type.startsWith("image/")) return NextResponse.json({ error: `Image ${r.status}` }, { status: 404 });
  return new NextResponse(await r.arrayBuffer(), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800, immutable" },
  });
}
