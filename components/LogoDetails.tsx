"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Design } from "@/lib/pricing";
import { InkSelect, ThreadSelect } from "@/components/InkSelect";

/**
 * "Tell us about this logo" (Oct 28, Nick: "a pop-up questionnaire… give me more details about this logo. Okay, it prints
 * in white, it prints in PMS 452, and then it also has this thread, 1973 or white. Do I want to specify a sleeve? No…
 * but you got to make it loose"). Every question can be left blank: nothing is guessed, so a logo never shows a size or
 * a color it never had. Saved on the logo: inks (designs.inks + colors, and specs.inkList with their colors), threads
 * (specs.threads), where it goes (specs.where) and a print size only when one is typed (specs.printSize).
 */
export type Swatch = { name: string; hex: string };
type Specs = { inkList?: Swatch[]; threads?: Swatch[]; where?: string; printSize?: { wIn?: number; hIn?: number; location?: string } };
const PLACES = ["Left Chest", "Right Chest", "Center Chest", "Full Front", "Full Back", "Upper Back", "Nape", "Left Sleeve", "Right Sleeve", "Hat Front", "Hat Side", "Pocket"];

export function logoSpecs(d: Design): Specs { return (d.specs || {}) as Specs; }

export default function LogoDetails({ d, onClose, onSaved }: { d: Design; onClose: () => void; onSaved: (d: Design) => void }) {
  const sb = useMemo(() => createClient(), []);
  const sp = logoSpecs(d);
  const [inks, setInks] = useState<Swatch[]>(sp.inkList?.length ? sp.inkList : (d.inks || "").split(/\s*,\s*/).filter(Boolean).map((name) => ({ name, hex: "" })));
  const [threads, setThreads] = useState<Swatch[]>(sp.threads || []);
  const [where, setWhere] = useState(sp.where || sp.printSize?.location || "");
  const [wIn, setWIn] = useState(sp.printSize?.wIn ? String(sp.printSize.wIn) : "");
  const [hIn, setHIn] = useState(sp.printSize?.hIn ? String(sp.printSize.hIn) : "");
  const [inkKey, setInkKey] = useState(0), [thKey, setThKey] = useState(0);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const ratio = d.width_px && d.height_px ? d.height_px / d.width_px : 0;
  const add = (list: Swatch[], v: Swatch) => (list.some((x) => x.name.toLowerCase() === v.name.toLowerCase()) ? list : [...list, v]);

  async function save() {
    setBusy(true); setErr("");
    const w = +wIn > 0 ? +wIn : 0, h = +hIn > 0 ? +hIn : 0;
    const next: Record<string, unknown> = { ...((d.specs || {}) as object), inkList: inks.length ? inks : undefined, threads: threads.length ? threads : undefined, where: where.trim() || undefined,
      printSize: w ? { wIn: w, ...(h ? { hIn: h } : {}), ...(where.trim() ? { location: where.trim() } : {}) } : undefined };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const patch = { specs: next, ...(inks.length ? { inks: inks.map((i) => i.name).join(", "), colors: inks.length } : {}) };
    const { data, error } = await sb.from("designs").update(patch).eq("id", d.id).select("*").single();
    setBusy(false);
    if (error) return setErr(error.message);
    onSaved(data as Design);
  }

  const chips = (list: Swatch[], set: (l: Swatch[]) => void, label: string) => list.length > 0 && (
    <div className="ld-chips">{list.map((c) => <span key={c.name} className="ld-chip">{c.hex ? <i style={{ background: c.hex }} /> : null}{c.name}<button type="button" aria-label={`Take ${c.name} off the ${label}`} onClick={() => set(list.filter((x) => x !== c))}>×</button></span>)}</div>
  );

  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Logo details" onClick={onClose}>
      <div className="dla ld" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={onClose}>×</button>
        <h3>Tell us about D-{d.number} {d.name}</h3>
        <p className="dla-sub">Answer what you know and skip the rest. Nothing here is guessed.</p>
        <div className="ld-q">
          <div className="ld-k">What does it print in?<span className="faint">Inks and PMS: white, PMS 452…</span></div>
          {chips(inks, setInks, "inks")}
          <InkSelect key={inkKey} onChange={(v) => { if (v && v.name !== "none") setInks((l) => add(l, v)); setInkKey((k) => k + 1); }} />
        </div>
        <div className="ld-q">
          <div className="ld-k">What thread does it sew in?<span className="faint">1973, white…</span></div>
          {chips(threads, setThreads, "threads")}
          <ThreadSelect key={thKey} value="" line="Polyneon 40" onChange={(name, hex) => { setThreads((l) => add(l, { name, hex })); setThKey((k) => k + 1); }} />
        </div>
        <div className="ld-q">
          <div className="ld-k">Where does it go?<span className="faint">Optional: leave blank if it goes anywhere</span></div>
          <input type="text" list="ld-places" value={where} placeholder="Not set" onChange={(e) => setWhere(e.target.value)} />
          <datalist id="ld-places">{PLACES.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div className="ld-q">
          <div className="ld-k">Does it print at a set size?<span className="faint">Optional: only when it always prints this size</span></div>
          <div className="ld-size">
            <label><span>Width, in</span><input type="number" min="0.25" step="0.25" value={wIn} placeholder="Not set" onChange={(e) => { setWIn(e.target.value); if (ratio && +e.target.value > 0) setHIn(String(Math.round(+e.target.value * ratio * 100) / 100)); if (!e.target.value) setHIn(""); }} /></label>
            <span className="faint">×</span>
            <label><span>Height, in</span><input type="number" min="0.25" step="0.25" value={hIn} placeholder="Not set" onChange={(e) => setHIn(e.target.value)} /></label>
            {wIn && <button type="button" className="linkbtn" onClick={() => { setWIn(""); setHIn(""); }}>No set size</button>}
          </div>
        </div>
        {err && <p className="warnline">{err}</p>}
        <div className="dla-acts"><button type="button" className="btn" onClick={onClose}>Cancel</button><span className="spacer" /><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save details"}</button></div>
      </div>
    </div>
  );
}
