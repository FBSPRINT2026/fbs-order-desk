import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import Inventory from "@/components/draftpunk/Inventory";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><Inventory userId={userId} /></Shell>;
}
