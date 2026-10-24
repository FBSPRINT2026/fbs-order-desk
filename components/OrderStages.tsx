"use client";
import { useCallback, useEffect, useState } from "react";
import { FLAGS, type FlagKey } from "@/lib/orderStages";
import type { StageView } from "@/lib/orderStagesServer";

/**
 * Shop steps on the order (Oct 21, the order statuses doc): where the job is in the shop, step by step for its method,
 * the holds and flags beside it, and what the customer sees. Steps tick off on their own from what already happens;
 * the rest are clicked off here. Orders run from Printavo keep Printavo's status.
 */
const GROUP: Record<string, string> = { start: "", screen: "Screen print", embroidery: "Embroidery", dtf: "Heat press / DTF", finish: "" };
const fmt = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function OrderStages({ orderId, printavo, bump = 0 }: { orderId: string; printavo?: string; bump?: number }) {
  const [s, setS] = useState<StageView | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{ key: FlagKey | ""; note: string; date: string } | null>(null);
  const load = useCallback(async () => {
    const j = await fetch(`/api/orders/${orderId}/stage`).then((r) => r.json()).catch(() => ({ error: "Couldn't load the shop steps." }));
    if (j.error) setErr(j.error); else { setS(j); setErr(""); }
  }, [orderId]);
  useEffect(() => { if (!printavo) void load(); }, [load, printavo, bump]);
  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setErr("");
    const j = await fetch(`/api/orders/${orderId}/stage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ error: "Couldn't reach the server." }));
    setBusy(false);
    if (j.error) setErr(j.error); else setS(j);
  };
  if (printavo) return <section className="panel osp"><div className="panel-h"><h2>Shop steps</h2></div><div className="panel-b faint">This job is run from Printavo ({printavo}). Its status is Printavo&apos;s.</div></section>;
  if (!s) return err ? <section className="panel osp"><div className="panel-h"><h2>Shop steps</h2></div><div className="panel-b err">{err}</div></section> : null;
  let lastGroup = "";
  const none = !s.steps.some((x) => x.done);
  return (
    <section className="panel osp" aria-label="Shop steps">
      <div className="panel-h"><h2>Shop steps</h2><span className="faint">{s.current ? <>{none ? "Next" : "Now"}: <b className="osp-now">{s.current.label}</b></> : <b className="osp-now">All done</b>}</span></div>
      <div className="panel-b">
        <div className="osp-cust" title={s.customer.text}>Customer sees: <b>{s.customer.label}</b></div>
        <ol className="osp-rail">
          {s.steps.map((st) => {
            const head = st.group !== lastGroup && GROUP[st.group] ? GROUP[st.group] : "";
            lastGroup = st.group;
            const cur = s.current?.key === st.key;
            const how = st.done ? (st.done.auto ? `Done on its own: ${st.done.note || st.auto || ""}` : `Checked off by ${st.done.by}, ${fmt(st.done.at)}${st.done.note ? ` (${st.done.note})` : ""}`) : st.auto ? `Ticks off when ${st.auto}. Click to check it off by hand.` : "Click when it's done";
            return (
              <li key={st.key}>
                {head && <span className="osp-g">{head}</span>}
                <button type="button" className={"osp-step" + (st.done ? " done" : cur ? " now" : "")} disabled={busy || !!(st.done && st.done.auto)} title={how}
                  onClick={() => void post({ op: "check", step: st.key, done: !st.done })}>
                  <span className="osp-dot">{st.done ? "✓" : ""}</span><span className="osp-l">{st.label}</span>
                  {st.done && <small>{st.done.auto ? "auto" : `${st.done.by.split(" ")[0]} ${fmt(st.done.at)}`}</small>}
                </button>
              </li>
            );
          })}
        </ol>
        {s.flags.length > 0 && (
          <div className="osp-flags">
            {s.flags.map((f) => {
              const def = FLAGS.find((x) => x.key === f.key);
              return <span key={f.key} className={"os-flag" + (def?.hold ? " hold" : "") + (def?.customer ? " cust" : "")} title={`${f.by}, ${fmt(f.at)}${def?.customer ? ` · the customer sees: ${def.customer(f)}` : " · internal"}`}>{def?.label || f.key}{f.note ? `: ${f.note}` : ""}{f.date ? ` (new date ${f.date})` : ""}<button type="button" aria-label="Remove" disabled={busy} onClick={() => void post({ op: "flag", key: f.key, on: false })}>×</button></span>;
            })}
          </div>
        )}
        {adding ? (
          <div className="osp-add">
            <select value={adding.key} onChange={(e) => setAdding({ ...adding, key: e.target.value as FlagKey })} aria-label="Hold or flag">
              <option value="">Hold or flag…</option>
              {FLAGS.map((f) => <option key={f.key} value={f.key}>{f.label}{f.customer ? " (customer sees it)" : ""}</option>)}
            </select>
            <input value={adding.note} onChange={(e) => setAdding({ ...adding, note: e.target.value })} placeholder={["hold_customer", "art_problem", "goods_wrong", "hold_payment"].includes(adding.key) ? "Why it's on hold (the customer sees this)" : "Note (optional)"} aria-label="Note" />
            {adding.key === "delayed" && <input type="date" value={adding.date} onChange={(e) => setAdding({ ...adding, date: e.target.value })} aria-label="New date" />}
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm primary" disabled={!adding.key || busy} onClick={async () => { await post({ op: "flag", key: adding.key, on: true, note: adding.note, date: adding.date }); setAdding(null); }}>Add</button>
              <button type="button" className="btn sm ghost" onClick={() => setAdding(null)}>Cancel</button>
            </div>
          </div>
        ) : <button type="button" className="btn sm ghost osp-addb" onClick={() => setAdding({ key: "", note: "", date: "" })}>+ Hold or flag</button>}
        {err && <div className="err">{err}</div>}
      </div>
    </section>
  );
}
