import { notFound } from "next/navigation";
import SettingsMain from "@/components/SettingsMain";
export default async function Page({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  if (!["staff", "owners"].includes(sub)) notFound();
  return <SettingsMain part="people" sub={sub} />;
}
