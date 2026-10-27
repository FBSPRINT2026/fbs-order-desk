"use client";
import { useEffect, useMemo, useRef } from "react";
import { useSticky } from "@/lib/useSticky";
import type { DstInfo } from "@/lib/dst";
import { jumpStitches, renderThreads, stitchesOf } from "@/lib/dstRender";

/**
 * A digitized logo (DST) drawn thread by thread on the garment's color (lib/dstRender.ts), with "Remove jump stitches"
 * (Oct 27, Nick: "just like we say remove background… remove jump stitch, and then it removes the jump stitch… when we
 * need to see them with the jump stitch, what it actually does"). The tick is remembered.
 */
export default function DstPreview({ info, colors, fabric = "#F4F4F1", width = 720 }: { info: DstInfo; colors: string[]; fabric?: string; width?: number }) {
  const [trim, setTrim] = useSticky<boolean>("dst.trimJumps", true);
  const box = useRef<HTMLDivElement>(null);
  const jumps = useMemo(() => { try { return jumpStitches(stitchesOf(info)).size; } catch { return 0; } }, [info]);
  const key = colors.join(",");
  useEffect(() => {
    if (!box.current) return;
    const el = box.current;
    // drawn after the page paints (a big logo takes a moment)
    const t = setTimeout(() => {
      try {
        const c = renderThreads(info, colors, { width: Math.round(width * Math.min(2, window.devicePixelRatio || 1)), fabric, trimJumps: trim });
        c.className = "emb-dst-c";
        el.innerHTML = ""; el.appendChild(c);
      } catch { el.textContent = "The stitches couldn't be drawn."; }
    }, 0);
    return () => clearTimeout(t);
  }, [info, key, fabric, width, trim]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="dst-pv">
      <div className="emb-dst" ref={box} aria-label="The stitches in the file, drawn thread by thread" />
      <label className="check dst-pv-t" title="Jump stitches are the threads that run from one letter or piece to the next. The shop trims them (or blacks them out on dark goods); untick to see them as the machine sews them.">
        <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
        Remove jump stitches{jumps ? ` (${jumps})` : ""}
      </label>
    </div>
  );
}
