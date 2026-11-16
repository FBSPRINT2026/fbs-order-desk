import { SettingsFrame } from "@/components/SettingsTabs";

/** every Settings page sits beside the one list of settings (Nov 16, Nick, option B) */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
