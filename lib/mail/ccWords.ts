/**
 * Cc from words (Oct 12, Nick: "when the AI writes 'I'm copying Amanda', it should copy amanda@fbsprint.com on the
 * email, same with Claudia"). Finds the team members a reply (or what you told the AI) says to copy: "copying Amanda",
 * "I've cc'd Claudia", "looping in Amanda", "cc Claudia", or an address after "cc". Shared by the browser and the server.
 */
export type TeamMember = { name: string; email: string };

const ADDR = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const VERB = String.raw`(?:cc(?:'?(?:ing|ed|d))?|copy(?:ing)?|copied|looping\s+in|loop\s+in|looped\s+in|bring(?:ing)?\s+in)`;

export function ccFromWords(text: string, team: TeamMember[]): string[] {
  const t = String(text || "");
  if (!t.trim()) return [];
  const out = new Set<string>();
  for (const m of team) {
    const first = m.name.trim().split(/\s+/)[0].toLowerCase();
    if (first.length < 3) continue;
    const n = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "copying Amanda", "cc'd Amanda and Claudia", "looping in Claudia" (the name within a few words after the verb)
    const after = new RegExp(String.raw`\b${VERB}\b(?:[^.!?\n]{0,40}?)\b${n}\b`, "i");
    // "Amanda (cc'd)", "Amanda is copied", "Amanda in the loop"
    const before = new RegExp(String.raw`\b${n}\b[^.!?\n]{0,20}\b(?:cc'?d|copied|on cc|in the loop|on this email)\b`, "i");
    // "including Amanda" (only right before the name: "include the Amanda logo" isn't a Cc)
    const incl = new RegExp(String.raw`\b(?:includ(?:e|ing|ed)|add(?:ing|ed)?)\s+${n}\b(?!'s|\s+logo|\s+design)`, "i");
    if (after.test(t) || before.test(t) || incl.test(t)) out.add(m.email.toLowerCase());
  }
  // "cc: someone@example.com" / "copy jose@fbsprint.com"
  for (const line of t.split(/\n/)) if (new RegExp(String.raw`\b${VERB}\b`, "i").test(line)) for (const a of line.match(ADDR) || []) out.add(a.toLowerCase());
  return [...out];
}

/** a usable list of addresses: trimmed, lower case, no repeats, at most 10 */
export function cleanCc(list: unknown, not: string[] = []): string[] {
  const no = new Set(not.map((x) => x.toLowerCase()));
  const out: string[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const a = String(x || "").trim().toLowerCase();
    if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(a) && !no.has(a) && !out.includes(a)) out.push(a);
  }
  return out.slice(0, 10);
}
