/** Messages between the shop and a customer: general ones, and one conversation per order. */
export type Attachment = { path: string; name: string; mime: string; size: number };
export type HubFile = { name: string; mime: string; size: number; url: string };
export type HubMsg = {
  id: string; order_id: string | null; /** the project this conversation is about */ project_id: string | null; /** "goods": about the customer supplied goods on the order */ topic: string; author_type: "staff" | "customer"; author_name: string; body: string;
  created_at: string; read_at: string | null; files: HubFile[]; /** what the customer said it is about (REASONS) */ reason?: string | null;
};
export type HubOrder = { id: string; number: number; nickname: string; status?: string; href: string; /** still being worked on: listed in the customer's Message Center even before anyone wrote about it */ live?: boolean };
export const MAX_ATTACH = 25 * 1024 * 1024;

/**
 * What a customer's message is about, picked before they send one about an order (Nick, Nov 16 2026). The ones with
 * `reply: false` never wait on us: no "waiting on us", no to-do, no unread badge; they still show, grayed.
 */
export const REASONS = [
  // a file for an order already sent (Nick, Nov 16 2026): the tile across the top; it opens the file picker, and every file a
  // customer sends about an order is put on the order's files too (portalSend)
  { k: "file", label: "Add a file", sub: "Art, a logo, a size list, a PO", reply: true },
  { k: "question", label: "A question", sub: "We'll write back", reply: true },
  { k: "change", label: "Change my order", sub: "Sizes, colors, dates", reply: true },
  { k: "art", label: "Art or a proof", sub: "A new file, a fix", reply: true },
  { k: "payment", label: "Payment", sub: "A bill, a card, a check", reply: true },
  { k: "tracking", label: "Sending tracking", sub: "No reply needed", reply: false },
  { k: "fyi", label: "Just letting you know", sub: "No reply needed", reply: false },
] as const;
export type Reason = (typeof REASONS)[number]["k"];
export const NO_REPLY: readonly string[] = REASONS.filter((r) => !r.reply).map((r) => r.k);
export const reasonOf = (k?: string | null) => REASONS.find((r) => r.k === k) || null;
/**
 * A customer message that waits on us: To do. The AI's read of it (lib/ai/messageRead.ts, `ai_kind`) decides first,
 * whatever reason the customer picked (Nick, Nov 16 2026: "firm ship date, bag size… those are changes… it's not no
 * reply needed"): "todo" waits, "filed" doesn't. Not read yet, the reason decides (no reason counts as a question). Done
 * (applied, answered or filed: `handled_at`) never waits.
 */
export const needsReply = (m: { author_type: string; reason?: string | null; ai_kind?: string | null; handled_at?: string | null }) =>
  m.author_type === "customer" && !m.handled_at && (m.ai_kind ? m.ai_kind === "todo" : !NO_REPLY.includes(m.reason || ""));
/** the same for a query, inside .or(): only the messages that wait on us */
export const NEEDS_REPLY_FILTER = `and(handled_at.is.null,or(ai_kind.eq.todo,and(ai_kind.is.null,or(reason.is.null,reason.not.in.(${NO_REPLY.join(",")})))))`;

type Row = { reason?: string | null; id: string; order_id: string | null; project_id?: string | null; topic?: string | null; author_type: string; author_name: string | null; body: string; created_at: string; read_at: string | null; attachments?: Attachment[] | null };

/** Adds signed links (valid 1 hour) to each message's files. `sign` is a storage client allowed to read them. */
export async function withFiles(rows: Row[], sign: (paths: string[]) => Promise<(string | null)[]>): Promise<HubMsg[]> {
  const paths = rows.flatMap((r) => (r.attachments || []).map((a) => a.path));
  const urls = paths.length ? await sign(paths) : [];
  const map = new Map(paths.map((p, i) => [p, urls[i] || ""]));
  return rows.map((r) => ({
    id: r.id, order_id: r.order_id, project_id: r.order_id ? null : r.project_id || null, topic: r.order_id ? r.topic || "" : "", author_type: r.author_type === "staff" ? "staff" : "customer", author_name: r.author_name || "", body: r.body || "",
    created_at: r.created_at, read_at: r.read_at, reason: r.reason || null,
    files: (r.attachments || []).map((a) => ({ name: a.name, mime: a.mime, size: a.size, url: map.get(a.path) || "" })),
  }));
}

/** Only files this customer uploaded to their own message folder can be attached. */
export function cleanAttachments(list: unknown, customerId: string): Attachment[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).flatMap((a) => {
    const x = a as Partial<Attachment>;
    if (typeof x?.path !== "string" || !x.path.startsWith(`messages/${customerId}/`) || x.path.includes("..")) return [];
    return [{ path: x.path, name: String(x.name || "file").slice(0, 160), mime: String(x.mime || "application/octet-stream").slice(0, 100), size: Math.max(0, Math.min(+(x.size || 0), MAX_ATTACH)) }];
  });
}
export const attachNote = (a: Attachment[], where = "your portal") => (a.length ? `\n\n📎 ${a.length === 1 ? a[0].name : `${a.length} files`} attached. Open ${a.length === 1 ? "it" : "them"} in ${where}.` : "");
