"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { matchColor } from "@/lib/colorMatch";
import { sizeRank } from "@/lib/sizeOrder";
import type { PreferredGood } from "@/lib/preferredGoods";

/**
 * Order goods: which garment each size run is on, when the email doesn't say (Oct 26, Nick, on Michael Peticolas' email:
 * "if you detect multiple size runs… are we all the same good yes or no toggle right at the top… if you say no then it
 * does a drop-down for each size run where you can just type and select"). One screen:
 *   "We found 4 size runs in the email." · All the same garment? Yes / No
 *   Yes: one box for the garment, every run listed under it (a color it doesn't come in is said)
 *   No: a box under each run
 * Each box: type and pick; their preferred goods first; every choice says whether it comes in that run's color.
 * With preferred goods on file, the same screen asks first (Oct 26, Nick: "we detected brand standard. Should we apply
 * this to that email?"). Yes fills each run, color by color: a color listed on one of their garments → that one; else
 * the one of theirs that comes in the color (Heather Sage only on the 3001CVC); else their 1st choice. Each box says
 * why, and stays yours to change. No leaves the boxes empty.
 */
export type Run = { id: string; color: string; called: string; sizes: Record<string, number>; pcs: number };
export type RunPick = { style: string; brand: string; name: string };
type Gar = { style: string; brand: string; description: string; colors: string[] };

const clean = (c: string) => (c || "").replace(/\(.*?\)/g, "").replace(/^the\s+/i, "").trim();
const sizesLine = (s: Record<string, number>) => Object.entries(s).filter(([, n]) => +n > 0).sort((a, b) => sizeRank(a[0]) - sizeRank(b[0])).map(([z, n]) => `${z} ${n}`).join(" · ");

/** does this garment come in that color: "yes", "as <name>" (a sure match by another name), or "no" */
function carries(g: Gar | undefined, color: string): { ok: boolean; as?: string } | null {
  if (!g || !g.colors?.length || !color) return null;
  const c = clean(color);
  const exact = g.colors.find((x) => x.toLowerCase() === c.toLowerCase());
  if (exact) return { ok: true };
  const m = matchColor(c, g.colors);
  return m?.sure ? { ok: true, as: m.color } : { ok: false };
}

export default function SizeRunsAsk({ runs, prefs, company, sender, onDone, onCancel }: { runs: Run[]; prefs: PreferredGood[]; company: string; sender: string;
  onDone: (picks: Record<string, RunPick | null>, remember: boolean) => void; onCancel: () => void }) {
  const sb = useMemo(() => createClient(), []);
  const [gars, setGars] = useState<Record<string, Gar>>({});
  const known = (st: string) => gars[st.toUpperCase()];
  const loadStyles = async (styles: string[]): Promise<Record<string, Gar>> => {
    const want = [...new Set(styles.map((s) => s.toUpperCase()).filter((s) => s && !gars[s]))];
    if (!want.length) return gars;
    const { data } = await sb.from("garments").select("style, brand, description, colors").in("style", want);
    const got = Object.fromEntries(((data || []) as Gar[]).map((g) => [g.style.toUpperCase(), { ...g, colors: g.colors || [] }]));
    setGars((x) => ({ ...x, ...got }));
    return { ...gars, ...got };
  };
  useEffect(() => { void loadStyles(prefs.map((p) => p.style)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toPick = (p: PreferredGood | null | undefined): RunPick | null => (p ? { style: p.style, brand: p.brand, name: p.name } : null);
  const [same, setSame] = useState(true);
  const [one, setOne] = useState<RunPick | null>(null);
  const [each, setEach] = useState<Record<string, RunPick | null>>(() => Object.fromEntries(runs.map((r) => [r.id, null])));
  const [why, setWhy] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<boolean | null>(null);
  const [remember, setRemember] = useState(true);
  const ranked = [...prefs].sort((a, b) => a.rank - b.rank);
  async function apply(yes: boolean) {
    setApplied(yes);
    if (!yes) { setSame(true); setOne(null); setEach(Object.fromEntries(runs.map((r) => [r.id, null]))); setWhy({}); return; }
    const g = await loadStyles(ranked.map((p) => p.style));
    const pick: Record<string, PreferredGood> = {}, w: Record<string, string> = {};
    for (const r of runs) {
      const c = clean(r.color).toLowerCase();
      const listed = ranked.find((p) => (p.colors || []).some((x) => clean(x).toLowerCase() === c));
      const has = ranked.filter((p) => carries(g[p.style.toUpperCase()], r.color)?.ok);
      if (listed) { pick[r.id] = listed; w[r.id] = `their usual on the ${listed.style}`; }
      else if (has.length === 1) { pick[r.id] = has[0]; w[r.id] = `only the ${has[0].style} comes in it`; }
      else if (has.length > 1) { pick[r.id] = has[0]; w[r.id] = `their ${has[0].rank === 1 ? "1st" : "next"} choice that comes in it`; }
      else if (ranked[0]) { pick[r.id] = ranked[0]; w[r.id] = r.color ? `none of theirs comes in ${clean(r.color)}: check it` : "their 1st choice"; }
    }
    const styles = new Set(runs.map((r) => pick[r.id]?.style || ""));
    setWhy(w);
    if (styles.size === 1 && runs[0] && pick[runs[0].id]) { setSame(true); setOne(toPick(pick[runs[0].id])); }
    else { setSame(false); setEach(Object.fromEntries(runs.map((r) => [r.id, toPick(pick[r.id])]))); }
  }
  const picks: Record<string, RunPick | null> = same ? Object.fromEntries(runs.map((r) => [r.id, one])) : each;
  const ready = runs.every((r) => picks[r.id]);
  const misses = same && one ? runs.filter((r) => carries(known(one.style), r.color)?.ok === false) : [];

  return (
    <div className="ap sra" role="group" aria-label="Which garment">
      <p className="ap-q">{runs.length > 1 ? `We found ${runs.length} size runs in ${sender ? `${sender}'s` : "the"} email.` : "The email doesn't say which garment."}</p>
      {prefs.length > 0 && (
        <div className={"sra-bs" + (applied === false ? " off" : "")}>
          <b>We found {company}&apos;s brand standards.</b>
          <span>{[...new Set(ranked.map((p) => p.kind))].map((k) => `${k}: ${ranked.filter((p) => p.kind === k).map((p) => `${[p.brand, p.style].filter(Boolean).join(" ")} (${p.rank === 1 ? "1st" : p.rank === 2 ? "2nd" : `${p.rank}th`})`).join(", ")}`).join(" · ")}. Apply them to this email?</span>
          <span className="sra-yn" role="radiogroup" aria-label="Apply their brand standards?">
            <button type="button" role="radio" aria-checked={applied === true} className={applied === true ? "on" : ""} onClick={() => void apply(true)}>Yes, apply</button>
            <button type="button" role="radio" aria-checked={applied === false} className={applied === false ? "on" : ""} onClick={() => void apply(false)}>No</button>
          </span>
        </div>
      )}
      {runs.length > 1 && (
        <div className="sra-tg">
          <b>All the same garment?</b>
          <span className="sra-sw" role="radiogroup" aria-label="All the same garment?">
            <button type="button" role="radio" aria-checked={same} className={same ? "on" : ""} onClick={() => setSame(true)}>Yes</button>
            <button type="button" role="radio" aria-checked={!same} className={!same ? "on" : ""} onClick={() => setSame(false)}>No</button>
          </span>
        </div>
      )}
      {same ? <>
        <StyleBox value={one} prefs={prefs} colors={runs.map((r) => r.color)} known={known} loadStyles={loadStyles} onPick={(p) => { setOne(p); setWhy({}); }} autoFocus={!one && !prefs.length} />
        <ul className="sra-list">{runs.map((r) => { const h = one ? carries(known(one.style), r.color) : null; return (
          <li key={r.id}><b>{[r.called && runs.some((x) => x.called !== r.called) ? r.called : "", r.color || "No color"].filter(Boolean).join(" · ")}</b><span>{sizesLine(r.sizes)}{r.pcs ? ` · ${r.pcs}` : ""}</span>{h && <em className={h.ok ? "ok" : "no"}>{h.ok ? (h.as ? `as ${h.as}` : "✓") : "not on it"}</em>}{why[r.id] && <i className="sra-why">{why[r.id]}</i>}</li>
        ); })}</ul>
        {misses.length > 0 && <p className="sra-warn">The {one!.style} doesn&apos;t come in {misses.map((r) => clean(r.color)).join(", ")}. Switch to No to pick another for {misses.length === 1 ? "it" : "them"}.</p>}
      </> : (
        <div className="sra-runs">{runs.map((r) => (
          <div key={r.id} className="sra-run">
            <div className="sra-rt"><b>{[r.called && runs.some((x) => x.called !== r.called) ? r.called : "", r.color || "No color"].filter(Boolean).join(" · ")}</b><span>{sizesLine(r.sizes)}</span></div>
            <StyleBox value={each[r.id]} prefs={prefs} colors={[r.color]} known={known} loadStyles={loadStyles} onPick={(p) => { setEach((x) => ({ ...x, [r.id]: p })); setWhy((x) => ({ ...x, [r.id]: "" })); }} />
            {why[r.id] && <i className="sra-why">{why[r.id]}</i>}
          </div>
        ))}</div>
      )}
      {ready && <label className="check sra-rem"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember for {company}: these colors on these garments (filled in next time, still asked)</label>}
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
        <button type="button" className="btn ghost" onClick={() => onDone(Object.fromEntries(runs.map((r) => [r.id, picks[r.id] || null])), false)} title="Runs with no garment are left out of the goods">{ready ? "Skip" : "Leave the rest"}</button>
        <button type="button" className="btn primary" disabled={!ready} onClick={() => onDone(picks, remember)}>Next</button></div>
    </div>
  );
}

/** type a style and pick it: their preferred goods first, then the catalog; each says whether it comes in the color(s) */
function StyleBox({ value, prefs, colors, known, loadStyles, onPick, autoFocus }: { value: RunPick | null; prefs: PreferredGood[]; colors: string[]; known: (s: string) => Gar | undefined; loadStyles: (s: string[]) => Promise<unknown>; onPick: (p: RunPick | null) => void; autoFocus?: boolean }) {
  const sb = useMemo(() => createClient(), []);
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), [hits, setHits] = useState<Gar[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const t = q.trim().toUpperCase().replace(/\s+/g, "");
    if (!t) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      const { data } = await sb.from("garments").select("style, brand, description, colors").ilike("style", `${t}%`).order("style").limit(6);
      setHits(((data || []) as Gar[]).map((g) => ({ ...g, colors: g.colors || [] })));
    }, 180);
  }, [q, sb]);
  const say = (g: Gar | undefined) => {
    if (!g) return "";
    const hs = colors.filter(Boolean).map((c) => ({ c, h: carries(g, c) }));
    const no = hs.filter((x) => x.h && !x.h.ok).map((x) => clean(x.c));
    if (no.length) return `no ${no.join(", ")}`;
    return hs.some((x) => x.h?.ok) ? "✓ has it" : "";
  };
  const opts: { key: string; style: string; brand: string; name: string; tag: string; g?: Gar }[] = [
    ...prefs.filter((p) => !q.trim() || p.style.toUpperCase().startsWith(q.trim().toUpperCase().replace(/\s+/g, ""))).map((p) => ({ key: "p" + p.id, style: p.style, brand: p.brand, name: p.name, tag: p.rank === 1 ? "their 1st" : p.rank === 2 ? "their 2nd" : "theirs", g: known(p.style) })),
    ...hits.filter((h) => !prefs.some((p) => p.style.toUpperCase() === h.style.toUpperCase())).map((h) => ({ key: "g" + h.style, style: h.style, brand: h.brand, name: h.description, tag: "", g: h })),
  ];
  async function lookUp() {
    const st = q.trim().toUpperCase().replace(/\s+/g, "");
    if (!st) return;
    if (opts[0]) { choose(opts[0]); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/ss/lookup?style=${encodeURIComponent(st)}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.garment) { await loadStyles([j.garment.style]); choose({ style: j.garment.style, brand: j.garment.brand || "", name: j.garment.description || "" }); }
      else setErr(`Couldn't find ${st} at S&S or SanMar.`);
    } finally { setBusy(false); }
  }
  const choose = (o: { style: string; brand: string; name: string; g?: Gar }) => { if (o.g) void loadStyles([o.style]); onPick({ style: o.style, brand: o.brand, name: o.name }); setQ(""); setOpen(false); setErr(""); };
  const cur = value ? say(known(value.style)) : "";
  return (
    <div className="sra-box">
      {value && !open
        ? <button type="button" className="sra-val" onClick={() => { setOpen(true); setQ(""); }} aria-label={`Garment: ${value.style}. Change it`}>
            <b>{value.style}</b><span>{[value.brand, value.name].filter(Boolean).join(" ")}</span>{cur && <em className={cur.startsWith("no") ? "no" : "ok"}>{cur}</em>}
          </button>
        : <input className="sra-in" autoFocus={autoFocus || open} value={q} placeholder="Type a style: 6210, 3001CVC…" inputMode="text" autoCapitalize="characters" aria-label="Garment style"
            onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookUp(); } if (e.key === "Escape") setOpen(false); }}
            onBlur={() => setTimeout(() => setOpen(false), 200)} />}
      {open && (opts.length > 0 || q.trim()) && (
        <div className="sra-menu" role="listbox">
          {opts.map((o) => { const s = say(o.g); return (
            <button key={o.key} type="button" role="option" aria-selected={value?.style === o.style} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
              <span><b>{o.style}</b> {o.brand}{o.tag ? <small> · {o.tag}</small> : null}</span>{s && <em className={s.startsWith("no") ? "no" : "ok"}>{s}</em>}
            </button>
          ); })}
          {q.trim() && !opts.length && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void lookUp()}><span>{busy ? "Looking it up…" : <>Look up <b>{q.trim().toUpperCase()}</b> at S&amp;S / SanMar</>}</span></button>}
        </div>
      )}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}
