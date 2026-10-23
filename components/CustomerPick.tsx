"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type PickOption = { id: string; label: string; sub?: string };

/**
 * Pick a customer by typing (Oct 22, Nick: "anywhere we have this customer dropdown, it needs to be a type-in thing
 * where you select from below… type PET and then select Peticolas"). Type any part of the company, contact name or
 * email; the ones that start with what you typed come first. ↑ ↓ to move, Enter to pick, Esc to close.
 *
 * `options`: the list to pick from when the page already has it (searched here, as you type); without it the
 * customers are searched in the database. The picked one shows as a chip: click it to change, × to clear.
 */
export default function CustomerPick({ value, label, onPick, placeholder = "Type a customer…", disabled, compact, options, clearable = true, ariaLabel = "Customer", field }: {
  value: string | null; label?: string; onPick: (id: string | null, label: string) => void; placeholder?: string; disabled?: boolean; compact?: boolean;
  options?: PickOption[]; clearable?: boolean; ariaLabel?: string; /** full width, the height of a form field */ field?: boolean;
}) {
  const sb = useMemo(() => createClient(), []);
  const [q, setQ] = useState(""), [hits, setHits] = useState<PickOption[]>([]), [open, setOpen] = useState(false), [at, setAt] = useState(0);
  const [name, setName] = useState(label || ""), [editing, setEditing] = useState(false);
  const box = useRef<HTMLDivElement>(null), inp = useRef<HTMLInputElement>(null);
  // the picked customer's name, when only the id is known
  useEffect(() => {
    if (label) { setName(label); return; }
    if (!value) { setName(""); return; }
    const o = options?.find((x) => x.id === value);
    if (o) { setName(o.label); return; }
    sb.from("customers").select("company, name").eq("id", value).maybeSingle().then(({ data }) => setName((data?.company || data?.name || "Customer") as string));
  }, [sb, value, label, options]);
  // what matches: starts-with first, then contains, then by name
  const rank = (t: string, list: PickOption[]) => {
    const n = t.toLowerCase();
    const score = (o: PickOption) => { const l = o.label.toLowerCase(), s = (o.sub || "").toLowerCase(); return l.startsWith(n) ? 0 : l.split(/[\s&,.-]+/).some((w) => w.startsWith(n)) ? 1 : l.includes(n) ? 2 : s.includes(n) ? 3 : 9; };
    return list.map((o) => ({ o, k: score(o) })).filter((x) => x.k < 9).sort((a, b) => a.k - b.k || a.o.label.localeCompare(b.o.label)).slice(0, 10).map((x) => x.o);
  };
  useEffect(() => {
    const t = q.trim();
    if (!t) { setHits([]); return; }
    if (options) { setHits(rank(t, options)); setAt(0); setOpen(true); return; }
    const like = `%${t.replace(/[%,()]/g, " ")}%`;
    const h = setTimeout(async () => {
      const { data } = await sb.from("customers").select("id, company, name, email").or(`company.ilike.${like},name.ilike.${like},email.ilike.${like}`).limit(40);
      const list = ((data || []) as { id: string; company: string | null; name: string | null; email: string | null }[]).map((c) => ({ id: c.id, label: c.company || c.name || c.email || "Customer", sub: c.company && c.name ? c.name : c.email || "" }));
      setHits(rank(t, list)); setAt(0); setOpen(true);
    }, 150);
    return () => clearTimeout(h);
  }, [sb, q, options]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setEditing(false); setQ(""); } };
    document.addEventListener("mousedown", off); return () => document.removeEventListener("mousedown", off);
  }, []);
  const pick = (h: PickOption) => { onPick(h.id, h.label); setName(h.label); setOpen(false); setQ(""); setEditing(false); };

  if (value && !editing) return (
    <span className={"cpk-chip" + (compact ? " sm" : "") + (field ? " field" : "")}>
      <button type="button" className="cpk-n" data-notranslate disabled={disabled} title={disabled ? undefined : "Change customer"} onClick={() => { setEditing(true); setTimeout(() => inp.current?.focus(), 0); }}>{name || "Customer"}</button>
      {!disabled && clearable && <button type="button" className="cpk-x" aria-label="Clear the customer" title="Clear" onClick={() => { onPick(null, ""); setQ(""); }}>×</button>}
    </span>
  );
  return (
    <div className={"cpk" + (compact ? " sm" : "") + (field ? " field" : "")} ref={box}>
      <input ref={inp} type="search" value={q} disabled={disabled} placeholder={editing && name ? name : placeholder} autoComplete="off" aria-label={ariaLabel} aria-expanded={open} aria-autocomplete="list"
        onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAt((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { if (open && hits[at]) { e.preventDefault(); pick(hits[at]); } }
          else if (e.key === "Escape") { setOpen(false); if (editing) { setEditing(false); setQ(""); } }
        }} />
      {open && q.trim().length >= 1 && (
        <div className="cpk-list" role="listbox">
          {hits.length ? hits.map((h, i) => (
            <button key={h.id} type="button" role="option" aria-selected={i === at} className={i === at ? "on" : undefined} onMouseEnter={() => setAt(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}>
              <b data-notranslate>{h.label}</b>{h.sub && <span className="faint" data-notranslate>{h.sub}</span>}
            </button>
          )) : <div className="cpk-none faint">No customer matches “{q.trim()}”.</div>}
        </div>
      )}
    </div>
  );
}
