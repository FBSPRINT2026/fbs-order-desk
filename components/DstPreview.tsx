"use client";
import { useEffect, useMemo, useRef } from "react";
import { useSticky } from "@/lib/useSticky";
import type { DstInfo } from "@/lib/dst";
import { jumpStitches, renderThreads, stitchesOf, stopThreadsFromArt } from "@/lib/dstRender";

/**
 * A digitized logo (DST) drawn thread by thread on the garment's color (lib/dstRender.ts), with "Remove jump stitches"
 * (Oct 27, Nick: "just like we say remove background… remove jump stitch, and then it removes the jump stitch… when we
 * need to see them with the jump stitch, what it actually does"). The tick is remembered.
 */
/** `art`: the logo's picture; when `colors` are only the print's threads (fewer than the stops), each stop takes the thread
 *  its part of the picture shows (lib/dstRender.ts stopThreadsFromArt), the same as the work order's (DstPicture). */
export default function DstPreview({ info, colors, art, fabric = "#F4F4F1", width = 720 }: { info: DstInfo; colors: string[]; art?: string; fabric?: string; width?: number }) {
  const [trim, setTrim] = useSticky<boolean>("dst.trimJumps", true);
  const box = useRef<HTMLDivElement>(null);
  const jumps = useMemo(() => { try { return jumpStitches(stitchesOf(info)).size; } catch { return 0; } }, [info]);
  const key = colors.join(",");
  useEffect(() => {
    if (!box.current) return;
    const el = box.current;
    // drawn after the page paints (a big logo takes a moment)
    let live = true;
    const t = setTimeout(async () => {
      try {
        let use = colors;
        if (art && colors.length !== info.blocks.length) {
          const im = await new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = art; });
          use = (im && stopThreadsFromArt(info, colors, im)) || colors;
        }
        if (!live) return;
        const c = renderThreads(info, use, { width: Math.round(width * Math.min(2, window.devicePixelRatio || 1)), fabric, trimJumps: trim });
        c.className = "emb-dst-c";
        el.innerHTML = ""; el.appendChild(c);
      } catch { el.textContent = "The stitches couldn't be drawn."; }
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [info, key, fabric, width, trim, art]); // eslint-disable-line react-hooks/exhaustive-deps
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
