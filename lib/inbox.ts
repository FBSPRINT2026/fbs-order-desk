/**
 * Which customer emails still need an answer (shared by the Inbox and the dashboard so they always agree).
 * An email needs a reply when the AI drafted one (or a quote) or its triage says so, and nobody has answered it
 * since, or staff marked it "no reply needed". Answered means one of these came after it:
 *  - something we sent in the same thread (from Outlook or the portal);
 *  - any email we sent to that same person, even a fresh one outside the thread;
 *  - the customer wrote again later, in another thread, and that newer email has been answered: the conversation
 *    moved on (Shag Carpet, Oct 7: "New shirt" asked for a price, then "500 shirt order" placed it and got the reply).
 * Urgent = needs a reply and the AI rated it high urgency (rush, deadline within a week, same-day pickup, a problem).
 */

export type MailAct = {
  id: string; direction: string; occurred_at: string; external_id: string | null; thread_id: string | null; customer_id: string | null;
  from_email?: string | null; to_email?: string | null;
  meta: { references?: string[]; account_id?: string; ignored?: boolean; lead?: boolean; no_reply?: boolean; triage?: { needs_reply?: boolean; intent?: string; summary?: string; urgency?: string; urgent_reason?: string } } | null;
};
export type MailSug = { id: string; kind: string; status: string; activity_id: string | null };

export function mailRows<A extends MailAct, S extends MailSug>(acts: A[], sugs: S[]) {
  const out = acts.filter((x) => x.direction === "out");
  const ins = acts.filter((x) => x.direction === "in" && !x.meta?.ignored);
  const lc = (v?: string | null) => (v || "").toLowerCase();
  // answered in its own thread
  const inThread = (x: A) => out.some((o) => o.occurred_at > x.occurred_at && ((x.external_id && (o.meta?.references || []).includes(x.external_id)) || (o.thread_id && (o.thread_id === x.thread_id || o.thread_id === x.external_id))));
  const threadDone = new Set(ins.filter(inThread).map((x) => x.id));
  // we wrote to that same person afterwards (a fresh email counts)
  const wroteTo = (x: A) => !!x.from_email && out.some((o) => o.occurred_at > x.occurred_at && lc(o.to_email).split(/\s*,\s*/).includes(lc(x.from_email)));
  // the customer wrote again later and that newer email got its answer
  const movedOn = (x: A) => !!x.customer_id && ins.some((y) => y.id !== x.id && y.customer_id === x.customer_id && y.occurred_at > x.occurred_at && threadDone.has(y.id));
  return ins.map((x) => {
    const answered = threadDone.has(x.id) || wroteTo(x) || movedOn(x);
    const mine = sugs.filter((s) => s.activity_id === x.id);
    const reply = mine.find((s) => s.kind === "email_reply" && (s.status === "open" || s.status === "snoozed"));
    const quote = mine.find((s) => s.kind === "draft_order" && s.status === "open");
    const needs = !answered && !x.meta?.no_reply && (!!reply || !!quote || x.meta?.triage?.needs_reply === true);
    // urgent: still waiting on us and the customer needs it fast (the AI read a rush, a near deadline, a same-day pickup…)
    const urgent = needs && x.meta?.triage?.urgency === "high";
    return { x, answered, reply, quote, needs, urgent };
  });
}
