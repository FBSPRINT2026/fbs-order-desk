/**
 * THE subject line of every email a customer gets about an order: the number first, then what it is, then the job's
 * name (Oct 29, Nick: "every customer email regarding a job should start with the order number… so it's really easy for
 * Outlook… to group it… 40208 shipped, 40208 sew-out and invoice ready, 40208 on hold").
 *   "#40208 Sew-out and invoice ready for approval · Embark LL Bean Tote"
 */
export function orderSubject(number: number | string, what: string, nickname?: string | null): string {
  const name = (nickname || "").trim();
  return `#${number} ${what.trim()}${name ? ` · ${name}` : ""}`;
}
