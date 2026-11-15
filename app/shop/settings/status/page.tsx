import SettingsTabs, { ConnectionsPanel, SettingsHead } from "@/components/SettingsTabs";
export default function Page() {
  return <><SettingsHead title="Connections" note="QuickBooks, Canva, Dropbox, texts, and whether each outside service is working" /><SettingsTabs /><div className="stack"><ConnectionsPanel /></div></>;
}
