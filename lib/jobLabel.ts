/**
 * A job's print list cut to what a person reads at a glance (Nick, Nov 16 2026: #40382's five groups made the phone's
 * job line "Full Front 4c dark + Full Back 3c dark ×3 + Full Front 3c dark ×2 + …", "long and bad").
 * Each spot once, with its most colors: "Full Front 4c · Full Back 3c"; past three spots, "+2 more".
 * Works on any booking label (`needOf` in lib/production.ts: screen "Loc 3c dark", embroidery "Loc 8k cap", heat "Loc").
 */
export function shortLabel(label: string, max = 3): string {
  if (!label) return "";
  const spots = new Map<string, number>();
  for (const raw of label.split(/\s+\+\s+/)) {
    const part = raw.replace(/\s*×\d+\s*$/, "").trim();
    if (!part) continue;
    const m = part.match(/^(.*?)\s+(\d+)([ck])\b/i);
    const loc = (m ? m[1] : part).trim();
    const n = m ? +m[2] : 0;
    const key = m ? `${loc}|${m[3].toLowerCase()}` : `${loc}|`;
    spots.set(key, Math.max(spots.get(key) || 0, n));
  }
  const list = [...spots.entries()].map(([k, n]) => { const [loc, u] = k.split("|"); return n ? `${loc} ${n}${u}` : loc; });
  return list.length > max ? `${list.slice(0, max - 1).join(" · ")} · +${list.length - max + 1} more` : list.join(" · ");
}
