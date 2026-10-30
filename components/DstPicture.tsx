"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { readDst } from "@/lib/dst";
import { renderThreads, stopThreadsFromArt } from "@/lib/dstRender";
import { useSticky } from "@/lib/useSticky";

/**
 * The digitized logo as it sews (lib/dstRender.ts), from its stored DST, as a picture (so the work order's Save PDF
 * keeps it). Jump stitches follow the shop's "Remove jump stitches" tick (components/DstPreview.tsx). Until it's read,
 * or if it can't be, `fallback` shows.
 * `colors` is one per stop when the worksheet says so; when it's only the print's threads (fewer than the stops), each
 * stop takes the thread its part of the logo's picture `art` shows (lib/dstRender.ts stopThreadsFromArt).
 */
export default function DstPicture({ path, colors, art, style, className, fallback }: { path: string; colors: string[]; art?: string; style?: CSSProperties; className?: string; fallback?: React.ReactNode }) {
  const [trim] = useSticky<boolean>("dst.trimJumps", true);
  const [src, setSrc] = useState("");
  const key = colors.join(",");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch(`/api/files/open?${new URLSearchParams({ p: path })}`);
        if (!r.ok) return;
        const info = readDst(await r.arrayBuffer());
        let use = colors;
        if (art && colors.length !== info.blocks.length) {
          const im = await new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = art; });
          use = (im && stopThreadsFromArt(info, colors, im)) || colors;
        }
        const c = renderThreads(info, use, { width: 1400, fabric: "", trimJumps: trim, pad: 0 });
        if (live) setSrc(c.toDataURL("image/png"));
      } catch { /* the art shows instead */ }
    })();
    return () => { live = false; };
  }, [path, key, trim, art]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="The logo as it sews (from the DST)" className={className} style={{ objectFit: "contain", ...style }} /> : <>{fallback}</>;
}
