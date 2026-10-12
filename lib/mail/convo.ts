/**
 * Email as conversations (Oct 12, Nick: "think of all emails as a conversation… three emails from Methodist should
 * just be one email with the conversation underneath"). Emails are one conversation when they share the subject
 * (without Re:/Fw:/[EXT] and the like) and come from the same company (the same customer, else the same email domain;
 * gmail-type addresses only match the same address), or when they're in the same email thread. Used by the Inbox list
 * and by Create order, which reads the whole conversation whichever email it starts from.
 */

const PREFIX = /^\s*(?:(?:re|fw|fwd|aw|sv|vs|antw|wg|tr|rif|r|réf)\s*(?:\[\d+\])?\s*[:：]|\[(?:ext|external)[^\]]*\]|\((?:ext|external)\)|external\s*[:：]|ext\s*[:：])\s*/i;

/** the subject as the conversation's name: no Re:/Fw:/[EXT], spacing and case ignored */
export function convoSubject(s: string | null | undefined): string {
  let t = String(s || "").trim();
  for (let i = 0; i < 12; i++) { const n = t.replace(PREFIX, ""); if (n === t) break; t = n; }
  return t.replace(/[\s\-–—_:]+/g, " ").trim().toLowerCase();
}

const PUBLIC = new Set(["gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "att.net", "sbcglobal.net", "comcast.net", "verizon.net", "proton.me", "protonmail.com"]);
/** who it's from, for grouping: the company's domain, or the whole address for gmail-type mail */
export function senderKey(email: string | null | undefined): string {
  const e = String(email || "").trim().toLowerCase(), d = e.split("@")[1] || "";
  return !d ? e : PUBLIC.has(d) ? e : d;
}

/** subjects too generic to group on by themselves */
const GENERIC = new Set(["", "(no subject)", "no subject", "hi", "hello", "hey", "question", "quote", "order", "invoice", "test", "help", "thanks", "thank you", "info", "update"]);
export const groupable = (subject: string) => !GENERIC.has(subject) && subject.length >= 3;

/**
 * Group items into conversations, newest first. `keys(x)` gives the keys an item shares with others in its conversation
 * (convoKeys below); any shared key joins two items.
 */
export function groupConvos<T>(items: T[], keys: (x: T) => string[], when: (x: T) => string): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map<string, number>();
  items.forEach((x, i) => {
    for (const k of keys(x)) {
      if (!k) continue;
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i); else { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
    }
  });
  const by = new Map<number, T[]>();
  items.forEach((x, i) => { const r = find(i); const g = by.get(r); if (g) g.push(x); else by.set(r, [x]); });
  const groups = [...by.values()].map((g) => g.sort((a, b) => (when(b) || "").localeCompare(when(a) || "")));
  return groups.sort((a, b) => (when(b[0]) || "").localeCompare(when(a[0]) || ""));
}

/** the keys for an email: subject + who (customer and domain), and its thread */
export function convoKeys(e: { subject?: string | null; from_email?: string | null; customer_id?: string | null; thread_id?: string | null; external_id?: string | null; references?: string[] | null }): string[] {
  const s = convoSubject(e.subject), out: string[] = [];
  if (groupable(s)) {
    out.push(`s:${s}|${senderKey(e.from_email)}`);
    if (e.customer_id) out.push(`s:${s}|c:${e.customer_id}`);
  }
  if (e.thread_id) out.push(`t:${e.thread_id}`);
  if (e.external_id) out.push(`t:${e.external_id}`);
  for (const r of e.references || []) if (r) out.push(`t:${r}`);
  return out;
}
