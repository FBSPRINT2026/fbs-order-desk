/**
 * A ship-to as a normal address block, one line each (Oct 30, Nick on #40293: "the attention, the second line, the
 * address, say just like a normal address block"): name, ATTN, street, suite, then "City, ST ZIP". The reader and staff
 * often give it on one line with commas ("All My Sons Pittsburgh, ATTN John Kurhan, 150 54th Street, Pittsburgh, PA
 * 15201"); a block that's already on lines is only tidied. Anything that isn't an address (a note) is left as it is.
 */
const STATE_ZIP = /^[A-Z]{2}\.?\s*\d{5}(-\d{4})?$/;
export function addressBlock(raw: string): string {
  const t = (raw || "").replace(/\r/g, "").trim();
  if (!t) return "";
  const tidy = (ls: string[]) => ls.map((l) => l.replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim()).filter(Boolean).join("\n");
  if (t.includes("\n")) return tidy(t.split("\n"));
  const parts = t.split(/\s*,\s*/).filter(Boolean);
  // not an address: no ZIP at the end
  if (parts.length < 2 || !/\d{5}(-\d{4})?$/.test(t)) return t;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], next = parts[i + 1] || "";
    // "Pittsburgh, PA 15201" stays one line; so does "Pittsburgh PA 15201"
    if (next && STATE_ZIP.test(next) && i === parts.length - 2) { out.push(`${p}, ${next}`); break; }
    out.push(p);
  }
  return tidy(out);
}
