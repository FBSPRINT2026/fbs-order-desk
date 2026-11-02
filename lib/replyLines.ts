/**
 * An AI reply laid out to read at a glance (Nov 1, Nick: "really easy to read responses… I detected this, Lane 7 this,
 * new line, small, medium, large, XL… space between"). The reply's lines become blocks with a gap between them; a
 * garment written on one line with its sizes ("Next Level 3600 Sand: S 25 · M 50 · L 80") becomes the garment on one
 * line and its sizes under it, and a size never splits from its count ("S 25" stays together). Pure, so it can be tested.
 */
export type ReplyBlock = { kind: "text"; text: string } | { kind: "garment"; name: string; sizes: string[] };

// a size has a letter in it (S, 2XL, YM, 2T, OSFA): "11/30" or "4 · 5" are not sizes
const SIZE = String.raw`(?:(?=[A-Z0-9]*[A-Z])[A-Z0-9]{1,5}|One Size)`;
const RUN = new RegExp(String.raw`^(${SIZE}\s*[:=]?\s*\d+)(\s*[·,|]\s*${SIZE}\s*[:=]?\s*\d+)+\.?$`, "i");

/** "S 10 · M 30 · L 40" → ["S 10","M 30","L 40"], or null when it isn't a run of sizes */
export function sizeRun(s: string): string[] | null {
  const t = s.trim();
  if (!RUN.test(t)) return null;
  return t.replace(/\.$/, "").split(/\s*[·,|]\s*/).map((x) => x.replace(/\s*[:=]?\s*(\d+)$/, " $1").trim()).filter(Boolean);
}

export function replyBlocks(reply: string): ReplyBlock[] {
  const out: ReplyBlock[] = [];
  const lines = String(reply || "").replace(/\r/g, "").split("\n").map((l) => l.trim().replace(/^[-•*]\s+/, ""));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    // a garment and its sizes on one line: "Lane Seven LS16005 Pigment French Oak: S 10 · M 30"
    const at = l.lastIndexOf(":");
    const run = at > 0 ? sizeRun(l.slice(at + 1)) : null;
    if (run && /[a-z]/i.test(l.slice(0, at))) { out.push({ kind: "garment", name: l.slice(0, at).trim(), sizes: run }); continue; }
    // the sizes already on their own line under the garment
    const own = sizeRun(l);
    const prev = out[out.length - 1];
    if (own && prev?.kind === "text" && !/[?]$/.test(prev.text)) { out[out.length - 1] = { kind: "garment", name: prev.text.replace(/:$/, ""), sizes: own }; continue; }
    if (own) { out.push({ kind: "garment", name: "", sizes: own }); continue; }
    out.push({ kind: "text", text: l });
  }
  return out;
}
