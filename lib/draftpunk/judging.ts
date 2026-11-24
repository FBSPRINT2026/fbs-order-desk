/** BJCP scoresheet arithmetic (beer): the five sections and their maximums, and the descriptor for a total */
export const SECTIONS = [["aroma", "Aroma", 12], ["appearance", "Appearance", 3], ["flavor", "Flavor", 20], ["mouthfeel", "Mouthfeel", 5], ["overall", "Overall", 10]] as const;
export type Sheet = { judge: string; rank?: string; aroma?: number; appearance?: number; flavor?: number; mouthfeel?: number; overall?: number; notes?: string };
export const sheetTotal = (s: Sheet) => SECTIONS.reduce((a, [k, , max]) => a + Math.min(max, Math.max(0, Number(s[k]) || 0)), 0);
export const entryScore = (sheets: Sheet[]) => { const t = sheets.map(sheetTotal).filter((x) => x > 0); return t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0; };
export function descriptor(score: number) {
  if (score >= 45) return "Outstanding"; if (score >= 38) return "Excellent"; if (score >= 30) return "Very Good";
  if (score >= 21) return "Good"; if (score >= 14) return "Fair"; return score > 0 ? "Problematic" : "";
}
export const PLACES: [string, string][] = [["", "No placing"], ["gold", "Gold (1st)"], ["silver", "Silver (2nd)"], ["bronze", "Bronze (3rd)"], ["hm", "Honorable mention"], ["bos", "Best of Show"], ["ninkasi", "Ninkasi Award"]];
export const MEDAL_LABEL: Record<string, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze", hm: "HM", bos: "Best of Show", ninkasi: "Ninkasi" };
