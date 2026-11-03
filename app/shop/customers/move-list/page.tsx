"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import BackLink from "@/components/BackLink";
import { PAY_TERMS, type PayTerms } from "@/lib/pricing";
import { moveCustomers, moveList, setQuiet, setTerms, type MoveRow } from "./actions";

/**
 * Move to the portal (Nov 3, Nick): every customer, biggest first. Set terms with one click (or for every ticked one at
 * once), see who has an email, and move the ticked ones together. Customers already moved are grayed. The top 30 not
 * moved yet start ticked. The launch email itself goes from Settings → Launch email.
 */
type Show = "30" | "100" | "all" | "todo";
const money0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const SHORT: Record<PayTerms, string> = { prepay: "Pre-pay", receipt: "On receipt", deposit: "50/50", net30: "Net 30" };
const TERMS = Object.keys(PAY_TERMS) as PayTerms[];

export default function MoveList() {
  const [show, setShow] = useSticky<Show>("customers.moveList.show", "30");
  const [rows, setRows] = useState<MoveRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [err, setErr] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState("");
  const load = async (first = false) => {
    const r = await moveList();
    if (!r.ok) return setErr(r.error);
    setRows(r.rows); setErr("");
    if (first) setPicked(new Set(r.rows.filter((x) => x.rank && x.rank <= 30 && !x.movedAt).map((x) => x.id)));
  };
  useEffect(() => { void load(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const all = rows || [];
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter((r) => (show === "30" ? r.rank > 0 && r.rank <= 30 : show === "100" ? r.rank > 0 && r.rank <= 100 : show === "todo" ? !r.movedAt : true)
      && (!t || `${r.name} ${r.contact} ${r.email} ${r.owner}`.toLowerCase().includes(t)));
  }, [all, show, q]);
  const ticked = all.filter((r) => picked.has(r.id));
  const toMove = ticked.filter((r) => !r.movedAt);
  const tick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = list.length > 0 && list.every((r) => picked.has(r.id));
  const tickAll = () => setPicked((s) => { const n = new Set(s); for (const r of list) { if (allOn) n.delete(r.id); else n.add(r.id); } return n; });

  const terms = async (ids: string[], t: PayTerms) => {
    const before = rows;
    setBusy(ids.length > 1 ? "bulk" : ids[0]); setNote("");
    setRows((rs) => (rs || []).map((x) => (ids.includes(x.id) ? { ...x, terms: t } : x)));
    const r = await setTerms(ids, t);
    setBusy("");
    if (!r.ok) { setRows(before); return setErr(r.error); }
    if (ids.length > 1) setNote(`${PAY_TERMS[t]} set for ${ids.length} customers.`);
  };
  const move = async (quiet = false) => {
    if (!toMove.length) return;
    setBusy(quiet ? "quiet" : "move"); setNote("");
    const r = await moveCustomers(toMove.map((x) => x.id), quiet);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    setNote(`${r.moved} customer${r.moved === 1 ? "" : "s"} moved to the portal${quiet ? ", left off the launch email" : ""}.`);
    await load();
  };
  /** on or off the launch email, one customer */
  const quiet = async (r: MoveRow, q: boolean) => {
    setBusy(r.id);
    setRows((rs) => (rs || []).map((x) => (x.id === r.id ? { ...x, quiet: q } : x)));
    const res = await setQuiet([r.id], q);
    setBusy("");
    if (!res.ok) { setErr(res.error); setRows((rs) => (rs || []).map((x) => (x.id === r.id ? { ...x, quiet: r.quiet } : x))); }
  };

  const moved = all.filter((r) => r.movedAt).length;
  const topLeft = all.filter((r) => r.rank && r.rank <= 30 && !r.movedAt).length;
  const noEmail = all.filter((r) => r.movedAt && !r.email).length;
  const sent = all.filter((r) => r.launchSent).length;

  return (
    <>
      <BackLink href="/shop/customers" label="Customers" />
      <div className="page-head">
        <div><h1>Move to the portal</h1><div className="eyebrow">Every customer, biggest first: set terms, tick who to move, and move them together</div></div>
        <div className="row"><Link className="btn" href="/shop/settings/launch-email">Launch email</Link></div>
      </div>
      {rows && <div className="stats">
        <button type="button" className="stat" onClick={() => setShow("all")}><span className="v">{moved}</span><span className="k">In the portal</span></button>
        <button type="button" className="stat" onClick={() => setShow("30")}><span className={"v" + (topLeft ? " alert" : "")}>{topLeft}</span><span className="k">Top 30 not moved</span></button>
        <button type="button" className="stat" onClick={() => setShow("todo")}><span className="v">{all.length - moved}</span><span className="k">Not moved yet</span></button>
        <button type="button" className="stat"><span className={"v" + (noEmail ? " alert" : "")}>{noEmail}</span><span className="k">Moved, no email</span></button>
        <button type="button" className="stat"><span className="v">{sent}</span><span className="k">Launch email sent</span></button>
      </div>}
      <div className="toolbar">
        <div className="chips">
          {([["30", "Top 30"], ["100", "Top 100"], ["todo", "Not moved yet"], ["all", "Everyone"]] as [Show, string][]).map(([k, l]) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <input type="search" className="mvl-q" placeholder="Find a customer" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {ticked.length > 0 && (
        <div className="mvl-bulk">
          <b>{ticked.length} ticked</b>
          <span className="mvl-bulk-t"><span className="faint">Set terms:</span>
            <span className="chips">{TERMS.map((t) => <button key={t} type="button" className="chip" disabled={busy === "bulk"} onClick={() => void terms(ticked.map((x) => x.id), t)}>{SHORT[t]}</button>)}</span>
          </span>
          <span className="spacer" />
          <button type="button" className="btn ghost sm" onClick={() => setPicked(new Set())}>Clear</button>
          {toMove.length > 0 && <button type="button" className="btn" disabled={!!busy} title="Moved to the portal, but left off the launch email" onClick={() => void move(true)}>{busy === "quiet" ? "Moving…" : `Move ${toMove.length}, don't notify`}</button>}
          <button type="button" className="btn primary" disabled={!toMove.length || !!busy} onClick={() => void move()}>{busy === "move" ? "Moving…" : toMove.length ? `Move ${toMove.length} to the portal` : "All ticked are moved"}</button>
        </div>
      )}
      {note && <div className="ok-note">{note}</div>}
      {err && <div className="err">{err}</div>}
      {rows === null ? <p className="faint">Loading…</p> : !list.length ? <p className="faint">No customers here.</p> : (
        <div className="tbl-wrap">
          <table className="tbl mvl-tbl">
            <thead><tr>
              <th><input type="checkbox" aria-label="Tick every customer shown" checked={allOn} onChange={tickAll} /></th>
              <th>#</th><th>Customer</th><th className="num">Last 12 months</th><th>Owner</th><th>Terms</th><th>Portal</th><th>Launch email</th>
            </tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} className={r.movedAt ? "mvl-done" : ""}>
                <td><input type="checkbox" aria-label={`Tick ${r.name}`} checked={picked.has(r.id)} onChange={() => tick(r.id)} /></td>
                <td className="faint">{r.rank || ""}</td>
                <td><Link href={`/shop/customers/${r.id}`} data-notranslate>{r.name}</Link><div className="sub" data-notranslate>{r.email || <span className="mvl-noemail">No email on file</span>}</div></td>
                <td className="num nowrap">{r.sales ? money0(r.sales) : "—"}</td>
                <td className="nowrap">{r.owner ? r.owner.split(/\s+/)[0] : <span className="faint">—</span>}</td>
                <td><div className="chips mvl-terms" role="group" aria-label={`Terms for ${r.name}`}>
                  {TERMS.map((t) => <button key={t} type="button" className={"chip" + (r.terms === t ? " on" : "")} disabled={busy === r.id} onClick={() => r.terms !== t && void terms([r.id], t)}>{SHORT[t]}</button>)}
                </div></td>
                <td className="nowrap">{r.movedAt ? <span className="mvl-in">In since {day(r.movedAt)}</span> : <span className="faint">Not yet</span>}</td>
                <td className="nowrap">{r.launchSent ? `Sent ${day(r.launchSent)}` : !r.email ? <span className="faint">No email</span> : !r.movedAt ? <span className="faint">—</span>
                  : r.quiet ? <button type="button" className="linkbtn mvl-quiet" disabled={busy === r.id} title="Put them back on the launch email" onClick={() => void quiet(r, false)}>Not notifying</button>
                  : <button type="button" className="linkbtn" disabled={busy === r.id} title="Leave them off the launch email" onClick={() => void quiet(r, true)}>Will get it</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
