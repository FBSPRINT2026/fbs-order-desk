import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import RecipeEditor from "@/components/draftpunk/RecipeEditor";

export const dynamic = "force-dynamic";

/** a BeerSmith recipe as it was: read only, brewable, and brought into DraftPunk from its toolbar */
export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><RecipeEditor key={id} id={id} userId={userId} brewerName={brewer.name} archive /></Shell>;
}
