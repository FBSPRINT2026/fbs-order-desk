"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getAtRisk } from "@/app/shop/alerts-actions";
import type { AtRisk } from "@/lib/jobWatch";

/**
 * Dashboard: "Needs you today" (Oct 12, Nick: "jobs naturally flow through… the only time I need them is on my
 * dashboard when things are getting close: if I don't order the heart transplant shirts today we miss the deadline").
 * Only what has to happen today or is already late, on the jobs and on orders still in email. Nothing at risk: one
 * quiet line. Checked every 30 minutes.
 */
const STEP: Record<string, string> = { goods: "Order goods", goods_late: "Goods", approve: "Approval", sizes: "Sizes", art: "Art", proof: "Proof", print: "Print", ship: "Ship" };

export default function NeedsToday() {
  const [d, setD] = useState<{ items: (AtRisk & { whose: string })[]; at: string | null; on: boolean } | null>(null);
  useEffect(() => { void getAtRisk().then((r) => { if (r.ok) setD(r); }); }, []);
  if (!d || !d.on) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (!d.items.length) return <div className="nt-calm"><span aria-hidden>✓</span> Nothing at risk today. Every job is on track for its date.</div>;
  return (
    <section className="nt" aria-label="Needs you today">
      <div className="nt-h"><h2>Needs you today</h2><span className="nt-n">{d.items.length}</span><span className="faint nt-note">has to happen today or a date is missed{d.at ? ` · checked ${new Date(d.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span></div>
      <ul className="nt-list">{d.items.map((x) => (
        <li key={x.key} className={x.by < today ? "late" : ""}>
          <span className="nt-k">{STEP[x.step] || "Job"}</span>
          <div className="nt-b"><b>{x.title}</b><span>{x.notes}</span>{x.whose && <em>{x.whose}&apos;s</em>}</div>
          <Link href={x.url} className="btn sm">{x.step === "goods" && /email-order/.test(x.url) ? "Create order" : x.step === "goods" ? "Order goods" : "Open"}</Link>
        </li>
      ))}</ul>
    </section>
  );
}
