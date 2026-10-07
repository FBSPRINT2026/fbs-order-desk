import type { Group } from "@/lib/pricing";

/**
 * "Create order" from a customer email (Inbox): the AI reads the email and its attachments and suggests an order
 * that staff check and create. Shared between the server (lib/ai/emailOrder.ts) and the Inbox panel.
 *  - New order: built from scratch (garments and sizes from the email or the attached sheet, prints with the art,
 *    the customer's mockup, where their goods are coming from).
 *  - Reorder: a past job (portal order or Printavo invoice) copied with the new quantities.
 */
export type EOFile = { path: string; name: string; type: string; size: number; role: "art" | "mockup" | "sheet" | "signature" | "other"; what?: string; url?: string };
/** a past job of this customer that a reorder can start from */
export type PastJob = {
  /** "o:<order id>" or "a:<archived order id>" */ ref: string;
  label: string; date: string; qty: number; groups: Group[];
  /** for Printavo jobs: where the art and mockups are kept */ note?: string;
};
export type EODraft = {
  v: 2; kind: "new" | "reorder"; summary: string; confidence: "high" | "medium" | "low";
  nickname: string; due_date: string | null; delivery: "pickup" | "ship" | "deliver"; ship_to: string; po_number: string; notes: string;
  /** customer supplied garments (wholesale): who sends them, from where, when */
  goods: { supplied: boolean; supplier: string; expected: string; note: string };
  groups: Group[];
  /** art file (storage path) per imprint id, made into a design when the order is created */
  art: Record<string, string>;
  /** the customer's mockup files (storage paths) per group id */
  mockups: Record<string, string[]>;
  /** the past job a reorder copies (PastJob.ref) */
  reorderOf: string | null;
  questions: string[];
  files: EOFile[];
};
export const ROLE_LABEL: Record<EOFile["role"], string> = { art: "Art", mockup: "Mockup", sheet: "Size sheet", signature: "Email signature (ignored)", other: "Other" };
/**
 * Pictures that are the sender's email signature (their logo, social icons), not art: a nameless picture under
 * 120 KB ("image.png", "image001.jpg", "Outlook-xyz.png"), or one that came with their other emails too.
 */
export const GENERIC_PIC = /^(image|img|logo|signature|sig|outlook[-\w]*|~wrl\d*)[-_ ]?\d*\.(png|jpe?g|gif|bmp)$/i;
export const looksLikeSignature = (f: Pick<EOFile, "type" | "name" | "size">) => isPicture(f) && GENERIC_PIC.test(f.name.trim()) && f.size < 120 * 1024;
export const isPicture = (f: Pick<EOFile, "type" | "name">) => /^image\/(png|jpe?g|gif|webp)$/i.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
