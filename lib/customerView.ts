import "server-only";
import { headers } from "next/headers";
import { getViewer } from "@/lib/supabase/server";

/**
 * Was this opening of a customer's link really the customer? (Nov 10, Nick on #50013: "I'm the one that opened it… I
 * just viewed it from my sent, so they haven't seen it… is there a way to actually know who's seen it"). Not when it's
 * the shop: anyone signed in as staff in this browser (opening it from Sent, testing the link). Not when it's a mail
 * system checking the link before it reaches the inbox (Outlook's Safe Links, Proofpoint, Mimecast, Barracuda, Google's
 * and Apple's link and image fetchers) or a page preview (Slack, iMessage): those open it within seconds of sending.
 * Every "opened" count on proofs and sew-outs goes through this.
 */
const LINK_CHECKERS = /bot\b|crawler|spider|preview|safelinks|proofpoint|mimecast|barracuda|forcepoint|symantec|trendmicro|sophos|fireeye|cisco|ironport|googleimageproxy|feedfetcher|facebookexternalhit|slack|whatsapp|telegram|discord|skype|teams|linkedin|python-requests|curl\/|wget|headless|lighthouse|monitor/i;

export async function customerView(): Promise<boolean> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") || "";
    if (!ua || LINK_CHECKERS.test(ua)) return false;
    if (/prefetch|prerender/i.test(`${h.get("purpose") || ""} ${h.get("sec-purpose") || ""} ${h.get("x-moz") || ""}`)) return false;
    const v = await getViewer();
    return !v.isStaff;
  } catch { return true; }
}
