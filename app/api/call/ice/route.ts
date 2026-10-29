import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * How a support call's two computers find each other (components/ScreenShare.tsx). On the same network they link
 * directly; on different networks (the shop and the house, Oct 29: "I can't see it from the house") many routers won't
 * let a direct link through, so the picture goes through a relay (TURN). The relay is Cloudflare's: Nick makes a TURN key
 * in Cloudflare (Realtime → TURN) and adds CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN in Vercel. Each call gets
 * its own login for the relay, good for 12 hours. Without the key, calls still work on one network.
 */
const STUN = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];

export async function GET() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ iceServers: STUN, relay: false }, { status: 401 });
  const id = process.env.CLOUDFLARE_TURN_KEY_ID?.trim(), token = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!id || !token) return NextResponse.json({ iceServers: STUN, relay: false, why: "no relay key" });
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 12 * 3600 }), cache: "no-store",
    });
    if (!r.ok) return NextResponse.json({ iceServers: STUN, relay: false, why: `relay said ${r.status}` });
    const j = (await r.json()) as { iceServers?: RTCIceServer | RTCIceServer[] };
    const list = (Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [])
      // browsers block port 53, so those addresses only make the call wait
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    if (!list.some((s) => s.urls.some((u) => /^turns?:/.test(u)))) return NextResponse.json({ iceServers: STUN, relay: false, why: "no relay in the answer" });
    return NextResponse.json({ iceServers: [...list, STUN[1]], relay: true });
  } catch {
    return NextResponse.json({ iceServers: STUN, relay: false, why: "relay didn't answer" });
  }
}
