/** Messages between the shop and a customer: general ones, and one conversation per order. */
export type Attachment = { path: string; name: string; mime: string; size: number };
export type HubFile = { name: string; mime: string; size: number; url: string };
export type HubMsg = {
  id: string; order_id: string | null; author_type: "staff" | "customer"; author_name: string; body: string;
  created_at: string; read_at: string | null; files: HubFile[];
};
export type HubOrder = { id: string; number: number; nickname: string; status?: string; href: string };
export const MAX_ATTACH = 25 * 1024 * 1024;

type Row = { id: string; order_id: string | null; author_type: string; author_name: string | null; body: string; created_at: string; read_at: string | null; attachments?: Attachment[] | null };

/** Adds signed links (valid 1 hour) to each message's files. `sign` is a storage client allowed to read them. */
export async function withFiles(rows: Row[], sign: (paths: string[]) => Promise<(string | null)[]>): Promise<HubMsg[]> {
  const paths = rows.flatMap((r) => (r.attachments || []).map((a) => a.path));
  const urls = paths.length ? await sign(paths) : [];
  const map = new Map(paths.map((p, i) => [p, urls[i] || ""]));
  return rows.map((r) => ({
    id: r.id, order_id: r.order_id, author_type: r.author_type === "staff" ? "staff" : "customer", author_name: r.author_name || "", body: r.body || "",
    created_at: r.created_at, read_at: r.read_at,
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
