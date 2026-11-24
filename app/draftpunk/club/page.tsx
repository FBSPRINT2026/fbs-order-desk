import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import Club from "@/components/draftpunk/Club";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><Club userId={userId} isAdmin={brewer.club_role === "admin"} /></Shell>;
}
