import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDay } from "@/lib/timeclock";

export const dynamic = "force-dynamic";

/**
 * A press's tap tag (Nick, Nov 16 2026: "I put one on the machine so that he should just be able to tap it"): the NFC
 * sticker on a press holds portal.fbsprint.com/crew/press/<press id>. Tapping it opens that press's job right now:
 * what's printing or paused on it, else the next one booked today, on the press timer; nothing today, the crew menu.
 * The sign-in, the timer and everything else are the job's usual phone menu.
 */
export default async function PressTap({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const today = localDay(new Date());
  const { data } = await admin.from("production_slots").select("order_id, status, day, position, start_min").eq("machine", String(id).slice(0, 40)).lte("day", today).neq("status", "done").not("order_id", "is", null).order("day", { ascending: false }).order("position").limit(40);
  const rows = (data || []) as { order_id: string; status: string; day: string; position: number; start_min: number | null }[];
  const rank = (s: string) => (s === "running" ? 0 : s === "paused" ? 1 : 2);
  const pick = rows.filter((r) => r.status !== "scheduled" || r.day === today).sort((a, b) => rank(a.status) - rank(b.status) || (a.start_min ?? 9999) - (b.start_min ?? 9999) || a.position - b.position)[0];
  if (pick) {
    const { data: o } = await admin.from("orders").select("number").eq("id", pick.order_id).maybeSingle();
    if (o?.number) redirect(`/j/${o.number}?v=timer`);
  }
  redirect("/crew");
}
