import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { ssConfigured, ssSearch } from "@/lib/ss";

export const dynamic = "force-dynamic";

// Staff only: list S&S styles matching a style number or name, so the right brand can be picked.
export async function GET(req: Request) {
  const { isStaff } = await getViewer();
  if (!isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!ssConfigured()) return NextResponse.json({ error: "S&S isn't connected yet." }, { status: 503 });
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  try {
    return NextResponse.json({ results: await ssSearch(q) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
