import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Serves S&S and SanMar garment photos from our own site so the mockup builder can draw and save them.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const p = sp.get("p") || "", u = sp.get("u") || "";
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
