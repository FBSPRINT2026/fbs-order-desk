/** Check-In types and size order, safe for the browser (lib/checkin.ts is server-only). */
export const SIZE_ORDER = ["6M", "12M", "18M", "24M", "2T", "3T", "4T", "5T", "YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "OS", "OTHER"];
export const bySize = (a: string, b: string) => { const i = SIZE_ORDER.indexOf(a), j = SIZE_ORDER.indexOf(b); return (i < 0 ? 98 : i) - (j < 0 ? 98 : j) || a.localeCompare(b); };

/** one style + color, with how many of each size */
export type CheckItem = { key: string; style: string; color: string; desc: string; sizes: Record<string, number> };
export type Issue = "" | "short" | "over" | "damaged" | "mispick";
export type CheckLine = { item: string; style: string; color: string; size: string; expected: number; received: number; issue: Issue; bad?: number; note?: string };
export type CheckinRow = { id: string; order_id: string | null; archived_order_id: string | null; lines: CheckLine[]; expected: number; received: number; boxes: number | null; source: string; status: "complete" | "issue"; note: string; photos: string[]; by: string; created_at: string; resolved_at: string | null; resolved_by: string; resolution: string };
export type JobKind = "sp" | "emb" | "hp" | "other";
export const KIND_LABEL: Record<JobKind, string> = { sp: "Screen printing", emb: "Embroidery", hp: "Heat press", other: "Other" };
export type JobState = "issue" | "checked" | "ready" | "partial" | "way" | "none";
export type CheckJob = {
  ref: string;                 // "pv:<archived id>" or an order id
  number: number; nickname: string; customer: string; po: string; status: string;
  start: string | null; due: string | null; day: string; // day: the schedule day it's listed under
  ordered: number;             // pieces on the job
  items: CheckItem[]; source: "manifest" | "order";
  shipped: number; arrived: number; lines: number; delivered: number; boxes: number; suppliers: string[];
  state: JobState; checkins: CheckinRow[];
  /** screen printing (sp), embroidery (emb), heat press (hp) or anything else */
  kind: JobKind;
  href: string;
};

