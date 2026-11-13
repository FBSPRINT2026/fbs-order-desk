import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";

export default async function Home() {
  const { user, isStaff } = await getViewer();
  // a crew phone (signed in with their employee number) goes to its main menu, never the portal's sign-in (Nov 13)
  if (!user) redirect((await cookies()).get("fbs_emp")?.value ? "/crew" : "/login");
  redirect(isStaff ? "/shop" : "/portal");
}
