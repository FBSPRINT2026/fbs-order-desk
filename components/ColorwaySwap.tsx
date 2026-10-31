"use client";
import { useEffect, useState } from "react";
import { colorwaysOf, cwLetter, printColorway, type Colorway } from "@/lib/brands";
import { printArtUrl } from "@/lib/designs";
import { isLightArtUrl } from "@/lib/lightArt";
import type { Design, Imprint } from "@/lib/pricing";

/**
 * THE colorway picker for a print (Oct 31, Nick: "collapse that and then have a small button that says change
 * colorway… by default it'll just say colorway A, B, C or D… then right to the right of it… swap… it sends them out
 * again so that you can see them and pick the next one… and then goes back down to just D").
 *
 * One line under the print's threads or inks: the colorway's little picture, its letter and name, and the layout it's
 * from (M-1240-B) when the group is a saved mockup. Swap opens every colorway of the logo, each with its picture; picking
 * one closes it again. Shown only for a logo with two or more colorways. Picking is the caller's: it applies the
 * colorway to the print (lib/brands.ts applyColorway), which sets its inks or threads, sew file and picture.
 */
export default function ColorwaySwap({ d, im, urls, mockupNo, disabled, onPick, also }: {
  d: Pick<Design, "id" | "specs">; im: Pick<Imprint, "colorway" | "inks" | "emb">; urls: Record<string, string>;
  /** the saved mockup the group is made from (M-1240), for the line's "M-1240-B" */ mockupNo?: number | null;
  disabled?: boolean; onPick: (cw: Colorway) => void;
  /** a colorway change's other colorways, after this one ("Group B: A Maroon / Black") */ also?: string;
}) {
  const cws = colorwaysOf(d);
  const cur = printColorway(im, d);
  const [open, setOpen] = useState(false);
  // each colorway's picture on the backdrop it needs (a white logo on charcoal)
  const pics = cws.map((c) => printArtUrl(urls, d.id, { colorway: c.name }));
  const [dark, setDark] = useState<boolean[]>([]);
  const key = pics.join("|");
  useEffect(() => { let on = true; void Promise.all(pics.map((u) => isLightArtUrl(u))).then((v) => { if (on) setDark(v); }); return () => { on = false; }; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (cws.length < 2) return null;
  const at = cur ? cws.findIndex((c) => c.name === cur.name) : -1;
  const pic = (i: number, big = false) => (
    <span className={"cws-pic" + (big ? " big" : "") + (dark[i] ? " dk" : "")}>{pics[i] ? <img src={pics[i]} alt="" /> : <span className="cws-ink">{cws[i].inks.join(", ")}</span>}</span>
  );
  const L = cur ? cwLetter(d, cur) : "";
  return (
    <div className="cws">
      <div className="pr-scr cws-line">
        <span className="pr-scr-l">Colorway</span>
        <span className="pr-scr-v cws-now">
          {cur ? <>{pic(at)}<b className="cws-l">{L}</b><span className="cws-n">{cur.name}</span>{mockupNo ? <span className="cws-m">· M-{mockupNo}-{L}</span> : null}{also ? <span className="cws-m">· {also}</span> : null}</>
            : <span className="cws-n faint">Not one of its colorways</span>}
          {!disabled && (
            <button type="button" className={"cws-swap" + (open ? " on" : "")} aria-expanded={open} title="Change colorway" onClick={() => setOpen((x) => !x)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l4 4-4 4" /><path d="M3 7h18" /><path d="M7 21l-4-4 4-4" /><path d="M21 17H3" /></svg>Swap
            </button>
          )}
        </span>
      </div>
      {open && !disabled && (
        <div className="cws-opts" role="group" aria-label="Colorways">
          {cws.map((c, i) => (
            <button key={c.name} type="button" className={"cws-opt" + (i === at ? " on" : "")} aria-pressed={i === at} title={c.inks.join(", ")}
              onClick={() => { setOpen(false); if (i !== at) onPick(c); }}>
              {pic(i, true)}
              <span className="cws-on"><b>{String.fromCharCode(65 + i)}</b><span>{c.name}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
