/** the words in a payment processor's error, however it's shaped (Stax.js: a message, or field errors like
 *  { card_number: ["…"] }); used by every card form (the portal's Pay, the merch store checkout) */
export function staxReason(e: unknown, depth = 0): string {
  const t = rawReason(e, depth);
  // the processor has no gateway for this kind of payment (Nov 3: bank transfers, "no tokenization gateway found"): said
  // plainly, with what still works
  if (/no tokenization gateway/i.test(t)) return "Bank transfers aren't turned on with our payment processor yet. Please pay by card, Zelle or Venmo for now.";
  return t;
}
function rawReason(e: unknown, depth = 0): string {
  if (depth > 4 || e == null) return "";
  if (typeof e === "string") return e.trim();
  if (e instanceof Error && e.message) return e.message;
  if (Array.isArray(e)) return e.map((x) => rawReason(x, depth + 1)).filter(Boolean).join(" ");
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    for (const k of ["message", "error", "errors", "detail", "description"]) { const t = rawReason(o[k], depth + 1); if (t) return t; }
    return Object.values(o).map((x) => rawReason(x, depth + 1)).filter(Boolean).join(" ").slice(0, 300);
  }
  return "";
}
