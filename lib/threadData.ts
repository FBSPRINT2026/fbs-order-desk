import { MADEIRA_THREADS } from "@/lib/madeiraThreads";
import { PMS_COATED } from "@/lib/pms";

/**
 * The thread colors (moved out of lib/embroidery.ts on Oct 31 so the ink color lookup, lib/inkColors.ts colorHex, can
 * color a thread by its name too: "Madeira 1981 Carmine" on a work order was a gray swatch). Data only: imports nothing
 * but the thread and PMS tables.
 */
export type Thread = { line: "Polyneon 40" | "Classic Rayon 40" | "Isacord 40"; code: string; name: string; hex: string; pms: string[] };
/** the threads with a color to compare (a thread with only its PMS gets the PMS's color). `alt`: the color of the
 *  PMS the maker matches it to, a second point to compare against (Madeira's chart is how the shop matches a logo's
 *  PMS to a thread; Oct 23, Nick sent Madeira's Polyneon PANTONE chart) */
let all: (Thread & { alt: string[] })[] | null = null;
/**
 * Threads whose chart screen color is plainly wrong next to their name and the maker's own PMS match (Oct 24, Nick on
 * Madeira 1766 Sailor Blue: "your little choice for the color is like a brown almost"): shown in their PMS's color.
 * Found by comparing every thread's screen color with its PMS (a big gap, ΔE over 30) and reading the name: kept where
 * the screen color is the right one (Parchment, Linen and Garden Rose are light; three Madeira blues are just a shade
 * off their PMS).
 */
const USE_PMS = new Set([
  "Polyneon 40:1766",
  ...["0232", "0442", "0630", "0704", "0932", "1102", "1220", "1305", "1342", "1346", "1366", "1703", "1902", "1913", "1950", "2600", "3102", "3323", "3355", "3510", "3541", "3543", "3611", "3622", "4425", "4442", "5210", "5833", "6011"].map((c) => `Isacord 40:${c}`),
]);
export function threads(): (Thread & { alt: string[] })[] {
  if (all) return all;
  all = (MADEIRA_THREADS as Thread[]).map((t) => ({ ...t, hex: (USE_PMS.has(`${t.line}:${t.code}`) ? pmsHex(t.pms[0] || "") : "") || t.hex || pmsHex(t.pms[0] || "") || "", alt: t.pms.slice(0, 2).map(pmsHex).filter(Boolean) })).filter((t) => /^#[0-9a-f]{6}$/i.test(t.hex));
  return all;
}
export const pmsHex = (p: string) => {
  if (!p) return "";
  const norm = (s: string) => s.replace(/^(pms|pantone)\s*/i, "").replace(/^process\s+/i, "").replace(/\s+[cu]$/i, "").trim().toLowerCase();
  const want = norm(p);
  const k = Object.keys(PMS_COATED).find((n) => norm(n) === want);
  return k ? PMS_COATED[k] : "";
};


/** the thread an order names ("Madeira 1843 Purple", "Madeira Rayon 1147", "Isacord 0015 White") */
export function threadByName(s: string): Thread | null {
  const m = /^(madeira|isacord)\s+(rayon\s+)?(\d{3,4})/i.exec((s || "").trim());
  if (!m) return null;
  const line = /isacord/i.test(m[1]) ? "Isacord 40" : m[2] ? "Classic Rayon 40" : "Polyneon 40";
  return threads().find((t) => t.line === line && t.code === m[3]) || null;
}
