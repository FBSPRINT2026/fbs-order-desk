/**
 * Learning the print size and drop the AI reads off a customer's mockup (Inbox → Create order). The AI's numbers are
 * kept on the print (`aiPlace`); when staff save the mockup with a different size or drop, the pair is saved as a
 * lesson (ai_suggestions kind "mockup_lesson"). The next reading is scaled by what staff did on the same kind of print
 * (location group, garment kind), this customer's first.
 */
export type MockupLesson = { location: string; garment: string; kind: string; ai_w: number; staff_w: number; ai_drop: number | null; staff_drop: number | null; customer_id: string | null };
export const LESSON_KIND = "mockup_lesson";

/** big front / back prints, chest prints, sleeves… (lessons on one apply to the others in the group) */
export const locGroup = (loc: string) => (/sleeve/i.test(loc) ? "sleeve" : /left chest|right chest|pocket/i.test(loc) ? "chest" : /yoke|shoulder|upper back|nape/i.test(loc) ? "yoke" : "big");
/** inches from "7.5\" wide"; null for a size given as a height */
export const widthOf = (size: string) => { const m = String(size || "").match(/^\s*([\d.]+)/); return m && !/tall/i.test(size) ? +m[1] : null; };

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/**
 * How to correct a new reading: width × factor, drop + offset, from up to 8 recent lessons on the same kind of print
 * and garment (this customer's first). One lesson from this customer is enough; otherwise two.
 */
export function correction(lessons: MockupLesson[], loc: string, kind: string, customerId: string | null): { factor: number; dropAdd: number; n: number } | null {
  const same = lessons.filter((l) => locGroup(l.location) === locGroup(loc) && l.kind === kind && l.ai_w > 0 && l.staff_w > 0);
  const mine = same.filter((l) => customerId && l.customer_id === customerId);
  const use = (mine.length ? [...mine, ...same.filter((l) => !mine.includes(l))] : same).slice(0, 8);
  if (!use.length || (!mine.length && use.length < 2)) return null;
  const factor = Math.max(0.5, Math.min(1.6, median(use.map((l) => l.staff_w / l.ai_w))));
  const drops = use.filter((l) => l.ai_drop != null && l.staff_drop != null).map((l) => (l.staff_drop as number) - (l.ai_drop as number));
  return { factor, dropAdd: drops.length ? Math.max(-3, Math.min(3, median(drops))) : 0, n: use.length };
}
