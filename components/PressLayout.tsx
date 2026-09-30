"use client";
import type { Station } from "@/lib/production";

/**
 * A screen press seen from above: the load station, the print heads in the order a pallet reaches them, and the
 * unload station, around the center hub (like the press itself). Heads show what's parked there: a flash, a head that's
 * down, a flash that isn't heating. Tap a head to pick it (Equipment Status → press layout).
 * A 12-color press has 14 stations: load + 12 heads + unload.
 */
export default function PressLayout({ layout, size = 300, selected = null, onPick, label, sub, mirror = false, inks }: { layout: Station[]; size?: number; selected?: number | null; onPick?: (i: number) => void; label?: string; sub?: string; mirror?: boolean; /** a separation laid on the press: per head, the ink's color and name */ inks?: ({ hex: string; name: string } | null)[] }) {
  const heads = layout.length, n = heads + 2, c = size / 2, step = 360 / n;
  const rp = size * 0.34, len = size * 0.2, w = Math.min(((2 * Math.PI * rp) / n) * 0.72, size * 0.15), hub = size * 0.15;
  const small = size < 160;
  // pallets travel counter-clockwise on screen: load just right of the bottom, head 1 next, … unload just left of it.
  // A flipped press (Presses 1 and 3) turns the other way: load on the left, head 1 to the left, the last head on the right.
  const ang = (k: number) => (mirror ? 90 + step / 2 + k * step : 90 - step / 2 - k * step);
  const stations: { k: number; kind: Station | "load" | "unload"; head: number | null }[] = [
    { k: 0, kind: "load", head: null },
    ...layout.map((s, i) => ({ k: i + 1, kind: s, head: i })),
    { k: n - 1, kind: "unload", head: null },
  ];
  return (
    <svg className={"pl" + (small ? " sm" : "")} viewBox={`0 0 ${size} ${size}`} width={size} height={size} role={onPick ? "group" : "img"} aria-label={`${heads}-color press layout`}>
      {stations.map(({ k, kind }) => {
        const a = ang(k), rad = (a * Math.PI) / 180;
        return <line key={"a" + k} className="pl-arm" x1={c + hub * Math.cos(rad)} y1={c + hub * Math.sin(rad)} x2={c + (rp - len / 2) * Math.cos(rad)} y2={c + (rp - len / 2) * Math.sin(rad)} strokeWidth={small ? 2 : 5} data-kind={kind} />;
      })}
      <circle className="pl-hub" cx={c} cy={c} r={hub} strokeWidth={small ? 3 : 7} />
      {!small && label ? <text className="pl-hub-t" x={c} y={sub ? c - 2 : c + 4} textAnchor="middle">{label}</text> : null}
      {!small && sub ? <text className="pl-hub-s" x={c} y={c + 13} textAnchor="middle">{sub}</text> : null}
      {stations.map(({ k, kind, head }) => {
        const a = ang(k), rad = (a * Math.PI) / 180, x = c + rp * Math.cos(rad), y = c + rp * Math.sin(rad);
        const pick = head != null && onPick ? () => onPick(head) : undefined;
        const ink = head != null ? inks?.[head] : null;
        const title = kind === "load" ? "Load (pallets come on here)" : kind === "unload" ? "Unload (off the press)" : `Head ${head! + 1}: ${ink ? ink.name : kind === "print" ? "printing" : kind === "flash" ? "flash" : kind === "down" ? "head down" : "flash not heating"}`;
        return (
          <g key={k} className={`pl-st ${kind}${head != null && head === selected ? " sel" : ""}${pick ? " can" : ""}`} onClick={pick} role={pick ? "button" : undefined} tabIndex={pick ? 0 : undefined} aria-label={title} aria-pressed={pick ? head === selected : undefined} onKeyDown={pick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } } : undefined}>
            <title>{title}</title>
            <rect x={c + rp - len / 2} y={c - w / 2} width={len} height={w} rx={small ? 2 : 5} transform={`rotate(${a} ${c} ${c})`} style={ink ? { fill: ink.hex } : undefined} />
            {(kind === "down" || kind === "flashdown") && <g transform={`rotate(${a} ${c} ${c})`} className="pl-x"><line x1={c + rp - len / 2 + 4} y1={c - w / 2 + 4} x2={c + rp + len / 2 - 4} y2={c + w / 2 - 4} /><line x1={c + rp - len / 2 + 4} y1={c + w / 2 - 4} x2={c + rp + len / 2 - 4} y2={c - w / 2 + 4} /></g>}
            {!small && <>
              <circle className="pl-badge" cx={x} cy={y} r={11} />
              {kind === "load" || kind === "unload" ? (
                // load: an arrow onto the press (toward the hub); unload: an arrow off it
                <g className="pl-arr" transform={`rotate(${kind === "load" ? a + 180 : a} ${x} ${y})`}><path d={`M ${x - 5.5} ${y} H ${x + 5} M ${x + 1} ${y - 4} L ${x + 5.5} ${y} L ${x + 1} ${y + 4}`} /></g>
              ) : <text className="pl-num" x={x} y={y + 4} textAnchor="middle">{head! + 1}</text>}
              {(kind === "flash" || kind === "flashdown") && <text className="pl-tag" x={c + (rp + len / 2 + 11) * Math.cos(rad)} y={c + (rp + len / 2 + 11) * Math.sin(rad) + 3.5} textAnchor="middle">F</text>}
            </>}
          </g>
        );
      })}
    </svg>
  );
}
