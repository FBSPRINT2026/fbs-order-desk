import { getViewer } from "@/lib/supabase/server";
import { viewerPerms } from "@/lib/access";
import AiWorkbench from "@/components/AiWorkbench";

export const metadata = { title: "AI Workbench · FBS" };
export const dynamic = "force-dynamic";

/** AI Workbench (Oct 13): a chat with the AI for anything — mockups from logos, orders from spreadsheets, lookups */
export default async function AiPage() {
  const v = await getViewer(", name");
  const perms = v.user && v.isStaff ? await viewerPerms(v.supabase, v.email, v.role) : null;
  if (!perms?.workbench) {
    return (
      <>
        <div className="page-head"><div><h1>AI Workbench</h1></div></div>
        <p>The AI Workbench isn&apos;t on for you. An owner can turn it on in Settings → User Access.</p>
      </>
    );
  }
  const first = String((v.staff?.name as string) || "").trim().split(/\s+/)[0] || "";
  return (
    <>
      <div className="page-head wb-head"><div><h1>AI Workbench</h1></div></div>
      <AiWorkbench name={first} />
    </>
  );
}
