import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient, getViewer } from "@/lib/supabase/server";
import { mergeSettings } from "@/lib/pricing";
import { accessOf, permsFor, ROLES } from "@/lib/roles";
import ShopNav from "@/components/ShopNav";
import PullRefresh from "@/components/PullRefresh";
import Cheer from "@/components/Cheer";
import MobileTables from "@/components/MobileTables";
import Translate from "@/components/Translate";
import { RoleProvider } from "@/components/RoleContext";
import CrewGuard from "@/components/CrewGuard";
import { OrderCheckDock } from "@/components/tools/OrderReview";
import { CreateOrderDock } from "@/components/tools/CreateOrderDock";
import { OrderGoodsDock } from "@/components/tools/OrderGoodsTool";
import SameArtPrompt from "@/components/SameArtPrompt";
import ArtboardPrompt from "@/components/ArtboardPrompt";
import StockInkSeed from "@/components/StockInkSeed";

export const dynamic = "force-dynamic";
// the shop's server actions (the Order chat reading a big PDF and making many edits) get up to 5 minutes
export const maxDuration = 300;

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // the shop settings don't depend on who's signed in: ask for them while the sign-in is being checked
  // (this layout runs on every page load, so each round trip saved here is felt everywhere)
  const settingsQ = createClient().then((sb) => sb.from("settings").select("data").eq("id", 1).maybeSingle());
  settingsQ.catch(() => null); // a redirect below must not leave an unhandled rejection behind
  const { user, isStaff, email, supabase, role: realRole, staff: me } = await getViewer(", name, shortcuts, cheer, sanebox");
  if (!user) redirect("/login?next=/shop");
  if (!isStaff) redirect("/portal");
  const [{ data: st }, { data: team }, { data: stockInks }] = await Promise.all([
    settingsQ,
    realRole === "owner" ? supabase.from("staff").select("email, name, role").order("name") : Promise.resolve({ data: [] as { email: string; name: string; role: string }[] }),
    supabase.from("stock_inks").select("name, hex, line").eq("stocked", true).is("archived_at", null),
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
  const full = (viewAs && viewAs.includes("@") ? viewName : ((me?.name as string) || meta.full_name || meta.name || email.split("@")[0] || "")).trim();
  const first = full.split(/[\s._-]+/)[0] || "";
  const firstName = first ? first[0].toUpperCase() + first.slice(1) : "";
  // permissions: the role's defaults with the person's own changes (Settings → User Access)
  const access = accessOf(st?.data);
  const perms = permsFor(role, viewAs ? (viewAs.includes("@") ? access[viewAs] : null) : access[email]);
  // Translate to Spanish: for the crew, not Nick and Amanda (Oct 15, Nick); "View as" a crew member shows it
  const showSpanish = !["nicholas@fbsprint.com", "amanda@fbsprint.com"].includes((viewAs.includes("@") ? viewAs : email).toLowerCase());
  const people = (team || []).map((t) => ({ email: (t.email as string).toLowerCase(), name: (t.name as string) || "", role: (t.role as string) || "" }));
  return (
    <RoleProvider value={{ role, realRole, viewAs, viewName, perms, email, staffName: (me?.name as string) || "", sanebox: (me as { sanebox?: boolean } | null)?.sanebox !== false }}>
      <StockInkSeed rows={(stockInks || []) as { name: string; hex: string; line: string }[]} />
      <div className="app">
        <ShopNav email={email} firstName={firstName} fullName={full} brand={mergeSettings(st?.data).brand} shortcuts={(me?.shortcuts || []) as { label: string; href: string }[]} people={people} />
        <main className="main">{showSpanish && <div className="top-r"><Translate /></div>}<CrewGuard /><PullRefresh>{children}</PullRefresh></main>
        <Cheer on={!viewAs && !!me?.cheer} name={firstName} />
        <MobileTables />
        <OrderCheckDock />
        <CreateOrderDock />
        <OrderGoodsDock />
        <SameArtPrompt />
        <ArtboardPrompt />
      </div>
    </RoleProvider>
  );
}
