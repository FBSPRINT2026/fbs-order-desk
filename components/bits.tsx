import { ST } from "@/lib/pricing";
import { daysUntil, fmtDate } from "@/lib/format";

export function Pill({ status, portal = false }: { status: string; portal?: boolean }) {
  const s = ST[status] || ST.quote;
  return <span className="pill" style={{ ["--sc" as string]: s.c }}>{portal ? s.portal : s.label}</span>;
}

export function Due({ date, status }: { date: string | null; status: string }) {
  if (!date) return <span className="faint">No date</span>;
  const n = daysUntil(date)!;
  const done = status === "completed";
  let cls = "";
  if (!done && n < 0) cls = "due-late";
  else if (!done && n <= 3) cls = "due-soon";
  const rel = done ? "" : n === 0 ? " · today" : n === 1 ? " · tomorrow" : n < 0 ? ` · ${-n}d late` : n <= 7 ? ` · ${n}d` : "";
  return <span className={cls}>{fmtDate(date)}{rel}</span>;
}
