/**
 * Brand standards → Preferred goods (Oct 26, Nick: "Peticolas… they always use the Next Level 6210 or the Bella Canvas
 * 3001 CVC; they prefer the 6210"). A customer's blanks, ranked for each kind of garment. Used only when an email
 * doesn't name the style: the order reader leaves it empty, and Create order asks "use their preferred tee?" first.
 * Never filled in on its own.
 */
export type PreferredGood = { id: string; kind: string; rank: number; style: string; brand: string; name: string; colors: string[]; notes: string };

/** a garment word to its kind: "tees", "t-shirts", "shirts" → tee; "hoodies", "hooded sweatshirts" → hoodie… */
const KINDS: [string, RegExp][] = [
  ["hoodie", /hood/i],
  ["crew", /crew|sweatshirt|fleece|pullover/i],
  ["long sleeve", /long\s*-?\s*sleeve|\bls\b/i],
  ["tank", /tank/i],
  ["polo", /polo/i],
  ["hat", /\bhats?\b|\bcaps?\b|trucker|snapback|beanie|visor/i],
  ["jacket", /jacket|quarter|1\/4|zip/i],
  ["onesie", /onesie|bodysuit/i],
  ["tee", /\btees?\b|t-?\s*shirts?|\bshirts?\b|\btops?\b/i],
];
export const kindOf = (s: string) => KINDS.find(([, r]) => r.test(s || ""))?.[0] || "";

/** the preferred goods that fit what the email called it, best first; all of them when it didn't say */
export function goodsFor(list: PreferredGood[], called: string): PreferredGood[] {
  const k = kindOf(called);
  const all = [...(list || [])].filter((g) => g && g.style).sort((a, b) => a.kind.localeCompare(b.kind) || a.rank - b.rank);
  if (!k) return all;
  return all.filter((g) => kindOf(g.kind) === k || g.kind.toLowerCase().trim() === (called || "").toLowerCase().trim());
}

export const rankWord = (n: number) => (n === 1 ? "1st choice" : n === 2 ? "2nd choice" : n === 3 ? "3rd choice" : `${n}th choice`);
