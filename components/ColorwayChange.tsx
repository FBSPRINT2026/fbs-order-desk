"use client";
import { useEffect, useState } from "react";
import { colorwayOnColor, colorwaysOf, printColorway } from "@/lib/brands";
import { printArtUrl } from "@/lib/designs";
import { isLightArtUrl } from "@/lib/lightArt";
import { lineQty, type Design, type GLine, type Imprint } from "@/lib/pricing";

/**
 * Colorway change on a print (Oct 31, Nick: "just like color change or location change, we need to do colorway…
 * CT106678 gets colorway B, and then the charcoal gets colorway A… you select which ones get which colorway"). Built like
 * the location change pop-up: one row per garment color, one column per colorway of the logo (its picture, letter and
 * name); each garment color ticks the colorway it gets. The print's own colorway is where everything starts.
 */
export default function ColorwayChange({ im, d, lines, urls, onClose, onSave }: {
  im: Imprint; d: Pick<Design, "id" | "specs">; lines: GLine[]; urls: Record<string, string>;
  onClose: () => void; onSave: (byColor: Record<string, string>) => void;
}) {
  const cws = colorwaysOf(d);
  const base = printColorway(im, d);
  const ck = (c: string) => (c || "").trim().toLowerCase();
  // one row per garment color (its styles and pieces under it)
  const colors = [...new Map(lines.filter((l) => (l.color || "").trim() && lineQty(l) > 0).map((l) => [ck(l.color), l.color.trim()])).entries()];
  const [pick, setPick] = useState<Record<string, string>>(() => Object.fromEntries(colors.map(([k, c]) => [k, colorwayOnColor(im, d, c)?.name || base?.name || ""])));
  const changed = colors.some(([k]) => pick[k] && base && pick[k] !== base.name) || Object.keys(im.colorwayBy || {}).length > 0;
  // each colorway's picture on the backdrop it needs (a white logo on charcoal), as in the Swap list
  const pics = cws.map((c) => printArtUrl(urls, d.id, { colorway: c.name }));
  const [dark, setDark] = useState<boolean[]>([]);
  useEffect(() => { let on = true; void Promise.all(pics.map((u) => isLightArtUrl(u))).then((v) => { if (on) setDark(v); }); return () => { on = false; }; }, [pics.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Colorway change" onClick={onClose}>
      <div className="dla cc cwc" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={onClose}>×</button>
        <h3>Colorway change · {im.location}</h3>
        <p className="dla-sub">Same logo, a different colorway on some garments. Tick the colorway each garment color gets; the print is {base ? `${String.fromCharCode(65 + cws.findIndex((c) => c.name === base.name))} ${base.name}` : "not one of its colorways yet (Swap first)"}.</p>
        <div className="tbl-wrap"><table className="tbl cc-tbl cwc-tbl">
          <thead><tr><th>Garment</th>{cws.map((c, i) => (
            <th key={c.name} className="cwc-h"><span className="cwc-col"><span className={"cwc-pic" + (dark[i] ? " dk" : "")}>{pics[i] ? <img src={pics[i]} alt="" /> : null}</span><b>{String.fromCharCode(65 + i)}</b><span className="cwc-n">{c.name}</span></span></th>
          ))}</tr></thead>
          <tbody>{colors.map(([k, c]) => {
            const ls = lines.filter((l) => ck(l.color) === k), n = ls.reduce((a, l) => a + lineQty(l), 0);
            return (
              <tr key={k}>
                <td><span className="cwc-g"><b>{[...new Set(ls.map((l) => l.style).filter(Boolean))].join(", ") || "Garment"}</b><span className="faint">{c} · {n} pc{n === 1 ? "" : "s"}</span></span></td>
                {cws.map((cw) => <td key={cw.name} className="cwc-c"><label className="cc-tick"><input type="radio" name={`cw-${k}`} checked={pick[k] === cw.name} disabled={!base} onChange={() => setPick({ ...pick, [k]: cw.name })} aria-label={`${c}: ${cw.name}`} /></label></td>)}
              </tr>
            );
          })}</tbody>
        </table></div>
        <div className="dla-acts">
          {im.colorwayBy && Object.keys(im.colorwayBy).length > 0 && <button type="button" className="btn ghost danger" onClick={() => onSave({})}>No colorway change</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!base || !changed} title={!base ? "Swap the print to one of its colorways first" : changed ? undefined : "Tick another colorway for a garment color"} onClick={() => onSave(Object.fromEntries(colors.map(([k, c]) => [c, pick[k]])))}>Save colorway change</button>
        </div>
      </div>
    </div>
  );
}
