import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Serves S&S garment photos from our own site so the mockup builder can draw and save them.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p") || "";
  if (!/^Images\/[\w\/.\-]+\.(jpe?g|png|webp)$/i.test(p)) return NextResponse.json({ error: "Bad image path" }, { status: 400 });
  const r = await fetch(`https://cdn.ssactivewear.com/${p}`, { cache: "force-cache" });
  if (!r.ok) return NextResponse.json({ error: `S&S image ${r.status}` }, { status: 404 });
  return new NextResponse(await r.arrayBuffer(), {
    headers: { "Content-Type": r.headers.get("content-type") || "image/jpeg", "Cache-Control": "public, max-age=604800, immutable" },
  });
}
