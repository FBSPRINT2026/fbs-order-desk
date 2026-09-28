import { NextResponse } from "next/server";
import { checkQueries, remoteSize } from "@/lib/printavo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: checks the importer's Printavo queries against the live schema (reports only error messages, never shop data)
// and that a known file's size can be read without downloading it. Removed after use.
export async function GET() {
  const t = Date.now();
  const size = await remoteSize("https://cdn.filepicker.io/api/file/clQogOVQVSbQbbaFwFlR?cache=true+.pdf");
  return NextResponse.json({ size, ms: Date.now() - t, queries: await checkQueries() });
}
