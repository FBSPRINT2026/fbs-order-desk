import { redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { myAccountIds } from "@/app/portal/account-actions";
import AccountChooser from "@/components/AccountChooser";

export const dynamic = "force-dynamic";

/** Which account to open, for a sign-in on more than one (Nov 3, Nick) */
export default async function ChooseAccount() {
  const { user, isStaff } = await getViewer();
  if (!user) redirect("/login?next=/portal/choose");
  if (isStaff) redirect("/shop");
  const ids = await myAccountIds();
  if (ids.length <= 1) redirect("/portal");
  const { data } = await createAdminClient().from("customers").select("id, company, name, price_type").in("id", ids).order("company");
  const list = (data || []).map((c) => ({ id: c.id as string, name: String(c.company || c.name || "Your account"), sub: c.price_type === "wholesale" ? "Wholesale account" : "Account" }));
  return (
    <main className="p-main">
      <div className="pac">
        <h1 className="pac-h">Which account would you like to open?</h1>
        <p className="pac-sub">Your email is on {list.length} accounts with us. Pick one; you can switch any time from the top of the page.</p>
        <AccountChooser accounts={list} />
      </div>
    </main>
  );
}
