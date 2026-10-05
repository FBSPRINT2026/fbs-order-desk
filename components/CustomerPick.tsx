"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Pick a customer by typing part of the company, name or email (645+ customers: searched, not listed).
 * Shows the picked one as a chip with × to clear.
 */
export default function CustomerPick({ value, label, onPick, placeholder = "Customer (type to search)", disabled, compact }: {
  value: string | null; label?: string; onPick: (id: string | null, label: string) => void; placeholder?: string; disabled?: boolean; compact?: boolean;
}) {
  const sb = useMemo(() => createClient(), []);
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; label: string; sub: string }[]>([]), [open, setOpen] = useState(false);
  const [name, setName] = useState(label || "");
  const box = useRef<HTMLDivElement>(null);
  // the picked customer's name, when only the id is known
  useEffect(() => {
    if (label) { setName(label); return; }
    if (!value) { setName(""); return; }
    sb.from("customers").select("company, name").eq("id", value).maybeSingle().then(({ data }) => setName((data?.company || data?.name || "Customer") as string));
  }, [sb, value, label]);
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) { setHits([]); return; }
    const like = `%${t.replace(/[%,()]/g, " ")}%`;
    const h = setTimeout(async () => {
      const { data } = await sb.from("customers").select("id, company, name, email").or(`company.ilike.${like},name.ilike.${like},email.ilike.${like}`).order("company").limit(8);
      setHits(((data || []) as { id: string; company: string | null; name: string | null; email: string | null }[]).map((c) => ({ id: c.id, label: c.company || c.name || c.email || "Customer", sub: c.company && c.name ? c.name : c.email || "" })));
      setOpen(true);
    }, 180);
    return () => clearTimeout(h);
  }, [sb, q]);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off); return () => document.removeEventListener("mousedown", off);
  }, []);

  if (value) return (
    <span className={"cpk-chip" + (compact ? " sm" : "")}>
      <span className="cpk-n" data-notranslate>{name || "Customer"}</span>
      {!disabled && <button type="button" className="cpk-x" aria-label="Change customer" title="Change customer" onClick={() => { onPick(null, ""); setQ(""); }}>×</button>}
    </span>
  );
  return (
    <div className={"cpk" + (compact ? " sm" : "")} ref={box}>
      <input type="search" value={q} disabled={disabled} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} aria-label="Customer" />
      {open && q.trim().length >= 2 && (
        <div className="cpk-list" role="listbox">
          {hits.length ? hits.map((h) => (
            <button key={h.id} type="button" role="option" aria-selected={false} onClick={() => { onPick(h.id, h.label); setOpen(false); setQ(""); }}>
              <b data-notranslate>{h.label}</b>{h.sub && <span className="faint" data-notranslate>{h.sub}</span>}
            </button>
          )) : <div className="cpk-none faint">No customer matches “{q.trim()}”.</div>}
        </div>
      )}
    </div>
  );
}
