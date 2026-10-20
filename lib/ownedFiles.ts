/**
 * The files an order owns, the only ones its Delete may remove from storage (Oct 20: deleting a reorder of Printavo
 * #32668 also deleted the old job's own art PDFs, which the reorder listed in its production files, so every later
 * reorder of The Bottles found no art). Shared files are never removed with an order: the Printavo archive's copies
 * (printavo/…), logos (designs/…), customer mockups (mockups/…), email attachments (emails/…).
 */
export const ownedFiles = (orderId: string, paths: (string | null | undefined)[]) =>
  [...new Set(paths.filter((p): p is string => !!p && (p.startsWith(`${orderId}/`) || p.startsWith(`art/${orderId}/`))))];
