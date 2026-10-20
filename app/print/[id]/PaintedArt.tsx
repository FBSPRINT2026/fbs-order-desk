"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { repaintLogo } from "@/lib/inkColors";
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
  useEffect(() => {
    if (!key) { setOut(""); return; }
    let live = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { try { const u = repaintLogo(img, want, 1600); if (live) setOut(u); } catch { /* can't read the picture: as uploaded */ } };
    img.src = src;
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} style={style} src={out || src} alt={alt || ""} data-hires={hires || undefined} data-hires-name={hiresName || undefined} data-inkmap={key || undefined} />;
}
