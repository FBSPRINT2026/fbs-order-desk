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
  if (printavo) return <div className="os os-pv faint">Shop steps: this job is run from Printavo ({printavo}). Its status is Printavo&apos;s.</div>;
  if (!s) return err ? <div className="os err">{err}</div> : null;
  let lastGroup = "";
  return (
    <section className="os" aria-label="Shop steps">
      <div className="os-h">
        <b>Shop steps</b>
        <span className="os-now">{s.current ? <>Now: <b>{s.current.label}</b></> : <b>All done</b>}</span>
        <span className="os-cust" title={s.customer.text}>Customer sees: <b>{s.customer.label}</b></span>
        <span className="os-sp" />
        {!adding && <button type="button" className="btn sm ghost" onClick={() => setAdding({ key: "", note: "", date: "" })}>+ Hold or flag</button>}
      </div>
      <div className="os-rail">
        {s.steps.map((st) => {
          const head = st.group !== lastGroup && GROUP[st.group] ? GROUP[st.group] : "";
          lastGroup = st.group;
          const cur = s.current?.key === st.key;
          const how = st.done ? (st.done.auto ? `Done on its own: ${st.done.note || st.auto || ""}` : `Checked off by ${st.done.by}, ${fmt(st.done.at)}${st.done.note ? ` (${st.done.note})` : ""}`) : st.auto ? `Ticks off when ${st.auto}. Click to check it off by hand.` : "Click when it's done";
          return (
            <span key={st.key} className="os-cell">
              {head && <span className="os-g">{head}</span>}
              <button type="button" className={"os-step" + (st.done ? " done" : cur ? " now" : "")} disabled={busy || !!(st.done && st.done.auto)} title={how}
                onClick={() => void post({ op: "check", step: st.key, done: !st.done })}>
                <span className="os-dot">{st.done ? "✓" : ""}</span>{st.label}
              </button>
            </span>
          );
        })}
      </div>
      {(s.flags.length > 0 || adding) && (
        <div className="os-flags">
          {s.flags.map((f) => {
            const def = FLAGS.find((x) => x.key === f.key);
            return <span key={f.key} className={"os-flag" + (def?.hold ? " hold" : "") + (def?.customer ? " cust" : "")} title={`${f.by}, ${fmt(f.at)}${def?.customer ? ` · the customer sees: ${def.customer(f)}` : " · internal"}`}>{def?.label || f.key}{f.note ? `: ${f.note}` : ""}{f.date ? ` (new date ${f.date})` : ""}<button type="button" aria-label="Remove" disabled={busy} onClick={() => void post({ op: "flag", key: f.key, on: false })}>×</button></span>;
          })}
          {adding && (
            <span className="os-add">
              <select value={adding.key} onChange={(e) => setAdding({ ...adding, key: e.target.value as FlagKey })} aria-label="Hold or flag">
                <option value="">Hold or flag…</option>
                {FLAGS.map((f) => <option key={f.key} value={f.key}>{f.label}{f.customer ? " (customer sees it)" : ""}</option>)}
              </select>
              <input value={adding.note} onChange={(e) => setAdding({ ...adding, note: e.target.value })} placeholder={adding.key === "hold_customer" ? "What we need from them" : "Note (optional)"} aria-label="Note" />
              {adding.key === "delayed" && <input type="date" value={adding.date} onChange={(e) => setAdding({ ...adding, date: e.target.value })} aria-label="New date" />}
              <button type="button" className="btn sm primary" disabled={!adding.key || busy} onClick={async () => { await post({ op: "flag", key: adding.key, on: true, note: adding.note, date: adding.date }); setAdding(null); }}>Add</button>
              <button type="button" className="btn sm ghost" onClick={() => setAdding(null)}>Cancel</button>
            </span>
          )}
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </section>
  );
}
