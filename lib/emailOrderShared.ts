import type { Group } from "@/lib/pricing";

/**
 * "Create order" from a customer email (Inbox): the AI reads the email and its attachments and suggests an order
 * that staff check and create. Shared between the server (lib/ai/emailOrder.ts) and the Inbox panel.
 *  - New order: built from scratch (garments and sizes from the email or the attached sheet, prints with the art,
 *    the customer's mockup, where their goods are coming from).
 *  - Reorder: a past job (portal order or Printavo invoice) copied with the new quantities.
 */
export type EOFile = { path: string; name: string; type: string; size: number; role: "art" | "mockup" | "sheet" | "signature" | "other"; what?: string; url?: string;
  /** a PNG picture of an .ai / EPS / PDF (made in the browser): the design's preview, so mockups work right away */ preview?: string;
  /** a customer's mockup sheet (Oct 22, Hutchins' setup PDF): the page with the art and spec box, the garment page */
  sheet?: { artPage: number; mockupPage: number };
  /** its label in the order's Production files (lib/productionFileKinds.ts), e.g. "customer_mockup" */
  kind?: string };
/** a past job of this customer that a reorder can start from */
export type PastJob = {
  /** "o:<order id>" or "a:<archived order id>" */ ref: string;
  label: string; date: string; qty: number; groups: Group[];
  /** for Printavo jobs: where the art and mockups are kept */ note?: string;
  /** a Printavo job's own notes, as text (a reorder can carry them over to production) */
  oldNotes?: { customer: string; production: string };
};

/**
 * Carrying the old Printavo job's notes over to a reorder (Oct 21, Nick: "give us the option of carrying over production
 * customer notes… sometimes customer notes will be like a shipping address and that's not important. But sometimes like
 * this one, it's actual color information"). Ticked by default when the note talks about the print (inks, colors, size).
 */
export const oldNoteText = (s: unknown) => String(s ?? "").replace(/<br\s*\/?>|<\/(div|p|li)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
export const aboutThePrint = (t: string) => /\bpms\b|\b\d{3,4}\s?c\b|\binks?\b|\bcolou?rs?\b|\bc\s?=\s?\d|\bscreens?\b|\bunderbase\b|\bflash\b|\bmesh\b|\b\d+(\.\d+)?\s?("|in\b|inch)|\b(front|back|sleeve|chest)\b/i.test(t);
export type CarryKey = "customer" | "production";
/** which of the old job's notes go to the reorder: what staff ticked, else the ones about the print */
export const carryOf = (d: { carry?: CarryKey[] }, n: { customer: string; production: string }): CarryKey[] =>
  d.carry ?? (["customer", "production"] as CarryKey[]).filter((k) => n[k] && aboutThePrint(n[k]));
export type EODraft = {
  v: 2; kind: "new" | "reorder"; summary: string; confidence: "high" | "medium" | "low";
  /** the customer's own notes for the job, word for word (their ClickUp notes, the PO's instructions): the order's Customer notes */
  customerNotes?: string;
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
  /** one order reordering several past jobs (one per design): every job's ref, the first is reorderOf */
  reorderJobs?: string[];
  /** a reorder where the customer attached the art: staff choose their files or the old jobs' (QuickOrder asks) */
  emailArt?: boolean;
  questions: string[];
  /** what doesn't add up, asked of staff BEFORE the order is made (Oct 22, Nick: "when there's a clear contradiction, or I
   *  can't find this product… you need to just ask… then remember it moving forward"): the question and the AI's guess */
  check?: { q: string; guess: string; /** the group it's about (its name) */ about?: string; /** answers to click, the first the guess; a file's are picked by its picture */ choices?: { label: string; path?: string; name?: string }[] }[];
  /** the file and page that pictures each group's print (by group name), shown beside the art at the check */
  shown?: { about: string; path: string; name: string; page: number }[];
  /** what the reorder's art pull couldn't do (no film found, flat mockup…): for production, not the customer */
  artNotes?: string[];
  /** a reorder of a Printavo job: what its notes say about the prints, for production to confirm (lib/ai/oldJobNotes.ts) */
  prodSuggest?: string;
  /** the old Printavo job's notes to carry over to production (unset: the ones about the print) */
  carry?: CarryKey[];
  /** what staff told the AI before it read the email ("it's a reorder of 31174, art is on the old job") */
  told?: string;
  /** the AI read it as a reorder (even when it couldn't tell which job) */
  looksReorder?: boolean;
  /** staff said yes to "I found this job: place a reorder?" */
  reorderOk?: boolean;
  /** what was looked up online for staff's note (team PMS colors…), with sources */
  lookedUp?: { text: string; sources: { title: string; url: string }[] };
  files: EOFile[];
  /** one of several orders read from the same email */
  part?: EOPart;
};
/**
 * One order of several in the same email (Oct 20, Nick: Dear Heart's "Buc-ee's Reorders + Warehouse Restock" is four
 * reorders, one per design, each with its own S&S sheets named for the design). Made by lib/ai/emailPlan.ts.
 */
export type EOPart = {
  /** a short key (the design), unique within the email */ key: string;
  /** the conversation's first email: where the plan and these orders' drafts are kept */ anchor?: string;
  label: string; kind: "new" | "reorder"; of: number;
  /** the past job to copy (PastJob.ref) and its label */ job: string | null; jobLabel?: string;
  /** what's different from the past job ("" = an exact reprint) */ changes: string;
  /** its files (storage paths) and their names (the same file sent again in a reply) */ files: string[]; names?: string[];
  /** the pieces the sheets' names add up to ("…-400PCS.pdf"), to check the order against */ pieces?: number;
};
export const ROLE_LABEL: Record<EOFile["role"], string> = { art: "Art", mockup: "Mockup", sheet: "Size sheet", signature: "Email signature (ignored)", other: "Other" };
/**
 * Pictures that are the sender's email signature (their logo, social icons), not art: a nameless picture under
 * 120 KB ("image.png", "image001.jpg", "Outlook-xyz.png"), or one that came with their other emails too.
 */
export const GENERIC_PIC = /^(image|img|logo|signature|sig|outlook[-\w]*|~wrl\d*)[-_ ]?\d*\.(png|jpe?g|gif|bmp)$/i;
export const looksLikeSignature = (f: Pick<EOFile, "type" | "name" | "size">) => isPicture(f) && GENERIC_PIC.test(f.name.trim()) && f.size < 120 * 1024;
export const isPicture = (f: Pick<EOFile, "type" | "name">) => /^image\/(png|jpe?g|gif|webp)$/i.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
