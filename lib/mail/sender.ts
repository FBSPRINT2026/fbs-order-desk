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
  // the person who wrote it, then their company (Oct 20, Nick: "I'd rather just say, like, Cassidy from Dear Heart
  // Designs… there's two people within Dear Hearts"): "Kassidy from Dear Heart Designs"
  const first = personName(fromName).split(/\s+/)[0] || String(fromEmail || "").split("@")[0];
  // a sender named for the company itself ("Dear Heart Designs <orders@…>") is just the company
  const co = cust.company?.toLowerCase() || "";
  if (cust.company) return first && own && !co.includes(own.toLowerCase()) && !own.toLowerCase().includes(co) ? `${first} from ${cust.company}` : cust.company;
  if (cust.name && cust.email && fromEmail && cust.email.toLowerCase() === fromEmail.toLowerCase()) return cust.name;
  return own || cust.name || "";
}

/**
 * Whose email it is (Oct 12): each person sees only email that came to them. An email stored once under one mailbox
 * can have been sent to both owners (States Made's POs to Amanda and Nick): it's theirs when it came to their mailbox
 * or their address is on its To / Cc. Email that came in some other way (no mailbox: a web form) is everyone's.
 */
export function emailIsMine(x: { to_email?: string | null; direction?: string; meta?: { account_id?: string; cc?: string[] } | null }, myAccountId: string | null, myAddress: string | null) {
  const acct = x.meta?.account_id;
  if (!acct) return true;
  if (myAccountId && acct === myAccountId) return true;
  if (!myAddress || x.direction === "out") return false;
  const me = myAddress.toLowerCase();
  return [x.to_email || "", ...(x.meta?.cc || [])].join(",").toLowerCase().split(/[,;\s<>]+/).includes(me);
}
