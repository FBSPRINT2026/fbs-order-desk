/** the words in a payment processor's error, however it's shaped (Stax.js: a message, or field errors like
 *  { card_number: ["…"] }); used by every card form (the portal's Pay, the merch store checkout) */
export function staxReason(e: unknown, depth = 0): string {
  if (depth > 4 || e == null) return "";
  if (typeof e === "string") return e.trim();
  if (e instanceof Error && e.message) return e.message;
  if (Array.isArray(e)) return e.map((x) => staxReason(x, depth + 1)).filter(Boolean).join(" ");
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    for (const k of ["message", "error", "errors", "detail", "description"]) { const t = staxReason(o[k], depth + 1); if (t) return t; }
    return Object.values(o).map((x) => staxReason(x, depth + 1)).filter(Boolean).join(" ").slice(0, 300);
  }
  return "";
}
