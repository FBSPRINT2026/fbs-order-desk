"use client";
import { useEffect, useMemo, useState } from "react";
import { listLaunchRecipients, sendLaunchBatch, type LaunchRecipient } from "./actions";

/**
 * Send the launch email to customers (Oct 26, Nick: "go ahead and build it"): pick who gets it (not sent yet by default),
 * one more click to confirm, then it goes a few at a time with a running count. Each customer gets it once unless you
 * pick them again from Sent.
 */
type Show = "todo" | "sent" | "all";
export default function LaunchSend() {
  const [rows, setRows] = useState<LaunchRecipient[] | null>(null);
  const [from, setFrom] = useState(""), [err, setErr] = useState("");
  const [show, setShow] = useState<Show>("todo"), [q, setQ] = useState(""), [onlyMoved, setOnlyMoved] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false), [prog, setProg] = useState<{ done: number; of: number; sent: number; failed: { email: string; why: string }[] } | null>(null);
  const load = async () => { const r = await listLaunchRecipients(); if (r.ok) { setRows(r.rows || []); setFrom(r.from || ""); } else setErr(r.error || "Couldn't load customers."); };
  useEffect(() => { void load(); }, []);
  const list = useMemo(() => (rows || []).filter((r) => (show === "todo" ? !r.sentAt : show === "sent" ? !!r.sentAt : true) && (!onlyMoved || r.moved) && (!q.trim() || `${r.company} ${r.name} ${r.email}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, show, q, onlyMoved]);
  const n = (k: Show) => (rows || []).filter((r) => (k === "todo" ? !r.sentAt : k === "sent" ? !!r.sentAt : true)).length;
  const allOn = list.length > 0 && list.every((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const go = async () => {
    const ids = [...picked]; setConfirm(false);
    let state = { done: 0, of: ids.length, sent: 0, failed: [] as { email: string; why: string }[] };
    setProg(state);
    for (let i = 0; i < ids.length; i += 10) {
      const r = await sendLaunchBatch(ids.slice(i, i + 10));
      if (!r.ok) { setErr(r.error || "Stopped."); break; }
      state = { ...state, done: Math.min(ids.length, i + 10), sent: state.sent + r.sent, failed: [...state.failed, ...r.failed] };
      setProg(state);
    }
    setPicked(new Set()); await load();
  };
  const busy = !!prog && prog.done < prog.of;
  return (
    <section className="panel">
      <div className="panel-h"><h2>Send to customers</h2><span className="faint">Each gets it with their first name and their company in the picture, from {from || "the site's address"}</span></div>
      <div className="panel-b stack">
        {!/portal@/i.test(from) && <div className="gang-warn">It sends from <b data-notranslate>{from || "nothing yet"}</b>. Set the site&apos;s address (portal@fbsprint.com) in Settings → Connections → Site email first if you want it from there.</div>}
        <div className="toolbar" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="chips">{(["todo", "sent", "all"] as Show[]).map((k) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{k === "todo" ? "Not sent yet" : k === "sent" ? "Sent" : "All"} <span className="pill-n">{n(k)}</span></button>)}</div>
          <input type="search" placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 36, border: "1px solid var(--line)", borderRadius: 6, padding: "0 10px", minWidth: 200 }} />
          <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={onlyMoved} onChange={(e) => setOnlyMoved(e.target.checked)} /> Only customers moved to the new system</label>
        </div>
        {err && <div className="gang-warn">{err}</div>}
        {rows === null ? <p className="faint">Loading customers…</p> : (
          <div className="tbl-wrap" style={{ maxHeight: 420, overflow: "auto" }}><table className="tbl">
            <thead><tr><th style={{ width: 30 }}><input type="checkbox" aria-label="Pick all shown" checked={allOn} onChange={() => setPicked((s) => { const x = new Set(s); for (const r of list) { if (allOn) x.delete(r.id); else x.add(r.id); } return x; })} /></th><th>Company</th><th>Contact</th><th>Email</th><th>Sent</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} onClick={() => toggle(r.id)} style={{ cursor: "pointer" }}>
                <td><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} aria-label={`Send to ${r.company || r.name}`} /></td>
                <td data-notranslate>{r.company || <span className="faint">Your Company (no company on file)</span>}</td>
                <td data-notranslate>{r.name}</td>
                <td data-notranslate>{r.email}</td>
                <td className="num">{r.sentAt ? new Date(r.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : <span className="faint">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {!confirm ? (
            <button type="button" className="btn primary" disabled={!picked.size || busy} onClick={() => setConfirm(true)}>Send to {picked.size} customer{picked.size === 1 ? "" : "s"}</button>
          ) : (
            <>
              <span><b>Email {picked.size} customer{picked.size === 1 ? "" : "s"} now?</b> <span className="faint">It can&apos;t be unsent.</span></span>
              <button type="button" className="btn primary" onClick={() => void go()}>Yes, send it</button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
            </>
          )}
          {prog && <span className="faint" style={{ fontSize: 13 }}>{busy ? `Sending… ${prog.done} of ${prog.of}` : `Sent ${prog.sent} of ${prog.of}.`}{prog.failed.length ? ` ${prog.failed.length} didn't go: ${prog.failed.slice(0, 3).map((f) => f.email).join(", ")}${prog.failed.length > 3 ? "…" : ""}` : ""}</span>}
        </div>
      </div>
    </section>
  );
}
