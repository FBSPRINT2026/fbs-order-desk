import type { Design, Imprint } from "@/lib/pricing";

/**
 * Where an embroidered print is in digitizing: THE one answer for every place that shows it (the Digitizing page's
 * tabs and the order's print stamps), so they can't disagree (Oct 28, Nick: "reflect the statuses that we have in the
 * digitizing thing… this one is ready to be sewn out… it should say pending sew out approval").
 *
 *   need  → no file yet, not asked                     (order: "Needs digitizing", the print grayed out)
 *   asked → asked the digitizer, or sent back for changes (order: "Sent to the digitizer" / "Changes asked", grayed)
 *   done  → their files are in, sew it out              (order: "Pending sew-out approval", details shown)
 *   sent  → the sew-out photo is out to the customer    (order: "Waiting on customer")
 *   ok    → the sew-out was approved, or a repeat (the file sewed before / marked Already digitized)
 */
export type DgzState = "need" | "asked" | "done" | "sent" | "ok";
export type DgzSewout = { order_id: string; imprint_id: string; status: "pending" | "approved" | "changes"; archived_at: string | null; photo_path?: string; sent_at?: string | null; decided_at?: string | null; created_at?: string; version?: number };
type EmbFileLite = { at?: string; lastUsed?: unknown };
type EmbLite = { files?: EmbFileLite[]; request?: { at: string; changes?: string } | null };

export const embSpecsOf = (d: Pick<Design, "specs"> | null | undefined): EmbLite => (((d?.specs as { embroidery?: EmbLite } | null)?.embroidery) || {});

/** the print's live (not replaced) sew-out, from the order's sew-outs */
export const liveSewout = <S extends DgzSewout>(sws: S[], orderId: string, imprintId: string): S | undefined =>
  sws.find((x) => x.order_id === orderId && x.imprint_id === imprintId && !x.archived_at);

export function digitizeState(im: Pick<Imprint, "digitized" | "emb">, d: Pick<Design, "specs"> | null | undefined, live: DgzSewout | undefined): { state: DgzState; repeat: boolean; changes: boolean } {
  if (live) return { state: live.status === "approved" ? "ok" : live.status === "pending" ? "sent" : "done", repeat: false, changes: false };
  const e = embSpecsOf(d), file = (im.emb?.file || e.files?.[0]) as EmbFileLite | undefined;
  // a repeat: marked Already digitized, or the file sewed on an earlier job (Oct 28, Nick: "#40195… that's a repeat")
  if (im.digitized || (file && (file.lastUsed || (e.files || []).some((x) => x.lastUsed)))) return { state: "ok", repeat: true, changes: false };
  // sent back for changes: asked again until the fixed file comes in
  const lastAt = [...(e.files || []).map((x) => x.at || ""), (im.emb?.file as EmbFileLite | undefined)?.at || ""].sort().pop() || "";
  if (e.request?.changes && e.request.at > lastAt) return { state: "asked", repeat: false, changes: true };
  return { state: (e.files || []).length || im.emb?.file ? "done" : e.request ? "asked" : "need", repeat: false, changes: false };
}

/** the stamp on the order's print. `gray`: the details are estimates until the digitizer's files come back */
export function digitizeStamp(s: ReturnType<typeof digitizeState>): { title: string; sub: string; gray: boolean; tone: "gray" | "blue" | "warn" | "ok" } | null {
  if (s.repeat) return null;
  switch (s.state) {
    case "need": return { title: "Needs digitizing", sub: "Stitches and price confirmed after sew-out", gray: true, tone: "gray" };
    case "asked": return s.changes ? { title: "Changes asked", sub: "Waiting on the digitizer's fixed file", gray: true, tone: "gray" } : { title: "Sent to the digitizer", sub: "Stitches and price confirmed after sew-out", gray: true, tone: "gray" };
    case "done": return { title: "Pending sew-out approval", sub: "Files are in: sew it out", gray: false, tone: "blue" };
    case "sent": return { title: "Waiting on customer", sub: "Sew-out sent for approval", gray: false, tone: "warn" };
    case "ok": return { title: "Sew-out approved", sub: "Click to see the sew-out", gray: false, tone: "ok" };
  }
}

/** the Digitizing page opened on this print */
export const digitizingHref = (orderId: string, imprintId: string) => `/shop/digitizing?open=${encodeURIComponent(`${orderId}:${imprintId}`)}`;
