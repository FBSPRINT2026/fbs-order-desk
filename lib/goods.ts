/**
 * Customer supplied goods (wholesale): the garments a customer sends us for a job.
 * The goods have their own status, separate from the job's status.
 */
export type GoodsStatus = "waiting" | "on_way" | "arrived" | "partial" | "received" | "issue";
export type IssueType = "" | "short" | "over" | "mispick" | "damaged" | "missing" | "other";

export const GOODS: Record<GoodsStatus, { label: string; portal: string; c: string; step: number; help: string }> = {
  waiting: { label: "Waiting on goods", portal: "Waiting on your goods", c: "#B7791F", step: 0, help: "Send the garments for this job and add the tracking here." },
  on_way: { label: "On the way", portal: "On the way", c: "#2563EB", step: 1, help: "Tracking added. We'll check them in when they arrive." },
  arrived: { label: "Arrived, checking in", portal: "Arrived, we're checking them in", c: "#7C3AED", step: 2, help: "Your boxes are here. We're counting them against the order." },
  partial: { label: "Partly arrived", portal: "Partly arrived", c: "#C2410C", step: 2, help: "Some boxes are here. We're waiting on the rest." },
  received: { label: "Received, ready to print", portal: "All received", c: "#15803D", step: 3, help: "Everything's checked in and ready to print." },
  issue: { label: "Receiving issue", portal: "Issue with your goods", c: "#DC2626", step: 2, help: "Something didn't match. See the note and message us." },
};
export const GOODS_ORDER: GoodsStatus[] = ["waiting", "on_way", "arrived", "partial", "received", "issue"];
export const ISSUES: Record<Exclude<IssueType, "">, string> = {
  short: "Short (fewer than ordered)",
  over: "Over (more than ordered)",
  mispick: "Mispick (wrong style, color or size)",
  damaged: "Damaged or stained",
  missing: "Missing / lost in transit",
  other: "Other",
};

export type GoodsFile = { name: string; mime: string; size: number; url: string };
export type Shipment = {
  id: string; carrier: string; tracking: string; boxes: number | null; eta: string | null; note: string; files: GoodsFile[]; added_by: "customer" | "staff"; author_name: string; created_at: string;
  /** live tracking (EasyPost): status, latest scan, estimated delivery */
  track_status?: string; track_detail?: string; est_delivery?: string | null; delivered_at?: string | null; source?: string;
};
export type GoodsState = { status: GoodsStatus; issue_type: IssueType; issue_note: string; expected: string; updated_at: string | null; supplier?: string; supplier_po?: string; ship_date?: string | null };
export type GoodsItem = {
  order: { id: string; number: number; nickname: string; status: string; statusLabel: string; due_date: string | null; qty: number; href: string };
  goods: GoodsState; shipments: Shipment[];
  /** shop only: what the order says is coming, for counting in (style + color, quantities by size) */
  lines?: { label: string; sizes: Record<string, number> }[];
  /** latest message in the goods conversation, and how many the viewer hasn't read */
  last: { body: string; at: string; mine: boolean; who: string } | null; unread: number;
};
export const NO_GOODS: GoodsState = { status: "waiting", issue_type: "", issue_note: "", expected: "", updated_at: null, supplier: "", supplier_po: "", ship_date: null };

/** Where wholesale customers' goods usually come from. Anything else is stored as its name. */
export const SUPPLIERS: Record<string, string> = { sanmar: "SanMar", ss: "S&S Activewear" };
export const supplierLabel = (s?: string | null) => (s ? SUPPLIERS[s] || s : "");
/** Nothing known yet about the goods: no supplier and no tracking. */
export const goodsNeedInfo = (g: GoodsState, shipments: { tracking: string }[]) => g.status === "waiting" && !g.supplier && !shipments.some((x) => x.tracking);
/** Live tracking status in words. */
export const TRACK: Record<string, string> = {
  pre_transit: "Label created", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered",
  available_for_pickup: "Waiting at carrier", return_to_sender: "Returning to sender", failure: "Delivery problem", cancelled: "Cancelled", error: "Tracking problem", unknown: "No scans yet",
};

/** Which carrier a tracking number belongs to, from its shape. */
export function carrierOf(t: string): string {
  const s = t.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(s)) return "UPS";
  if (/^(94|93|92|95|82)\d{18,20}$/.test(s) || /^[A-Z]{2}\d{9}US$/.test(s)) return "USPS";
  if (/^\d{12}$|^\d{15}$|^\d{20}$|^\d{22}$/.test(s)) return "FedEx";
  if (/^\d{10}$/.test(s) || /^JJD\d+$/.test(s)) return "DHL";
  return "";
}
/** A link to the carrier's tracking page. */
export function trackingUrl(carrier: string, t: string): string {
  const n = encodeURIComponent(t.replace(/\s+/g, ""));
  switch ((carrier || carrierOf(t)).toLowerCase()) {
    case "ups": return `https://www.ups.com/track?tracknum=${n}`;
    case "fedex": return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case "usps": return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case "dhl": return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}`;
    case "r&l": return `https://www2.rlcarriers.com/freight/shipping/shipment-tracing?pro=${n}`;
    default: return `https://www.google.com/search?q=${n}+tracking`;
  }
}
/** Plain words for a package: "Arrived", a real problem (delivery problem, waiting at carrier…), or just "On the way". */
export const TRACK_PROBLEMS = ["failure", "return_to_sender", "error", "available_for_pickup", "cancelled"];
export const trackWord = (st: string | null | undefined) => (st === "delivered" ? "Arrived" : st && TRACK_PROBLEMS.includes(st) ? TRACK[st] || st : "On the way");
export const CARRIERS = ["UPS", "FedEx", "USPS", "DHL", "S&S freight", "SanMar", "Other"];

/** Wholesale jobs whose goods matter: from the moment the order is sent in (request) until it's completed. */
export const needsGoods = (o: { price_type?: string | null; type: string; status: string; submitted_at?: string | null }) =>
  o.price_type === "wholesale" && o.status !== "completed" && o.status !== "quote" && !(o.status === "request" && !o.submitted_at);
