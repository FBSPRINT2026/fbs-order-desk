import { redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";

export default async function Home() {
  const { user, isStaff } = await getViewer();
  if (!user) redirect("/login");
  redirect(isStaff ? "/shop" : "/portal");
}
