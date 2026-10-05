import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { mergeSettings } from "@/lib/pricing";
import { accessOf, permsFor, ROLES } from "@/lib/roles";
import ShopNav from "@/components/ShopNav";
import MobileTables from "@/components/MobileTables";
import Translate from "@/components/Translate";
import { RoleProvider } from "@/components/RoleContext";
import CrewGuard from "@/components/CrewGuard";

export const dynamic = "force-dynamic";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const { user, isStaff, email, supabase, role: realRole } = await getViewer();
  if (!user) redirect("/login?next=/shop");
  if (!isStaff) redirect("/portal");
  const [{ data: me }, { data: st }, { data: team }] = await Promise.all([
    supabase.from("staff").select("name, shortcuts").eq("email", email).maybeSingle(),
    supabase.from("settings").select("data").eq("id", 1).maybeSingle(),
    realRole === "owner" ? supabase.from("staff").select("email, name, role").order("name") : Promise.resolve({ data: [] as { email: string; name: string; role: string }[] }),
  ]);
  // "View as" (owner only): a staff member (their name and role) or just a role
  let role = realRole, viewAs = "", viewName = "";
  const want = realRole === "owner" ? ((await cookies()).get("fbs_view_as")?.value || "") : "";
  if (want) {
    const p = (team || []).find((t) => (t.email as string).toLowerCase() === want);
    const r = ROLES.find((x) => x.v === want);
    if (p) { role = (p.role as string) || "admin"; viewAs = want; viewName = (p.name as string) || want; }
    else if (r) { role = r.v; viewAs = want; viewName = r.label; }
  }
  // the greeting uses the first name (staff name, else the sign-in name, else the email)
  const meta = (user.user_metadata || {}) as { full_name?: string; name?: string };
  const full = (viewAs && viewAs.includes("@") ? viewName : (me?.name || meta.full_name || meta.name || email.split("@")[0] || "")).trim();
  const first = full.split(/[\s._-]+/)[0] || "";
  const firstName = first ? first[0].toUpperCase() + first.slice(1) : "";
  // permissions: the role's defaults with the person's own changes (Settings → User Access)
  const access = accessOf(st?.data);
  const perms = permsFor(role, viewAs ? (viewAs.includes("@") ? access[viewAs] : null) : access[email]);
  const people = (team || []).map((t) => ({ email: (t.email as string).toLowerCase(), name: (t.name as string) || "", role: (t.role as string) || "" }));
  return (
    <RoleProvider value={{ role, realRole, viewAs, viewName, perms }}>
      <div className="app">
        <ShopNav email={email} firstName={firstName} brand={mergeSettings(st?.data).brand} shortcuts={(me?.shortcuts || []) as { label: string; href: string }[]} people={people} />
        <main className="main"><div className="top-r"><Translate /></div><CrewGuard />{children}</main>
        <MobileTables />
      </div>
    </RoleProvider>
  );
}
