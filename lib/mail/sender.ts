/**
 * Who an email is from (Oct 12, Amanda: "an email from Kelly Silver also showed Brittany Kuehnhold, who has nothing to do
 * with it"). A sender from a customer's domain is matched to that customer, but the customer's own contact name is
 * theirs, not the sender's: show the customer's company when there is one, the customer's name only when it's that
 * same person, and otherwise the sender's own name ("Haley-Silber, Kelly" → "Kelly Haley-Silber").
 */
export const personName = (n?: string | null) => {
  const t = String(n || "").replace(/["']/g, "").replace(/\s+/g, " ").trim();
  const m = /^([^,@]+),\s*([^,@]+)$/.exec(t);
  return m ? `${m[2].trim()} ${m[1].trim()}` : t;
};
export function senderLabel(fromName: string | null | undefined, fromEmail: string | null | undefined, cust?: { company?: string | null; name?: string | null; email?: string | null } | null) {
  const own = personName(fromName) || String(fromEmail || "");
  if (!cust) return own;
  if (cust.company) return cust.company;
  if (cust.name && cust.email && fromEmail && cust.email.toLowerCase() === fromEmail.toLowerCase()) return cust.name;
  return own || cust.name || "";
}
