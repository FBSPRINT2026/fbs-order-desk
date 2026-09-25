import Link from "next/link";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { email } = await getViewer();
  const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeSettings(data?.data);
  return (
    <div className="portal">
      <header className="p-top">
        <div className="p-top-in">
          <Link href="/portal" className="shop" style={{ display: "flex", alignItems: "center" }}>
            {s.shop.logoUrl ? <img className="logo" src={s.shop.logoUrl} alt={s.shop.name} /> : s.shop.name}
          </Link>
          <div className="who">
            {email && <span>{email}</span>}
            {email && <form action="/auth/signout" method="post"><button className="btn sm" type="submit">Sign out</button></form>}
          </div>
        </div>
      </header>
      {children}
      <footer className="p-main" style={{ paddingBlock: "0 40px", fontSize: 12, color: "var(--ink-3)" }}>
        {[s.shop.name, s.shop.phone, s.shop.email].filter(Boolean).join(" · ")}
      </footer>
    </div>
  );
}
