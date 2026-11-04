import { redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";

/**
 * ClickUp Jobs is the owner's tool now, under Admin tools (Nov 3, Nick: "remove the ClickUp tool from everybody's view
 * except mine"). Anyone else who follows a link here goes to their dashboard. An order's own ClickUp job (shown on the
 * order page) still works for everyone.
 */
export default async function ClickUpLayout({ children }: { children: React.ReactNode }) {
  const v = await getViewer();
  if (!v.user || !v.isStaff || v.role !== "owner") redirect("/shop");
  return <>{children}</>;
}
