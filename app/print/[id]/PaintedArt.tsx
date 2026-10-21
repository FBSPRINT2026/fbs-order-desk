"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { repaintLogo } from "@/lib/inkColors";
import { knockOut } from "@/lib/artPrep";
import type { Imprint } from "@/lib/pricing";

/**
 * A print's art in the inks picked for it in the Mockup Creator (imprint.inkMap), else as uploaded. Used on the proof
 * and the work order so the close-up matches the mockup (Oct 20: art set to yellow still showed its uploaded green).
 */
export default function PaintedArt({ src, inkMap, designId, className, style, alt, hires, hiresName }: { src: string; inkMap?: Imprint["inkMap"]; designId?: string; className?: string; style?: CSSProperties; alt?: string; /** the original vector file (signed link): the saved PDF draws the art from it at full resolution */ hires?: string; hiresName?: string }) {
  const map = inkMap && inkMap.design === designId ? inkMap.map : null;
  const want: Record<string, string> = {};
  if (map) for (const [s, v] of Object.entries(map)) if (v.name === "none" || (v.hex && v.hex.toLowerCase() !== s.toLowerCase())) want[s] = v.name === "none" ? "none" : v.hex;
  const key = Object.keys(want).length ? JSON.stringify(want) : "";
  const [out, setOut] = useState("");
  // the art's solid background (the white box around a flattened PSD or JPG) knocked out, as the Mockup Creator does,
  // so the close-up shows the shirt around the art (Oct 21, Nick: "why this isn't knocking out the white on the blown up
  // image"); then painted in the picked inks
  useEffect(() => {
    let live = true;
    const load = (u: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = u; });
    void (async () => {
      try {
        let img = await load(src);
        const k = knockOut(img, { maxPx: 1800, full: true });
        let u = k?.url || "";
        if (key) { if (u) img = await load(u); u = repaintLogo(img, want, 1600); }
        if (live) setOut(u);
      } catch { if (live) setOut(""); /* can't read the picture: as uploaded */ }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} style={style} src={out || src} alt={alt || ""} data-hires={hires || undefined} data-hires-name={hiresName || undefined} data-inkmap={key || undefined} data-orig={key ? src : undefined} data-ko={!key && out ? src : undefined} />;
}
