"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Icon from "./icons";
import Emblem from "./Emblem";

/**
 * DraftPunk's frame, laid out like BeerSmith: the "folders" down the left (a bottom tab bar on a phone), the work on the
 * right. Ctrl/Cmd+S (or F2) saves whatever screen is open; the screen listens for "dp-save".
 */
const NAV = [
  { href: "/draftpunk", label: "Recipes", icon: "recipes" },
  { href: "/draftpunk/assistant", label: "Assistant", icon: "spark" },
  { href: "/draftpunk/best", label: "Best ever", icon: "star" },
  { href: "/draftpunk/brewery", label: "Brewery", icon: "brewery" },
  { href: "/draftpunk/brews", label: "Brew log", icon: "brews" },
  { href: "/draftpunk/equipment", label: "Equipment", icon: "equip" },
  { href: "/draftpunk/inventory", label: "Ingredients", icon: "stock" },
  { href: "/draftpunk/competitions", label: "Competitions", icon: "medal" },
  { href: "/draftpunk/tools", label: "Tools", icon: "tools" },
  { href: "/draftpunk/club", label: "Club", icon: "club" },
];

export default function Shell({ name, children }: { name: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.key === "s" && (e.metaKey || e.ctrlKey)) || e.key === "F2") { e.preventDefault(); window.dispatchEvent(new Event("dp-save")); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  // the look: Brew Lab unless this brewer picked another on this device
  const [theme, setTheme] = useState("lab");
  useEffect(() => { try { const t = localStorage.getItem("dp:theme"); if (t) setTheme(t); } catch { /* default */ } }, []);
  useEffect(() => { const el = document.querySelector<HTMLElement>(".dp-app"); if (el) el.dataset.theme = theme; try { localStorage.setItem("dp:theme", theme); } catch { /* fine */ } }, [theme]);
  // the club's top award (its picture as the club was given it, from the trophy case) under the name on every page
  const [award, setAward] = useState<{ title: string; year: number | null; image: string } | null>(null);
  useEffect(() => {
    try { const c = sessionStorage.getItem("dp:award"); if (c && c !== "null") { setAward(JSON.parse(c)); return; } } catch { /* fine */ }
    createClient().from("dp_awards").select("title, year, image, place").neq("image", "").order("year").then(({ data }) => {
      const a = (data || []).sort((x, y) => Number(y.place === "ninkasi") - Number(x.place === "ninkasi"))[0];
      const v = a ? { title: a.title as string, year: a.year as number | null, image: a.image as string } : null;
      setAward(v); try { sessionStorage.setItem("dp:award", JSON.stringify(v)); } catch { /* fine */ }
    });
  }, []);
  const signOut = async () => { await createClient().auth.signOut(); router.push("/draftpunk"); router.refresh(); };
  const on = (href: string) => (href === "/draftpunk" ? path === "/draftpunk" || path.startsWith("/draftpunk/r/") || path.startsWith("/draftpunk/import") : path.startsWith(href));
  return (
    <div className="dp-shell">
      <nav className="dp-side dp-noprint" aria-label="DraftPunk">
        <Link href="/draftpunk" className="dp-brand">{award ? <span className="dp-brand-award" role="img" aria-label={`${award.year ? `${award.year} ` : ""}${award.title} winners`} title={`${award.year ? `${award.year} ` : ""}${award.title} winners`} style={{ WebkitMaskImage: `url(${award.image})`, maskImage: `url(${award.image})` }} /> : <Emblem size={34} />}<span>Draft Punk<small>Homebrew Club</small></span></Link>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`dp-nav ${on(n.href) ? "on" : ""}`}><Icon name={n.icon} />{n.label}</Link>
        ))}
        <div className="dp-me">
          <b>{name}</b>
          <label className="dp-dim" style={{ fontSize: 12, display: "grid", gap: 4 }}>Look
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="lab">Brew Lab</option><option value="taproom">Taproom</option><option value="hop">Hop Yard</option>
            </select>
          </label>
          <button type="button" className="dp-linkbtn" onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <main className="dp-main">{children}</main>
      <nav className="dp-bottom dp-noprint" aria-label="DraftPunk">
        {/* a phone's bottom bar: the four used most, and More for the rest */}
        {NAV.filter((n) => ["Recipes", "Brewery", "Brew log", "Tools"].includes(n.label)).map((n) => (
          <Link key={n.href} href={n.href} className={on(n.href) ? "on" : ""}><Icon name={n.icon} />{n.label === "Ingredients" ? "Stock" : n.label}</Link>
        ))}
        <Link href="/draftpunk/more" className={path.startsWith("/draftpunk/more") || ["/draftpunk/equipment", "/draftpunk/competitions", "/draftpunk/club", "/draftpunk/inventory", "/draftpunk/assistant", "/draftpunk/best"].some((h) => path.startsWith(h)) ? "on" : ""}><Icon name="more" />More</Link>
      </nav>
    </div>
  );
}

/** a short "Saved" note in the corner */
export function useToast() {
  const [msg, setMsg] = useState("");
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 2400); return () => clearTimeout(t); }, [msg]);
  return { toast: setMsg, node: msg ? <div className="dp-toast" role="status">{msg}</div> : null };
}
