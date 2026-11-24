"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** the F-keys work like an old DOS program; F2 saves whatever screen is open (it listens for "dp-save") */
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
  { href: "/draftpunk", label: "Recipes", hot: 0 },
  { href: "/draftpunk/brews", label: "Brew Log", hot: 0 },
  { href: "/draftpunk/tools", label: "Tools", hot: 0 },
  { href: "/draftpunk/equipment", label: "Equipment", hot: 0 },
  { href: "/draftpunk/inventory", label: "Stock", hot: 0 },
  { href: "/draftpunk/club", label: "Club", hot: 1 },
];

export default function Shell({ name, children }: { name: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);
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
        <span className="dp-logo">DRAFTPUNK</span>
        {MENU.map((m) => (
          <Link key={m.href} href={m.href} className={on(m.href) ? "on" : ""}>
            {m.label.slice(0, m.hot)}<b>{m.label[m.hot]}</b>{m.label.slice(m.hot + 1)}
          </Link>
        ))}
        <span className="dp-who">
          <span>{name.toUpperCase()}</span>
          <span>{clock}</span>
          <button type="button" onClick={signOut}>Exit</button>
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

/** a short "SAVED" note in the corner */
export function useToast() {
  const [msg, setMsg] = useState("");
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 2200); return () => clearTimeout(t); }, [msg]);
  return { toast: setMsg, node: msg ? <div className="dp-toast">{msg}</div> : null };
}
