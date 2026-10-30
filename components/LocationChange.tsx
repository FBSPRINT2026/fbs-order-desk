"use client";
import { useState } from "react";
import { BEANIE_LOCATIONS, HAT_LOCATIONS, LOCATIONS, lineQty, locationsFor, type GLine, type Imprint } from "@/lib/pricing";
import { spotKey, spotOf, spotsOf } from "@/lib/spotChange";

/**
 * Location change on an embroidery print (Oct 30, Nick: "the same indicator exactly how you do a color change… A, left
 * chest… a little swap symbol… instead of color change, location change… beanie cuff, that's number two"). Built like
 * the color change pop-up: A is where the print sews, B, C… other spots; each garment ticks the spot it sews on. Same
 * logo, same file, one digitizing charge.
 */
export default function LocationChange({ im, lines, onClose, onSave }: { im: Imprint; lines: GLine[]; onClose: () => void; onSave: (spotBy: Record<string, string> | undefined) => void }) {
  // one row per garment kind (its style): the spot is per garment, whatever its color
  const kinds = lines.filter((l, i) => lineQty(l) > 0 && lines.findIndex((x) => spotKey(x) === spotKey(l)) === i);
  const [spots, setSpots] = useState<string[]>(() => { const s = spotsOf(im, lines).slice(1); return s.length ? s : [""]; });
  const [pick, setPick] = useState<Record<string, number>>(() => Object.fromEntries(kinds.map((l) => { const s = spotOf(im, l); const i = spotsOf(im, lines).indexOf(s); return [spotKey(l), i > 0 ? i : 0]; })));
  // a hat or beanie picked for a change gets its own spot first (beanie → Cuff, cap → Full Front)
  const suggest = [...new Set([...BEANIE_LOCATIONS, ...HAT_LOCATIONS, ...LOCATIONS, "Left Upper Arm", "Right Upper Arm", "Left Leg", "Right Leg"])];
  const ok = spots.every((s) => s.trim()) && Object.values(pick).some((v) => v > 0);
  const save = () => {
    const out: Record<string, string> = {};
    for (const l of kinds) { const v = pick[spotKey(l)] || 0; if (v > 0 && spots[v - 1]?.trim() && spots[v - 1].trim() !== im.location) out[spotKey(l)] = spots[v - 1].trim(); }
    onSave(Object.keys(out).length ? out : undefined);
  };
  const setPickFor = (l: GLine, vi: number) => {
    setPick({ ...pick, [spotKey(l)]: vi });
    // the spot box still empty: the garment's own spot (a beanie's cuff) goes in it
    if (vi > 0 && !spots[vi - 1]?.trim()) { const own = locationsFor([l])[0]; if (own && own !== im.location) setSpots(spots.map((s, j) => (j === vi - 1 ? own : s))); }
  };
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Location change" onClick={onClose}>
      <div className="dla cc" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={onClose}>×</button>
        <h3>Location change · {im.location}</h3>
        <p className="dla-sub">Same logo, same sew file, sewn somewhere else on some garments. Say the spot, then tick which garments sew there. The rest stay at {im.location}.</p>
        <div className="cc-vers">
          <div className="cc-v"><span className="cc-tag">A</span><b>{im.location}</b><span className="faint">as set on the print</span></div>
          {spots.map((s, i) => (
            <div key={i} className="cc-v">
              <span className="cc-tag">{String.fromCharCode(66 + i)}</span>
              <span className="cc-chg">Sews on
                <input type="text" list="lc-spots" aria-label={`Spot ${String.fromCharCode(66 + i)}`} value={s} placeholder="Cuff, Left Sleeve…" onChange={(e) => setSpots(spots.map((x, j) => (j === i ? e.target.value : x)))} />
              </span>
              {spots.length > 1 && <button type="button" className="linkbtn" onClick={() => { setSpots(spots.filter((_, j) => j !== i)); setPick(Object.fromEntries(Object.entries(pick).map(([k, n]) => [k, n === i + 1 ? 0 : n > i + 1 ? n - 1 : n]))); }}>Remove</button>}
            </div>
          ))}
          <datalist id="lc-spots">{suggest.map((x) => <option key={x} value={x} />)}</datalist>
          <button type="button" className="linkbtn cc-more" onClick={() => setSpots([...spots, ""])}>+ Another spot</button>
        </div>
        <div className="tbl-wrap"><table className="tbl cc-tbl">
          <thead><tr><th>Garment</th><th>A · {im.location}</th>{spots.map((s, i) => <th key={i}>{String.fromCharCode(66 + i)} · {s || "…"}</th>)}</tr></thead>
          <tbody>{kinds.map((l) => { const k = spotKey(l), on = pick[k] || 0; const n = lines.filter((x) => spotKey(x) === k).reduce((a, x) => a + lineQty(x), 0); return (
            <tr key={k}>
              <td><span className="cc-g"><b>{l.style || l.garment || "Garment"}</b><span className="faint">{[...new Set(lines.filter((x) => spotKey(x) === k).map((x) => x.color))].join(", ")} · {n} pcs</span></span></td>
              {[0, ...spots.map((_, i) => i + 1)].map((vi) => (
                <td key={vi}><label className="cc-tick"><input type="radio" name={`lc-${k}`} checked={on === vi} onChange={() => setPickFor(l, vi)} aria-label={`${l.style}: ${vi ? spots[vi - 1] || `spot ${String.fromCharCode(65 + vi)}` : im.location}`} /></label></td>
              ))}
            </tr>
          ); })}</tbody>
        </table></div>
        <div className="dla-acts">
          {im.spotBy && Object.keys(im.spotBy).length > 0 && <button type="button" className="btn ghost danger" onClick={() => onSave(undefined)}>No location change</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!ok} title={ok ? undefined : "Say each spot and tick a garment for it"} onClick={save}>Save location change</button>
        </div>
      </div>
    </div>
  );
}
