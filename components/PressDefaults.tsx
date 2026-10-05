"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PressLayout from "@/components/PressLayout";
import { defaultLayout, flashesOf, layoutCounts, type Machine, type Station } from "@/lib/production";

/** a press as it normally sits: its saved layout, or the usual one */
export const pressLayOf = (m: Machine): Station[] => m.layout ? [...m.layout] : defaultLayout(m.issue?.full ?? m.colors, m.issue?.fullFlashes ?? flashesOf(m));

const OPTS: [Station, string, string][] = [
  ["print", "Printing", "A free head for screens"],
  ["flash", "Flash", "A flash-cure unit always parked here"],
  ["roller", "Roller (dead screen)", "Rolls the print flat so the fibers don't show"],
];

/**
 * Press defaults (from the Separation Studio): what always sits on each head of a press: the flashes and the roller.
 * Every separation's press setup starts from this. It's the same layout as Production → Equipment Status (heads down
 * and flashes not heating are reported there).
 */
export default function PressDefaults({ presses, start, me, onClose, onSaved }: { presses: Machine[]; start?: string; me: string; onClose: () => void; onSaved: (m: Machine, lay: Station[]) => void }) {
  const [id, setId] = useState(start || presses[0]?.id || "");
  const m = presses.find((x) => x.id === id) || presses[0];
  const [lay, setLay] = useState<Station[]>(() => (m ? pressLayOf(m) : []));
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  if (!m) return null;
  const choose = (x: string) => { const n = presses.find((p) => p.id === x); if (n) { setId(x); setLay(pressLayOf(n)); setPick(null); } };
  const lc = layoutCounts(lay), heads = (k: Station) => lay.flatMap((s, i) => (s === k ? [i + 1] : [])).join(", ");
  async function save() {
    setBusy(true); setErr("");
    const sb = createClient();
    const r = await sb.from("production_equipment").upsert({ machine: m.id, stations: lay, updated_by: me, updated_at: new Date().toISOString() }, { onConflict: "machine" });
    if (r.error) { setErr(r.error.message); setBusy(false); return; }
    await sb.from("production_equipment_log").insert({ machine: m.id, note: "Press defaults (flashes / roller) from the Separation Studio", by: me, stations: lay });
    setBusy(false); onSaved(m, lay);
  }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet pd-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Press defaults">
        <div className="pp-sheet-h"><b>Press Defaults</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="pd-b">
          <p className="sep-help">What always sits on each head of this press. Every job&apos;s press setup starts from this; you can still change it for one job in its setup.</p>
          <select value={m.id} onChange={(e) => choose(e.target.value)} aria-label="Press">{presses.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <div className="pl-ed">
            <PressLayout layout={lay} mirror={!!m.mirror} selected={pick} onPick={(i) => setPick(pick === i ? null : i)} label={`${lay.length} heads`} sub={`${lc.units} flash${lc.units === 1 ? "" : "es"}${lc.rollers ? " + roller" : ""}`} />
            <div className="pl-side">
              <div className="pl-sum"><b>{m.name.split(" · ")[0]}</b><span>{lc.units ? `Flash${lc.units === 1 ? "" : "es"} on ${heads("flash") || heads("flashdown")}` : "No flashes"}{lc.rollers ? ` · roller on ${heads("roller")}` : ""}</span></div>
              {pick == null ? <div className="faint pl-hint">Tap a head to put a flash or the roller there.</div> : (
                <div className="pl-pick">
                  <div className="pl-pick-h">Head {pick + 1}</div>
                  {lay[pick] === "down" || lay[pick] === "flashdown"
                    ? <div className="faint" style={{ fontSize: 12.5 }}>{lay[pick] === "down" ? "This head is reported down" : "This flash is reported not heating"} (Production → Equipment Status).</div>
                    : OPTS.map(([k, l, t]) => <button key={k} type="button" title={t} className={"pl-opt " + k + (lay[pick] === k ? " on" : "")} onClick={() => setLay(lay.map((x, j) => (j === pick ? k : x)))}><i aria-hidden />{l}</button>)}
                </div>
              )}
              <div className="pl-key"><span><i className="print" />Printing</span><span><i className="flash" />Flash</span><span><i className="roller" />Roller</span><span><i className="down" />Down</span></div>
            </div>
          </div>
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Press Defaults"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
