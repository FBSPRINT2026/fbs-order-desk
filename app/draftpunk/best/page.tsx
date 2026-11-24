import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import BestEver from "@/components/draftpunk/BestEver";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><BestEver userId={userId} brewerName={brewer.name} /></Shell>;
}
