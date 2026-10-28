"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PMS_HEX, STOCK_HEX, WILFLEX_HEX, colorHex } from "@/lib/inkColors";
import { PMS_COATED } from "@/lib/pms";
import { findThreads, threadByName, threadLabel, type Thread } from "@/lib/embroidery";

/** The ink and thread pickers (one field each), shared by the Mockup Creator and the order page's color change. */
/**
 * The customer's brand colors (Oct 16, Nick: "a drop down in the mockup creator that has customer colors saved"): first
 * in every ink dropdown, and an "Apply brand standards" pick (a pop-up when a logo's colors come up, and a dropdown under
 * them). Never applied on their own: a customer can have several sets. Set on the customer page.
 */
export type BrandInk = { name: string; ink: string; hex: string; group?: string };
export type Brand = { label: string; colors: BrandInk[]; groups: { key: string; label: string; colors: BrandInk[] }[] };
export const BrandCtx = createContext<Brand>({ label: "", colors: [], groups: [] });

/** Pick the ink a logo color prints as: a Wilflex RFU color, a PMS color, a custom PMS, or drop it. */
/**
 * A typed ink: a stock ink or brand ink by name ("royal" → Royal), or any Pantone from the full coated chart by number
 * ("241", "pms 241", "Pantone 241 C" → PMS 241 C). Null when it isn't one we know (then it's kept as typed, with a picked color).
 */
export function resolveInk(text: string, brand: Brand): { name: string; hex: string } | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return null;
  const lc = t.toLowerCase().replace(/^wilflex\s+/, "");
  for (const g of brand.groups) for (const b of g.colors) if (b.ink.toLowerCase() === lc || b.name.toLowerCase() === lc) return { name: b.ink, hex: b.hex || colorHex(b.ink) || "#888888" };
  const named = [...Object.keys(WILFLEX_HEX), ...Object.keys(STOCK_HEX), ...Object.keys(PMS_HEX)].find((n) => n.toLowerCase() === lc);
  if (named) return { name: named, hex: colorHex(named) };
  const num = t.replace(/^(pms|pantone)\s*/i, "").replace(/\s*c$/i, "").trim();
  if (!num) return null;
  const key = `PMS ${num.replace(/\b[a-z]/g, (c) => c.toUpperCase())} C`;
  return PMS_COATED[key] ? { name: key, hex: PMS_COATED[key] } : null;
}

/**
 * The ink a logo color prints as, in ONE field (Oct 24, Nick: "I don't like how this double drop down arrow thing
 * happens… you click it and then it drops down… then it goes to standard colors… rethink how we do that"): type to find
 * (a stock ink, a brand ink, any Pantone by number: "241" → PMS 241 C) or open the list with the one ▾. Each ink shows
 * its swatch. "Keep as uploaded" and "Remove" sit at the top of the list.
 */
type InkOpt = { name: string; hex: string; sub?: string; act?: "keep" | "none" | "typed" };
export function InkSelect({ value, onChange }: { value?: { name: string; hex: string }; onChange: (v: { name: string; hex: string } | null) => void }) {
  const brand = useContext(BrandCtx);
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const inp = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null); // what's being typed (null = show the picked ink)
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<{ left: number; width: number; top?: number; bottom?: number; max: number } | null>(null);
  const shown = value?.name === "none" ? "Remove (shirt shows through)" : value?.name || "";
  const q = (text ?? "").trim().toLowerCase().replace(/^pantone\s*/, "pms ").replace(/\s+/g, " ");
  const hit = text && text.trim() ? resolveInk(text, brand) : null;
  const groups = useMemo(() => {
    const has = (n: string, sub = "") => !q || n.toLowerCase().includes(q) || sub.toLowerCase().includes(q) || n.toLowerCase().replace(/^pms /, "").startsWith(q.replace(/^pms ?/, ""));
    const out: { label: string; opts: InkOpt[] }[] = [];
    const seen = new Set<string>();
    const add = (label: string, opts: InkOpt[]) => { const o = opts.filter((x) => !seen.has(x.name) && has(x.name, x.sub)); o.forEach((x) => seen.add(x.name)); if (o.length) out.push({ label, opts: o }); };
    if (hit) { out.push({ label: "", opts: [hit] }); seen.add(hit.name); }
    if (!q) out.push({ label: "", opts: [{ name: "Keep as uploaded", hex: "", act: "keep" }, { name: "Remove (shirt shows through)", hex: "", act: "none" }] });
    for (const g of brand.groups) if (g.colors.length) add(g.label, g.colors.map((b) => ({ name: b.ink, hex: b.hex || colorHex(b.ink) || "#888888", sub: b.name !== b.ink ? b.name : undefined })));
    add("Our stock inks (Wilflex RFU)", Object.keys(WILFLEX_HEX).map((k) => ({ name: k, hex: colorHex(k) })));
    add("Our other stock inks (Ink Room)", Object.keys(STOCK_HEX).map((k) => ({ name: k, hex: colorHex(k) })));
    add("Common PMS", Object.keys(PMS_HEX).map((k) => ({ name: k, hex: colorHex(k) })));
    if (q) {
      const chart = Object.keys(PMS_COATED).filter((k) => !seen.has(k) && has(k)).slice(0, 40).map((k) => ({ name: k, hex: PMS_COATED[k] }));
      if (chart.length) { out.push({ label: "Pantone chart", opts: chart }); chart.forEach((x) => seen.add(x.name)); }
      if (!hit && text!.trim()) out.push({ label: "", opts: [{ name: text!.trim(), hex: value?.hex || "#888888", act: "typed" }] });
    }
    return out;
  }, [q, brand, hit, text, value?.hex]);
  const flat = groups.flatMap((g) => g.opts);
  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8, up = below < 240 && above > below;
    setAt({ left: r.left, width: Math.max(r.width, 260), max: Math.min(340, up ? above : below), ...(up ? { bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2 }) });
  };
  const show = () => { place(); setOpen(true); const i = flat.findIndex((o) => o.name === value?.name); setActive(Math.max(0, i)); };
  const close = () => { setOpen(false); setText(null); };
  const choose = (o: InkOpt) => {
    if (o.act === "keep") onChange(null);
    else if (o.act === "none") onChange({ name: "none", hex: "" });
    else onChange({ name: o.name, hex: o.hex });
    close(); inp.current?.blur();
  };
  // the list follows the field; a scroll elsewhere closes it
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (menu.current?.contains(e.target as Node)) return; if (e.type === "scroll") close(); else if (!box.current?.contains(e.target as Node)) close(); };
    window.addEventListener("scroll", off, true); window.addEventListener("resize", close); document.addEventListener("pointerdown", off);
    return () => { window.removeEventListener("scroll", off, true); window.removeEventListener("resize", close); document.removeEventListener("pointerdown", off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // not on any chart (typed as the customer wrote it): pick the color to show
  const offChart = !!value && value.name !== "none" && !!value.name && !resolveInk(value.name, brand);
  let n = -1;
  return (
    <span className="ink-dd" ref={box}>
      <input ref={inp} type="text" aria-label="Ink color" role="combobox" aria-expanded={open} autoComplete="off" spellCheck={false}
        placeholder="Keep as uploaded" value={text ?? shown}
        onFocus={(e) => { e.currentTarget.select(); show(); }}
        onClick={() => { if (!open) show(); }}
        onChange={(e) => { setText(e.target.value); setActive(0); if (!open) show(); }}
        onBlur={() => { if (hit && text) onChange(hit); setTimeout(close, 120); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); if (!open) show(); else setActive((a) => Math.min(flat.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && flat[active]) choose(flat[active]); }
          else if (e.key === "Escape") { close(); e.currentTarget.blur(); }
        }} />
      <button type="button" className="ink-dd-car" tabIndex={-1} aria-label="Show the inks" onMouseDown={(e) => { e.preventDefault(); if (open) close(); else inp.current?.focus(); }}>
        <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
      </button>
      {offChart && <input type="color" className="ink-dd-hex" aria-label="Screen color" title="Not on the Pantone chart: pick the color to show" value={value!.hex || "#888888"} onChange={(e) => onChange({ name: value!.name, hex: e.target.value })} />}
      {open && at && typeof document !== "undefined" && createPortal(
        <div ref={menu} className="ink-menu" role="listbox" style={{ left: at.left, width: at.width, top: at.top, bottom: at.bottom, maxHeight: at.max }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <div className="ink-menu-g">{g.label}</div>}
              {g.opts.map((o) => {
                const i = ++n, cur = o.act === "keep" ? !value : o.act === "none" ? value?.name === "none" : value?.name === o.name;
                return (
                  <div key={(o.act || "") + o.name} role="option" aria-selected={cur} className={"sm-item" + (i === active ? " on" : "") + (cur ? " cur" : "")}
                    ref={i === active ? (el) => { el?.scrollIntoView({ block: "nearest" }); } : undefined}
                    onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}>
                    <i className={o.act === "keep" || o.act === "none" ? "x " + o.act : ""} style={o.hex ? { background: o.hex } : undefined} />
                    <b data-notranslate={o.act ? undefined : true}>{o.act === "typed" ? `Use “${o.name}” (not on the chart)` : o.name}</b>
                    {o.sub ? <span data-notranslate>{o.sub}</span> : <span />}
                  </div>
                );
              })}
            </div>
          ))}
          {!flat.length && <div className="ink-menu-g">No ink by that name</div>}
        </div>, document.body)}
    </span>
  );
}


/**
 * The thread a print sews in, in the same ONE field as the inks (Oct 27, Nick: the color change's "to" should "work just
 * like the drop down on the mock-up… you can select white, or you can select the threads"): type a Madeira number, name
 * or PMS, or open the list: the customer's brand threads first, then white and black.
 */
export function ThreadSelect({ value, onChange, line = "Polyneon 40", suggest = [], placeholder = "Find a thread: number, name or PMS" }: { value: string; onChange: (name: string, hex: string) => void; line?: Thread["line"]; suggest?: string[]; placeholder?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const inp = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<{ left: number; width: number; top?: number; bottom?: number; max: number } | null>(null);
  const q = (text ?? "").trim();
  const groups = useMemo(() => {
    const out: { label: string; opts: { name: string; hex: string; sub?: string }[] }[] = [];
    const seen = new Set<string>();
    const add = (label: string, list: Thread[]) => { const o = list.filter((t) => !seen.has(t.code)).map((t) => { seen.add(t.code); return { name: threadLabel(t), hex: t.hex, sub: t.pms.length ? `PMS ${t.pms[0].replace(/^PMS\s*/i, "")}` : undefined }; }); if (o.length) out.push({ label, opts: o }); };
    if (q) add("", findThreads(q, line, 40));
    else {
      add("Their brand", suggest.map((n) => threadByName(n)).filter(Boolean) as Thread[]);
      add("White and black", [threadByName(`${line === "Isacord 40" ? "Isacord 0015" : "Madeira 1801"}`), threadByName(`${line === "Isacord 40" ? "Isacord 0020" : "Madeira 1800"}`)].filter(Boolean) as Thread[]);
    }
    return out;
  }, [q, line, suggest]);
  const flat = groups.flatMap((g) => g.opts);
  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8, up = below < 240 && above > below;
    setAt({ left: r.left, width: Math.max(r.width, 280), max: Math.min(340, up ? above : below), ...(up ? { bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2 }) });
  };
  const show = () => { place(); setOpen(true); setActive(0); };
  const close = () => { setOpen(false); setText(null); };
  const choose = (o: { name: string; hex: string }) => { onChange(o.name, o.hex); close(); inp.current?.blur(); };
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (menu.current?.contains(e.target as Node)) return; if (e.type === "scroll") close(); else if (!box.current?.contains(e.target as Node)) close(); };
    window.addEventListener("scroll", off, true); window.addEventListener("resize", close); document.addEventListener("pointerdown", off);
    return () => { window.removeEventListener("scroll", off, true); window.removeEventListener("resize", close); document.removeEventListener("pointerdown", off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const cur = threadByName(value);
  let n = -1;
  return (
    <span className="ink-dd" ref={box}>
      <span className="ink-dd-sw" style={{ background: cur?.hex || "transparent" }} aria-hidden />
      <input ref={inp} type="text" aria-label="Thread" role="combobox" aria-expanded={open} autoComplete="off" spellCheck={false}
        placeholder={placeholder} value={text ?? value}
        onFocus={(e) => { e.currentTarget.select(); show(); }}
        onClick={() => { if (!open) show(); }}
        onChange={(e) => { setText(e.target.value); setActive(0); if (!open) show(); }}
        onBlur={() => setTimeout(close, 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); if (!open) show(); else setActive((a) => Math.min(flat.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && flat[active]) choose(flat[active]); }
          else if (e.key === "Escape") { close(); e.currentTarget.blur(); }
        }} />
      <button type="button" className="ink-dd-car" tabIndex={-1} aria-label="Show the threads" onMouseDown={(e) => { e.preventDefault(); if (open) close(); else inp.current?.focus(); }}>
        <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
      </button>
      {open && at && typeof document !== "undefined" && createPortal(
        <div ref={menu} className="ink-menu" role="listbox" style={{ left: at.left, width: at.width, top: at.top, bottom: at.bottom, maxHeight: at.max }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <div className="ink-menu-g">{g.label}</div>}
              {g.opts.map((o) => { const i = ++n; return (
                <div key={o.name} role="option" aria-selected={o.name === value} className={"sm-item" + (i === active ? " on" : "") + (o.name === value ? " cur" : "")}
                  ref={i === active ? (el) => { el?.scrollIntoView({ block: "nearest" }); } : undefined}
                  onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}>
                  <i style={{ background: o.hex }} /><b data-notranslate>{o.name}</b>{o.sub ? <span data-notranslate>{o.sub}</span> : <span />}
                </div>
              ); })}
            </div>
          ))}
          {!flat.length && <div className="ink-menu-g">{q ? `No thread matches “${q}”` : "Type a thread number, name or PMS"}</div>}
        </div>, document.body)}
    </span>
  );
}
