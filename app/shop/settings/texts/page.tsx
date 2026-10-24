import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";
import TextsSetup from "@/components/TextsSetup";
import { SITE_URL } from "@/lib/config";
export default function Page() {
  return <><SettingsHead title="Connections" note="QuickBooks, Canva, Dropbox, texts, Printavo, and whether each outside service is working" /><SettingsTabs /><div className="stack"><TextsSetup site={SITE_URL} /></div></>;
}
