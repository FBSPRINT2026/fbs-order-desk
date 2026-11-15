import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";
import DropboxSettings from "@/components/DropboxSettings";
import BackupDrive from "@/components/BackupDrive";
import RestorePoint from "@/components/RestorePoint";
export default function Page() {
  return <><SettingsHead title="Connections" note="QuickBooks, Canva, Dropbox, texts, and whether each outside service is working" /><SettingsTabs /><div className="stack"><DropboxSettings /><BackupDrive /><RestorePoint /></div></>;
}
