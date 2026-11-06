/**
 * What the Order helper learns (Nov 6, Nick: "this is a trainer that will help the AI learn for future orders… if we do
 * Tiger Blue 10 orders in a row and nothing changes, and you know what to do, then you should come up and say, hey, I think
 * I've discovered a pattern… would you like me to try to make the next order with these rules?").
 *
 * Every order made with the Order helper saves what staff said each file was (helper_lessons). For a new job from the same
 * customer, each file is matched to the files they sent before, by the file's shape (its name with the numbers taken out:
 * "TigerBlue_Order_2844.pdf" and "TigerBlue_Order_2848.pdf" are the same kind of file), then by its words, then by its
 * type (.ai, .pdf…), and given the answer staff gave most. It's "sure" of the customer when it would have got their last
 * orders right by itself, every file, several in a row: then Create order offers to make the next one that way. Nothing
 * here is about one customer: it's the same for anyone who sends the same kinds of files each time.
 */
export type LessonFile = { name: string; kind: string; sizes: boolean; mockFor?: string };
export type Lesson = { files: LessonFile[]; in_message: boolean; created_at?: string };
export type Guess = { kind: string; sizes: boolean; mockFor?: string; why: "shape" | "words" | "type" | "" };

/** in a row, the orders it would have got right by itself, before it offers to make one (Nick said "10 in a row"; 3 is
 *  the least that's a pattern) */
export const SURE_AFTER = 3;

const ext = (n: string) => (n.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] || "");
/** the file's shape: lower case, numbers as #, no copy marks ("(1)", "copy") */
export const shapeOf = (n: string) => n.toLowerCase().replace(/\s*\(\d+\)(?=\.[a-z0-9]+$)/, "").replace(/\bcopy\b/g, "").replace(/\d+/g, "#").replace(/[\s_-]+/g, " ").trim();
const STOP = new Set(["the", "and", "for", "pdf", "png", "jpg", "jpeg", "ai", "eps", "of", "a", "to", "#"]);
const wordsOf = (n: string) => new Set(shapeOf(n).replace(/\.[a-z0-9]+$/, "").split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w)));

function vote<T extends string>(xs: T[]): T | "" {
  if (!xs.length) return "";
  const n = new Map<T, number>(); for (const x of xs) n.set(x, (n.get(x) || 0) + 1);
  const [best, c] = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return c / xs.length >= 0.75 ? best : ""; // a clear answer only
}

/** each file's guess from past lessons (the newest first count the same as older ones) */
export function guessFiles(past: Lesson[], names: string[]): Guess[] {
  const all = past.flatMap((l) => l.files);
  return names.map((name) => {
    const sh = shapeOf(name), ws = wordsOf(name), e = ext(name);
    const same = all.filter((f) => shapeOf(f.name) === sh);
    const near = same.length ? [] : all.filter((f) => { const w2 = wordsOf(f.name); let hit = 0; for (const w of ws) if (w2.has(w)) hit++; return hit > 0 && hit >= Math.min(ws.size, w2.size) / 2; });
    const typed = same.length || near.length ? [] : all.filter((f) => ext(f.name) === e);
    const pool = same.length ? same : near.length ? near : typed;
    const why: Guess["why"] = same.length ? "shape" : near.length ? "words" : typed.length ? "type" : "";
    const kind = vote(pool.map((f) => f.kind));
    const sizes = vote(pool.map((f) => (f.sizes ? "y" : "n"))) === "y";
    return { kind, sizes, why: kind ? why : "" };
  });
}
/** which mockup goes with each separations file: the one whose guess is the mockup (one mockup: that one) */
export function pairGuess(names: string[], g: Guess[]): Record<string, string> {
  const mocks = names.filter((_, i) => g[i].kind === "customer_mockup");
  const out: Record<string, string> = {};
  if (mocks.length >= 1) names.forEach((n, i) => { if (g[i].kind === "film") out[n] = mocks[0]; });
  return out;
}
/** would the others have got this one right, every file? */
export function wouldMatch(others: Lesson[], l: Lesson): boolean {
  if (!others.length || !l.files.length) return false;
  const g = guessFiles(others, l.files.map((f) => f.name));
  const msg = vote(others.map((x) => (x.in_message ? "y" : "n")));
  return l.files.every((f, i) => g[i].kind === f.kind && g[i].sizes === f.sizes) && (msg === "" || (msg === "y") === l.in_message);
}
/** how many of their latest orders in a row it would have got right by itself */
export function streakOf(lessons: Lesson[]): number {
  // newest first
  let n = 0;
  for (let i = 0; i < lessons.length; i++) { if (wouldMatch(lessons.slice(i + 1), lessons[i])) n++; else break; }
  return n;
}
