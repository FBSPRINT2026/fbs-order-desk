import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import Importer from "@/components/draftpunk/Importer";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><Importer userId={userId} admin={brewer.club_role === "admin"} /></Shell>;
}
