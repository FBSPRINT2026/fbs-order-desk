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
type EmbFileLite = { at?: string; lastUsed?: unknown; path?: string; /** only the EMB came in (lib/embFile.ts): embroidery still confirms its DST */ embOnly?: boolean; emb?: { path: string } };
type EmbLite = { files?: EmbFileLite[]; request?: { at: string; changes?: string } | null };

export const embSpecsOf = (d: Pick<Design, "specs"> | null | undefined): EmbLite => (((d?.specs as { embroidery?: EmbLite } | null)?.embroidery) || {});

/**
 * A logo's stitch files, oldest first, each with its version number (Oct 29, Nick: "you got to show version one, which
 * was 6 inches wide. Then… version two, which is 4.02"). Every file the digitizer sends stays: a resize or a fix is the
 * next version, never a replacement. Files saved newest-first by older code are put back in order by when they came in.
 */
export function sewVersions<F extends EmbFileLite>(files: F[] | undefined): (F & { v: number })[] {
  return [...(files || [])].sort((a, b) => (a.at || "").localeCompare(b.at || "")).map((f, i) => ({ ...f, v: i + 1 }));
}
/** the file this print sews: the one the order names, else the logo's newest */
export function currentSewFile<F extends EmbFileLite>(im: Pick<Imprint, "emb">, files: F[] | undefined): F | undefined {
  const mine = im.emb?.file as F | undefined;
  // by its DST, or by its EMB: an EMB-only file confirmed later with its DST keeps its EMB (lib/sewAdd.ts)
  if (mine) return (files || []).find((x) => (x.path && x.path === mine.path) || (!!x.emb?.path && x.emb.path === mine.emb?.path)) || mine;
  const v = sewVersions(files);
  return v[v.length - 1];
}
/** what was asked of the digitizer for this print: on the logo, or on the print itself when there's no logo on file yet
 *  (a request sent from a mailbox outside the portal, lib/digitizerOutside.ts) */
export const requestOf = (im: Pick<Imprint, "emb">, d: Pick<Design, "specs"> | null | undefined) => embSpecsOf(d).request || im.emb?.request || null;

/** the print's live (not replaced) sew-out, from the order's sew-outs */
export const liveSewout = <S extends DgzSewout>(sws: S[], orderId: string, imprintId: string): S | undefined =>
  sws.find((x) => x.order_id === orderId && x.imprint_id === imprintId && !x.archived_at);

export function digitizeState(im: Pick<Imprint, "digitized" | "emb" | "sewoutCharge">, d: Pick<Design, "specs"> | null | undefined, live: DgzSewout | undefined): { state: DgzState; repeat: boolean; changes: boolean; needDst?: boolean } {
  // the logo's file is only the EMB (Nov 10, Nick: "if we have the EMB, that's good enough… but embroidery has to confirm
  // the DST file… upload it and say this is the right DST"): it counts as digitized, and asks embroidery for the DST
  { const e0 = embSpecsOf(d), f0 = currentSewFile(im, e0.files) || (im.emb?.file as EmbFileLite | undefined); if (f0?.embOnly) { const r = digitizeState0(im, d, live); return { ...r, needDst: true }; }
    // marked Already digitized with no stitch file anywhere (the logo nor the print): a repeat whose DST production has to
    // bring in (Nick, Nov 16 2026, #50051 Keeley: "I just need my production staff to upload the DSTs… where do they go?")
    if (im.digitized && !f0 && !(e0.files || []).length && !live) { const r = digitizeState0(im, d, live); return { ...r, needDst: true }; } }
  return digitizeState0(im, d, live);
}
function digitizeState0(im: Pick<Imprint, "digitized" | "emb" | "sewoutCharge">, d: Pick<Design, "specs"> | null | undefined, live: DgzSewout | undefined): { state: DgzState; repeat: boolean; changes: boolean } {
  if (live) return { state: live.status === "approved" ? "ok" : live.status === "pending" ? "sent" : "done", repeat: false, changes: false };
  const e = embSpecsOf(d), file = currentSewFile(im, e.files), req = requestOf(im, d);
  // the customer's own stitch file (a sew-out charged, Imprint.sewoutCharge): no digitizing, but it isn't a repeat either
  // until it has sewn here. It starts where the digitizer's files would land, at Pending sew-out (Nick, Nov 20 2026, #50171:
  // "anytime we do a sew out, it should just skip the first part of digitizing, take the DST, and then go through the same
  // process as if we just got it back from Volikes")
  const sewnHere = !!file && (!!file.lastUsed || (e.files || []).some((x) => x.lastUsed));
  if (im.sewoutCharge && !sewnHere && (file || im.emb?.file)) return { state: "done", repeat: false, changes: false };
  // a repeat: marked Already digitized, or the file sewed on an earlier job (Oct 28, Nick: "#40195… that's a repeat")
  if (im.digitized || (file && (file.lastUsed || (e.files || []).some((x) => x.lastUsed)))) return { state: "ok", repeat: true, changes: false };
  // sent back for changes: asked again until the fixed file comes in
  const lastAt = [...(e.files || []).map((x) => x.at || ""), (im.emb?.file as EmbFileLite | undefined)?.at || ""].sort().pop() || "";
  if (req?.changes && req.at > lastAt) return { state: "asked", repeat: false, changes: true };
  return { state: (e.files || []).length || im.emb?.file ? "done" : req ? "asked" : "need", repeat: false, changes: false };
}

/** the stamp on the order's print. `gray`: the details are estimates until the digitizer's files come back */
export function digitizeStamp(s: ReturnType<typeof digitizeState>): { title: string; sub: string; gray: boolean; tone: "gray" | "blue" | "warn" | "ok" } | null {
  if (s.needDst) return { title: "DST needed", sub: "Digitized (EMB in). Embroidery adds the DST to sew", gray: false, tone: "warn" };
  if (s.repeat) return null;
  switch (s.state) {
    case "need": return { title: "Needs digitizing", sub: "Stitches and price confirmed after sew-out", gray: true, tone: "gray" };
    case "asked": return s.changes ? { title: "Changes asked", sub: "Waiting on the digitizer's fixed file", gray: true, tone: "gray" } : { title: "Sent to the digitizer", sub: "Stitches and price confirmed after sew-out", gray: true, tone: "gray" };
    case "done": return { title: "Pending sew-out approval", sub: "Files received from digitizer", gray: false, tone: "blue" };
    case "sent": return { title: "Waiting on customer", sub: "Sew-out sent for approval", gray: false, tone: "warn" };
    case "ok": return { title: "Sew-out approved", sub: "Click to see the sew-out", gray: false, tone: "ok" };
  }
}

/** the Digitizing page opened on this print */
export const digitizingHref = (orderId: string, imprintId: string) => `/shop/digitizing?open=${encodeURIComponent(`${orderId}:${imprintId}`)}`;
