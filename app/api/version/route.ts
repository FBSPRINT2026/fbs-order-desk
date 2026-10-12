import { NextResponse } from "next/server";

/** which build is live (the phone compares it with the one it's running, and reloads when there's a newer one) */
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ v: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "" }, { headers: { "Cache-Control": "no-store" } });
}
