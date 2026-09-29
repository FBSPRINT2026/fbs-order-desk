import Link from "next/link";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import MobileTables from "@/components/MobileTables";
import Translate from "@/components/Translate";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { email } = await getViewer();
  const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeSettings(data?.data);
  return (
    <div className="portal">
      <header className="p-top">
        <div className="p-top-in">
          <Link href="/portal" className="shop p-brand">
            {s.brand.sideLogoUrl ? <img className="logo" src={s.brand.sideLogoUrl} alt={s.shop.name} /> : s.shop.logoUrl ? <img className="logo" src={s.shop.logoUrl} alt={s.shop.name} /> : s.shop.name}
            <span className="p-brand-t">Customer Portal</span>
          </Link>
          <div className="who">
            <Translate />
            {email && <span>{email}</span>}
            {email && <form action="/auth/signout" method="post"><button className="btn sm" type="submit">Sign out</button></form>}
          </div>
        </div>
      </header>
      {children}
      <MobileTables />
      <footer className="p-foot">
        <div className="p-foot-in">
          {s.brand.sideLogoUrl && <img src={s.brand.sideLogoUrl} alt="" className="p-foot-logo" />}
          <span>{[s.shop.name, s.shop.phone, s.shop.email].filter(Boolean).join(" · ")}</span>
        </div>
      </footer>
    </div>
  );
}
