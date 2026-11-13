/** Check-In types and size order, safe for the browser (lib/checkin.ts is server-only). */
export const SIZE_ORDER = ["6M", "12M", "18M", "24M", "2T", "3T", "4T", "5T", "YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "OS", "OTHER"];
export const bySize = (a: string, b: string) => { const i = SIZE_ORDER.indexOf(a), j = SIZE_ORDER.indexOf(b); return (i < 0 ? 98 : i) - (j < 0 ? 98 : j) || a.localeCompare(b); };

/** one style + color, with how many of each size */
export type CheckItem = { key: string; style: string; color: string; desc: string; /** the brand ("Comfort Colors") when the line or manifest says it */ brand?: string; sizes: Record<string, number> };
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
  /** who works a problem with these goods: the shop for our own blank orders, else the customer (lib/goodsIssues.ts) */
  owner?: "customer" | "shop";
  /** screen printing (sp), embroidery (emb), heat press (hp) or anything else */
  kind: JobKind;
  /** boxes this job shares with other jobs (a mixed box): split it when counting */
  mixed?: { tracking: string; box: string; supplier: string; jobs: { number: number; pcs: number; items: string }[] }[];
  href: string;
};


/**
 * The jobs to count in, what's surely here first (Nick, Nov 13 2026: "I want them to count in what we know is here
 * first"): within a day, Here · ready to count, then Part here, then Problems to recount, then Not sure (no tracking:
 * it may be on the shelf), then On the way. The receiving dashboard (desk and phone) and the crew phone's list use it.
 */
export const COUNT_SECTIONS: { key: string; label: string; states: JobState[] }[] = [
  { key: "here", label: "Here · ready to count", states: ["ready"] },
  { key: "part", label: "Part here", states: ["partial"] },
  { key: "issue", label: "Problem · recount", states: ["issue"] },
  { key: "unknown", label: "Not sure if it's here", states: ["none"] },
  { key: "way", label: "On the way", states: ["way"] },
];
export function countSections<T extends { state: string }>(jobs: T[]): { key: string; label: string; jobs: T[] }[] {
  return COUNT_SECTIONS.map((s) => ({ key: s.key, label: s.label, jobs: jobs.filter((j) => (s.states as string[]).includes(j.state)) })).filter((s) => s.jobs.length);
}
