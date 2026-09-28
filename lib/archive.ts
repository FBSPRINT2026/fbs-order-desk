/**
 * An archived Printavo order, stored exactly as Printavo had it (archived_orders.data).
 * Shared by the importer (server) and the read-only archived order page.
 */
export type PvFile = { id: string; full: string; thumb: string; mime: string; name?: string };
export type PvAddress = { companyName?: string | null; customerName?: string | null; address1?: string | null; address2?: string | null; city?: string | null; state?: string | null; zipCode?: string | null; country?: string | null } | null;
export type PvLine = {
  id: string; position: number; category: string; itemNumber: string; color: string; description: string;
  brand: string; sizes: Record<string, number>; items: number; price: number; markup: number | null; taxed: boolean; status: string;
  personalizations: { name: string; value: string }[]; mockups: PvFile[];
};
export type PvImprint = { id: string; typeOfWork: string; details: string; column: string; mockups: PvFile[] };
export type PvGroup = { id: string; position: number; columns: { category: boolean; color: boolean; itemNumber: boolean; markup: boolean; sizes: string[] } | null; lines: PvLine[]; imprints: PvImprint[] };
export type PvFee = { id: string; description: string; quantity: number | null; unitPrice: number | null; pct: boolean; amount: number; taxable: boolean };
export type PvTransaction = { id: string; kind: "Payment" | "Refund" | "Void" | "Return" | "PaymentDispute" | string; amount: number; category: string; description: string; date: string; source: string; processing: boolean; status?: string };
export type PvTask = { id: string; name: string; completed: boolean; completedAt: string | null; dueAt: string | null; assignee: string };
export type PvApproval = { id: string; name: string; status: string; requester: string; response: { name: string; email: string; reason: string; at: string } | null; at: string };
export type PvExpense = { id: string; name: string; amount: number; at: string };
export type PvMessage = { id: string; kind: "email" | "text"; incoming: boolean; from: string; to: string; cc: string; subject: string; text: string; at: string };
export type PvOrder = {
  v: 1; kind: "invoice" | "quote"; id: string; visualId: string; nickname: string;
  status: { name: string; color: string };
  createdAt: string; startAt: string | null; dueAt: string | null; customerDueAt: string | null; paymentDueAt: string | null; invoiceAt: string | null;
  customer: { id: string; companyName: string }; contact: { fullName: string; email: string; phone: string };
  owner: string; deliveryMethod: string; paymentTerm: string; poNumber: string; tags: string[]; merch: boolean;
  billingAddress: PvAddress; shippingAddress: PvAddress;
  customerNote: string; productionNote: string;
  subtotal: number; discount: number; discountAmount: number; discountAsPercentage: boolean; salesTax: number; salesTaxAmount: number;
  total: number; totalUntaxed: number; amountPaid: number; amountOutstanding: number; paidInFull: boolean; totalQuantity: number;
  groups: PvGroup[]; fees: PvFee[]; transactions: PvTransaction[]; files: PvFile[]; tasks: PvTask[]; approvals: PvApproval[]; expenses: PvExpense[]; messages: PvMessage[];
  urls: { url: string; publicUrl: string; publicPdf: string; workorderUrl: string; packingSlipUrl: string };
  /** anything that couldn't be read (the rest still imported) */
  warnings?: string[];
};

export type ArchivedRow = {
  id: string; printavo_id: string; kind: "invoice" | "quote"; visual_id: string; customer_id: string; nickname: string;
  status_name: string; status_color: string; order_date: string | null; due_date: string | null;
  total: number; paid: number; balance: number; qty: number; po_number: string;
  data: PvOrder; files: Record<string, string>; files_total: number; files_copied: number; imported_at: string;
};

/** Printavo's size codes, in Printavo's order. */
export const PV_SIZES = ["size_6m", "size_12m", "size_18m", "size_24m", "size_2t", "size_3t", "size_4t", "size_5t", "size_yxs", "size_ys", "size_ym", "size_yl", "size_yxl", "size_xs", "size_s", "size_m", "size_l", "size_xl", "size_2xl", "size_3xl", "size_4xl", "size_5xl", "size_6xl", "size_other"];
export const sizeLabel = (code: string) => { const s = code.replace(/^size_/, ""); return s === "other" ? "Other" : s.toUpperCase(); };
export const sizeOrder = (a: string, b: string) => { const i = PV_SIZES.indexOf(a), j = PV_SIZES.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); };

/** Every file on an order (mockups, imprint mockups, production files), full size and thumbnail. */
export function orderFiles(o: PvOrder): PvFile[] {
  return [
    ...o.groups.flatMap((g) => [...g.imprints.flatMap((i) => i.mockups), ...g.lines.flatMap((l) => l.mockups)]),
    ...o.files,
  ];
}
/** The URLs worth copying into our storage (full files and their thumbnails). */
export function fileUrls(o: PvOrder): string[] {
  return [...new Set(orderFiles(o).flatMap((f) => [f.full, f.thumb]).filter((u): u is string => !!u && /^https?:\/\//.test(u)))];
}

export const addressLines = (a: PvAddress) => !a ? [] : [a.companyName, a.customerName, a.address1, a.address2, [[a.city, a.state].filter(Boolean).join(", "), a.zipCode].filter(Boolean).join(" "), a.country && !/^(us|usa|united states)$/i.test(a.country) ? a.country : ""].map((x) => (x || "").trim()).filter(Boolean);

/** Printavo stores notes as HTML ("<div>1/0 Screen Print<br>Customer shipping in shirts</div>"); show them as the plain lines Printavo showed. */
export function plain(s?: string | null): string {
  if (!s) return "";
  if (!/[<&]/.test(s)) return s;
  return s
    .replace(/\r/g, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*(div|p|li|h[1-6]|tr|ul|ol|blockquote)\s*>/gi, "\n")
    .replace(/<\s*(div|p|h[1-6]|tr|ul|ol|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** What a customer may see of an archived order: no production notes, internal tasks, expenses, shop emails or owner. */
export function forCustomer(o: PvOrder): PvOrder {
  return { ...o, groups: o.groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, status: "" })) })), productionNote: "", tasks: [], expenses: [], messages: [], files: [], owner: "", tags: [], warnings: undefined,
    urls: { url: "", publicUrl: "", publicPdf: "", workorderUrl: "", packingSlipUrl: "" },
    transactions: o.transactions.filter((t) => !t.processing) };
}

/** The summary columns lists need (not the whole record). */
export const ARCHIVE_LIST_COLS = "id, kind, visual_id, customer_id, nickname, status_name, status_color, order_date, due_date, total, paid, balance, qty";
export type ArchiveSummary = Pick<ArchivedRow, "id" | "kind" | "visual_id" | "customer_id" | "nickname" | "status_name" | "status_color" | "order_date" | "due_date" | "total" | "paid" | "balance" | "qty"> & {
  /** searchable text (select `search:search_text` for customers, `search:search_staff` for the shop) */ search?: string | null };

const METHOD_NAMES: Record<string, string> = { BANK_TRANSFER: "Bank transfer", CASH: "Cash", CHECK: "Check", CREDIT_CARD: "Credit card", ECHECK: "eCheck", OTHER: "Other" };
/** An archived order as a row in the customer's order lists (same shape as new orders, marked archived). */
export function archiveAsOrder(r: ArchiveSummary, href: string) {
  return { id: r.id, number: +r.visual_id || 0, nickname: r.nickname || "", status: "archived", type: r.kind, total: +r.total || 0, paid: +r.paid || 0, balance: +r.balance || 0,
    due_date: r.due_date, created_at: r.order_date || "", qty: r.qty || 0, pay_due: null, archived: true, href, statusLabel: r.status_name, statusColor: r.status_color, search: r.search || "" };
}
/** An archived order's payments as rows in the payment history. */
export function archivePayments(r: ArchiveSummary & { transactions?: PvTransaction[] | null }, href: string) {
  return (r.transactions || []).filter((t) => t.kind === "Payment" && !t.processing).map((t) => ({
    id: `pv-${t.id}`, order_id: r.id, number: +r.visual_id || 0, amount: +t.amount || 0, method: METHOD_NAMES[t.category] || t.category || "", paid_on: t.date || null, created_at: t.date || "", href }));
}
