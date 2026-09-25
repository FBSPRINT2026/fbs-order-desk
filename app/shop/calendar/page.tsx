"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ST } from "@/lib/pricing";
import { custLabel, todayISO } from "@/lib/format";
import { useShopData } from "@/lib/shopData";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function CalendarPage() {
  const router = useRouter();
  const { orders, customers } = useShopData();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [showQuotes, setShowQuotes] = useState(false);
  const first = new Date(ym.y, ym.m, 1);
  const start = new Date(ym.y, ym.m, 1 - first.getDay());
  const byDate: Record<string, typeof orders> = {};
  orders.forEach((o) => { if (o.due_date && (o.type === "invoice" || showQuotes)) (byDate[o.due_date] = byDate[o.due_date] || []).push(o); });
  const today = todayISO();
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== ym.m) break;
    days.push(d);
  }
  const shift = (n: number) => setYm(({ y, m }) => { m += n; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return { y, m }; });
  const noDate = orders.filter((o) => o.type === "invoice" && o.status !== "completed" && !o.due_date);

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Due dates</div><h1>{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h1></div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={showQuotes} onChange={(e) => setShowQuotes(e.target.checked)} /> Show quotes</label>
          <button className="btn" type="button" aria-label="Previous month" onClick={() => shift(-1)}>←</button>
          <button className="btn" type="button" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
          <button className="btn" type="button" aria-label="Next month" onClick={() => shift(1)}>→</button>
        </div>
      </div>
      <div className="cal-wrap">
        <div className="cal">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="dow">{d}</div>)}
          {days.map((d) => {
            const k = iso(d);
            const list = (byDate[k] || []).sort((a, b) => a.number - b.number);
            return (
              <div key={k} className={"day" + (d.getMonth() !== ym.m ? " out" : "") + (k === today ? " today" : "")}>
                <span className="d">{d.getDate()}</span>
                {list.map((o) => (
                  <button key={o.id} type="button" className="cal-chip" style={{ ["--sc" as string]: ST[o.status].c }} title={`#${o.number} ${o.nickname} · ${ST[o.status].label}`} onClick={() => router.push(`/shop/orders/${o.id}`)}>
                    #{o.number} {o.nickname || custLabel(customers[o.customer_id || ""])}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {noDate.length > 0 && (
        <p className="muted" style={{ marginTop: 14 }}>
          {noDate.length} active job{noDate.length === 1 ? " has" : "s have"} no due date:{" "}
          {noDate.map((o, i) => <span key={o.id}>{i ? ", " : ""}<Link href={`/shop/orders/${o.id}`}>#{o.number}</Link></span>)}
        </p>
      )}
    </>
  );
}
