// Ready-to-send customer messages. Used by the Assistant's follow-up drafts and the
// quick replies in the order editor. Plain text; {placeholders} are filled by fillTemplate().
// When AI is on, these are the starting point it rewrites, so keep them short and friendly.

export type TemplateKey =
  | "quote_followup" | "quote_followup_soon" | "proof_ready" | "proof_followup" | "payment_reminder" | "deposit_request"
  | "ready_pickup" | "shipped" | "request_received" | "reorder_checkin" | "annual_reorder" | "thanks";

export type TemplateVars = {
  first?: string; number?: string | number; job?: string; total?: string; balance?: string; due?: string; days?: string | number;
  tracking?: string; shop?: string; phone?: string; lastJob?: string; lastDate?: string;
};

export const TEMPLATES: Record<TemplateKey, { label: string; subject: string; body: string }> = {
  quote_followup: {
    label: "Quote follow-up",
    subject: "Checking in on quote #{number}",
    body: "Hi {first},\n\nJust checking in on quote #{number} for {job} ({total}). Any questions, or anything you'd like changed? When it looks right, you can approve it in your portal and we'll get started.\n\nThanks!",
  },
  quote_followup_soon: {
    label: "Quote follow-up (date coming up)",
    subject: "Quote #{number}: approve by soon to make {due}",
    body: "Hi {first},\n\nQuick heads-up on quote #{number} for {job}. To have everything in hand by {due}, we need your approval in the next day or two so we can order garments and set up screens. You can approve it in your portal, or let us know what to change.\n\nThanks!",
  },
  proof_ready: {
    label: "Proof is ready",
    subject: "Your artwork proof for #{number} is ready",
    body: "Hi {first},\n\nYour proof for {job} is ready in your portal. Please check spelling, colors, size and placement, then approve it or tell us what to change. We start printing as soon as it's approved.\n\nThanks!",
  },
  proof_followup: {
    label: "Proof reminder",
    subject: "Waiting on your proof approval for #{number}",
    body: "Hi {first},\n\nYour artwork proof for {job} has been waiting {days} days. We can't start printing until it's approved, so please take a quick look in your portal when you get a minute.{dueLine}\n\nThanks!",
  },
  payment_reminder: {
    label: "Payment reminder",
    subject: "Balance due on order #{number}",
    body: "Hi {first},\n\nA friendly reminder that order #{number} ({job}) has a balance of {balance}{dueText}. You can pay it online in your portal.\n\nThank you!",
  },
  deposit_request: {
    label: "Deposit to start",
    subject: "Deposit for order #{number}",
    body: "Hi {first},\n\nThanks for approving order #{number}! To get it into production we just need the deposit. You can pay it online in your portal.\n\nThanks!",
  },
  ready_pickup: {
    label: "Ready for pickup",
    subject: "Order #{number} is ready!",
    body: "Hi {first},\n\nGood news: {job} (#{number}) is ready for pickup.{balanceLine} Let us know when you're coming by.\n\nThanks!",
  },
  shipped: {
    label: "Shipped",
    subject: "Order #{number} has shipped",
    body: "Hi {first},\n\n{job} (#{number}) is on its way. Tracking: {tracking}\n\nThanks for your order!",
  },
  request_received: {
    label: "Got your request",
    subject: "We got your order request #{number}",
    body: "Hi {first},\n\nThanks for sending in {job}! We're checking the garments and artwork now and will send it back priced for your OK shortly.\n\nThanks!",
  },
  reorder_checkin: {
    label: "Reorder check-in",
    subject: "Need anything printed?",
    body: "Hi {first},\n\nIt's been a little while since your last order ({lastJob}, {lastDate}). If you've got anything coming up, we'd love to help. You can start an order or reorder a past one right from your portal.\n\nThanks!",
  },
  annual_reorder: {
    label: "Annual reorder",
    subject: "Time for {lastJob} again?",
    body: "Hi {first},\n\nThis time last year we printed {lastJob} for you. If you're doing it again this year, you can reorder it in one click from your portal, and we'll update anything that changed.\n\nThanks!",
  },
  thanks: {
    label: "Thank you",
    subject: "Thanks for your order!",
    body: "Hi {first},\n\nThanks again for your order. We hope everything looks great! If you need anything else, just reply here.\n\nThanks!",
  },
};

/** First name from a contact name ("Dana Ruiz" -> "Dana"). Falls back to "there". */
export function firstName(name?: string | null) {
  const f = (name || "").trim().split(/\s+/)[0];
  return f || "there";
}

/** Replace {placeholders}; unknown ones become blank. */
export function fillTemplate(text: string, v: TemplateVars & Record<string, string | number | undefined>) {
  return text.replace(/\{(\w+)\}/g, (_, k) => {
    const x = (v as Record<string, unknown>)[k];
    return x === undefined || x === null ? "" : String(x);
  }).replace(/\n{3,}/g, "\n\n");
}

export function renderTemplate(key: TemplateKey, v: TemplateVars & Record<string, string | number | undefined>) {
  const t = TEMPLATES[key];
  return { subject: fillTemplate(t.subject, v), body: fillTemplate(t.body, v) };
}
