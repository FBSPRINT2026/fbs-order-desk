import { NextResponse } from "next/server";
import { copyFiles } from "@/lib/printavoImport";
import { fail, staffOnly } from "../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Step 3: copy an archived order's artwork into our own storage. Works for about 40 seconds per call; call again until `left` is 0. */
export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const { id } = await req.json().catch(() => ({}));
  try { return NextResponse.json(await copyFiles(g.sb, String(id), Date.now() + 40000)); }
  catch (e) { return fail(e); }
}
