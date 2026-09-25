import { redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import ShopNav from "@/components/ShopNav";

export const dynamic = "force-dynamic";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const { user, isStaff, email } = await getViewer();
  if (!user) redirect("/login?next=/shop");
  if (!isStaff) redirect("/portal");
  return (
    <div className="app">
      <ShopNav email={email} />
      <main className="main">{children}</main>
    </div>
  );
}
