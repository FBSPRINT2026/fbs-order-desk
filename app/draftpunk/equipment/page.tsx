import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import EquipmentEditor from "@/components/draftpunk/EquipmentEditor";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><EquipmentEditor userId={userId} /></Shell>;
}
