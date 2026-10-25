import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pdfTextServer } from "@/lib/pdfTextServer";
import { supplierConfirmRows } from "@/lib/supplierConfirm";

/**
 * Is an old job's PDF paperwork (a supplier's order confirmation, a PO, an invoice, a packing slip), not a mockup or art?
 * (Oct 24, Nick, searching old orders in Customer artwork: "just remember to ignore these still": #34502's picture was
 * its S&S order confirmation.) Read from the PDF's words; remembered while this server is warm.
 */
const seen = new Map<string, boolean>();
const PAPER = /\b(order confirmation|purchase order|packing (slip|list)|bill to\s*:|ship to\s*:|remit to|invoice (number|#|date)|sales order|po number\s*:)/i;
export async function isPaperworkPdf(admin: SupabaseClient, path: string): Promise<boolean> {
  if (seen.has(path)) return seen.get(path)!;
  let yes = false;
  try {
    const { data } = await admin.storage.from("proofs").download(path);
    if (data && data.size < 8 * 1024 * 1024) {
      const tx = await pdfTextServer(new Uint8Array(await data.arrayBuffer()), 2);
      yes = supplierConfirmRows(tx).length > 0 || PAPER.test(tx);
    }
  } catch { yes = false; }
  seen.set(path, yes);
  return yes;
}
/** the Filepicker handle in a Printavo file's name: a PDF and the picture made of it share it */
export const fpHandle = (name: string) => name.match(/filepicker\.io\/([A-Za-z0-9]{12,})(?:[?+][^/]*)?$/)?.[1] || "";
