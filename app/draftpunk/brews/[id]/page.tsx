import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import BrewLog from "@/components/draftpunk/BrewLog";

export const dynamic = "force-dynamic";

export default async function BrewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><BrewLog id={id} userId={userId} /></Shell>;
}
