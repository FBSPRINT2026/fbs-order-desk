"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { requestNotAnOrder, requestsDesk, simpleOrderActivity, type DeskRequest } from "@/app/shop/actions";
import CreateOrderTool from "@/components/tools/CreateOrderTool";
import { FileTray, type MailFile } from "@/components/MailFolders";

/**
 * Job Center → Requests, laid out like ClickUp Jobs' New list (Nov 2, Nick: "it should look exactly like what you built
 * for ClickUp new… when you click on them, it brings up the screen… on the top… hit the create order button and it's
 * gonna bring up the side panel and we're gonna rock through it just like it was a ClickUp order"). Each request keeps
 * the number it got when they sent it; Create order (the one tool, components/tools/CreateOrderTool.tsx) fills that order
 * in from what they sent. No prices anywhere until it's built.
 */
const METHOD: Record<string, string> = { screen: "Screen printing", embroidery: "Embroidery", transfer: "Transfers", mixed: "Mixed" };
const chi = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", ...o });
const sent = (iso: string) => chi(iso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dueTxt = (d: string | null) => {
  if (!d) return { t: "No date", soon: false };
  const days = Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000);
  const t = new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { t: days >= 0 && days <= 7 ? `${t} · ${days === 0 ? "today" : days === 1 ? "tomorrow" : `${days}d`}` : t, soon: days <= 3 };
};
const asMail = (r: DeskRequest): MailFile[] => r.files.map((f) => ({ key: f.path, name: f.name, size: f.size, type: f.type, href: `/api/files/open?${new URLSearchParams({ p: f.path, n: f.name })}` }));

export default function RequestsDesk({ q, onChanged, onMessage, only }: { q: string; onChanged?: () => void; /** open a conversation about this request in the Message Center */ onMessage?: (orderId: string) => void; /** just this request, opened (a customer's message about it in the Message Center) */ only?: string }) {
  const [list, setList] = useState<DeskRequest[] | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(only || null);
  useEffect(() => { if (only) setOpenId(only); }, [only]);
  const [act, setAct] = useState(""), [actText, setActText] = useState("");
  const panel = useRef<HTMLDivElement | null>(null);
  const load = async () => { const r = await requestsDesk(); if (r.ok) setList(r.list); else setErr(r.error); };
  useEffect(() => { void load(); }, []);
  const w = q.trim().toLowerCase().replace(/^#/, "");
  const shown = useMemo(() => (list || []).filter((r) => !w || [String(r.number), r.name, r.customer, r.contact, r.po, r.about].some((x) => x.toLowerCase().includes(w))), [list, w]);
  // grouped by customer, like ClickUp's workspaces
  const byCust = useMemo(() => { const m = new Map<string, DeskRequest[]>(); for (const r of shown) m.set(r.customerId, [...(m.get(r.customerId) || []), r]); return [...m.values()]; }, [shown]);
  const job = (list || []).find((r) => r.id === (only || openId)) || null;
  const open = (id: string) => { setOpenId(id); setMsg(""); setErr(""); setTimeout(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40); };
  const createOrder = async (r: DeskRequest) => {
    setBusy("Bringing in what they sent…"); setErr("");
    const x = await simpleOrderActivity(r.id);
    setBusy("");
    if (!x.ok) { setErr(x.error); return; }
    setAct(x.activityId); setActText(x.text);
  };
  const notOrder = async (r: DeskRequest) => {
    setBusy("Putting it away…");
    const x = await requestNotAnOrder(r.id);
    setBusy("");
    if (!x.ok) { setErr(x.error); return; }
    setMsg(`#${r.number} put away as not an order.`); setOpenId(null); await load(); onChanged?.();
  };
  if (!list) return <div className="faint">Loading the requests…</div>;
  return (
    <div className="rqd">
      {err && <div className="banner">{err}</div>}
      {msg && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--ink)" }}>{msg}</div>}
      {job && <div ref={panel} className="panel cu-job rqd-job">
        <div className="panel-h">
          <h2>{job.customer} · request #{job.number}</h2>
          <span className="cu-upl">Sent from their portal {sent(job.sentAt)}</span>
          {!only && <button type="button" className="cu-x" aria-label="Close this request" title="Close" onClick={() => setOpenId(null)}>✕</button>}
        </div>
        <div className="panel-b">
          <div className="cu-title">{job.name || `Request #${job.number}`}</div>
          <div className="cu-line">
            {job.due ? <span>Due {dueTxt(job.due).t}</span> : <span className="faint">No due date</span>}
            {job.po && <><span className="faint">·</span><span>PO {job.po}</span></>}
            {job.method && <><span className="faint">·</span><span>{METHOD[job.method] || job.method}</span></>}
            {(job.qty || job.pieces) ? <><span className="faint">·</span><span>about {(job.qty || job.pieces).toLocaleString("en-US")} pcs</span></> : null}
            <span className="faint">·</span><span>{job.delivery === "ship" ? `Ship to ${job.shipTo}` : job.delivery === "deliver" ? `Deliver to ${job.shipTo}` : "Pickup"}</span>
            {job.contact && <><span className="faint">·</span><span>{job.contact}</span></>}
            {Object.entries(job.fields).filter(([, v]) => String(v || "").trim()).map(([k, v]) => <span key={k} style={{ display: "contents" }}><span className="faint">·</span><span>{k}: {v}</span></span>)}
          </div>
          {job.about ? <div className="cu-notes"><span className="lbl">Original message</span><p style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{job.about}</p></div> : !job.simple ? <p className="cu-notes faint">They filled in the order form: {job.pieces.toLocaleString("en-US")} pieces. Open the order to see their garments and prints.</p> : null}
          {job.garments && <p className="cu-notes rqd-g"><b>Garments:</b> {job.garments}</p>}
          {job.files.length > 0 ? <div className="cu-sec"><FileTray files={asMail(job)} /></div> : <div className="cu-sec faint">No files with this request.</div>}
          <div className="cu-ask">
            <b>Would you like to process this request?</b>
            <div className="cu-acts">
              {job.simple
                ? <button type="button" className="btn primary" disabled={!!busy} title="The AI reads what they sent, their PO and art, and fills in this order (it keeps its number)" onClick={() => void createOrder(job)}>Process</button>
                : <Link className="btn primary" href={`/shop/orders/${job.id}`}>Open the order</Link>}
              <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void notOrder(job)}>Not an order</button>
              {/* a question about it in the Message Center, beside the list (Nov 2, Nick: "ask him a question in the messaging
                  center… about this") */}
              {only ? null : onMessage ? <button type="button" className="btn ghost" onClick={() => onMessage(job.id)}>Message them</button> : <Link className="btn ghost" href={`/shop/orders/${job.id}#messages`}>Message them</Link>}
            </div>
            {busy && <div className="faint">{busy}</div>}
          </div>
        </div>
      </div>}
      {act && <CreateOrderTool activityId={act} text={actText} onClose={() => setAct("")} onCreated={(id, n) => { setAct(""); setMsg(`Order #${n} is filled in.`); setOpenId(null); void load(); onChanged?.(); }} />}

      {only ? (!job && <div className="faint">This request isn&apos;t waiting anymore. It may have been made into an order.</div>) : !shown.length ? <div className="faint">{w ? `No requests match “${q}”.` : "No requests waiting. When a customer sends one from their portal, it shows here."}</div> : (
        <div className="tbl-wrap"><table className="tbl cu-tbl rqd-tbl" data-nofit>
          <thead><tr><th>Customer</th><th>Request</th><th>Due</th><th>Files</th><th>Sent in</th><th aria-label="Process" /></tr></thead>
          <tbody>{byCust.map((rs) => rs.map((r, i) => { const d = dueTxt(r.due); return (
            <tr key={r.id} className={"rqd-r" + (openId === r.id ? " on" : "")} onClick={() => open(r.id)}>
              {i === 0 && <td rowSpan={rs.length} className="rqd-cust"><b>{r.customer}</b>{r.contact && <span>{r.contact}</span>}<em>{rs.length} new</em></td>}
              <td><span className="ordno">#{r.number}</span> {r.name || (r.simple ? "Simple order" : "Order request")}</td>
              <td className={"nowrap" + (d.soon && r.due ? " rqd-soon" : r.due ? "" : " faint")}>{d.t}</td>
              <td className="nowrap">{r.files.length ? `${r.files.length} file${r.files.length === 1 ? "" : "s"}` : <span className="faint">None</span>}</td>
              <td className="nowrap">{sent(r.sentAt)}</td>
              <td className="r"><button type="button" className="btn primary sm" onClick={(e) => { e.stopPropagation(); open(r.id); }}>Process</button></td>
            </tr>); }))}</tbody>
        </table></div>
      )}
    </div>
  );
}
