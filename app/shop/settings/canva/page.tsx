import { getViewer } from "@/lib/supabase/server";
import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";
import CanvaSettings from "@/components/CanvaSettings";

export const dynamic = "force-dynamic";

/** Settings → Canva: connect the shop's Canva account (owner only). */
export default async function CanvaPage() {
  const v = await getViewer();
  return (
    <>
      <SettingsHead title="Connections" note="QuickBooks, Canva, Dropbox, texts, Printavo, and whether each outside service is working" />
      <SettingsTabs />
      {v.role !== "owner" ? <div className="empty">Only the owner can open the Canva settings.</div> : <CanvaSettings />}
    </>
  );
}
