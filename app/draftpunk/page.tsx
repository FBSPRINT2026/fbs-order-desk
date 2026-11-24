import { getBrewer } from "@/lib/draftpunk/server";
import Login from "@/components/draftpunk/Login";
import Shell from "@/components/draftpunk/Shell";
import RecipeList from "@/components/draftpunk/RecipeList";

export const dynamic = "force-dynamic";

/** the front door: the sign-in for people who aren't in yet, a brewer's recipes for those who are */
export default async function DraftPunk() {
  const { brewer, email, userId } = await getBrewer();
  if (!brewer) return <Login signedInAs={userId ? email : undefined} />;
  return <Shell name={brewer.name}><RecipeList userId={userId} /></Shell>;
}
