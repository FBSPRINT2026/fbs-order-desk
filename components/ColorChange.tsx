"use client";
import { useState } from "react";
import type { GLine, Imprint } from "@/lib/pricing";
import { guessHex } from "@/lib/mockup";
import { threadByName } from "@/lib/embroidery";
import { colorHex } from "@/lib/inkColors";

/**
 * Color change on a print (Oct 27, Nick on #40192's ShipStation polos: "you click a color change button and you go, okay,
 * what are we doing? Change the navy to white. And then… which ones are navy? And you check them… then you check the
 * ones that are white… colors against the colors… garment"). Each version of the print is a column (A = as it is, B =
 * one ink or thread changed to another), each garment color a row with a tick under its version. Saved as the print's
 * Imprint.inkBy (garment color → the ink it changes); the group's lines are then grouped by version.
 */
type Ver = { from: string; to: string };
const ck = (c: string) => (c || "").trim().toLowerCase();
const swatch = (name: string) => threadByName(name)?.hex || colorHex(name) || (/white/i.test(name) ? "#FFFFFF" : /black/i.test(name) ? "#111111" : "#9aa1ab");

/** the versions on a print now: A as it is, then each different change (from → to) its inkBy has */
export function versionsOf(im: Imprint): Ver[] {
  const out: Ver[] = [];
  for (const m of Object.values(im.inkBy || {})) {
    const ent = Object.entries(m || {}).filter(([a, b]) => b && ck(a) !== ck(b));
    if (!ent.length) continue;
    const v = { from: ent[0][0], to: ent[0][1] };
    if (!out.some((x) => ck(x.from) === ck(v.from) && ck(x.to) === ck(v.to))) out.push(v);
  }
  return out;
}
/** which version (0 = as printed, 1… = a change) a garment color gets on this print */
export function versionOfColor(im: Imprint, color: string, vers = versionsOf(im)): number {
  const m = Object.entries(im.inkBy || {}).find(([k]) => ck(k) === ck(color))?.[1];
  if (!m) return 0;
  const ent = Object.entries(m).filter(([a, b]) => b && ck(a) !== ck(b));
  if (!ent.length) return 0;
  const i = vers.findIndex((v) => ck(v.from) === ck(ent[0][0]) && ck(v.to) === ck(ent[0][1]));
  return i < 0 ? 0 : i + 1;
}

export default function ColorChange({ im, lines, onSave, onClose }: { im: Imprint; lines: GLine[]; onSave: (inkBy: Imprint["inkBy"]) => void; onClose: () => void }) {
  const inks = (im.inks || "").split(/\s*,\s*/).filter(Boolean);
  const colors = [...new Map(lines.filter((l) => (l.color || "").trim()).map((l) => [ck(l.color), l])).values()];
  const [vers, setVers] = useState<Ver[]>(() => { const v = versionsOf(im); return v.length ? v : [{ from: inks[0] || "", to: "" }]; });
  const [pick, setPick] = useState<Record<string, number>>(() => Object.fromEntries(colors.map((l) => [ck(l.color), versionOfColor(im, l.color)])));
  const thread = im.method === "embroidery";
  const word = thread ? "thread" : "ink";
  const ok = vers.every((v) => v.from.trim() && v.to.trim());

  function save() {
    const inkBy: NonNullable<Imprint["inkBy"]> = {};
    for (const l of colors) {
      const k = pick[ck(l.color)] || 0, v = vers[k - 1];
      if (k && v && v.from.trim() && v.to.trim()) inkBy[ck(l.color)] = { [v.from.trim()]: v.to.trim() };
    }
    onSave(Object.keys(inkBy).length ? inkBy : undefined);
  }

  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Color change" onClick={onClose}>
      <div className="dla cc" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={onClose}>×</button>
        <h3>Color change · {im.location}</h3>
        <p className="dla-sub">Say what changes, then tick which garments get it. The rest stay as printed.</p>
        <div className="cc-vers">
          <div className="cc-v"><span className="cc-tag">A</span><span className="cc-sw" style={{ background: swatch(inks[0] || "") }} /><b>{inks.join(", ") || `As printed`}</b><span className="faint">as printed</span></div>
          {vers.map((v, i) => (
            <div key={i} className="cc-v">
              <span className="cc-tag">{String.fromCharCode(66 + i)}</span>
              <span className="cc-chg">Change
                {inks.length > 1 ? <select aria-label={`The ${word} that changes`} value={v.from} onChange={(e) => setVers(vers.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}>{inks.map((n) => <option key={n}>{n}</option>)}</select> : <b>{v.from || inks[0]}</b>}
                to <span className="cc-sw" style={{ background: swatch(v.to) }} />
                <input type="text" value={v.to} autoFocus={!v.to} placeholder={thread ? "Madeira 1801 Super White" : "White"} aria-label={`The new ${word}`} onChange={(e) => setVers(vers.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
              </span>
              {vers.length > 1 && <button type="button" className="linkbtn" onClick={() => { setVers(vers.filter((_, j) => j !== i)); setPick(Object.fromEntries((Object.entries(pick) as [string, number][]).map(([k, n]) => [k, n === i + 1 ? 0 : n > i + 1 ? n - 1 : n]))); }}>Remove</button>}
            </div>
          ))}
          <button type="button" className="linkbtn cc-more" onClick={() => setVers([...vers, { from: inks[0] || "", to: "" }])}>+ Another change</button>
        </div>
        {/* garments against the versions: one tick per garment color */}
        <div className="tbl-wrap"><table className="tbl cc-tbl">
          <thead><tr><th>Garment</th><th>A · as printed</th>{vers.map((v, i) => <th key={i}>{String.fromCharCode(66 + i)} · {v.to || "…"}</th>)}</tr></thead>
          <tbody>{colors.map((l) => { const k = ck(l.color), on = pick[k] || 0; const n = lines.filter((x) => ck(x.color) === k).length; return (
            <tr key={k}>
              <td><span className="cc-g"><i style={{ background: guessHex(l.color) }} /><b>{l.color}</b>{n > 1 ? <span className="faint">{n} styles</span> : <span className="faint">{l.style}</span>}</span></td>
              {[0, ...vers.map((_, i) => i + 1)].map((vi) => (
                <td key={vi}><label className="cc-tick"><input type="radio" name={`cc-${k}`} checked={on === vi} onChange={() => setPick({ ...pick, [k]: vi })} aria-label={`${l.color}: ${vi ? `change ${String.fromCharCode(65 + vi)}` : "as printed"}`} /></label></td>
              ))}
            </tr>
          ); })}</tbody>
        </table></div>
        <div className="dla-acts">
          {versionsOf(im).length > 0 && <button type="button" className="btn ghost danger" onClick={() => onSave(undefined)}>No color change</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!ok} title={ok ? undefined : `Say what each change goes to`} onClick={save}>Save color change</button>
        </div>
      </div>
    </div>
  );
}
