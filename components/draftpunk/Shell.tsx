"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** keyboard shortcuts: F1–F9 jump around, F2 saves whatever screen is open (it listens for "dp-save") */
const KEYS: { k: string; label: string; href?: string; event?: string }[] = [
  { k: "F1", label: "Recipes", href: "/draftpunk" },
  { k: "F2", label: "Save", event: "dp-save" },
  { k: "F3", label: "New", href: "/draftpunk/r/new" },
  { k: "F4", label: "Brews", href: "/draftpunk/brews" },
  { k: "F5", label: "Tools", href: "/draftpunk/tools" },
  { k: "F6", label: "Equip", href: "/draftpunk/equipment" },
  { k: "F7", label: "Stock", href: "/draftpunk/inventory" },
  { k: "F8", label: "Club", href: "/draftpunk/club" },
  { k: "F9", label: "Import", href: "/draftpunk/import" },
];
const MENU = [
  { href: "/draftpunk", label: "Recipes" },
  { href: "/draftpunk/brews", label: "Brew log" },
  { href: "/draftpunk/tools", label: "Tools" },
  { href: "/draftpunk/equipment", label: "Equipment" },
  { href: "/draftpunk/inventory", label: "Stock" },
  { href: "/draftpunk/club", label: "Club" },
];

export default function Shell({ name, children }: { name: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const press = (key: (typeof KEYS)[number]) => {
    if (key.event) window.dispatchEvent(new Event(key.event));
    else if (key.href) router.push(key.href);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const key = KEYS.find((k) => k.k === e.key);
      if (!key) return;
      e.preventDefault();
      press(key);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const signOut = async () => { await createClient().auth.signOut(); router.push("/draftpunk"); router.refresh(); };
  const on = (href: string) => (href === "/draftpunk" ? path === "/draftpunk" || path.startsWith("/draftpunk/r/") : path.startsWith(href));
  return (
    <>
      <nav className="dp-menu dp-noprint">
        <Link href="/draftpunk" className="dp-logo">DraftPunk</Link>
        {MENU.map((m) => (
          <Link key={m.href} href={m.href} className={on(m.href) ? "on" : ""}>
            {m.label}
          </Link>
        ))}
        <span className="dp-who">
          <span>{name}</span>
          <button type="button" onClick={signOut}>Sign out</button>
        </span>
      </nav>
      <main className="dp-main">{children}</main>
      <div className="dp-fkeys dp-noprint">
        {KEYS.map((k) => (
          <button key={k.k} type="button" onClick={() => press(k)}><i>{k.k}</i>{k.label}</button>
        ))}
      </div>
    </>
  );
}

/** a short "Saved" note in the corner */
export function useToast() {
  const [msg, setMsg] = useState("");
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 2200); return () => clearTimeout(t); }, [msg]);
  return { toast: setMsg, node: msg ? <div className="dp-toast" role="status">{msg}</div> : null };
}
