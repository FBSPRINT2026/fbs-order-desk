"use client";
import { useState } from "react";
import type { GLine, Imprint } from "@/lib/pricing";
import { guessHex, lineColor } from "@/lib/mockup";
import { threadByName } from "@/lib/embroidery";
import { colorHex } from "@/lib/inkColors";
import { InkSelect, ThreadSelect } from "@/components/InkSelect";
import { inkKeyOf } from "@/lib/inkBy";

/**
 * Color change on a print (Oct 27, Nick on #40192's ShipStation polos: "you click a color change button and you go, okay,
 * what are we doing? Change the navy to white. And then… which ones are navy? And you check them… then you check the
 * ones that are white… colors against the colors… garment"). Each version of the print is a column (A = as it is, B =
 * one ink or thread changed to another), each garment color a row with a tick under its version. Saved as the print's
 * Imprint.inkBy (garment color → the ink it changes); the group's lines are then grouped by version.
 */
/** a version of a print: one ink changed to another, or (a colorway change, `cw`) the print's colorway → another colorway */
export type Ver = { from: string; to: string; cw?: boolean };
const ck = (c: string) => (c || "").trim().toLowerCase();
const swatch = (name: string) => threadByName(name)?.hex || colorHex(name) || (/white/i.test(name) ? "#FFFFFF" : /black/i.test(name) ? "#111111" : "#9aa1ab");

/**
 * the versions on a print now: A as it is, then each different change its inkBy has. A colorway change (Imprint.colorwayBy)
 * is a version per colorway, named by it ("Maroon / Off White"), however many of its inks change.
 */
/** every ink a garment color changes, in the print's ink order, as one version: from "652, 1645, Bora Bora Sand" to
 *  "6113, 7512, 5777" (Nov 9, Nick: a 3-color back's version only named its first ink, so B read "Full Back: 6113") */
function changeOn(im: Imprint, m: Record<string, string> | undefined) {
  const ent = Object.entries(m || {}).filter(([a, b]) => b && ck(a) !== ck(b));
  if (!ent.length) return null;
  const order = (im.inks || "").split(/\s*,\s*/).filter(Boolean).map(ck);
  const at = (a: string) => { const i = order.indexOf(ck(a)); return i < 0 ? 99 : i; };
  ent.sort((x, y) => at(x[0]) - at(y[0]));
  return { from: ent.map(([a]) => a).join(", "), to: ent.map(([, b]) => b.trim()).join(", ") };
}
export function versionsOf(im: Imprint): Ver[] {
  const out: Ver[] = [];
  if (im.colorwayBy && Object.keys(im.colorwayBy).length) {
    for (const name of Object.values(im.colorwayBy)) if (!out.some((x) => ck(x.to) === ck(name))) out.push({ from: im.colorway || "as printed", to: name, cw: true });
    return out;
  }
  for (const m of Object.values(im.inkBy || {})) {
    const v = changeOn(im, m);
    if (!v) continue;
    if (!out.some((x) => ck(x.from) === ck(v.from) && ck(x.to) === ck(v.to))) out.push(v);
  }
  return out;
}
/** which version (0 = as printed, 1… = a change) a garment color gets on this print */
export function versionOfColor(im: Imprint, color: string, vers = versionsOf(im)): number {
  if (vers.some((v) => v.cw)) {
    const name = Object.entries(im.colorwayBy || {}).find(([k]) => ck(k) === ck(color))?.[1];
    return name ? vers.findIndex((v) => ck(v.to) === ck(name)) + 1 : 0;
  }
  const m =Object.entries(im.inkBy || {}).find(([k]) => ck(k) === ck(color))?.[1];
  if (!m) return 0;
  const c = changeOn(im, m);
  if (!c) return 0;
  const i = vers.findIndex((v) => ck(v.from) === ck(c.from) && ck(v.to) === ck(c.to));
  return i < 0 ? 0 : i + 1;
}

export default function ColorChange({ im, lines, onSave, onClose }: { im: Imprint; lines: GLine[]; onSave: (inkBy: Imprint["inkBy"]) => void; onClose: () => void }) {
  const inks = (im.inks || "").split(/\s*,\s*/).filter(Boolean);
  // one row per ink key: a garment color, or its own colorway's lines of it (GLine.cw, lib/inkBy.ts inkKeyOf)
  const ik = (l: GLine) => ck(inkKeyOf(l));
  const colors = [...new Map(lines.filter((l) => (l.color || "").trim()).map((l) => [ik(l), l])).values()];
  const [vers, setVers] = useState<Ver[]>(() => { const v = versionsOf(im); return v.length ? v : [{ from: inks[0] || "", to: "" }]; });
  const [pick, setPick] = useState<Record<string, number>>(() => Object.fromEntries(colors.map((l) => [ik(l), versionOfColor(im, inkKeyOf(l))])));
  const thread = im.method === "embroidery";
  const word = thread ? "thread" : "ink";
  const ok = vers.every((v) => v.from.trim() && v.to.trim());

  function save() {
    const inkBy: NonNullable<Imprint["inkBy"]> = {};
    for (const l of colors) {
      const k = pick[ik(l)] || 0, v = vers[k - 1];
      if (k && v && v.from.trim() && v.to.trim()) inkBy[ik(l)] = { [v.from.trim()]: v.to.trim() };
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
                to
                <span className="cc-pick">{thread
                  ? <ThreadSelect value={v.to} suggest={inks} line={im.emb?.line || "Polyneon 40"} onChange={(name) => setVers(vers.map((x, j) => (j === i ? { ...x, to: name } : x)))} />
                  : <InkSelect value={v.to ? { name: v.to, hex: swatch(v.to) } : undefined} onChange={(o) => { if (o && o.name && o.name !== "none") setVers(vers.map((x, j) => (j === i ? { ...x, to: o.name } : x))); }} />}</span>
              </span>
              {vers.length > 1 && <button type="button" className="linkbtn" onClick={() => { setVers(vers.filter((_, j) => j !== i)); setPick(Object.fromEntries((Object.entries(pick) as [string, number][]).map(([k, n]) => [k, n === i + 1 ? 0 : n > i + 1 ? n - 1 : n]))); }}>Remove</button>}
            </div>
          ))}
          <button type="button" className="linkbtn cc-more" onClick={() => setVers([...vers, { from: inks[0] || "", to: "" }])}>+ Another change</button>
        </div>
        {/* garments against the versions: one tick per garment color */}
        <div className="tbl-wrap"><table className="tbl cc-tbl">
          <thead><tr><th>Garment</th><th>A · as printed</th>{vers.map((v, i) => <th key={i}>{String.fromCharCode(66 + i)} · {v.to || "…"}</th>)}</tr></thead>
          <tbody>{colors.map((l) => { const k = ik(l), on = pick[k] || 0; const n = lines.filter((x) => ik(x) === k).length; return (
            <tr key={k}>
              <td><span className="cc-g"><i style={{ background: guessHex(lineColor(l)) }} /><b>{l.color}</b>{l.cw && <span className="faint">its own colorway</span>}{n > 1 ? <span className="faint">{n} styles</span> : <span className="faint">{l.style}</span>}</span></td>
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
