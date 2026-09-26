import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { ssConfigured, ssSearch } from "@/lib/ss";

export const dynamic = "force-dynamic";

// Signed-in staff and customers: list S&S styles matching a style number or name (no prices in the results).
export async function GET(req: Request) {
  const { user } = await getViewer();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (!ssConfigured()) return NextResponse.json({ error: "S&S isn't connected yet." }, { status: 503 });
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  try {
    return NextResponse.json({ results: await ssSearch(q) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
