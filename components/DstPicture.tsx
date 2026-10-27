"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { readDst } from "@/lib/dst";
import { renderThreads } from "@/lib/dstRender";
import { useSticky } from "@/lib/useSticky";

/**
 * The digitized logo as it sews (lib/dstRender.ts), from its stored DST, as a picture (so the work order's Save PDF
 * keeps it). Jump stitches follow the shop's "Remove jump stitches" tick (components/DstPreview.tsx). Until it's read,
 * or if it can't be, `fallback` shows.
 */
export default function DstPicture({ path, colors, style, className, fallback }: { path: string; colors: string[]; style?: CSSProperties; className?: string; fallback?: React.ReactNode }) {
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
        const c = renderThreads(info, colors, { width: 1400, fabric: "", trimJumps: trim, pad: 0 });
        if (live) setSrc(c.toDataURL("image/png"));
      } catch { /* the art shows instead */ }
    })();
    return () => { live = false; };
  }, [path, key, trim]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="The logo as it sews (from the DST)" className={className} style={{ objectFit: "contain", ...style }} /> : <>{fallback}</>;
}
