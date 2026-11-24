import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import Tools from "@/components/draftpunk/Tools";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { brewer } = await requireBrewer();
  return <Shell name={brewer.name}><Tools /></Shell>;
}
