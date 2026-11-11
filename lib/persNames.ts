/**
 * Names for personalized pieces, written the way paperwork and staff write them, made into the line's own
 * personalization (GLine.persList: what "Add personalization" on the order makes, charged per name on top of the line).
 * One piece for both ways an order gets them (Nov 10, Nick: the order helper "is not using the add personalization
 * tool"): the order reader (lib/ai/emailOrder.ts, rule 7b) and the AI order helper (lib/ai/orderFix.ts, line field
 * "personalization").
 *  "Cody White / Ops Manager (S); Will-Da-Beast (XL)" → two names, each on its piece's size; a name without a size takes
 *  the next piece of the line not yet named. Pieces left over come back in `left`, to ask about, never guessed.
 */
import { normSize } from "@/lib/ai/normalize";
import { uid, type GLine, type PersEntry } from "@/lib/pricing";

/** "Charles / Warehouse Manager (4XL); Jordan (M)" or one per line → the names as written */
export function splitNames(raw: string): string[] {
  return String(raw || "").replace(/^\s*personali[sz]ation\s*:\s*/i, "").split(/\s*[;\n]\s*/).map((n) => n.trim()).filter(Boolean);
}

export function persFromNames(line: Pick<GLine, "sizes">, names: string[], loc?: string): { list: PersEntry[]; left: string[] } {
  const left = Object.entries(line.sizes || {}).flatMap(([z, q]) => Array.from({ length: +(q || 0) }, () => z));
  const list = names.map((n) => {
    const m = n.match(/\s*\(([^)]{1,16})\)\s*$/);
    const z = m ? normSize(m[1]) : null;
    const text = (m && z ? n.slice(0, m.index) : n).trim().slice(0, 120);
    const size = (z && left.includes(z) ? z : left[0] || z || "") as PersEntry["size"];
    const at = left.indexOf(size as string); if (at >= 0) left.splice(at, 1);
    return { id: uid(), text, size, qty: 1, ...(loc && loc !== "Right Chest" ? { loc } : {}) } as PersEntry;
  }).filter((e) => e.text);
  return { list, left };
}
