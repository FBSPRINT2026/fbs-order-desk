/**
 * Order statuses in two layers (Oct 21, Nick, the "Order statuses: customer-facing and internal" doc):
 *  - the customer status: a dozen plain words the customer sees (portal, emails, invoice), never film, screens or press;
 *  - the shop's stage: the step the job is on, per method, plus flags/holds beside it.
 * Every job is approved, its proof approved, then scheduled; then each method has its own prep; then goods counted in,
 * on press, finishing, QC, packing, out the door. Some steps tick off from what already happens (separations, film,
 * the schedule, the press timer, goods check-in, shipping); the rest are checked off by hand (orders.stage_checks).
 * Orders run from Printavo (the 40,000s sent there) keep Printavo's status: this is for orders run here.
 */
export type StepKey =
  | "approved" | "proof" | "scheduled"
  | "supplies" | "seps" | "film" | "film_checked" | "screens"
  | "thread" | "digitized" | "sewout" | "sewout_ok"
  | "dtf_supplies" | "gang" | "transfers" | "transfers_ok"
  | "goods" | "on_press" | "finishing" | "qc" | "packing" | "out";
export type Step = { key: StepKey; label: string; group: "start" | "screen" | "embroidery" | "dtf" | "finish";
  /** how it ticks off by itself; none = checked off by hand */ auto?: string };

export const STEPS: Step[] = [
  { key: "approved", label: "Approved", group: "start", auto: "the order is approved" },
  { key: "proof", label: "Proof approved", group: "start", auto: "the customer approves the proof (or staff mark the art approved)" },
  { key: "scheduled", label: "Scheduled", group: "start", auto: "it's on the production schedule" },
  { key: "supplies", label: "Supplies checked: inks", group: "screen" },
  { key: "seps", label: "Separations made", group: "screen", auto: "every screen print has its separation (or its film)" },
  { key: "film", label: "Film printed", group: "screen", auto: "Print Films in Separations, or the film is on file / in the drawer" },
  { key: "film_checked", label: "Film checked", group: "screen", auto: "Film looks good on the production mockup" },
  { key: "screens", label: "Screens burned", group: "screen" },
  { key: "thread", label: "Thread on hand or ordered", group: "embroidery" },
  { key: "digitized", label: "Digitized", group: "embroidery" },
  { key: "sewout", label: "Sew-out sample", group: "embroidery" },
  { key: "sewout_ok", label: "Sew-out approved", group: "embroidery" },
  { key: "dtf_supplies", label: "Supplies checked", group: "dtf" },
  { key: "gang", label: "Gang sheet built", group: "dtf" },
  { key: "transfers", label: "Transfers printed", group: "dtf" },
  { key: "transfers_ok", label: "Transfers checked", group: "dtf" },
  { key: "goods", label: "Goods counted in", group: "finish", auto: "the goods are checked in (Goods & Receiving or the phone)" },
  { key: "on_press", label: "On press", group: "finish", auto: "the press timer starts or the schedule says running" },
  { key: "finishing", label: "Curing, finishing", group: "finish" },
  { key: "qc", label: "QC and count", group: "finish" },
  { key: "packing", label: "Packing", group: "finish" },
  { key: "out", label: "Ready or shipped", group: "finish", auto: "the order is Ready, or its shipment is shipped" },
];
export const STEP: Record<StepKey, Step> = Object.fromEntries(STEPS.map((s) => [s.key, s])) as Record<StepKey, Step>;

/** the steps an order goes through: the start, each method it has, the finish */
export function stepsFor(methods: string[]): Step[] {
  const m = new Set(methods.map((x) => (x === "embroidery" ? "embroidery" : x === "dtf" || x === "heat" ? "dtf" : "screen")));
  return STEPS.filter((s) => s.group === "start" || s.group === "finish" || m.has(s.group));
}

export type Check = { by: string; at: string; auto?: boolean; note?: string };
export type FlagKey = "hold_customer" | "hold_payment" | "hold_shop" | "rush" | "firm" | "goods_issue" | "customer_goods" | "art_problem" | "misprint" | "press_approval" | "partial" | "delayed" | "goods_wrong";
export type Flag = { key: FlagKey; note?: string; by: string; at: string; /** Delayed: the new date */ date?: string };
export const FLAGS: { key: FlagKey; label: string; hold?: boolean; /** what the customer sees (null: nothing) */ customer: ((f: Flag) => string) | null }[] = [
  { key: "hold_customer", label: "On hold: waiting on customer", hold: true, customer: (f) => `Waiting on you${f.note ? `: ${f.note}` : ""}` },
  { key: "hold_payment", label: "On hold: payment / deposit", hold: true, customer: () => "Payment needed to start" },
  { key: "hold_shop", label: "On hold: shop", hold: true, customer: null },
  { key: "delayed", label: "Delayed (customer sees it)", customer: (f) => `Delayed${f.note ? `: ${f.note}` : ""}${f.date ? `. New date ${f.date}` : ""}` },
  { key: "rush", label: "Rush", customer: null },
  { key: "firm", label: "Firm date", customer: null },
  { key: "goods_issue", label: "Goods short / damaged / backordered", customer: null },
  { key: "customer_goods", label: "Customer-supplied goods expected", customer: () => "Waiting on your garments" },
  // the garments they sent us are wrong, short or damaged (Oct 24, Nick: "the goods showed up and they picked the order
  // wrong and we need to get those replaced")
  { key: "goods_wrong", label: "On hold: their goods are wrong / short", hold: true, customer: (f) => `On hold: a problem with the garments you sent${f.note ? `: ${f.note}` : ""}` },
  { key: "art_problem", label: "Art problem", customer: (f) => `Waiting on you: a better art file${f.note ? ` (${f.note})` : ""}` },
  { key: "misprint", label: "Misprint / reprint needed", customer: null },
  { key: "press_approval", label: "Approval at press", customer: () => "We'll send a photo of the first print to approve" },
  { key: "partial", label: "Partial ship / split delivery", customer: () => "Part of your order shipped" },
];

/** what ticked off on its own, worked out on the server (lib/orderStagesServer.ts) */
export type AutoFacts = Partial<Record<StepKey, Check>>;
export type StageState = { steps: (Step & { done: Check | null })[]; current: Step | null; next: string };

export function stageOf(methods: string[], auto: AutoFacts, manual: Partial<Record<StepKey, Check>>): StageState {
  const steps = stepsFor(methods).map((s) => ({ ...s, done: manual[s.key] || auto[s.key] || null }));
  const current = steps.find((s) => !s.done) || null;
  return { steps, current, next: current ? current.label : "Done" };
}

export type CustomerStatus = { key: string; label: string; text: string };
/**
 * What the customer sees, from the order's status, its flags and how it leaves. Everything in the shop between proof
 * approval and out the door is "In production"; a hold the customer must act on, or a delay staff mark, shows instead.
 */
export function customerStatus(o: { status: string; flags?: Flag[] | null; delivery_method?: string | null; type?: string | null }, extra: { proofSent?: boolean; shipped?: boolean; delivered?: boolean; changesRequested?: boolean } = {}): CustomerStatus {
  const flags = (o.flags || []) as Flag[];
  const flag = (k: FlagKey) => flags.find((f) => f.key === k);
  const say = (key: string, label: string, text: string) => ({ key, label, text });
  if (o.status === "void") return say("canceled", "Canceled", "This order was canceled.");
  if (o.status === "request") return say("request", "Sent to FBS", "We got your order and we're checking it. You'll get a message when we confirm.");
  if (o.status === "quote") return say("quote", "Quote in progress", "We're putting your quote together.");
  if (o.status === "quote_sent") return extra.changesRequested ? say("changes", "Changes requested", "We're updating your quote.") : say("quote_sent", "Quote sent", "Your quote is ready to review and approve.");
  if (o.status === "completed") return say("completed", "Completed", "Completed. Thank you!");
  // a hold the customer must act on, or a delay, comes first
  for (const k of ["hold_customer", "art_problem", "goods_wrong", "hold_payment", "customer_goods", "delayed"] as FlagKey[]) {
    const f = flag(k); const def = FLAGS.find((x) => x.key === k);
    if (f && def?.customer) return k === "customer_goods" ? say("goods", "Waiting on goods", def.customer(f)) : say(k === "delayed" ? "delayed" : "waiting", k === "delayed" ? "Delayed" : "Waiting on you", def.customer(f));
  }
  if (o.status === "blanks") return say("goods", "Waiting on goods", "Your garments are on the way to us. When they're in and counted, we print.");
  if (o.status === "ready") {
    if (extra.delivered) return say("delivered", "Delivered", "Delivered.");
    if (extra.shipped || flag("partial")) return say("shipped", flag("partial") ? "Partly shipped" : "Shipped", flag("partial") ? "Part of your order shipped." : "Your order shipped.");
    if (o.delivery_method === "ship") return say("ready", "Ready to ship", "Your order is packed and ready to ship.");
    if (o.delivery_method === "deliver") return say("ready", "Out for delivery", "Your order is ready and on its way to you.");
    return say("ready", "Ready for pickup", "Your order is ready to pick up.");
  }
  if (o.status === "approved") return say("approved", "Approved", "Approved, thank you.");
  if (o.status === "art") return extra.proofSent ? say("proof", "Proof ready", "Your proof is ready: please approve it.") : say("approved", "Approved", "Approved, thank you. We're working on your art proof.");
  return say("production", "In production", "Your order is in production.");
}

/**
 * An order on hold, as the customer sees it (Oct 24, Nick: "a visual that says on hold, like a stamp… you click on see
 * the reason why. Like, oh, we're trying to print from the artwork you gave us, but it's no good, or the goods showed up
 * and they picked the order wrong"). The reason is the note staff typed when they put it on hold. Holds that are only
 * ours (On hold: shop) stay out of it.
 */
export type CustomerHold = { key: FlagKey; title: string; reason: string; /** what they can do about it */ fix: "reply" | "art" | "pay" | "goods"; since: string };
export function customerHold(flags?: Flag[] | null): CustomerHold | null {
  const fs = (flags || []) as Flag[];
  const f = (["art_problem", "goods_wrong", "hold_customer", "hold_payment"] as FlagKey[]).map((k) => fs.find((x) => x.key === k)).find(Boolean);
  if (!f) return null;
  const note = (f.note || "").trim();
  if (f.key === "art_problem") return { key: f.key, title: "We need better artwork", reason: note || "The art file we have won't print well. Please send a better file (vector or high resolution), or ask us what we need.", fix: "art", since: f.at };
  if (f.key === "goods_wrong") return { key: f.key, title: "A problem with the garments you sent", reason: note || "The garments that came in don't match the order (wrong, short or damaged). They need to be replaced before we can print.", fix: "goods", since: f.at };
  if (f.key === "hold_payment") return { key: f.key, title: "Payment needed to start", reason: note || "We'll start as soon as the payment or deposit is in.", fix: "pay", since: f.at };
  return { key: f.key, title: "Waiting on you", reason: note || "We need something from you before we can go on. Send us a message and we'll explain.", fix: "reply", since: f.at };
}
