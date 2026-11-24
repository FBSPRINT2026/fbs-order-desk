import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import RecipeEditor from "@/components/draftpunk/RecipeEditor";

export const dynamic = "force-dynamic";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { brewer, userId } = await requireBrewer();
  return <Shell name={brewer.name}><RecipeEditor key={id} id={id} userId={userId} brewerName={brewer.name} /></Shell>;
}
