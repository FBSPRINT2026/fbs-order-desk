import "server-only";
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { PrintavoError } from "@/lib/printavo";

/** Only shop staff can import; returns their database client (row security applies). */
export async function staffOnly() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { error: NextResponse.json({ error: "Only shop staff can import from Printavo." }, { status: 403 }) } as const;
  return { sb: v.supabase, email: v.email } as const;
}
export const fail = (e: unknown) => NextResponse.json({ error: e instanceof PrintavoError || e instanceof Error ? e.message : String(e) }, { status: e instanceof PrintavoError ? 502 : 500 });
