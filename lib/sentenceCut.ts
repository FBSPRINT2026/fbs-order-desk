/**
 * Text kept to a length without cutting a sentence in half (Oct 31, #40311: a lesson saved as "…Isacord 0670 Cream,
 * and" because it was cut at 300 characters). Under `max` it's as it is; over, it ends at the last full sentence that
 * fits, else the last clause or word, with "…".
 */
export function cutClean(text: string, max: number): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  // the last sentence end that isn't an abbreviation ("e.g. ", "i.e. ", "vs. ")
  let sent = -1;
  for (const m of head.matchAll(/[.!?;](?=\s)/g)) if (!/(\b[a-z]\.[a-z]|\b(e\.g|i\.e|etc|vs|no|st|ave))$/i.test(head.slice(0, m.index!))) sent = m.index!;
  if (sent > max * 0.5) return head.slice(0, sent + 1).trim();
  const clause = Math.max(head.lastIndexOf(", "), head.lastIndexOf(" ("));
  const cut = clause > max * 0.6 ? clause : head.lastIndexOf(" ");
  return `${head.slice(0, cut > 0 ? cut : max).replace(/[\s,;:(]+$/, "")}…`;
}
