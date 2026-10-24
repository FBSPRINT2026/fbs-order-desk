import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";
import DropboxSettings from "@/components/DropboxSettings";
export default function Page() {
  return <><SettingsHead title="Connections" note="QuickBooks, Canva, Dropbox, texts, Printavo, and whether each outside service is working" /><SettingsTabs /><div className="stack"><DropboxSettings /></div></>;
}
