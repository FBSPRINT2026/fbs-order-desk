"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Icon from "./icons";

/**
 * DraftPunk's frame, laid out like BeerSmith: the "folders" down the left (a bottom tab bar on a phone), the work on the
 * right. Ctrl/Cmd+S (or F2) saves whatever screen is open; the screen listens for "dp-save".
 */
const NAV = [
  { href: "/draftpunk", label: "Recipes", icon: "recipes" },
  { href: "/draftpunk/brews", label: "Brew log", icon: "brews" },
  { href: "/draftpunk/equipment", label: "Equipment", icon: "equip" },
  { href: "/draftpunk/inventory", label: "Ingredients", icon: "stock" },
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
  const signOut = async () => { await createClient().auth.signOut(); router.push("/draftpunk"); router.refresh(); };
  const on = (href: string) => (href === "/draftpunk" ? path === "/draftpunk" || path.startsWith("/draftpunk/r/") || path.startsWith("/draftpunk/import") : path.startsWith(href));
  return (
    <div className="dp-shell">
      <nav className="dp-side dp-noprint" aria-label="DraftPunk">
        <Link href="/draftpunk" className="dp-brand"><span className="dp-mark" aria-hidden="true" />DraftPunk</Link>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`dp-nav ${on(n.href) ? "on" : ""}`}><Icon name={n.icon} />{n.label}</Link>
        ))}
        <div className="dp-me">
          <b>{name}</b>
          <button type="button" className="dp-linkbtn" onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <main className="dp-main">{children}</main>
      <nav className="dp-bottom dp-noprint" aria-label="DraftPunk">
        {NAV.slice(0, 5).map((n) => (
          <Link key={n.href} href={n.href} className={on(n.href) ? "on" : ""}><Icon name={n.icon} />{n.label === "Ingredients" ? "Stock" : n.label}</Link>
        ))}
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
