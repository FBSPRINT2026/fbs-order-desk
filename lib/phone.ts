/**
 * Phone numbers everywhere look like (940) 668-0060 (Oct 16, Nick). US numbers only: "+1 940.668.0060",
 * "9406680060" and "940-668-0060 x12" become "(940) 668-0060" ("… ext. 12"); anything else is left as typed.
 */
export function fmtPhone(v: string | null | undefined): string {
  const s = String(v || "").trim();
  if (!s || s.includes("@")) return s;
  const m = s.match(/^(.*?)(?:\s*(?:x|ext\.?|extension|#)\s*(\d+))?\s*$/i);
  const main = m?.[1] || s, ext = m?.[2];
  let d = main.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10 || /[a-z]/i.test(main.replace(/^\+?1?\s*/, ""))) return s;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}${ext ? ` ext. ${ext}` : ""}`;
}
