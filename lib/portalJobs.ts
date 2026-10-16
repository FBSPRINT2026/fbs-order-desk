import { lineQty, orderGroups, type Order } from "@/lib/pricing";

/**
 * The customer's jobs as their dashboard shows them (Oct 15, Nick: "more visual, so it shows jobs and they're moving
 * through"): a timeline of where each job is, what's happening now and what's next, in plain words.
 */
export type StepState = "done" | "cur" | "todo";
export type JobStep = { key: string; label: string; state: StepState; sub: string };
export type PortalJob = {
  id: string; number: number; nickname: string; href: string; pic: string; dueLabel: string; done: boolean;
  summary: string; badge: { text: string; tone: "wait" | "ok" | "info" }; steps: JobStep[]; now: string; next: string;
  reviewHref?: string; newMsgs: number; lastMsg?: { from: string; text: string; href: string };
  /** how it's decorated, for the Screen printing / Embroidery tabs */ kind: JobKind;
  /** where it is, for the Needs you / Printing / Ready / On the way filters (and the sort: what needs them first) */ stage: JobStage;
  /** the one thing they can do next (Oct 15, Nick: "if they're waiting to approve a proof, it should say click here to
   * approve proof… if it ships, it should have tracking") */ action?: JobAction;
  /** the line under the steps: "Waiting on you:" + "your proof is ready to look over" */ nowK: string; nowT: string;
  /** a balance on this job, with where to pay it */ owe?: { text: string; href: string; external?: boolean };
  /** the in-hands date, short ("Mon Oct 26"), and its date for sorting */ inHands: string; inHandsIso: string;
};
export type JobStage = "need" | "work" | "ready" | "out" | "done";
export type JobAction = { label: string; href: string; tone: "need" | "go" | "ok" | ""; sub?: string; external?: boolean };
/** a shipment that's left (or has a label): carrier, tracking and where to follow it */
export type JobShip = { carrier: string; service: string; tracking: string; url: string; boxes: number; when: string };
export type JobKind = "screen" | "embroidery" | "dtf" | "mixed" | "";
/** a job's decoration from words (Printavo status, line categories, imprint types, the job name) */
export function kindFromWords(words: string[]): JobKind {
  const w = words.join(" ").toLowerCase();
  const emb = /\bemb(roider(y|ed)?)?\b|\bemb -|stitch/.test(w), scr = /screen|\bsp\b|\bsp -|plastisol|silk/.test(w), dtf = /\bdtf\b|transfer/.test(w);
  const n = [emb, scr, dtf].filter(Boolean).length;
  return n > 1 ? "mixed" : emb ? "embroidery" : scr ? "screen" : dtf ? "dtf" : "";
}

const IDX: Record<string, number> = { request: 0, quote_sent: 0, approved: 1, art: 1, blanks: 2, production: 3, ready: 4, completed: 5 };
const day = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" }).replace(",", "");
};
const short = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
};

type JobExtra = {
  href: string; pic: string; pendingProof?: string; approvedArt: boolean; goods?: string | null; customerGoods: boolean; newMsgs: number;
  lastMsg?: { from: string; text: string; href: string }; kind?: JobKind;
  /** the customer-supplied goods page */ goodsHref?: string;
  /** a shipment with tracking */ ship?: JobShip | null;
  /** what's still owed on it and where to pay */ balance?: number; payHref?: string; payExternal?: boolean;
  /** the shop's address for pickup, and a map link */ pickup?: string; pickupHref?: string;
};

export function jobFor(o: Order, x: JobExtra): PortalJob {
  const groups = orderGroups(o);
  const lines = groups.flatMap((g) => g.lines).filter((l) => lineQty(l) > 0);
  const qty = lines.reduce((a, l) => a + lineQty(l), 0) || o.qty || 0;
  const colors = [...new Set(lines.map((l) => l.color).filter(Boolean))];
  const garment = lines[0]?.garment || "pieces";
  const prints = groups.flatMap((g) => g.imprints).map((d) => d.location).filter(Boolean);
  const kind: JobKind = x.kind ?? (() => { const ms = [...new Set(groups.flatMap((g) => g.imprints.map((d) => d.method)))]; return ms.length > 1 ? "mixed" : ms[0] === "embroidery" ? "embroidery" : ms[0] === "dtf" ? "dtf" : ms[0] === "screen" ? "screen" : ""; })();
  const done = o.status === "completed";
  const shipped = !done && !!x.ship;
  // a job from Printavo has no delivery method here: "Ready" / "Done"
  const how = shipped ? "On the way" : !o.delivery_method ? "Done" : o.delivery_method === "ship" ? "Shipped" : o.delivery_method === "deliver" ? "Delivered" : "Picked up";
  const summary = [`${qty} ${qty === 1 ? "piece" : garment.toLowerCase().includes("tee") ? "tees" : garment.toLowerCase().includes("polo") ? "polos" : garment.toLowerCase().includes("hat") || garment.toLowerCase().includes("cap") ? "hats" : "pieces"}`, colors.slice(0, 2).join(", ") + (colors.length > 2 ? ` +${colors.length - 2}` : ""),
    prints.length ? `${prints.length} print${prints.length === 1 ? "" : "s"} (${prints.slice(0, 2).join(", ")})` : "", !o.delivery_method ? "" : o.delivery_method === "ship" ? "shipping" : o.delivery_method === "deliver" ? "delivery" : "pickup"].filter(Boolean).join(" · ");

  let at = IDX[o.status] ?? 1;
  // a proof waiting on them holds the job at art approval (unless it's already printing or past it)
  if (x.pendingProof && at <= 2) at = 1;
  else if (at === 1 && x.approvedArt) at = 2;
  if (at === 2 && x.goods === "received") at = 3;
  if (shipped) at = 5;
  const quote = o.status === "quote_sent", asked = o.status === "request";
  const sub = [
    short(o.submitted_at || o.created_at),
    x.pendingProof && at <= 1 ? "waiting on you" : x.approvedArt ? "approved" : at > 1 ? "done" : "",
    x.customerGoods ? (x.goods === "received" ? "your garments are here" : "your garments") : at > 2 ? "here" : "",
    o.production_date ? day(o.production_date) : "",
    shipped ? x.ship!.when : o.due_date ? day(o.due_date) : "",
    done ? short(o.completed_at || o.updated_at) : shipped ? x.ship!.carrier : "",
  ];
  const labels = [quote || asked ? "Quote" : "Placed", "Art", "Garments", kind === "embroidery" ? "Stitching" : "Printing", shipped ? "Shipped" : "Ready", how];
  const keys = ["placed", "art", "goods", "print", "ready", shipped ? "ship" : o.delivery_method === "ship" ? "ship" : o.delivery_method === "pickup" ? "pickup" : "out"];
  const steps: JobStep[] = labels.map((label, i) => ({ key: keys[i], label, state: done || i < at ? "done" : i === at ? "cur" : "todo", sub: sub[i] }));
  if (done) steps.forEach((s) => { s.state = "done"; });

  const inHands = o.due_date ? day(o.due_date) : "";
  const NOW = [
    ["We're putting your order together.", "We'll send you a quote or proof to look over."],
    [x.pendingProof ? "Your proof is ready to look over." : "We're working on your artwork.", x.pendingProof ? "Once you approve, we get it on press." : "We'll send you a proof to approve."],
    [x.customerGoods ? "We're waiting on your garments." : "Your garments are on the way to us.", "When they're in and counted, we print."],
    ["Your job is on press.", o.due_date ? `It's ready ${day(o.due_date)}.` : "We'll let you know when it's ready."],
    [!o.delivery_method ? "Your order is ready." : o.delivery_method === "ship" ? "Packed and ready to ship." : o.delivery_method === "deliver" ? "Ready to deliver." : "Ready for pickup!", !o.delivery_method ? "We'll be in touch about pickup or shipping." : o.delivery_method === "pickup" ? "Come by anytime during shop hours." : "You'll get tracking when it goes out."],
    ["All done.", "Thanks for printing with us."],
  ];
  const [now, next] = done ? NOW[5] : NOW[Math.min(at, 4)];

  // what they can do now, and the line that says why
  let stage: JobStage = done ? "done" : shipped ? "out" : at === 4 ? "ready" : "work";
  let action: JobAction | undefined;
  let nowK = "", nowT = "";
  const view: JobAction = { label: "View order", href: x.href, tone: "" };
  if (done) { nowK = "Done"; nowT = short(o.completed_at || o.updated_at); }
  else if (shipped) {
    const s = x.ship!;
    nowK = "On the way:"; nowT = [[s.carrier, s.service].filter(Boolean).join(" "), s.boxes > 1 ? `${s.boxes} boxes` : "", s.when ? `shipped ${s.when}` : ""].filter(Boolean).join(" · ");
    action = { label: "Track package", href: s.url, tone: "go", sub: `${s.carrier ? s.carrier + " " : ""}${s.tracking}`, external: true };
  } else if (quote) {
    stage = "need"; nowK = "Waiting on you:"; nowT = "your quote is ready to approve";
    action = { label: "Review quote", href: x.href, tone: "need", sub: inHands ? `In hands ${inHands}` : "" };
  } else if (asked) {
    nowK = "We're on it:"; nowT = "putting your quote together"; action = view;
  } else if (x.pendingProof && at <= 1) {
    stage = "need"; nowK = "Waiting on you:"; nowT = "your proof is ready to look over";
    action = { label: "Approve proof", href: x.pendingProof, tone: "need", sub: inHands ? `In hands ${inHands}` : "" };
  } else if (at === 1) {
    nowK = "Artwork:"; nowT = "we're getting your proof ready"; action = view;
  } else if (at === 2 && x.customerGoods && (x.goods === "waiting" || x.goods === "issue" || !x.goods)) {
    stage = "need"; nowK = "Waiting on you:"; nowT = x.goods === "issue" ? "there's a problem with your garments" : "we don't have your garments yet";
    action = { label: x.goods === "issue" ? "See the garment issue" : "Add tracking for your garments", href: x.goodsHref || x.href, tone: "need", sub: x.goods === "issue" ? "" : "Tell us what's coming and when" };
  } else if (at === 2) {
    nowK = "Garments:"; nowT = x.customerGoods ? (x.goods === "partial" ? "some of your garments are here" : "your garments are on the way to us") : "on the way to us";
    action = x.customerGoods ? { label: "See your garments", href: x.goodsHref || x.href, tone: "" } : view;
  } else if (at === 3) {
    nowK = "In production"; nowT = inHands ? `on schedule for ${inHands}` : ""; action = { label: "View approved art", href: x.href, tone: "" };
  } else if (at === 4) {
    if (o.delivery_method === "pickup") {
      nowK = "Ready for pickup"; nowT = o.updated_at ? `since ${day(o.updated_at)}` : "";
      action = x.pickupHref ? { label: "Pickup info", href: x.pickupHref, tone: "ok", sub: x.pickup || "", external: true } : view;
    } else if (o.delivery_method === "ship") { nowK = "Packed:"; nowT = "you'll get tracking here when it ships"; action = view; }
    else if (o.delivery_method === "deliver") { nowK = "Ready:"; nowT = "we'll be in touch to deliver it"; action = view; }
    else { nowK = "Ready:"; nowT = "we'll be in touch about pickup or shipping"; action = x.pickupHref ? { label: "Pickup info", href: x.pickupHref, tone: "ok", sub: x.pickup || "", external: true } : view; }
  }
  if (action && !action.sub && inHands && stage !== "out" && stage !== "ready") action.sub = `In hands ${inHands}`;
  const owe = x.balance && x.balance > 0.004 && x.payHref ? { text: `$${x.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} due`, href: x.payHref, external: x.payExternal } : undefined;

  const badge = done ? { text: "Done", tone: "ok" as const } : stage === "need" ? { text: "Needs you", tone: "wait" as const }
    : stage === "out" ? { text: "On the way", tone: "info" as const } : at === 4 ? { text: "Ready", tone: "ok" as const } : { text: steps[at]?.label || "In progress", tone: "info" as const };
  return {
    id: o.id, number: o.number, nickname: o.nickname || "Your order", href: x.href, pic: x.pic, done,
    dueLabel: done ? `${how}|${short(o.completed_at || o.updated_at)}` : o.due_date ? `In hands|${day(o.due_date).toUpperCase()}` : "",
    summary, badge, steps, now, next, reviewHref: x.pendingProof, newMsgs: x.newMsgs, lastMsg: x.lastMsg, kind,
    stage, action, nowK, nowT, owe, inHands, inHandsIso: o.due_date || "",
  };
}
