import { redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { mergeSettings } from "@/lib/pricing";
import ShopNav from "@/components/ShopNav";
import MobileTables from "@/components/MobileTables";

export const dynamic = "force-dynamic";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const { user, isStaff, email, supabase } = await getViewer();
  if (!user) redirect("/login?next=/shop");
  if (!isStaff) redirect("/portal");
  // the greeting uses the first name (staff name, else the sign-in name, else the email)
  const [{ data: me }, { data: st }] = await Promise.all([
    supabase.from("staff").select("name, shortcuts").eq("email", email).maybeSingle(),
    supabase.from("settings").select("data").eq("id", 1).maybeSingle(),
  ]);
  const meta = (user.user_metadata || {}) as { full_name?: string; name?: string };
  const full = (me?.name || meta.full_name || meta.name || email.split("@")[0] || "").trim();
  const first = full.split(/[\s._-]+/)[0] || "";
  const firstName = first ? first[0].toUpperCase() + first.slice(1) : "";
  return (
    <div className="app">
      <ShopNav email={email} firstName={firstName} brand={mergeSettings(st?.data).brand} shortcuts={(me?.shortcuts || []) as { label: string; href: string }[]} />
      <main className="main">{children}</main>
      <MobileTables />
    </div>
  );
}
