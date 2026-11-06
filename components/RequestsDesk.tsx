"use client";
import ClickTwice from "@/components/ClickTwice";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { useColumnWidths } from "@/components/ColumnWidths";
import Link from "next/link";
import { requestNotAnOrder, requestsDesk, simpleOrderActivity, type DeskRequest } from "@/app/shop/actions";
import CreateOrderTool from "@/components/tools/CreateOrderTool";
import OrderHelper from "@/components/tools/OrderHelper";
import { ignoreLead, leadInfo } from "@/app/shop/lead-actions";
import { PARTIAL, type PartKind } from "@/components/tools/PartialOrder";
import type { OrderStart } from "@/components/OrderStartPick";
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
/** the last list, kept while this tab is open, so the Requests list shows at once and refreshes behind */
let rqMem: DeskRequest[] | null = null;
const asMail = (r: DeskRequest): MailFile[] => r.files.map((f) => ({ key: f.path, name: f.name, size: f.size, type: f.type, href: `/api/files/open?${new URLSearchParams({ p: f.path, n: f.name })}` }));

export default function RequestsDesk({ q, onChanged, onMessage, only, pick, onlyIds }: { q: string; onChanged?: () => void; /** open a conversation about this request in the Message Center */ onMessage?: (orderId: string) => void; /** just this request, opened (a customer's message about it in the Message Center) */ only?: string; /** open this one when the list loads (a link from its order page) */ pick?: string;
  /** just these requests: the Job Center's My accounts / Everyone and department switch (Nov 2, Nick: "it doesn't actually
   *  filter the down below") */ onlyIds?: Set<string> }) {
  const [list, setList] = useState<DeskRequest[] | null>(rqMem);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(only || null);
  useEffect(() => { if (only) setOpenId(only); }, [only]);
  useEffect(() => { if (pick && list?.some((r) => r.id === pick)) open(pick); }, [pick, list?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [act, setAct] = useState(""), [actText, setActText] = useState("");
  // three ways to process one (Nov 6, Nick): Make the order (the AI start to finish), the Order helper (step by step),
  // Other options (one part only); each opens the one Create order tool
  const [helper, setHelper] = useState(""), [begin, setBegin] = useState<OrderStart | undefined>(undefined);
  const panel = useRef<HTMLDivElement | null>(null);
  const load = async () => { const r = await requestsDesk(); if (r.ok) { rqMem = r.list; setList(r.list); } else setErr(r.error); };
  useEffect(() => { void load(); }, []);
  const w = q.trim().toLowerCase().replace(/^#/, "");
  const shown = useMemo(() => (list || []).filter((r) => !onlyIds || onlyIds.has(r.id)).filter((r) => !w || [String(r.number), r.name, r.customer, r.contact, r.po, r.about].some((x) => x.toLowerCase().includes(w))), [list, w, onlyIds]);
  // sorted by a click on a column's name (Nov 2, Nick: "click by customer… by due date… it should sort the list"); by
  // customer (the start) they're grouped A to Z with our rainbow line between customers, newest first inside each
  type SortK = "customer" | "number" | "due" | "files" | "sent";
  const [sort, setSort] = useSticky<{ k: SortK; up: boolean }>("jobs.rqSort", { k: "customer", up: true });
  const cmp = (a: DeskRequest, b: DeskRequest) => {
    const d = sort.k === "customer" ? a.customer.localeCompare(b.customer) || (a.lane || "~").localeCompare(b.lane || "~") || (a.due || "9999").localeCompare(b.due || "9999")
      : sort.k === "number" ? a.number - b.number
      : sort.k === "due" ? (a.due || "9999").localeCompare(b.due || "9999")
      : sort.k === "files" ? a.files.length - b.files.length
      : a.sentAt.localeCompare(b.sentAt);
    return sort.up ? d : -d;
  };
  const sorted = useMemo(() => [...shown].sort(cmp), [shown, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const byCust = useMemo(() => { const m = new Map<string, DeskRequest[]>(); for (const r of sorted) m.set(r.customerId, [...(m.get(r.customerId) || []), r]); return [...m.values()]; }, [sorted]);
  const grouped = sort.k === "customer";
  // like the ClickUp Jobs list (Nov 2, Nick: "make them kind of look the same"): the customer down the left with its count
  // and order types, each order type a heading row (Bulk Orders · 7), columns you can drag wider, sorted by a click
  const cols = useColumnWidths("jobs.rqCols", { cust: 170, due: 96, files: 84, sent: 140 }, "job");
  const th = (k: SortK, col: string, l: string, cls = "") => cols.th(col, <button type="button" className={"rqd-sort" + (sort.k === k ? " on" : "")} onClick={() => setSort({ k, up: sort.k === k ? !sort.up : true })}>{l}{sort.k === k ? <span aria-hidden>{sort.up ? "▲" : "▼"}</span> : null}</button>, { className: cls, ariaSort: sort.k === k ? (sort.up ? "ascending" : "descending") : "none" });
  const job = (list || []).find((r) => r.id === (only || openId)) || null;
  const open = (id: string) => { setOpenId(id); setMsg(""); setErr(""); setTimeout(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40); };
  const createOrder = async (r: DeskRequest, st?: OrderStart) => {
    setBusy("Bringing in what they sent…"); setErr("");
    const x = await simpleOrderActivity(r.id);
    setBusy("");
    if (!x.ok) { setErr(x.error); return; }
    setBegin(st); setHelper(""); setAct(x.activityId); setActText(x.text);
  };
  // a website submission: who sent it and whether it reads like junk (checked once, kept), then Ignore / Ignore and block
  const [lead, setLead] = useState<{ id: string; email: string; domain: string; ip: string; phone: string; junk: string } | null>(null);
  useEffect(() => {
    const j = (list || []).find((r) => r.id === (only || openId));
    if (!j?.web || lead?.id === j.id) return;
    setLead(null);
    void leadInfo(j.id).then((x) => { if (x.ok) setLead({ id: j.id, email: x.email, domain: x.domain, ip: x.ip, phone: x.phone, junk: x.junk }); });
  }, [openId, only, list]); // eslint-disable-line react-hooks/exhaustive-deps
  const ignore = async (r: DeskRequest, block: boolean) => {
    setBusy(block ? "Ignoring and blocking…" : "Ignoring it…");
    const x = await ignoreLead(r.id, block);
    setBusy("");
    if (!x.ok) { setErr(x.error); return; }
    setMsg(block ? `#${r.number} ignored. Blocked ${x.blocked.length ? x.blocked.join(", ") : "nothing new"}: what they send next won't show here.` : `#${r.number} ignored.`);
    setOpenId(null); await load(); onChanged?.();
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
          {job.web && lead?.id === job.id && lead.junk && <div className="rqd-junk" role="status">
            <span><b>This looks like junk:</b> {lead.junk}. Block it? What they send next is ignored by itself ({[lead.email, lead.domain && `anyone @${lead.domain}`, lead.phone].filter(Boolean).join(", ")}).</span>
            <button type="button" className="btn sm" disabled={!!busy} onClick={() => void ignore(job, true)}>Ignore and block</button>
          </div>}
          <div className="cu-ask">
            <b>Would you like to process this request?</b>
            <div className="cu-acts">
              {job.simple
                ? <>
                  <button type="button" className="btn primary" disabled={!!busy} title="The AI reads what they sent, their PO and art, and fills in this order start to finish (it keeps its number)" onClick={() => void createOrder(job)}>Make the order</button>
                  <button type="button" className={"btn" + (helper === job.id ? " on" : "")} disabled={!!busy} title="Step by step: where the sizes are, what each file is, then make it" onClick={() => setHelper(helper === job.id ? "" : job.id)}>Order helper</button>
                  <select className="rqd-more" aria-label="Other options" value="" disabled={!!busy} onChange={(e) => { const k = e.target.value as PartKind; if (k) void createOrder(job, { partial: k, orderType: "new" }); }}>
                    <option value="">Other options</option>
                    {(Object.keys(PARTIAL) as PartKind[]).map((k) => <option key={k} value={k}>{PARTIAL[k].label}</option>)}
                  </select>
                </>
                : <Link className="btn primary" href={`/shop/orders/${job.id}?stay=1`}>Open the order</Link>}
              {/* a question about it in the Message Center, beside the list (Nov 2, Nick: "ask him a question in the messaging
                  center… about this") */}
              {only ? null : onMessage ? <button type="button" className="btn ghost" onClick={() => onMessage(job.id)}>Message them</button> : <Link className="btn ghost" href={`/shop/orders/${job.id}#messages`}>Message them</Link>}
              {/* on the far right, two clicks (Nov 3, Nick) */}
              {job.web ? <>
                <ClickTwice className="btn ghost cu-not" label="Ignore" again="Click again: ignore" disabled={!!busy} onConfirm={() => ignore(job, false)} />
                <ClickTwice className="btn ghost" label="Ignore and block" again="Click again: block them" disabled={!!busy} onConfirm={() => ignore(job, true)} />
              </> : <ClickTwice className="btn ghost cu-not" label="Not an order" again="Click again: not an order" disabled={!!busy} onConfirm={() => notOrder(job)} />}
            </div>
            {busy && <div className="faint">{busy}</div>}
          </div>
          {helper === job.id && job.simple && <OrderHelper key={job.id} job={job} onCancel={() => setHelper("")} onChanged={() => void load()} onMake={(st) => void createOrder(job, st)} />}
        </div>
      </div>}
      {act && <CreateOrderTool key={act + (begin ? JSON.stringify(begin) : "")} activityId={act} text={actText} begin={begin} onClose={() => { setAct(""); setBegin(undefined); }} onCreated={(id, n) => { setAct(""); setMsg(`Order #${n} is filled in.`); setOpenId(null); void load(); onChanged?.(); }} />}

      {only ? (!job && <div className="faint">This request isn&apos;t waiting anymore. It may have been made into an order.</div>) : !shown.length ? <div className="faint">{w ? `No requests match “${q}”.` : "No requests waiting. When a customer sends one from their portal, it shows here."}</div> : (
        <div className="tbl-wrap cu-fit"><table ref={cols.tableRef} className="tbl cu-tbl rqd-tbl" data-nofit data-keep>
          <thead><tr>{th("customer", "cust", "Customer", "cu-w-rail")}{th("number", "job", "Request")}{th("due", "due", "Due", "cu-w-due")}{th("files", "files", "Files", "cu-w-files")}{th("sent", "sent", "Sent in", "cu-w-added")}<th className="cu-w-act" data-col="act" aria-label="Process" /></tr></thead>
          <tbody>{(grouped ? byCust : sorted.map((r) => [r])).flatMap((rs) => {
            // by customer: each of its order types gets a heading row, like ClickUp's lists
            const lanes = grouped ? [...new Set(rs.map((r) => r.lane || ""))] : [""];
            const heads = grouped && (lanes.length > 1 || lanes[0] !== "");
            const rows: ({ kind: "lane"; lane: string; n: number } | { kind: "req"; r: DeskRequest })[] = [];
            for (const ln of lanes) { const these = rs.filter((r) => !grouped || (r.lane || "") === ln); if (heads) rows.push({ kind: "lane", lane: ln, n: these.length }); for (const r of these) rows.push({ kind: "req", r }); }
            const c0 = rs[0];
            const laneCounts = heads ? lanes.filter(Boolean).map((l) => `${rs.filter((r) => r.lane === l).length} ${l.toLowerCase()}`).join(" · ") : "";
            const rail = <td className="cu-rail" rowSpan={rows.length} onClick={(e) => e.stopPropagation()}><div className="rqd-rail">
              <div className="cu-rail-c">{c0.customer}</div>{c0.contact && <div className="sub">{c0.contact}</div>}
              {grouped && <span className="cu-rail-n">{rs.length} new</span>}{laneCounts && <div className="sub cu-rail-b">{laneCounts}</div>}
            </div></td>;
            return rows.map((x, i) => x.kind === "lane"
              ? <tr key={`l:${c0.customerId}:${x.lane}`} className={"cu-boardrow" + (i === 0 ? " cu-gstart" : "")}>{i === 0 && rail}<td colSpan={5}>{!x.lane ? "Other" : c0.laneLabel ? `${c0.laneLabel} ${x.lane}` : `${x.lane} Orders`} <span className="faint">· {x.n}</span></td></tr>
              : (() => { const r = x.r, d = dueTxt(r.due); return (
                <tr key={r.id} className={"rqd-r" + (i === 0 ? " cu-gstart" : "") + (openId === r.id ? " picked" : "")} onClick={() => open(r.id)}>
                  {i === 0 && rail}
                  <td><span className="ordno">#{r.number}</span> {r.name || (r.simple ? "Simple order" : "Order request")}{!grouped && r.lane && <span className={"rqd-lane l-" + r.lane.toLowerCase()}>{r.lane}</span>}</td>
                  <td className={"cu-nw" + (d.soon && r.due ? " rqd-soon" : r.due ? "" : " faint")}>{d.t}</td>
                  <td className="cu-nw">{r.files.length ? `${r.files.length} file${r.files.length === 1 ? "" : "s"}` : <span className="faint">None</span>}</td>
                  <td className="cu-nw cu-added">{sent(r.sentAt)}</td>
                  <td className="r cu-nw"><button type="button" className="btn primary sm" onClick={(e) => { e.stopPropagation(); open(r.id); }}>Process</button></td>
                </tr>); })());
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}
