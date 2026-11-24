import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import Brewery from "@/components/draftpunk/Brewery";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><Brewery userId={userId} /></Shell>;
}
