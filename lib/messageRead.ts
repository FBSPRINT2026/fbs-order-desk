/**
 * What the AI made of a customer's message (Nick, Nov 16 2026: "an AI function on our side to the message center…
 * would you like me to update the shipping address to this? Or… I added 2 garments… this can be smart"). Read by
 * lib/ai/messageRead.ts with the order, kept on the message (messages.ai, messages.ai_kind), and shown as one card under
 * the message wherever it shows (components/MsgAiCard.tsx: the Job Center's FBS Messages and a job's timeline).
 */
export type MsgChange = { what: "print" | "line" | "art" | "order"; id: string; field: string; value: string; say: string };
export type MsgRead = {
  v: 1; at: string;
  /** todo: something to change, answer or do; filed: nothing for us to do */
  kind: "todo" | "filed";
  /** change: on the order; answer: a question to answer; act: something to do that isn't an order field; nothing */
  need: "change" | "answer" | "act" | "nothing";
  /** one short line for staff: "Make the ship date firm: Nov 28" */
  head: string;
  /** the button that does it: "Make it firm" */
  btn?: string;
  /** the order's fields now → after ("Ship to", "Pickup", "Ship to Sanford Contractors…") */
  ba?: { k: string; was: string; now: string }[];
  /** each change in a few words, for the ones that aren't a single field (a garment added, a color changed) */
  says?: string[];
  /** what Apply makes, through the AI order helper's applyChanges (lib/ai/orderFix.ts) */
  changes?: MsgChange[];
  /** a reply for them, written for staff to check and send (never sent by itself) */
  reply?: string;
  /** something to open instead of a change: Create DTF gang sheet, Order goods… */
  tool?: { label: string; href: string } | null;
  /** earlier messages in the same run this read covers (read together; Apply finishes them all) */
  covers?: string[];
  /** read as part of a later message's run: that message holds the read */
  coveredBy?: string;
  /** Apply pressed */
  done?: { at: string; by: string; applied: string[] };
  /** "Not this": what staff said instead (kept and shown to the next reads, so it learns) */
  no?: { at: string; by: string; note?: string };
  /** made by code, no AI (the portal's goods form) */
  auto?: boolean;
  err?: string;
};
