/**
 * An ink's (or thread's) short name, for when a print's line of inks runs out of room on the quote / invoice (Oct 30, Nick:
 * "W with the dot and B… Athletic Gold would be A Gld, Kelly Green could be Kly G… PMS just the number").
 * One list for every document, so the same ink always shortens the same way; anything not on it is shortened by rule:
 * a PMS / thread number keeps just the number, one word drops its vowels, two words become "Kly G" (the first word short,
 * the second its first letter).
 */
const KNOWN: Record<string, string> = {
  white: "W", black: "B", "athletic gold": "A Gld", "kelly green": "Kly G", "columbia blue": "Col B", "carolina blue": "Car B",
  "royal blue": "Roy", royal: "Roy", maroon: "Mrn", gray: "Gry", grey: "Gry", "light gray": "Lt Gry", "dark gray": "Dk Gry",
  "heather gray": "Hth Gry", navy: "Nvy", "navy blue": "Nvy", brown: "Brn", gold: "Gld", "vegas gold": "V Gld", yellow: "Ylw",
  orange: "Org", "texas orange": "Tx Org", "burnt orange": "Brnt O", red: "Red", cardinal: "Crd", scarlet: "Scr", purple: "Prp",
  pink: "Pnk", "hot pink": "Hot Pnk", green: "Grn", "forest green": "Fst G", "dark green": "Dk G", "lime green": "Lime", lime: "Lime",
  teal: "Teal", turquoise: "Turq", silver: "Slv", "metallic silver": "M Slv", "metallic gold": "M Gld", tan: "Tan", charcoal: "Chr",
  "rhodamine red": "Rhod Red", cream: "Crm", natural: "Nat", "process blue": "Proc B", "safety yellow": "Saf Y", "safety orange": "Saf O",
  "neon green": "Neon G", "neon pink": "Neon P", "neon yellow": "Neon Y", "neon orange": "Neon O", "glow": "Glow", "underbase": "UB",
};
const vowelless = (w: string, max = 3) => {
  const c = (w[0] + w.slice(1).replace(/[aeiou]/gi, "")).replace(/(.)\1+/gi, "$1");
  return (c.length >= 2 ? c : w).slice(0, max).replace(/^./, (x) => x.toUpperCase());
};
export function inkShort(name: string): string {
  const n = (name || "").trim();
  const key = n.toLowerCase().replace(/\s+/g, " ");
  if (KNOWN[key]) return KNOWN[key];
  // PMS 186 C / Pantone 2593 C → 186 / 2593; a thread with a number (Madeira 1842, Isacord 0015) → the number
  const pms = n.match(/^(?:pms|pantone)\s*([0-9]{2,5})\s*(?:c|u|cp|tcx)?$/i);
  if (pms) return pms[1];
  const num = n.match(/\b([0-9]{3,5})\b/);
  if (num) return num[1];
  // a named PMS ("PMS Bright Orange C") is shortened like any other name, without the PMS and the C
  const bare = n.replace(/^(?:pms|pantone)\s+/i, "").replace(/\s+(?:c|u|cp)$/i, "");
  if (KNOWN[bare.toLowerCase()]) return KNOWN[bare.toLowerCase()];
  const words = bare.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].length <= 4 ? words[0] : vowelless(words[0]);
  // "Kelly Green" → "Kly G": the first word short, the rest their first letters
  return [vowelless(words[0]), ...words.slice(1).map((w) => w[0].toUpperCase())].join(" ");
}

/**
 * A color, PMS or thread name made to fit one line of a small swatch (Oct 31, Nick: "this warm gray 1 C goes over into
 * two lines… if you need to abbreviate a color to make it one line, do so"): as written when it fits, else the words
 * shortened one at a time from the end ("PMS Warm Gray 1 C" → "PMS Warm Gy 1C", "Madeira 1981 Carmine" → "Mad 1981
 * Carmine") until it's `max` characters or less. The full name goes in the swatch's title.
 */
const SHORT_WORD: Record<string, string> = {
  gray: "Gy", grey: "Gy", warm: "Wm", cool: "Cl", black: "Blk", white: "Wht", light: "Lt", dark: "Dk", diamond: "Dmnd", process: "Proc",
  green: "Grn", orange: "Org", purple: "Prp", yellow: "Ylw", brown: "Brn", silver: "Slv", metallic: "Met", neon: "Nn", royal: "Roy",
  madeira: "Mad", isacord: "Isa", polyneon: "PN", rayon: "Ry", heather: "Hth", charcoal: "Chr", maroon: "Mrn", burgundy: "Brg",
  forest: "Fst", kelly: "Kly", navy: "Nvy", super: "Sup", emerald: "Em", carmine: "Crm", cream: "Crm", natural: "Nat", pantone: "PMS",
};
export function fitLabel(s: string, max = 15): string {
  let t = (s || "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  t = t.replace(/(\d)\s+([CU])\b/g, "$1$2");
  const words = t.split(" ");
  // a thread's maker first ("Madeira" → "Mad"), then the words from the end
  for (let i = 0; i < words.length && words.join(" ").length > max; i++) if (/^(madeira|isacord|polyneon|pantone)$/i.test(words[i])) words[i] = SHORT_WORD[words[i].toLowerCase()];
  for (let i = words.length - 1; i >= 0 && words.join(" ").length > max; i--) {
    const k = words[i].toLowerCase();
    if (SHORT_WORD[k]) words[i] = SHORT_WORD[k];
  }
  return words.join(" ");
}
