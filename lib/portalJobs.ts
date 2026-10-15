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
};

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

export function jobFor(o: Order, x: { href: string; pic: string; pendingProof?: string; approvedArt: boolean; goods?: string | null; customerGoods: boolean; newMsgs: number; lastMsg?: { from: string; text: string; href: string } }): PortalJob {
  const groups = orderGroups(o);
  const lines = groups.flatMap((g) => g.lines).filter((l) => lineQty(l) > 0);
  const qty = lines.reduce((a, l) => a + lineQty(l), 0) || o.qty || 0;
  const colors = [...new Set(lines.map((l) => l.color).filter(Boolean))];
  const garment = lines[0]?.garment || "pieces";
  const prints = groups.flatMap((g) => g.imprints).map((d) => d.location).filter(Boolean);
  const how = o.delivery_method === "ship" ? "Shipped" : o.delivery_method === "deliver" ? "Delivered" : "Picked up";
  const summary = [`${qty} ${qty === 1 ? "piece" : garment.toLowerCase().includes("tee") ? "tees" : "pieces"}`, colors.slice(0, 2).join(", ") + (colors.length > 2 ? ` +${colors.length - 2}` : ""),
    prints.length ? `${prints.length} print${prints.length === 1 ? "" : "s"} (${prints.slice(0, 2).join(", ")})` : "", o.delivery_method === "ship" ? "shipping" : o.delivery_method === "deliver" ? "delivery" : "pickup"].filter(Boolean).join(" · ");

  let at = IDX[o.status] ?? 1;
  // a proof waiting on them holds the job at art approval (unless it's already printing or past it)
  if (x.pendingProof && at <= 2) at = 1;
  else if (at === 1 && x.approvedArt) at = 2;
  if (at === 2 && x.goods === "received") at = 3;
  const done = o.status === "completed";
  const sub = [
    short(o.submitted_at || o.created_at),
    x.pendingProof && at <= 1 ? "waiting on you" : x.approvedArt ? "approved" : at > 1 ? "done" : "",
    x.customerGoods ? (x.goods === "received" ? "your garments are here" : "your garments") : at > 2 ? "here" : "",
    o.production_date ? day(o.production_date) : "",
    o.due_date ? day(o.due_date) : "",
    done ? short(o.completed_at || o.updated_at) : "",
  ];
  const labels = ["Order placed", "Art approved", "Garments in", "Printing", o.delivery_method === "pickup" || !o.delivery_method ? "Ready for pickup" : o.delivery_method === "ship" ? "Ready to ship" : "Ready to deliver", how];
  const keys = ["placed", "art", "goods", "print", "ready", "out"];
  const steps: JobStep[] = labels.map((label, i) => ({ key: keys[i], label: i === 1 && x.pendingProof && at <= 1 ? "Art approval" : label, state: done || i < at ? "done" : i === at ? "cur" : "todo", sub: sub[i] }));
  // finished: everything done
  if (done) steps.forEach((s) => { s.state = "done"; });

  const NOW = [
    ["We're putting your order together.", "We'll send you a quote or proof to look over."],
    [x.pendingProof ? "Your proof is ready to look over." : "We're working on your artwork.", x.pendingProof ? "Once you approve, we get it on press." : "We'll send you a proof to approve."],
    [x.customerGoods ? "We're waiting on your garments." : "Your garments are on the way to us.", "When they're in and counted, we print."],
    ["Your job is on press.", o.due_date ? `It's ready ${day(o.due_date)}.` : "We'll let you know when it's ready."],
    [o.delivery_method === "ship" ? "Packed and ready to ship." : o.delivery_method === "deliver" ? "Ready to deliver." : "Ready for pickup!", o.delivery_method === "pickup" || !o.delivery_method ? "Come by anytime during shop hours." : "You'll get tracking when it goes out."],
    ["All done.", "Thanks for printing with us."],
  ];
  const [now, next] = done ? NOW[5] : NOW[Math.min(at, 4)];
  const badge = done ? { text: "Done", tone: "ok" as const } : x.pendingProof && at === 1 ? { text: "Waiting on your art approval", tone: "wait" as const }
    : at === 4 ? { text: labels[4], tone: "ok" as const } : { text: steps[at]?.label || "In progress", tone: "info" as const };
  return {
    id: o.id, number: o.number, nickname: o.nickname || "Your order", href: x.href, pic: x.pic, done,
    dueLabel: done ? `${how}|${short(o.completed_at || o.updated_at)}` : o.due_date ? `In hands|${day(o.due_date).toUpperCase()}` : "",
    summary, badge, steps, now, next, reviewHref: x.pendingProof, newMsgs: x.newMsgs, lastMsg: x.lastMsg,
  };
}
