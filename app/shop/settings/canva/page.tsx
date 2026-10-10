import { getViewer } from "@/lib/supabase/server";
import SettingsTabs from "@/components/SettingsTabs";
import CanvaSettings from "@/components/CanvaSettings";

export const dynamic = "force-dynamic";

/** Settings → Canva: connect the shop's Canva account (owner only). */
export default async function CanvaPage() {
  const v = await getViewer();
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Settings</div><h1>Canva</h1></div></div>
      <SettingsTabs />
      {v.role !== "owner" ? <div className="empty">Only the owner can open the Canva settings.</div> : <CanvaSettings />}
    </>
  );
}
