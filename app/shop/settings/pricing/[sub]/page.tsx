import { notFound } from "next/navigation";
import SettingsMain from "@/components/SettingsMain";
export default async function Page({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  if (!["retail", "wholesale", "addons", "payments"].includes(sub)) notFound();
  return <SettingsMain part="pricing" sub={sub} />;
}
