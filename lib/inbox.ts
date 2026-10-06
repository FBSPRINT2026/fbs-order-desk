/**
 * Which customer emails still need an answer (shared by the Inbox and the dashboard so they always agree).
 * An email needs a reply when the AI drafted one (or a quote) or its triage says so, and nobody has answered it
 * since: answered = something we sent later in the same thread (from Outlook or the portal), or staff marked it
 * "no reply needed".
 */

export type MailAct = {
  id: string; direction: string; occurred_at: string; external_id: string | null; thread_id: string | null; customer_id: string | null;
  meta: { references?: string[]; account_id?: string; ignored?: boolean; lead?: boolean; no_reply?: boolean; triage?: { needs_reply?: boolean; intent?: string; summary?: string } } | null;
};
export type MailSug = { id: string; kind: string; status: string; activity_id: string | null };

export function mailRows<A extends MailAct, S extends MailSug>(acts: A[], sugs: S[]) {
  const out = acts.filter((x) => x.direction === "out");
  return acts.filter((x) => x.direction === "in" && !x.meta?.ignored).map((x) => {
    const answered = out.some((o) => o.occurred_at > x.occurred_at && ((x.external_id && (o.meta?.references || []).includes(x.external_id)) || (o.thread_id && (o.thread_id === x.thread_id || o.thread_id === x.external_id))));
    const mine = sugs.filter((s) => s.activity_id === x.id);
    const reply = mine.find((s) => s.kind === "email_reply" && (s.status === "open" || s.status === "snoozed"));
    const quote = mine.find((s) => s.kind === "draft_order" && s.status === "open");
    const needs = !answered && !x.meta?.no_reply && (!!reply || !!quote || x.meta?.triage?.needs_reply === true);
    return { x, answered, reply, quote, needs };
  });
}
