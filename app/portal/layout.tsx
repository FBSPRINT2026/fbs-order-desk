import Link from "next/link";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import MobileTables from "@/components/MobileTables";
import SupportButton from "@/components/SupportButton";
import SameArtPrompt from "@/components/SameArtPrompt";
import { fmtPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { email } = await getViewer();
  const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeSettings(data?.data);
  const addr = s.shop.address.replace(/\s*\n\s*/g, " · ").trim(), phone = fmtPhone(s.shop.phone);
  const year = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric" });
  return (
    <div className="portal">
      <SameArtPrompt />
      <header className="p-top">
        <div className="p-top-in">
          <Link href="/portal" className="shop p-brand">
            {s.brand.sideLogoUrl ? <img className="logo" src={s.brand.sideLogoUrl} alt={s.shop.name} /> : s.shop.logoUrl ? <img className="logo" src={s.shop.logoUrl} alt={s.shop.name} /> : s.shop.name}
            <span className="p-brand-t"><span className="p-brand-k" data-notranslate>{[..."Customer Portal"].map((ch, i) => <span key={i}>{ch === " " ? "\u00a0" : ch}</span>)}</span>
              {/* phones: "On the go" under it, like the shop's top bar (Oct 15, Nick) */}
              <span className="tag-go" aria-hidden><i className="go-lines"><b /><b /><b /></i><em>On the go</em></span>
            </span>
          </Link>
          <div className="who">
            {email && <span>{email}</span>}
            {/* Get help: a screenshot and what's wrong, to our Support page (Oct 24, Nick) */}
            {email && <SupportButton email={email} portal />}
            {email && <form action="/auth/signout" method="post"><button className="btn sm" type="submit">Sign out</button></form>}
          </div>
        </div>
      </header>
      {children}
      <MobileTables />
      {/* the footer (Oct 24, Nick): address and phone on one line, social links, and the copyright year (it turns over by
          itself on January 1, Central time) */}
      <footer className="p-foot">
        <div className="p-foot-in">
          {s.brand.sideLogoUrl && <img src={s.brand.sideLogoUrl} alt="" className="p-foot-logo" />}
          <div className="p-foot-addr">
            <b>{s.shop.name}</b>
            <span className="p-foot-ln">
              {addr && <a href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer">{addr}</a>}
              {addr && phone && <i aria-hidden>·</i>}
              {phone && <a href={`tel:${s.shop.phone.replace(/[^\d+]/g, "")}`}>{phone}</a>}
              {!addr && !phone && s.shop.email && <a href={`mailto:${s.shop.email}`}>{s.shop.email}</a>}
            </span>
          </div>
          <div className="p-foot-soc">
            {SOCIAL.map((x) => {
              const href = (s.shop[x.k] || "").trim();
              return href ? <a key={x.k} href={href} target="_blank" rel="noreferrer" aria-label={x.label} title={x.label}>{x.icon}</a> : <span key={x.k} aria-label={x.label} title={x.label}>{x.icon}</span>;
            })}
          </div>
        </div>
        <div className="p-foot-bot">© {year} {s.shop.name}. All rights reserved.</div>
      </footer>
    </div>
  );
}

const SOCIAL: { k: "facebook" | "instagram"; label: string; icon: React.ReactNode }[] = [
  { k: "facebook", label: "Facebook", icon: <svg viewBox="0 0 24 24" aria-hidden><path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21h2.9z" /></svg> },
  { k: "instagram", label: "Instagram", icon: <svg viewBox="0 0 24 24" aria-hidden><path d="M12 7.3a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0zM12 4.6c2.4 0 2.7 0 3.6.1 2.4.1 3.6 1.3 3.7 3.7.1.9.1 1.2.1 3.6s0 2.7-.1 3.6c-.1 2.4-1.3 3.6-3.7 3.7-.9.1-1.2.1-3.6.1s-2.7 0-3.6-.1c-2.4-.1-3.6-1.3-3.7-3.7-.1-.9-.1-1.2-.1-3.6s0-2.7.1-3.6C4.8 6 6 4.8 8.4 4.7c.9-.1 1.2-.1 3.6-.1zM12 3c-2.4 0-2.8 0-3.7.1C5 3.2 3.2 5 3.1 8.3 3 9.2 3 9.6 3 12s0 2.8.1 3.7c.1 3.3 1.9 5.1 5.2 5.2.9.1 1.3.1 3.7.1s2.8 0 3.7-.1c3.3-.1 5.1-1.9 5.2-5.2.1-.9.1-1.3.1-3.7s0-2.8-.1-3.7C20.8 5 19 3.2 15.7 3.1 14.8 3 14.4 3 12 3z" /></svg> },
];
