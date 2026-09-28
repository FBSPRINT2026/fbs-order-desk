import { NextResponse } from "next/server";
import { checkQueries } from "@/lib/printavo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: checks the importer's Printavo queries against the live schema (reports only error messages, never shop data). Removed after use.
export async function GET() {
  return NextResponse.json(await checkQueries());
}
