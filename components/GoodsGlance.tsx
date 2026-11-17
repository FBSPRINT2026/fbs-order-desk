"use client";
import { useEffect, useState } from "react";
import CheckinModal from "@/components/CheckinModal";
import { goodsGlance } from "@/app/shop/goods-glance-actions";
import type { CheckJob } from "@/lib/checkinShared";

/**
 * The order's goods at a glance, at the top of its Goods tab (Nick, Nov 16 2026: "there's really no good sales view…
 * of what goods are here… a status of what it is… counted, not counted, partially counted"): one word for where they
 * are, where they came from, and each style and color ordered against counted, read the same way Goods & Receiving
 * counts them (lib/checkin.ts). Shop only.
 */
const day = (s?: string | null) => (s ? new Date(s.length > 10 ? s : s + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "");

export default function GoodsGlance({ orderId }: { orderId: string }) {
  const [job, setJob] = useState<CheckJob | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [count, setCount] = useState(false);
  const load = () => { void goodsGlance(orderId).then((r) => { if (r.ok) setJob(r.job); else { setErr(r.error); setJob(null); } }); };
  useEffect(load, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (job === undefined) return <section className="panel ggl"><div className="panel-b faint">Reading the goods…</div></section>;
  if (!job) return err ? <section className="panel ggl"><div className="panel-b faint">{err}</div></section> : null;

  const last = [...(job.checkins || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const ordered = job.ordered || job.items.reduce((a, it) => a + Object.values(it.sizes).reduce((b, n) => b + (+n || 0), 0), 0);
  const counted = last ? last.received : 0;
  const st: { w: string; tone: "ok" | "warn" | "bad" | "blue" | "gray"; sub: string } =
    job.state === "issue" ? { w: "Problem", tone: "bad", sub: last?.note || `${Math.max(0, (last?.expected || ordered) - counted)} short · in the Issue Center` }
    : job.state === "checked" && last ? (counted >= (last.expected || ordered) ? { w: "Counted", tone: "ok", sub: `All ${counted} here · ${last.by || "counted"}, ${day(last.created_at)}` } : { w: "Partly counted", tone: "blue", sub: `${counted} of ${last.expected || ordered} · ${last.by || ""}, ${day(last.created_at)}` })
    : job.state === "ready" ? { w: "Here, not counted", tone: "warn", sub: job.delivered ? `${job.delivered} box${job.delivered === 1 ? "" : "es"} delivered` : "Delivered" }
    : job.state === "partial" ? { w: "Part here", tone: "warn", sub: `${job.delivered} of ${job.boxes} boxes delivered` }
    : job.state === "way" ? { w: "On the way", tone: "blue", sub: job.boxes ? `${job.boxes} box${job.boxes === 1 ? "" : "es"} shipped` : "Shipped" }
    : { w: "Not here", tone: "bad", sub: "No tracking yet: if it's on the floor, count it in" };
  const from = [job.suppliers.join(", "), job.po ? `PO ${job.po}` : ""].filter(Boolean).join(" · ");
  // counted per style and color, from the latest count
  const got = (style: string, color: string) => last ? last.lines.filter((l) => l.style === style && l.color === color).reduce((a, l) => a + (+l.received || 0), 0) : null;

  return (
    <section className="panel ggl">
      <div className="panel-h"><h2>Goods</h2><span className={"ggl-st " + st.tone}>{st.w}</span></div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        <div className="ggl-sub">{st.sub}{from ? ` · ${from}` : ""}</div>
        {job.items.length > 0 && (
          <table className="ggl-t" data-nofit>
            <thead><tr><th>Style · color</th><th className="r">Ordered</th><th className="r">Counted</th></tr></thead>
            <tbody>{job.items.map((it) => { const o = Object.values(it.sizes).reduce((a, n) => a + (+n || 0), 0), c = got(it.style, it.color); return (
              <tr key={it.key}><td>{[it.style, it.color].filter(Boolean).join(" ")}</td><td className="r num">{o}</td><td className={"r num" + (c == null ? " faint" : c < o ? " short" : "")}>{c == null ? "—" : c}</td></tr>
            ); })}</tbody>
          </table>
        )}
        {job.state !== "checked" && <button type="button" className="btn sm primary ggl-go" onClick={() => setCount(true)}>{job.state === "issue" ? "Count again" : "Count in"}</button>}
      </div>
      {count && <CheckinModal job={job} onClose={() => setCount(false)} onSaved={() => { setCount(false); load(); }} />}
    </section>
  );
}
