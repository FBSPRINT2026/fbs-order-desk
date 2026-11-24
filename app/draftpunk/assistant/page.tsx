import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import AssistantPage from "@/components/draftpunk/AssistantPage";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><AssistantPage userId={userId} brewerName={brewer.name} /></Shell>;
}
