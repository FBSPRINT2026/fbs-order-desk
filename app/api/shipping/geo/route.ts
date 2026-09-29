import { NextResponse } from "next/server";
import { GEO_URL } from "@/lib/usmap";

/** US counties + states (public us-atlas map shapes), cached here so the transit map loads from our own site. */
export const revalidate = 2592000;

export async function GET() {
  const r = await fetch(GEO_URL, { next: { revalidate: 2592000 } }).catch(() => null);
  if (!r || !r.ok) return NextResponse.json({ error: "The map shapes aren't available right now." }, { status: 502 });
  return new NextResponse(await r.text(), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400, s-maxage=2592000" } });
}
