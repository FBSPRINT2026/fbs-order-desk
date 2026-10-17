"use client";
import { useState } from "react";
import { colorHex } from "@/lib/inkColors";
import { guessHex, SHIRT_COLORS } from "@/lib/mockup";
import { INK_COLORS, type Design } from "@/lib/pricing";

/**
 * How a logo shows on each shirt color (Oct 16, Nick: "on a navy shirt show it as white, on a white shirt as navy, on a
 * gray shirt as navy… a portfolio of how their logos will look"). Saved on the logo as specs.onShirts; the Mockup
 * Creator prints a one-color logo in that ink on that shirt color.
 */
export type OnShirt = { shirt: string; ink: string };
export const onShirtsOf = (d: Pick<Design, "specs"> | null | undefined): OnShirt[] => ((d?.specs?.onShirts || []) as OnShirt[]).filter((x) => x.shirt && x.ink);
/** the ink for this logo on a shirt color, when one is set (by name, else the closest shirt color) */
export function inkOnShirt(d: Pick<Design, "specs"> | null | undefined, shirt: string): string | null {
  const list = onShirtsOf(d);
  if (!list.length || !shirt) return null;
  const s = shirt.toLowerCase().trim();
  return list.find((x) => x.shirt.toLowerCase() === s)?.ink || list.find((x) => s.includes(x.shirt.toLowerCase()) || x.shirt.toLowerCase().includes(s))?.ink || null;
}

/** one view: the logo in one ink on one shirt color (a mask of its picture, so any one-color logo recolors) */
export function ShirtView({ url, shirt, ink, size, title, className }: { url: string; shirt: string; ink: string; size?: number; title?: string; className?: string }) {
  const m = `url("${url}")`;
  return (
    <span className={"lv" + (className ? " " + className : "")} style={{ background: guessHex(shirt), ...(size ? { width: size, height: size } : {}) }} title={title || `${ink} on a ${shirt} shirt`}>
      <span className="lv-art" style={{ background: colorHex(ink) || ink, WebkitMaskImage: m, maskImage: m }} />
    </span>
  );
}

/** the editor on the logo page: shirt color → ink, with each view shown */
export default function LogoOnShirts({ d, url, onSave }: { d: Design; url: string; onSave: (list: OnShirt[]) => void }) {
  const [list, setList] = useState<OnShirt[]>(onShirtsOf(d));
  const shirts = SHIRT_COLORS.flatMap((g) => g.colors.map(([n]) => n));
  const commit = (next: OnShirt[]) => { setList(next); onSave(next.filter((x) => x.shirt && x.ink)); };
  return (
    <div className="los">
      <datalist id="los-shirts">{shirts.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="los-inks">{INK_COLORS.map((n) => <option key={n} value={n} />)}</datalist>
      {list.map((x, i) => (
        <div className="los-row" key={i}>
          {url && x.shirt && x.ink ? <ShirtView url={url} shirt={x.shirt} ink={x.ink} size={44} /> : <span className="lv" style={{ width: 44, height: 44 }} />}
          <input list="los-shirts" aria-label="Shirt color" placeholder="Navy" defaultValue={x.shirt} onBlur={(e) => commit(list.map((y, j) => (j === i ? { ...y, shirt: e.target.value.trim() } : y)))} />
          <span className="faint">→</span>
          <input list="los-inks" aria-label="Ink" placeholder="White" defaultValue={x.ink} onBlur={(e) => commit(list.map((y, j) => (j === i ? { ...y, ink: e.target.value.trim() } : y)))} />
          <button type="button" className="btn icon ghost sm" aria-label="Remove" title="Remove" onClick={() => commit(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setList([...list, { shirt: "", ink: "" }])}>+ Add a shirt color</button>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>For a one-color logo: the ink it prints in on each shirt color. Shown on the customer&apos;s logo card (both sides), and the Mockup Creator uses it.</p>
    </div>
  );
}
