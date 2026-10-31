"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The background behind a logo mockup's picture (Oct 31, Nick: "pick the most used color in that group… a little button
 * maybe right on the main order screen… just a little color picker… when you hover over it, it says background").
 *
 * A small swatch in the picture's top-right corner. It starts on the group's most-used garment color; clicking it shows
 * the group's own colors first, then any color. Only the picture changes, never the garments.
 */
export default function MockupBg({ value, auto, colors, onPick, small }: {
  /** the color picked (Group.mockupBg), else empty */ value?: string;
  /** the color it shows when nothing is picked: the garment with the most pieces */ auto: string;
  /** the group's garment colors: name and color, most pieces first */ colors: { name: string; hex: string; pcs: number }[];
  onPick: (hex: string | null) => void;
  /** on a small close-up (a section's tile): a smaller swatch, the list opening to the right */ small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const cur = (value || auto || "#9aa1ab").toLowerCase();
  return (
    <div className={"mbg" + (small ? " sm" : "")} ref={ref}>
      <button type="button" className={"mbg-btn" + (open ? " on" : "")} title="Background" aria-label="Background" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <span style={{ background: cur }} />
      </button>
      {open && (
        <div className="mbg-pop" role="dialog" aria-label="Background">
          <div className="mbg-h">Background</div>
          <div className="mbg-cs">
            {colors.map((c) => (
              <button key={c.name} type="button" className={"mbg-c" + (c.hex.toLowerCase() === cur ? " on" : "")} title={`${c.name} · ${c.pcs} pcs`} onClick={() => { onPick(c.hex.toLowerCase() === auto.toLowerCase() ? null : c.hex); setOpen(false); }}>
                <span style={{ background: c.hex }} /><small>{c.name}</small>
              </button>
            ))}
          </div>
          <label className="mbg-any"><input type="color" value={/^#[0-9a-f]{6}$/i.test(cur) ? cur : "#9aa1ab"} onChange={(e) => onPick(e.target.value)} />Pick any color…</label>
          {value && <button type="button" className="linkbtn mbg-reset" onClick={() => { onPick(null); setOpen(false); }}>Back to the most-used color</button>}
          <p className="mbg-f">Starts on the garment color with the most pieces. Only the picture changes.</p>
        </div>
      )}
    </div>
  );
}
