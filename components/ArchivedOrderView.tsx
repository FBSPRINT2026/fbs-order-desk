"use client";
import { useEffect, useState, type ReactNode } from "react";
import { addressLines, plain, sizeLabel, sizeOrder, type PvFile, type PvGroup, type PvOrder } from "@/lib/archive";
import { fmtDateLong, money } from "@/lib/format";
import ProductionPanel from "@/components/ProductionPanel";
import { useSeesMoney } from "@/components/RoleContext";
import { downloadUrl, pvFileName } from "@/lib/printavoNames";

const d = (x?: string | null) => (x ? fmtDateLong(x.slice(0, 10)) : "—");
const stamp = (x?: string | null) => (x ? new Date(x).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const METHOD: Record<string, string> = { BANK_TRANSFER: "Bank transfer", CASH: "Cash", CHECK: "Check", CREDIT_CARD: "Credit card", ECHECK: "eCheck", OTHER: "Other" };
const TASK_STATUS: Record<string, string> = { need_ordering: "Need ordering", attached_to_po: "On a PO", ordered: "Ordered", arrived: "Arrived", partially_received: "Partly received", received: "Received", in: "In" };
const isImg = (f: PvFile) => /^image\//.test(f.mime) || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(f.full);
/** readable text on Printavo's status color */
const inkOn = (hex: string) => { const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); if (!m) return "#fff"; const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16)); return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#1b1b1b" : "#fff"; };

/**
 * A Printavo invoice or quote, read-only, laid out the way Printavo shows it:
 * header with status, customer and dates, line item groups with size columns and their imprints and mockups,
 * then totals, payments, notes, files, tasks and messages.
 */
export default function ArchivedOrderView({ o, fileUrl, importedAt, customerHref, audience = "shop", actions, names, paths }: { o: PvOrder; fileUrl: (u: string) => string; importedAt: string; customerHref?: string; /** "customer": the portal view (no internal details) */ audience?: "shop" | "customer"; /** buttons next to Print (the shop's Reorder) */ actions?: ReactNode;
  /** the files' original names (Filestack handle → name, printavo_file_names) and our copies' paths (Printavo link → path) */ names?: Record<string, string>; paths?: Record<string, string> }) {
  const [zoom, setZoom] = useState<PvFile | null>(null);
  // a file's original name, and a link that saves it under that name
  const nameOf = (f: { full: string; name?: string }) => pvFileName({ url: f.full, name: f.name, path: paths?.[f.full], names });
  const dl = (u: string, name: string) => downloadUrl(fileUrl(u), name);
  // crew (production, receiving, shipping): the no-money view, quantities and what's ordered only
  const cash = useSeesMoney();
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(null); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);

  // a picture opens large; any other file (PDF, AI…) shows its preview with its name, Open and Download
  const open = (f: PvFile) => setZoom(f);
  const thumb = (f: PvFile, cls = "pv-thumb") => {
    const full = fileUrl(f.full), src = (f.thumb && fileUrl(f.thumb)) || (isImg(f) ? full : "");
    if (!full && !src) return null;
    const nm = nameOf(f);
    return (
      <button key={f.id + f.full} type="button" className={cls} onClick={() => open(f)} title={nm || "Open"}>
        {src ? <img src={src} alt={nm || "Mockup"} loading="lazy" /> : <span className="pv-doc">{nm.split("?")[0].split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span>}
      </button>
    );
  };
  const itemTotal = o.groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + l.items * l.price, 0), 0);
  const feeTotal = o.fees.reduce((a, f) => a + f.amount, 0);
  const bill = addressLines(o.billingAddress), ship = addressLines(o.shippingAddress);
  const label = o.kind === "quote" ? "Quote" : "Invoice";
  const approval = approvalBadge(o);

  return (
    <div className="pv">
      <div className="pv-note">
        <span className="pv-arch">Archived order</span>
        <span>{audience === "shop" ? <>Read-only, as it was in Printavo. Stored on our own servers (imported {stamp(importedAt)}).</> : <>This is a past order from our records.</>}</span>
        <span className="spacer" />
        {actions}
        <button type="button" className="btn sm" onClick={() => window.print()}>Print</button>
      </div>

      <div className="ed-grid pva-grid">
        <div className="pv-main">
        <header className="pv-head">
          <div>
            <div className="pv-kind">{label} <span>#{o.visualId}</span></div>
            {o.nickname && <div className="pv-nick">{o.nickname}</div>}
            {o.tags.length > 0 && <div className="pv-tags">{o.tags.map((t) => <span key={t}>{t}</span>)}</div>}
          </div>
          <div className="pv-head-r">
            {o.status.name && <span className="pv-status" style={{ background: o.status.color || "#888", color: inkOn(o.status.color || "#888") }}>{o.status.name}</span>}
            {approval && <span className={"pv-appr " + approval.cls} title={approval.title}>{approval.label}</span>}
            {cash && <div className="pv-bal"><span>Total</span><b>{money(o.total)}</b></div>}
            {cash && <div className="pv-bal"><span>Balance</span><b className={o.amountOutstanding > 0.004 ? "due" : ""}>{money(o.amountOutstanding)}</b></div>}
          </div>
        </header>

        <section className="pv-info">
          <div>
            <h4>Customer</h4>
            {customerHref ? <a className="pv-strong" href={customerHref}>{o.customer.companyName || o.contact.fullName}</a> : <div className="pv-strong">{o.customer.companyName || o.contact.fullName}</div>}
            {o.customer.companyName && o.contact.fullName && <div>{o.contact.fullName}</div>}
            {o.contact.email && <div><a href={`mailto:${o.contact.email}`}>{o.contact.email}</a></div>}
            {o.contact.phone && <div>{o.contact.phone}</div>}
          </div>
          <div><h4>Billing address</h4>{bill.length ? bill.map((l, i) => <div key={i}>{l}</div>) : <div className="faint">—</div>}</div>
          <div><h4>Shipping address</h4>{ship.length ? ship.map((l, i) => <div key={i}>{l}</div>) : <div className="faint">—</div>}</div>
          <dl className="pv-dates">
            <dt>Created</dt><dd>{d(o.createdAt)}</dd>
            {o.kind === "invoice" && o.invoiceAt && <><dt>Invoice date</dt><dd>{d(o.invoiceAt)}</dd></>}
            <dt>Production due</dt><dd>{d(o.dueAt)}</dd>
            <dt>Customer due</dt><dd>{d(o.customerDueAt)}</dd>
            {cash && <><dt>Payment due</dt><dd>{d(o.paymentDueAt)}</dd></>}
            {o.poNumber && <><dt>PO #</dt><dd>{o.poNumber}</dd></>}
            {o.deliveryMethod && <><dt>Delivery</dt><dd>{o.deliveryMethod}</dd></>}
            {cash && o.paymentTerm && <><dt>Terms</dt><dd>{o.paymentTerm}</dd></>}
            {o.owner && <><dt>Owner</dt><dd>{o.owner}</dd></>}
          </dl>
        </section>

        {o.groups.map((g, gi) => group(g, gi + 1))}
        {!o.groups.length && <div className="pv-card faint" style={{ padding: 18 }}>No line items on this {label.toLowerCase()}.</div>}

        <div className="pv-bottom">
          <div className="pv-stack">
            {plain(o.customerNote) && (
              <div className="pv-card"><h3>{audience === "shop" ? "Customer note" : "Note"}</h3><p className="pv-pre">{plain(o.customerNote)}</p></div>
            )}
          </div>
          {!cash ? <div className="pv-card pv-totals"><div className="pvt-big"><span>Total pieces</span><b>{o.totalQuantity}</b></div></div> : <div className="pv-card pv-totals">
            <div><span>Item total</span><b>{money(itemTotal)}</b></div>
            {o.fees.map((f) => <div key={f.id}><span>{plain(f.description) || "Fee"}{f.quantity && f.quantity !== 1 && f.unitPrice != null && !f.pct ? ` (${f.quantity} × ${money(f.unitPrice)})` : f.pct && f.unitPrice != null ? ` (${f.unitPrice}%)` : ""}</span><b>{money(f.amount)}</b></div>)}
            {o.fees.length > 1 && <div className="pvt-sub"><span>Fees</span><b>{money(feeTotal)}</b></div>}
            <div className="pvt-line"><span>Subtotal</span><b>{money(o.subtotal)}</b></div>
            {o.discountAmount > 0.004 && <div><span>Discount{o.discountAsPercentage && o.discount ? ` (${o.discount}%)` : ""}</span><b>−{money(o.discountAmount)}</b></div>}
            <div><span>Sales tax{o.salesTax ? ` (${o.salesTax}%)` : ""}</span><b>{money(o.salesTaxAmount)}</b></div>
            <div className="pvt-big"><span>Total</span><b>{money(o.total)}</b></div>
            <div><span>Amount paid</span><b>{money(o.amountPaid)}</b></div>
            <div className={"pvt-big" + (o.amountOutstanding > 0.004 ? " pvt-due" : "")}><span>Amount outstanding</span><b>{money(o.amountOutstanding)}</b></div>
            <div className="faint" style={{ fontSize: 12 }}>{o.totalQuantity} item{o.totalQuantity === 1 ? "" : "s"}{o.paidInFull ? " · Paid in full" : ""}</div>
          </div>}
        </div>
        </div>
        <aside className="ed-aside pv-aside">
        {audience === "shop" && (
          <ProductionPanel compact note={plain(o.productionNote)}
            files={o.files.map((f) => ({ id: f.id, name: nameOf(f), url: fileUrl(f.full) || undefined, thumb: (f.thumb && fileUrl(f.thumb)) || undefined, mime: f.mime }))} />
        )}
        {cash && o.transactions.length > 0 && (
          <section className="panel">
            <div className="panel-h"><h2>Payments</h2><span className="faint" style={{ fontSize: 12 }}>{money(o.amountPaid)} paid</span></div>
            <div className="panel-b pv-pays">
              {o.transactions.map((t) => (
                <div key={t.id} className="pv-pay">
                  <div><b>{t.kind === "Payment" ? money(t.amount) : `−${money(Math.abs(t.amount))}`}</b><span className="faint">{d(t.date)}</span></div>
                  <div className="faint">{[t.kind === "Payment" ? "" : t.kind === "PaymentDispute" ? "Dispute" : t.kind, METHOD[t.category] || t.category, t.source === "PROCESSOR" ? "online" : "", t.processing ? "processing" : "", t.status || ""].filter(Boolean).join(" · ") || "Payment"}</div>
                  {t.description && <div className="pv-pay-d">{t.description}</div>}
                </div>
              ))}
              <div className="pv-pay-bal"><span>Balance due</span><b className={o.amountOutstanding > 0.004 ? "due" : ""}>{money(o.amountOutstanding)}</b></div>
            </div>
          </section>
        )}
        <History o={o} fileUrl={fileUrl} dl={dl} paths={paths} audience={audience} />

        {o.tasks.length > 0 && (
          <section className="panel"><div className="panel-h"><h2>Tasks</h2></div><div className="panel-b">
            <ul className="pv-list">{o.tasks.map((t) => (
              <li key={t.id} className={t.completed ? "done" : ""}><span className="pv-box">{t.completed ? "✓" : ""}</span> {t.name} <span className="faint">{t.assignee ? `· ${t.assignee} ` : ""}{t.completed ? `· done ${d(t.completedAt)}` : t.dueAt ? `· due ${d(t.dueAt)}` : ""}</span></li>
            ))}</ul>
          </div></section>
        )}

        {cash && o.expenses.length > 0 && (
          <section className="panel"><div className="panel-h"><h2>Expenses</h2></div><div className="panel-b">
            <table className="pv-tbl"><tbody>{o.expenses.map((x) => <tr key={x.id}><td>{d(x.at)}</td><td>{x.name}</td><td className="r num">{money(x.amount)}</td></tr>)}</tbody></table>
          </div></section>
        )}

        {audience === "shop" && o.warnings?.length ? <div className="pv-card faint" style={{ fontSize: 12.5 }}>Some parts couldn&apos;t be read from Printavo: {o.warnings.join(" · ")}</div> : null}
        </aside>
      </div>

      {zoom && (() => {
        const nm = nameOf(zoom), pic = isImg(zoom) ? fileUrl(zoom.full) : (zoom.thumb && fileUrl(zoom.thumb)) || "";
        return (
        <div className="pv-zoom" role="dialog" aria-label={nm || "Mockup"} onClick={() => setZoom(null)}>
          {pic ? <img src={pic} alt={nm || "Mockup"} onClick={(e) => e.stopPropagation()} /> : <span className="pv-doc" onClick={(e) => e.stopPropagation()}>{nm.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span>}
          <div className="pv-zoom-bar" onClick={(e) => e.stopPropagation()}>
            <span className="pv-zoom-name" title={nm}>{nm}</span>
            <a href={fileUrl(zoom.full)} target="_blank" rel="noreferrer">{isImg(zoom) ? "Open full size" : "Open"}</a>
            <a href={dl(zoom.full, nm)} target="_blank" rel="noreferrer" download={nm}>Download</a>
            <button type="button" className="btn" onClick={() => setZoom(null)}>Close</button>
          </div>
        </div>
        );
      })()}
    </div>
  );

  function group(g: PvGroup, n: number) {
    const used = [...new Set(g.lines.flatMap((l) => Object.keys(l.sizes)))];
    // only the sizes ordered (Printavo also showed empty size columns; they crowd the narrower page)
    const sizes = used.sort(sizeOrder);
    const show = { category: g.columns ? g.columns.category : g.lines.some((l) => l.category), itemNumber: g.columns ? g.columns.itemNumber : true, color: g.columns ? g.columns.color : true, markup: !!g.columns?.markup && g.lines.some((l) => l.markup != null) };
    const qty = g.lines.reduce((a, l) => a + l.items, 0), tot = g.lines.reduce((a, l) => a + l.items * l.price, 0);
    return (
      <section key={g.id} className="pv-card pv-group">
        {o.groups.length > 1 && <div className="pv-gno">Line item group {n}</div>}
        <div className="pv-scroll">
          <table className="pv-tbl pv-items">
            <thead><tr>
              {show.category && <th>Category</th>}{show.itemNumber && <th>Item #</th>}{show.color && <th>Color</th>}<th className="desc">Description</th>
              {sizes.map((s) => <th key={s} className="c sz">{sizeLabel(s)}</th>)}
              <th className="c">Items</th>{cash && <>{show.markup && <th className="r">Markup</th>}<th className="r">Price</th><th className="c">Taxed</th><th className="r">Total</th></>}
            </tr></thead>
            <tbody>{g.lines.map((l) => (
              <tr key={l.id}>
                {show.category && <td>{l.category}</td>}{show.itemNumber && <td className="nowrap">{l.itemNumber}</td>}{show.color && <td>{l.color}</td>}
                <td className="desc">
                  <div className="pv-desc">{l.mockups.slice(0, 2).map((m) => thumb(m, "pv-thumb sm"))}<div>{l.brand && !l.description.toLowerCase().includes(l.brand.toLowerCase()) && <span className="faint">{l.brand} </span>}<span className="pv-pre">{plain(l.description)}</span>
                    {l.status && <div><span className="pv-chip">{TASK_STATUS[l.status] || l.status}</span></div>}
                    {l.personalizations.length > 0 && <div className="pv-pers">{l.personalizations.map((p, i) => <span key={i}>{[p.name, p.value].filter(Boolean).join(": ")}</span>)}</div>}</div></div>
                </td>
                {sizes.map((s) => <td key={s} className="c num">{l.sizes[s] || ""}</td>)}
                <td className="c num b">{l.items}</td>{cash && <>{show.markup && <td className="r num">{l.markup != null ? `${l.markup}%` : ""}</td>}
                <td className="r num">{money(l.price)}</td><td className="c">{l.taxed ? "✓" : ""}</td><td className="r num b">{money(l.items * l.price)}</td></>}
              </tr>
            ))}</tbody>
            {g.lines.length > 1 && <tfoot><tr><td colSpan={(show.category ? 1 : 0) + (show.itemNumber ? 1 : 0) + (show.color ? 1 : 0) + 1 + sizes.length} className="r faint">Group total</td><td className="c num b">{qty}</td>{cash && <>{show.markup && <td />}<td /><td /><td className="r num b">{money(tot)}</td></>}</tr></tfoot>}
          </table>
        </div>
        {g.imprints.map((im) => (
          <div key={im.id} className="pv-imprint">
            <div className="pv-imp-t"><span className="pv-imp-k">Imprint</span>{im.typeOfWork && <b>{im.typeOfWork}</b>}{im.column && <span className="pv-chip">{im.column}</span>}</div>
            <div className="pv-imp-b">
              {plain(im.details) ? <div className="pv-pre">{plain(im.details)}</div> : <div className="faint">No imprint details.</div>}
              {im.mockups.length > 0 && <div className="pv-mocks">{im.mockups.map((m) => thumb(m))}</div>}
            </div>
          </div>
        ))}
      </section>
    );
  }
}

/* ---------- messages & approvals ---------- */

const cap = (x: string) => x ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase().replace(/_/g, " ") : "";
const APPROVED = /^approved$/i, DECLINED = /declin|reject|unapprov/i, WITHDRAWN = /revok|retract|withdr|cancel/i;

/** The latest approval on the order, as a small badge: Approved · Leona Harder · Sep 16 */
function approvalBadge(o: PvOrder): { label: string; cls: string; title: string } | null {
  const a = [...o.approvals].sort((x, y) => (x.response?.at || x.at).localeCompare(y.response?.at || y.at)).pop();
  if (!a) return null;
  const when = a.response?.at ? fmtDateLong(a.response.at.slice(0, 10)) : "";
  if (APPROVED.test(a.status)) return { label: `✓ Approved${a.response?.name ? ` by ${a.response.name}` : ""}`, cls: "ok", title: `${a.name}${when ? ` · ${when}` : ""}` };
  if (DECLINED.test(a.status)) return { label: `Changes requested${a.response?.name ? ` by ${a.response.name}` : ""}`, cls: "bad", title: `${a.name}${a.response?.reason ? ` · “${a.response.reason}”` : ""}` };
  if (WITHDRAWN.test(a.status) || a.retractor) return { label: "Approval withdrawn", cls: "", title: a.name };
  return { label: "Waiting for approval", cls: "wait", title: `${a.name} · sent ${fmtDateLong(a.at.slice(0, 10))}` };
}

type Ev = { at: string; key: string; kind: "msg" | "appr"; node: ReactNode };

/**
 * Everything that was said and approved on this order, oldest first: emails and texts (with who sent them, whether they
 * were opened, and their attachments) and each approval request with its answer.
 */
function History({ o, fileUrl, dl, paths, audience }: { o: PvOrder; fileUrl: (u: string) => string; dl: (u: string, name: string) => string; paths?: Record<string, string>; audience: "shop" | "customer" }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const evs: Ev[] = [];
  for (const a of o.approvals) {
    evs.push({ at: a.at, key: a.id + "-req", kind: "appr", node: (
      <div className="pvh-appr"><span className="pvh-dot" aria-hidden="true">⧗</span><div><b>Approval requested</b>: {a.name || "Order"}<div className="faint">{a.requester ? `by ${a.requester} · ` : ""}{stamp(a.at)}</div></div></div>
    ) });
    if (a.response?.at) {
      const ok = APPROVED.test(a.status);
      evs.push({ at: a.response.at, key: a.id + "-res", kind: "appr", node: (
        <div className={"pvh-appr " + (ok ? "ok" : "bad")}><span className="pvh-dot" aria-hidden="true">{ok ? "✓" : "✕"}</span><div>
          <b>{ok ? "Approved" : cap(a.status) || "Answered"}</b>: {a.name || "Order"}
          <div className="faint">{[a.response.name, audience === "shop" ? a.response.email : ""].filter(Boolean).join(" · ")}{a.response.name || a.response.email ? " · " : ""}{stamp(a.response.at)}</div>
          {a.response.reason && <div className="pvh-reason">“{a.response.reason}”</div>}
        </div></div>
      ) });
    }
    if (a.retractor || (WITHDRAWN.test(a.status) && !a.response)) {
      evs.push({ at: a.updatedAt || a.at, key: a.id + "-wd", kind: "appr", node: (
        <div className="pvh-appr"><span className="pvh-dot" aria-hidden="true">↺</span><div><b>Approval withdrawn</b>: {a.name || "Order"}<div className="faint">{a.retractor ? `by ${a.retractor} · ` : ""}{stamp(a.updatedAt || a.at)}</div></div></div>
      ) });
    }
  }
  for (const m of o.messages) {
    const long = plain(m.text).length > 320 || plain(m.text).split("\n").length > 8;
    const shown = open[m.id] || !long;
    const who = m.incoming ? (m.sender || m.from || "Customer") : (m.sender || "FBS Print");
    evs.push({ at: m.at, key: m.id, kind: "msg", node: (
      <div className={"pv-msg" + (m.incoming ? " in" : "")}>
        <div className="pv-msg-h">
          <b>{who}</b>
          <span className="pv-chip">{m.kind === "text" ? "Text" : "Email"}</span>
          {audience === "shop" && m.status && <span className={"pv-chip st-" + m.status.toLowerCase()}>{cap(m.status)}</span>}
          <span className="faint">{stamp(m.at)}</span>
        </div>
        <div className="faint pvh-to">{m.incoming ? "To FBS Print" : `To ${m.to.split(",").map((x) => x.trim()).filter(Boolean).join(", ")}`}{m.cc ? ` · cc ${m.cc}` : ""}{audience === "shop" && m.bcc ? ` · bcc ${m.bcc}` : ""}</div>
        {m.subject && <div className="pv-msg-s">{m.subject}</div>}
        <div className={"pv-pre" + (shown ? "" : " clamp")}>{plain(m.text)}</div>
        {long && <button type="button" className="linkbtn" onClick={() => setOpen((x) => ({ ...x, [m.id]: !x[m.id] }))}>{shown ? "Show less" : "Show more"}</button>}
        {!!m.attachments?.length && (
          <div className="pvh-att">{m.attachments.map((f, i) => {
            // saved under the attachment's own name (our copy's path has a stamp in front of it)
            const nm = pvFileName({ url: f.url, name: f.name, path: paths?.[f.url] });
            const u = fileUrl(f.url);
            return u ? <a key={i} href={dl(f.url, nm)} target="_blank" rel="noreferrer" download={nm}>📎 {f.name || nm || "Attachment"}</a> : <span key={i} className="faint">📎 {f.name || "Attachment"}</span>;
          })}</div>
        )}
      </div>
    ) });
  }
  evs.sort((a, b) => a.at.localeCompare(b.at));
  const nMsg = o.messages.length, nAppr = o.approvals.length;
  return (
    <section className="panel pvh-panel"><div className="panel-h"><h2>Messages &amp; approvals</h2><span className="faint" style={{ fontSize: 12 }}>{[nMsg ? `${nMsg} message${nMsg === 1 ? "" : "s"}` : "", nAppr ? `${nAppr} approval${nAppr === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</span></div>
      <div className="panel-b">{evs.length ? <div className="pvh">{evs.map((e) => <div key={e.key} className={"pvh-ev pvh-" + e.kind}>{e.node}</div>)}</div> : <div className="faint" style={{ fontSize: 13 }}>No messages or approvals on this order in Printavo.</div>}</div>
    </section>
  );
}
