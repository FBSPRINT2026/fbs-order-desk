import { getViewer } from "@/lib/supabase/server";
import SettingsTabs from "@/components/SettingsTabs";
import QuickBooksSettings from "@/components/QuickBooksSettings";

export const dynamic = "force-dynamic";
// customer matching reads every QuickBooks customer and invoice: give the page's actions time
export const maxDuration = 300;

/** Settings → QuickBooks: connect, map, match customers, watch the queue (owner only). */
export default async function QuickBooksPage() {
  const v = await getViewer();
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Settings</div><h1>QuickBooks</h1></div></div>
      <SettingsTabs />
      {v.role !== "owner" ? <div className="empty">Only the owner can open the QuickBooks settings.</div> : <QuickBooksSettings />}
    </>
  );
}
