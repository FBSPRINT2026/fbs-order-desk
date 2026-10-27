"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { matchColor } from "@/lib/colorMatch";
import { sizeRank } from "@/lib/sizeOrder";
import type { PreferredGood } from "@/lib/preferredGoods";
import type { Group } from "@/lib/pricing";

/**
 * Which garment and which color each size run is (Oct 26, Nick, on Michael Peticolas' email: "if you detect multiple
 * size runs… we detected brand standard, should we apply this to that email?… you select one of those two [6210 or
 * 3001CVC]… then… a drop-down where you select the color or it makes a recommendation"). ONE tool, used by Order goods
 * and by Create order / reorder (a step of each, whenever a line has no style).
 *   "We found 4 size runs in the email." · Apply their brand standards? Yes / No (when they have preferred goods)
 *   each run: what they wrote · a toggle between their garments (a garment that doesn't come in the color is faded),
 *     or a box to type any style · the color on that garment: exact, or the closest recommended (their usual first,
 *     amber until you OK it), the closest few and every color in the box
 * Yes fills each run color by color: a color listed on one of their garments → that one; else the one of theirs that
 * comes in it; else their 1st choice. Nothing goes on until you press Next.
 */
export type Run = { id: string; color: string; called: string; sizes: Record<string, number>; pcs: number };
export type RunPick = { style: string; brand: string; name: string; color: string };
type Gar = { style: string; brand: string; description: string; colors: string[]; hex: Record<string, string> };

const clean = (c: string) => (c || "").replace(/\(.*?\)/g, " ").replace(/^\s*the\s+/i, "").replace(/\s+/g, " ").trim();
const plain = (c: string) => clean(c).toLowerCase().replace(/grey/g, "gray");
const words = (c: string) => plain(c).split(/[^a-z0-9]+/).filter(Boolean);
const sizesLine = (s: Record<string, number>) => Object.entries(s).filter(([, n]) => +n > 0).sort((a, b) => sizeRank(a[0]) - sizeRank(b[0])).map(([z, n]) => `${z} ${n}`).join(" · ");

/** the color they wrote on a garment: exact, recommended (closest, their usual first), or none close */
function colorOn(g: Gar | undefined, said: string, usual: string[]): { pick: string; kind: "exact" | "rec" | "none"; closest: string[] } {
  if (!g || !g.colors.length) return { pick: "", kind: "none", closest: [] };
  const exact = g.colors.find((c) => plain(c) === plain(said));
  const score = (c: string) => { const a = words(said), b = words(c); const shared = a.filter((w) => b.includes(w)).length; return shared * 10 - Math.abs(b.length - a.length) + (usual.some((u) => plain(u) === plain(c)) ? 5 : 0); };
  const ranked = [...g.colors].map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
  const m = said ? matchColor(clean(said), g.colors) : null;
  const closest = [...new Set([...(m ? [m.color] : []), ...ranked])].slice(0, 4);
  if (exact) return { pick: exact, kind: "exact", closest };
  const theirs = usual.find((u) => g.colors.includes(u) && words(said).length > 0 && words(said).every((w) => words(u).includes(w)));
  const pick = theirs || (m?.sure ? m.color : "") || ranked[0] || m?.color || "";
  return { pick, kind: pick ? "rec" : "none", closest: theirs ? [theirs, ...closest.filter((c) => c !== theirs)].slice(0, 4) : closest };
}

export default function SizeRunsAsk({ runs, prefs, company, sender, onDone, onCancel }: { runs: Run[]; prefs: PreferredGood[]; company: string; sender: string;
  onDone: (picks: Record<string, RunPick | null>, remember: boolean) => void; onCancel: () => void }) {
  const sb = useMemo(() => createClient(), []);
  const [gars, setGars] = useState<Record<string, Gar>>({});
  const garsRef = useRef(gars); garsRef.current = gars;
  const known = (st: string) => gars[st.toUpperCase()];
  const loadStyles = async (styles: string[]): Promise<Record<string, Gar>> => {
    const want = [...new Set(styles.map((s) => s.toUpperCase()).filter((s) => s && !garsRef.current[s]))];
    if (!want.length) return garsRef.current;
    const { data } = await sb.from("garments").select("style, brand, description, colors, color_images").in("style", want);
    const got = Object.fromEntries(((data || []) as { style: string; brand: string; description: string; colors: string[] | null; color_images: Record<string, { hex?: string }> | null }[]).map((g) => [g.style.toUpperCase(), {
      style: g.style, brand: g.brand, description: g.description, colors: g.colors?.length ? g.colors : Object.keys(g.color_images || {}),
      hex: Object.fromEntries(Object.entries(g.color_images || {}).map(([c, v]) => [c, v?.hex || ""])),
    }]));
    const all = { ...garsRef.current, ...got };
    garsRef.current = all; setGars(all);
    return all;
  };
  const ranked = useMemo(() => [...prefs].sort((a, b) => a.rank - b.rank), [prefs]);
  useEffect(() => { void loadStyles(ranked.map((p) => p.style)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // their brand standards only count once you say Yes (Oct 26, Nick: "if I don't apply the brand standards you should just
  // assume nothing… just a quick fill thing where you type in the model number")
  const [applied, setApplied] = useState<boolean | null>(null);
  const usualFor = (style: string) => (applied ? ranked.find((p) => p.style.toUpperCase() === style.toUpperCase())?.colors || [] : []);

  type Cell = { style: string; brand: string; name: string; color: string; ok: boolean; why: string };
  const empty = (): Cell => ({ style: "", brand: "", name: "", color: "", ok: false, why: "" });
  const [cells, setCells] = useState<Record<string, Cell>>(() => Object.fromEntries(runs.map((r) => [r.id, empty()])));
  const [remember, setRemember] = useState(true);
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  // a picked color (or garment) keeps the screen where it was (Oct 26, Nick: "whenever you select a color… it goes back to
  // the top of the screen… have it just stay where it's at"): the phone's picker closing scrolled the panel back to the
  // top; where it was is put back right after
  const rootRef = useRef<HTMLDivElement | null>(null), keepAt = useRef<{ el: HTMLElement; top: number } | null>(null);
  const scroller = () => { let el: HTMLElement | null = rootRef.current; while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement; return el || (document.scrollingElement as HTMLElement | null); };
  const hold = () => { const el = scroller(); if (el) keepAt.current = { el, top: el.scrollTop }; };
  const putBack = () => { const k = keepAt.current; if (!k) return; for (const ms of [0, 50, 200, 450]) setTimeout(() => { if (Math.abs(k.el.scrollTop - k.top) > 4) k.el.scrollTop = k.top; }, ms); };

  /** a run on a garment: its color found (exact), or the closest recommended */
  const onGarment = (r: Run, g: Gar | undefined, pick: { style: string; brand: string; name: string }, why = "", usual?: string[]): Cell => {
    const c = colorOn(g, r.color, usual ?? usualFor(pick.style));
    return { ...pick, color: c.pick, ok: c.kind === "exact", why };
  };
  async function apply(yes: boolean) {
    setApplied(yes);
    if (!yes) { setCells(Object.fromEntries(runs.map((r) => [r.id, empty()]))); return; }
    const g = await loadStyles(ranked.map((p) => p.style));
    const next: Record<string, Cell> = {};
    for (const r of runs) {
      const c = plain(r.color);
      const listed = ranked.find((p) => (p.colors || []).some((x) => plain(x) === c));
      const has = ranked.filter((p) => colorOn(g[p.style.toUpperCase()], r.color, p.colors || []).kind === "exact");
      const p = listed || (has.length ? has[0] : ranked[0]);
      if (!p) { next[r.id] = empty(); continue; }
      const why = listed ? `their usual on the ${p.style}` : has.length === 1 ? `only the ${p.style} comes in it` : has.length > 1 ? `their ${p.rank === 1 ? "1st" : "next"} choice that comes in it` : `none of theirs comes in ${clean(r.color) || "it"}: pick the color`;
      next[r.id] = onGarment(r, g[p.style.toUpperCase()], { style: p.style, brand: p.brand, name: p.name }, why, p.colors || []);
    }
    setCells(next);
  }
  const setGarment = async (r: Run, pick: { style: string; brand: string; name: string }) => {
    const g = await loadStyles([pick.style]);
    setCells((x) => ({ ...x, [r.id]: onGarment(r, g[pick.style.toUpperCase()], pick) }));
  };
  const ready = runs.every((r) => cells[r.id]?.style && cells[r.id]?.color);
  const firstSet = runs.find((r) => cells[r.id]?.style);
  const someEmpty = runs.some((r) => !cells[r.id]?.style);

  return (
    <div className="ap sra" role="group" aria-label="Which garment and color" ref={rootRef}>
      <p className="ap-q">{runs.length > 1 ? `We found ${runs.length} size runs in ${sender ? `${sender}'s` : "the"} email.` : "The email doesn't say which garment."}</p>
      {ranked.length > 0 && (
        <div className={"sra-bs" + (applied === false ? " off" : "")}>
          <span className="sra-bst"><b>Apply {company}&apos;s brand standards?</b><small>{[...new Set(ranked.map((p) => p.kind))].map((k) => `${k}: ${ranked.filter((p) => p.kind === k).map((p) => p.style).join(", ")}`).join(" · ")}</small></span>
          <span className="sra-yn" role="radiogroup" aria-label="Apply their brand standards?">
            <button type="button" role="radio" aria-checked={applied === true} className={applied === true ? "on" : ""} onClick={() => void apply(true)}>Yes</button>
            <button type="button" role="radio" aria-checked={applied === false} className={applied === false ? "on" : ""} onClick={() => void apply(false)}>No</button>
          </span>
        </div>
      )}
      <div className="sra-runs">{runs.map((r, i) => {
        const cell = cells[r.id] || empty();
        const g = cell.style ? known(cell.style) : undefined;
        const col = cell.style ? colorOn(g, r.color, usualFor(cell.style)) : null;
        const sw = g?.hex?.[cell.color] || "";
        const toggle = applied === true && ranked.length >= 2 && ranked.length <= 3;
        return (
          <div key={r.id} className="sra-run">
            <div className="sra-rt"><b>{runs.length > 1 ? `Size run ${i + 1}` : "The garment"}{r.called && runs.some((x) => x.called !== r.called) ? ` · ${r.called}` : ""}</b><span>{sizesLine(r.sizes)}</span></div>
            <div className="sra-said">They said: <i>&quot;{r.color || "no color given"}&quot;</i></div>
            {toggle && (
              <div className="sra-gt" role="radiogroup" aria-label="Garment">
                {ranked.map((p) => { const fits = colorOn(known(p.style), r.color, p.colors || []).kind; return (
                  <button key={p.id} type="button" role="radio" aria-checked={cell.style.toUpperCase() === p.style.toUpperCase()} className={(cell.style.toUpperCase() === p.style.toUpperCase() ? "on" : "") + (known(p.style) && fits === "none" ? " no" : "")}
                    title={known(p.style) && fits !== "exact" ? `The ${p.style} doesn't come in ${clean(r.color)} exactly` : `${p.brand} ${p.style}`}
                    onClick={() => { hold(); void setGarment(r, { style: p.style, brand: p.brand, name: p.name }).then(putBack); }}>{p.style}</button>
                ); })}
              </div>
            )}
            {(!toggle || typing[r.id] || (cell.style && !ranked.some((p) => p.style.toUpperCase() === cell.style.toUpperCase()))) &&
              <StyleBox value={cell.style && !typing[r.id] ? cell : null} prefs={applied ? ranked : []} said={r.color} known={known} loadStyles={loadStyles} onPick={(p) => { hold(); setTyping((x) => ({ ...x, [r.id]: false })); void setGarment(r, p).then(putBack); }} />}
            {toggle && !typing[r.id] && <button type="button" className="linkbtn sra-other" onClick={() => setTyping((x) => ({ ...x, [r.id]: true }))}>Another style…</button>}
            {cell.style && g && (
              <div className={"sra-col" + (cell.ok ? "" : cell.color ? " rec" : " none")}>
                <i className="sra-sw" style={sw ? { background: sw } : undefined} aria-hidden />
                <select value={cell.color} aria-label={`Color on the ${cell.style}`} onFocus={hold} onBlur={putBack} onChange={(e) => { if (!keepAt.current) hold(); setCells((x) => ({ ...x, [r.id]: { ...cell, color: e.target.value, ok: true } })); putBack(); }}>
                  {!cell.color && <option value="">Pick the color…</option>}
                  {col && col.closest.length > 0 && <optgroup label="Closest">{col.closest.map((c) => <option key={"c" + c} value={c}>{c}{usualFor(cell.style).includes(c) ? " (their usual)" : ""}</option>)}</optgroup>}
                  <optgroup label={`All ${g.colors.length} colors`}>{g.colors.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
                </select>
                <small>{cell.ok ? (col?.kind === "exact" && cell.color === col.pick ? "exact" : "picked") : cell.color ? "recommended" : `not on the ${cell.style}`}</small>
              </div>
            )}
            {cell.style && !g && <div className="sra-why">Finding the {cell.style}&apos;s colors…</div>}
            {cell.why && <div className="sra-why">{cell.why}</div>}
            {i === 0 && firstSet === r && someEmpty && runs.length > 1 && cell.style && <button type="button" className="linkbtn sra-all" onClick={() => void (async () => { const gg = await loadStyles([cell.style]); setCells((x) => Object.fromEntries(runs.map((rr) => [rr.id, x[rr.id]?.style ? x[rr.id] : onGarment(rr, gg[cell.style.toUpperCase()], { style: cell.style, brand: cell.brand, name: cell.name })]))); })()}>Use the {cell.style} for every run</button>}
          </div>
        );
      })}</div>
      {ready && <label className="check sra-rem"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember for {company}: these colors on these garments (filled in next time, still asked)</label>}
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
        <button type="button" className="btn ghost" onClick={() => onDone(Object.fromEntries(runs.map((r) => { const c = cells[r.id]; return [r.id, c?.style && c.color ? { style: c.style, brand: c.brand, name: c.name, color: c.color } : null]; })), false)} title="Runs with no garment or color are left out">{ready ? "Skip" : "Leave the rest"}</button>
        <button type="button" className="btn primary" disabled={!ready} onClick={() => onDone(Object.fromEntries(runs.map((r) => { const c = cells[r.id]; return [r.id, { style: c.style, brand: c.brand, name: c.name, color: c.color }]; })), remember)}>Next</button></div>
    </div>
  );
}

/** type a style and pick it: their preferred goods first, then the catalog; each says whether it comes in the color */
function StyleBox({ value, prefs, said, known, loadStyles, onPick }: { value: { style: string; brand: string; name: string } | null; prefs: PreferredGood[]; said: string; known: (s: string) => Gar | undefined; loadStyles: (s: string[]) => Promise<unknown>; onPick: (p: { style: string; brand: string; name: string }) => void }) {
  const sb = useMemo(() => createClient(), []);
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), [hits, setHits] = useState<{ style: string; brand: string; description: string; colors: string[] }[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const t = q.trim().toUpperCase().replace(/\s+/g, "");
    if (!t) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      const { data } = await sb.from("garments").select("style, brand, description, colors").ilike("style", `${t}%`).order("style").limit(6);
      setHits(((data || []) as { style: string; brand: string; description: string; colors: string[] | null }[]).map((g) => ({ ...g, colors: g.colors || [] })));
    }, 180);
  }, [q, sb]);
  const fits = (colors: string[]) => (!colors.length || !said ? "" : colors.some((c) => plain(c) === plain(said)) ? "✓ has it" : `no ${clean(said)}`);
  const t = q.trim().toUpperCase().replace(/\s+/g, "");
  const opts = [
    ...prefs.filter((p) => !t || p.style.toUpperCase().startsWith(t)).map((p) => ({ key: "p" + p.id, style: p.style, brand: p.brand, name: p.name, tag: p.rank === 1 ? "their 1st" : p.rank === 2 ? "their 2nd" : "theirs", fit: fits(known(p.style)?.colors || []) })),
    ...hits.filter((h) => !prefs.some((p) => p.style.toUpperCase() === h.style.toUpperCase())).map((h) => ({ key: "g" + h.style, style: h.style, brand: h.brand, name: h.description, tag: "", fit: fits(h.colors) })),
  ];
  const choose = (o: { style: string; brand: string; name: string }) => { void loadStyles([o.style]); onPick(o); setQ(""); setOpen(false); setErr(""); };
  async function lookUp() {
    if (!t) return;
    if (opts[0]) { choose(opts[0]); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/ss/lookup?style=${encodeURIComponent(t)}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.garment) choose({ style: j.garment.style, brand: j.garment.brand || "", name: j.garment.description || "" });
      else setErr(`Couldn't find ${t} at S&S or SanMar.`);
    } finally { setBusy(false); }
  }
  return (
    <div className="sra-box">
      {value && !open
        ? <button type="button" className="sra-val" onClick={() => { setOpen(true); setQ(""); }} aria-label={`Garment: ${value.style}. Change it`}><b>{value.style}</b><span>{[value.brand, value.name].filter(Boolean).join(" ")}</span></button>
        : <input className="sra-in" autoFocus={open} value={q} placeholder="Type a style: 6210, 3001CVC…" inputMode="text" autoCapitalize="characters" aria-label="Garment style"
            onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookUp(); } if (e.key === "Escape") setOpen(false); }}
            onBlur={() => setTimeout(() => setOpen(false), 200)} />}
      {open && (opts.length > 0 || t) && (
        <div className="sra-menu" role="listbox">
          {opts.map((o) => (
            <button key={o.key} type="button" role="option" aria-selected={value?.style === o.style} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
              <span><b>{o.style}</b> {o.brand}{o.tag ? <small> · {o.tag}</small> : null}</span>{o.fit && <em className={o.fit.startsWith("no") ? "no" : "ok"}>{o.fit}</em>}
            </button>
          ))}
          {t && !opts.length && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void lookUp()}><span>{busy ? "Looking it up…" : <>Look up <b>{t}</b> at S&amp;S / SanMar</>}</span></button>}
        </div>
      )}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}

export type RunsAsk = { runs: Run[]; prefs: PreferredGood[]; company: string; sender: string };
/**
 * The step itself, the same in Order goods and in Create order / reorder: the lines with no style become size runs, the
 * screen above asks (ask() shows it and waits), the answers go on the lines (style and real color), and what was
 * picked is remembered on the customer's preferred goods when asked to. Returns the groups, what was left out, and
 * their usual colors per style (for the color check after).
 */
export async function garmentStep(groups: Group[], o: { customerId?: string | null; activityId?: string | null; ask: (a: RunsAsk) => Promise<{ picks: Record<string, RunPick | null>; remember: boolean } | null> }): Promise<{ groups: Group[]; asked: boolean; skipped: string[]; usual: Record<string, string[]>; did: string[] }> {
  const blank = groups.flatMap((x) => x.lines).filter((l) => !String(l.style || "").trim() && (l.color || Object.values(l.sizes || {}).some((n) => +(n || 0) > 0)));
  if (!blank.length) return { groups, asked: false, skipped: [], usual: {}, did: [] };
  const sb = createClient();
  const [{ data: cu }, { data: em }] = await Promise.all([
    o.customerId ? sb.from("customers").select("preferred_goods, company, name").eq("id", o.customerId).maybeSingle() : Promise.resolve({ data: null }),
    o.activityId ? sb.from("activities").select("from_email, meta").eq("id", o.activityId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const prefs = (((cu as { preferred_goods?: PreferredGood[] } | null)?.preferred_goods) || []).filter((x) => x && x.style);
  const company = String((cu as { company?: string } | null)?.company || (cu as { name?: string } | null)?.name || "This customer");
  const sender = (() => { const n = String(((em as { meta?: { from_name?: string } } | null)?.meta?.from_name) || "").replace(/["']/g, "").trim(); const m = /^([^,@]+),\s*([^,@]+)$/.exec(n); return ((m ? m[2] : n).split(/\s+/).find((w) => w && !/@/.test(w)) || ""); })();
  const runs: Run[] = blank.map((l) => ({ id: l.id, color: l.color || "", called: l.called || "", sizes: Object.fromEntries(Object.entries(l.sizes || {}).map(([k, v]) => [k, +(v || 0)])), pcs: Object.values(l.sizes || {}).reduce((a, n) => a + (+(n || 0)), 0) }));
  const out = await o.ask({ runs, prefs, company, sender });
  const picks = out?.picks || {};
  const next = groups.map((x) => ({ ...x, lines: x.lines.map((l) => {
    if (String(l.style || "").trim()) return l;
    const p = picks[l.id];
    return p ? { ...l, style: p.style, brand: p.brand || l.brand, garment: l.garment || p.name, color: p.color || l.color, called: undefined } : l;
  }) }));
  const usual: Record<string, string[]> = {};
  for (const p of prefs) if (p.colors?.length) usual[p.style.toUpperCase()] = p.colors;
  const did: string[] = [];
  for (const r of runs) { const p = picks[r.id]; if (p) did.push(`${r.color ? `"${r.color}"` : "A size run"} → ${[p.brand, p.style].filter(Boolean).join(" ")} ${p.color}`); }
  // remember: each color on the garment it went on (their brand standards fill it in next time, still asked)
  if (out?.remember && o.customerId) {
    const keep = prefs.map((p) => ({ ...p, colors: [...(p.colors || [])] }));
    for (const r of runs) {
      const p = picks[r.id]; if (!p || !p.color) continue;
      const c = p.color;
      for (const x of keep) x.colors = x.colors.filter((y) => y.toLowerCase() !== c.toLowerCase() || x.style.toUpperCase() === p.style.toUpperCase());
      let hit = keep.find((x) => x.style.toUpperCase() === p.style.toUpperCase());
      if (!hit) { const kind = r.called || keep[0]?.kind || "Garment"; hit = { id: Math.random().toString(36).slice(2, 10), kind, rank: keep.filter((x) => x.kind.toLowerCase() === kind.toLowerCase()).length + 1, style: p.style, brand: p.brand, name: p.name, colors: [], notes: "" }; keep.push(hit); }
      if (!hit.colors.some((y) => y.toLowerCase() === c.toLowerCase())) hit.colors.push(c);
    }
    await sb.from("customers").update({ preferred_goods: keep }).eq("id", o.customerId);
    did.push(`Remembered on ${company}'s preferred goods`);
  }
  return { groups: next, asked: true, skipped: runs.filter((r) => !picks[r.id]).map((r) => [r.called, r.color].filter(Boolean).join(" ") || "a size run"), usual, did };
}
