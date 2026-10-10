"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSticky } from "@/lib/useSticky";
import { PAY_METHODS, PAY_TERMS } from "@/lib/pricing";
import { ITEM_KEYS, type QboSettings } from "@/lib/qbo/map";
import {
  qboAdopt, qboClearChanged, qboConfirm, qboFindCustomers, qboLinkManual, qboLists, qboLog, qboMatching, qboQueue, qboQueueAction, qboQueueAll,
  qboReject, qboRunMatching, qboRunNow, qboSaveSettings, qboSetPrimary, qboStatus, qboTest, qboUnlink,
  qboDifferences, qboDismissRealmWarning, qboNextOrderNumber, qboReadLinkedCustomers, qboSendOurs,
  type DiffRow, type LinkRow, type LogRow, type Option, type ProposalRow, type QboLists, type QboStatus, type QueueItem,
} from "@/app/shop/settings/quickbooks/actions";

/**
 * Settings → QuickBooks (owner only). Setup: connect, turn the sync on (preview first), map items / accounts / payment
 * methods / terms / sales tax. Matching: link our customers to the ones Printavo made in QuickBooks (by invoices,
 * email, name, phone), then adopt the invoices and payments Printavo already sent. Queue: everything waiting, with
 * exactly what would be sent. Log: every request to QuickBooks.
 */
const STATUS_C: Record<string, string> = { pending: "#6477D6", running: "#0A8FC0", error: "#C98A0C", needs_review: "#E0582E", done: "#2E9D5B", skipped: "#7C8799" };
const STATUS_L: Record<string, string> = { pending: "Waiting", running: "Running", error: "Will retry", needs_review: "Needs review", done: "Done", skipped: "Skipped" };
const when = (s?: string | null) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function QuickBooksSettings() {
  const [tab, setTab] = useSticky<"setup" | "matching" | "queue" | "log">("qbo.tab", "setup");
  const [st, setSt] = useState<QboStatus | null>(null);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const load = useCallback(() => qboStatus().then((r) => (r.ok ? (setSt(r.data!), setErr("")) : setErr(r.error))), []);
  useEffect(() => {
    load();
    const m = new URLSearchParams(location.search).get("qbo");
    if (m) setFlash(m.startsWith("connected:") ? `Connected to ${m.slice(10)}.` : m);
  }, [load]);
  if (err) return <div className="err">{err}</div>;
  if (!st) return <div className="empty">Loading…</div>;
  const open = (st.counts.pending || 0) + (st.counts.error || 0) + (st.counts.running || 0);
  return (
    <div className="stack" style={{ gap: 14 }}>
      {flash && <div className={flash.startsWith("Connected") ? "faint" : "err"} style={{ fontSize: 14 }}>{flash}</div>}
      {st.realmWarning && <div className="err" style={{ fontSize: 14 }}>{st.realmWarning} <button className="btn sm ghost" type="button" onClick={() => qboDismissRealmWarning().then(load)}>I&apos;ve checked: dismiss</button></div>}
      {st.envMismatch && <div className="err" style={{ fontSize: 14 }}>{st.envMismatch}</div>}
      <p className="faint" style={{ margin: 0, maxWidth: 860 }}>
        Sends our customers, invoices (#{st.settings.live_from_number} and up) and payments to QuickBooks, taking over from Printavo&apos;s QuickBooks sync at the cutover.
        Customers are linked by QuickBooks&apos; own customer number, so renaming a customer here renames the same customer in QuickBooks and its history stays with it.
        It&apos;s <b>{st.settings.enabled ? (st.settings.mode === "live" ? "on and sending" : "on, preview only") : "off"}</b>.
      </p>
      <nav className="set-tabs" aria-label="QuickBooks">
        {([["setup", "Setup"], ["matching", "Customer matching"], ["queue", `Queue${st.counts.needs_review ? ` · ${st.counts.needs_review} to review` : open ? ` · ${open}` : ""}`], ["log", "Log"]] as const).map(([k, l]) => (
          <a key={k} href="#" className={tab === k ? "on" : ""} onClick={(e) => { e.preventDefault(); setTab(k); }}>{l}</a>
        ))}
      </nav>
      {tab === "setup" && <Setup st={st} reload={load} />}
      {tab === "matching" && <Matching st={st} />}
      {tab === "queue" && <Queue st={st} reload={load} />}
      {tab === "log" && <Log />}
    </div>
  );
}

/* ---------------- setup ---------------- */

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <div className="conn-row"><span className={"conn-dot " + (ok ? "ok" : "bad")} aria-hidden="true" /><div>{children}</div></div>;
}

function Setup({ st, reload }: { st: QboStatus; reload: () => void }) {
  const [s, setS] = useState<QboSettings>(st.settings);
  const [lists, setLists] = useState<QboLists | null>(null);
  const [listErr, setListErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => setS(st.settings), [st.settings]);
  useEffect(() => { if (st.connected) qboLists().then((r) => (r.ok ? setLists(r.data!) : setListErr(r.error))); }, [st.connected]);
  const env = st.env;
  const run = async (key: string, f: () => Promise<{ ok: boolean; error?: string; msg?: string }>) => {
    setBusy(key); setMsg("");
    const r = await f();
    setBusy(""); setMsg(r.ok ? r.msg || "Done." : r.error || "Didn't work."); reload();
  };
  const save = (patch: Partial<QboSettings> = s) => run("save", async () => {
    const r = await qboSaveSettings(patch);
    if (!r.ok && /Confirm to save it anyway/.test(r.error) && confirm(r.error)) return qboSaveSettings(patch, { allowLowLiveFrom: true });
    return r;
  });
  const disconnect = async () => {
    if (!confirm("Disconnect QuickBooks? The sync is turned off. Links and history are kept; connect again to carry on.")) return;
    setBusy("disc");
    await fetch("/api/qbo/disconnect", { method: "POST" });
    setBusy(""); reload();
  };
  return (
    <>
      <section className="panel">
        <div className="panel-h"><h2>Connection</h2></div>
        <div className="panel-b stack" style={{ gap: 8 }}>
          {(["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_ENV"] as const).map((k) => (
            <Check key={k} ok={!env.missing.includes(k)}><b><code>{k}</code></b> <span className="faint">{env.missing.includes(k) ? "missing: add it in Vercel → Settings → Environment Variables, then redeploy" : k === "QBO_ENV" ? `set (${env.env || "?"})` : "set"}</span></Check>
          ))}
          {env.problems.map((p) => <div key={p} className="err">{p}</div>)}
          <Check ok={env.webhook}><b><code>QBO_WEBHOOK_TOKEN</code></b> <span className="faint">{env.webhook ? "set" : "optional: the webhook's verifier token from the Intuit app, so edits made in QuickBooks are noticed at once (otherwise every 15 minutes)"}</span></Check>
          <div className="faint" style={{ fontSize: 12.5 }}>In the Intuit developer app, add this redirect URI: <code>{st.callbackUrl}</code>{" · "}webhook URL: <code>{st.webhookUrl}</code> (Customer, Invoice, Payment).</div>
          <Check ok={st.connected}>
            {st.connected
              ? <><b>Connected{st.company ? ` to ${st.company}` : ""}</b> <span className="faint">company {st.realm} · {st.tokenEnv || env.env} · by {st.connectedBy} {when(st.connectedAt)} · sign-in good until {when(st.refreshExpires)} (renewed automatically)</span></>
              : <b>Not connected</b>}
          </Check>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {env.configured ? <a className={"btn sm" + (st.connected ? "" : " primary")} href="/api/qbo/connect">{st.connected ? "Connect again" : "Connect QuickBooks"}</a> : <span className="faint">Connect appears once the keys are in Vercel.</span>}
            {st.connected && <button className="btn sm" type="button" disabled={!!busy} onClick={() => run("test", qboTest)}>{busy === "test" ? "Checking…" : "Check connection"}</button>}
            {st.connected && <button className="btn sm ghost danger" type="button" disabled={!!busy} onClick={disconnect}>Disconnect</button>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Sync</h2><span className="faint" style={{ fontSize: 12 }}>Last run {when(st.lastRunAt)}{st.lastError ? ` · last problem ${when(st.lastErrorAt)}: ${st.lastError}` : ""}</span></div>
        <div className="panel-b stack" style={{ gap: 10 }}>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> <b>Sync on</b> <span className="faint">(runs every minute; off: nothing runs, changes keep queueing)</span></label>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <label>Mode <select value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as QboSettings["mode"] })}>
              <option value="preview">Preview: build what would be sent, send nothing</option>
              <option value="live">Live: send to QuickBooks</option>
            </select></label>
            <label>Invoices from # <input type="number" style={{ width: 100 }} value={s.live_from_number} onChange={(e) => setS({ ...s, live_from_number: +e.target.value })} /></label>
            <label>Printavo&apos;s invoices from # <input type="number" style={{ width: 100 }} value={s.adopt_from_number} onChange={(e) => setS({ ...s, adopt_from_number: +e.target.value })} /></label>
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>Below #{s.adopt_from_number}: never touched. #{s.adopt_from_number}–#{s.live_from_number - 1}: Printavo made the QuickBooks invoice; we only link to it and put payments recorded here on it. #{s.live_from_number} and up: made and kept up to date by this portal.</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn sm primary" type="button" disabled={!!busy} onClick={() => save({ enabled: s.enabled, mode: s.mode, live_from_number: s.live_from_number, adopt_from_number: s.adopt_from_number })}>{busy === "save" ? "Saving…" : "Save"}</button>
            <button className="btn sm" type="button" disabled={!!busy} onClick={() => run("prev", () => qboRunNow(true))}>{busy === "prev" ? "Building previews…" : "Preview now"}</button>
            {st.settings.enabled && st.settings.mode === "live" && <button className="btn sm" type="button" disabled={!!busy} onClick={() => run("run", () => qboRunNow(false))}>{busy === "run" ? "Sending…" : "Run now"}</button>}
            <button className="btn sm ghost" type="button" disabled={!!busy} onClick={() => run("all", qboQueueAll)} title="Every order from the Printavo number up, its customer and its payments">{busy === "all" ? "Queueing…" : "Queue everything"}</button>
          </div>
        </div>
      </section>

      <Cutover st={st} />

      <section className="panel">
        <div className="panel-h"><h2>What goes where in QuickBooks</h2><span className="faint" style={{ fontSize: 12 }}>{st.connected ? (lists ? "Lists from QuickBooks." : listErr ? `Couldn't read QuickBooks' lists: ${listErr}` : "Reading QuickBooks' lists…") : "Connect to pick from QuickBooks' lists; until then, type QuickBooks ids."}</span></div>
        <div className="panel-b stack" style={{ gap: 12 }}>
          <div><b>Products / services</b> <span className="faint" style={{ fontSize: 12.5 }}>(each invoice line is filed under one; anything not set uses the last one)</span></div>
          <div className="grid g2">
            {ITEM_KEYS.map((k) => (
              <label key={k.k} className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>{k.label}</span>
                <Pick value={s.item_map[k.k] || ""} options={lists?.items} onChange={(v) => setS({ ...s, item_map: { ...s.item_map, [k.k]: v } })} />
              </label>
            ))}
          </div>
          <div><b>Payments</b></div>
          <div className="grid g2">
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>Deposit to</span><Pick value={s.deposit_account_id} options={lists?.depositAccounts} blank="Undeposited Funds (QuickBooks' default)" onChange={(v) => setS({ ...s, deposit_account_id: v })} /></label>
            {[...PAY_METHODS, "default"].map((m) => (
              <label key={m} className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>{m === "default" ? "Any other method" : m}</span><Pick value={s.payment_method_map[m] || ""} options={lists?.methods} blank="(none)" onChange={(v) => setS({ ...s, payment_method_map: { ...s.payment_method_map, [m]: v } })} /></label>
            ))}
          </div>
          <div><b>Terms</b></div>
          <div className="grid g2">
            {Object.entries(PAY_TERMS).map(([k, l]) => (
              <label key={k} className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>{l}</span><Pick value={s.term_map[k] || ""} options={lists?.terms} blank="(none)" onChange={(v) => setS({ ...s, term_map: { ...s.term_map, [k]: v } })} /></label>
            ))}
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>No terms set</span><Pick value={s.default_term_id} options={lists?.terms} blank="(none)" onChange={(v) => setS({ ...s, default_term_id: v })} /></label>
          </div>
          <div><b>Sales tax</b> {lists?.ast != null && <span className="faint" style={{ fontSize: 12.5 }}>(QuickBooks automated sales tax is {lists.ast ? "on" : "off"} for this company)</span>}</div>
          <div className="grid g2">
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>How</span>
              <select value={s.tax_mode} onChange={(e) => setS({ ...s, tax_mode: e.target.value as QboSettings["tax_mode"] })}>
                <option value="qbo_ast">QuickBooks sales tax, set to our amount</option>
                <option value="tax_line">Its own line (the &quot;Sales tax&quot; item)</option>
                <option value="none">None</option>
              </select></label>
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>Tax rate code (only without automated sales tax)</span><Pick value={s.tax_code_id} options={lists?.taxCodes} blank="(none)" onChange={(v) => setS({ ...s, tax_code_id: v })} /></label>
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>Exemption reason for tax-exempt customers</span>
              <select value={s.exemption_reason_id} onChange={(e) => setS({ ...s, exemption_reason_id: e.target.value })}>
                <option value="">(none)</option>
                {[["1", "Federal government"], ["2", "State government"], ["3", "Local government"], ["4", "Tribal government"], ["5", "Charitable organization"], ["6", "Religious organization"], ["7", "Educational organization"], ["8", "Hospital"], ["9", "Resale"], ["10", "Direct pay permit"], ["11", "Multiple points of use"], ["12", "Direct mail"], ["13", "Agricultural production"], ["14", "Industrial production / manufacturing"], ["15", "Foreign diplomat"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>Discount account (optional)</span><Pick value={s.discount_account_id} options={lists?.discountAccounts} blank="(QuickBooks' default)" onChange={(v) => setS({ ...s, discount_account_id: v })} /></label>
          </div>
          <div><b>Other</b></div>
          <div className="grid g2">
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>PO number goes in the custom field</span>
              {lists?.customFields?.length ? (
                <select value={s.po_field_id} onChange={(e) => setS({ ...s, po_field_id: e.target.value, po_field_name: lists.customFields.find((f) => f.id === e.target.value)?.name || "" })}>
                  <option value="">(the invoice&apos;s private note)</option>
                  {lists.customFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              ) : <input value={s.po_field_id} placeholder="custom field number (1-3), blank = note" onChange={(e) => setS({ ...s, po_field_id: e.target.value })} style={{ width: 220 }} />}
            </label>
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>Class (optional)</span><Pick value={s.class_id} options={lists?.classes} blank="(none)" onChange={(v) => setS({ ...s, class_id: v })} /></label>
            <label className="row" style={{ gap: 8, justifyContent: "space-between" }}><span>Location (optional)</span><Pick value={s.department_id} options={lists?.departments} blank="(none)" onChange={(v) => setS({ ...s, department_id: v })} /></label>
          </div>
          <div className="row" style={{ gap: 8 }}><button className="btn sm primary" type="button" disabled={!!busy} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save"}</button>{msg && <span className="faint">{msg}</span>}</div>
        </div>
      </section>
    </>
  );
}

function Pick({ value, options, onChange, blank = "(not set)" }: { value: string; options?: Option[]; onChange: (v: string) => void; blank?: string }) {
  if (!options) return <input value={value} placeholder="QuickBooks id" onChange={(e) => onChange(e.target.value.trim())} style={{ width: 160 }} />;
  const known = !value || options.some((o) => o.id === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 280 }}>
      <option value="">{blank}</option>
      {!known && <option value={value}>#{value} (not found)</option>}
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.note ? ` (${o.note})` : ""}</option>)}
    </select>
  );
}

function Cutover({ st }: { st: QboStatus }) {
  const [seq, setSeq] = useState<{ next: number; sql: string } | null>(null);
  useEffect(() => { qboNextOrderNumber().then((r) => r.ok && setSeq(r.data!)); }, []);
  const lf = st.settings.live_from_number;
  const numbered = !!seq && seq.next >= lf;
  const steps: [boolean, ReactNode][] = [
    [st.connected, "Connect QuickBooks and check the connection."],
    [!!st.matchedAt, "Customer matching: run it, confirm, link stragglers, then \"Link Printavo's invoices and payments\"."],
    [st.settings.enabled, "A week before: turn the sync on in preview, press Queue everything, then Preview now. Clear everything under Needs review."],
    [false, "Nov 1, after Printavo's last QuickBooks sync: turn off Printavo's QuickBooks integration, then press \"Link Printavo's invoices and payments\" once more."],
    [numbered, <>Start numbering orders at {lf.toLocaleString("en-US")}: next order is #{seq ? seq.next.toLocaleString("en-US") : "…"}.{!numbered && seq && <> In Supabase → SQL editor run <code data-notranslate>{seq.sql}</code> (Live won&apos;t switch on until this is done).</>}</>],
    [st.settings.enabled && st.settings.mode === "live", <>Switch the mode to Live and Save.{st.liveSince ? ` (Live since ${when(st.liveSince)}.)` : ""} Watch the queue and the log for the first hour.</>],
  ];
  return (
    <section className="panel">
      <div className="panel-h"><h2>Cutover checklist</h2><span className="faint" style={{ fontSize: 12 }}>Printavo off, the portal takes over QuickBooks (Nov 1–2)</span></div>
      <div className="panel-b stack" style={{ gap: 6 }}>
        {steps.map(([done, text], i) => <Check key={i} ok={done}><span style={{ fontSize: 13.5 }}>{i + 1}. {text}</span></Check>)}
      </div>
    </section>
  );
}

const GROUP_OF: Record<string, string> = { DisplayName: "names", CompanyName: "names", PrimaryEmailAddr: "emails", PrimaryPhone: "phones", BillAddr: "addresses", ShipAddr: "addresses", SalesTermRef: "terms", Taxable: "taxable" };
function Differences() {
  const [d, setD] = useState<{ rows: DiffRow[]; unread: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => qboDifferences().then((r) => (r.ok ? setD(r.data!) : setMsg(r.error))), []);
  useEffect(() => { load(); }, [load]);
  const run = async (key: string, f: () => Promise<{ ok: boolean; error?: string; msg?: string }>) => { setBusy(key); const r = await f(); setBusy(""); setMsg(r.ok ? r.msg || "Done." : r.error || "Didn't work."); load(); };
  const counts: Record<string, number> = {};
  for (const r of d?.rows || []) for (const g of new Set(r.fields.map((f) => GROUP_OF[f.field]))) counts[g] = (counts[g] || 0) + 1;
  return (
    <section className="panel">
      <div className="panel-h"><h2>Differences between ours and QuickBooks</h2><span className="faint" style={{ fontSize: 12 }}>Linked customers whose details differ. Nothing here is sent unless you choose to: only what changes here after linking goes on its own.</span></div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn sm" type="button" disabled={!!busy} onClick={() => run("read", qboReadLinkedCustomers)}>{busy === "read" ? "Reading…" : "Read linked customers from QuickBooks"}</button>
          {Object.entries(counts).map(([g, n]) => <button key={g} className="btn sm ghost" type="button" disabled={!!busy} onClick={() => { if (confirm(`Send our ${g} to QuickBooks for ${n} customer${n === 1 ? "" : "s"}? QuickBooks' ${g} for them are replaced by ours.`)) run("g" + g, () => qboSendOurs(g)); }}>Send our {g} ({n})</button>)}
        </div>
        {msg && <div className="faint">{msg}</div>}
        {d && d.unread > 0 && <div className="faint" style={{ fontSize: 12.5 }}>{d.unread} linked customer{d.unread === 1 ? "" : "s"} not read from QuickBooks yet.</div>}
        {!d ? <div className="empty">Loading…</div> : !d.rows.length ? <div className="empty">No differences.</div> : (
          <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>Our customer</th><th>Field</th><th>Ours</th><th>QuickBooks</th><th /></tr></thead>
            <tbody>
              {d.rows.slice(0, 500).flatMap((r) => r.fields.map((f, i) => (
                <tr key={r.linkId + f.field} style={{ cursor: "default" }}>
                  <td>{i === 0 ? <a href={`/shop/customers/${r.localId}`}>{r.localName}</a> : ""}{i === 0 && <span className="faint" style={{ fontSize: 12 }}> #{r.qboId}</span>}</td>
                  <td>{f.label}</td><td style={{ fontSize: 13 }}>{f.ours}</td><td style={{ fontSize: 13 }} className="faint">{f.qbo || "(blank)"}</td>
                  <td className="r"><button className="btn sm ghost" type="button" disabled={!!busy} onClick={() => run("one", () => qboSendOurs(GROUP_OF[f.field], [r.linkId]))}>Send ours</button></td>
                </tr>
              )))}
            </tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}

/* ---------------- matching ---------------- */

function evidenceText(p: ProposalRow) {
  const e = p.evidence as { invoices?: number; totalsMatched?: number; unconfirmed?: string; ofInvoices?: number; sample?: string[]; email?: string; name?: string; phone?: string; ambiguous?: string[]; split?: { localId: string; invoices: number }[] };
  if (p.method === "invoices") return `${e.invoices} invoice number${e.invoices === 1 ? "" : "s"} match (${(e.sample || []).join(", ")}${(e.invoices || 0) > (e.sample?.length || 0) ? "…" : ""}), ${e.totalsMatched} with the same total; ${e.ofInvoices} invoices in QuickBooks${e.split ? `; also points to ${e.split.length - 1} other customer(s)` : ""}${e.unconfirmed ? `. Check it: ${e.unconfirmed}` : ""}`;
  if (p.method === "email") return `Same email: ${e.email}${e.ambiguous ? ` (also ${e.ambiguous.slice(1).join(", ")})` : ""}`;
  if (p.method === "name") return `Same name: ${e.name}${e.ambiguous ? ` (also ${e.ambiguous.slice(1).join(", ")})` : ""}`;
  if (p.method === "phone") return `Same phone: ${e.phone}`;
  return `${(p.evidence as { invoices?: number }).invoices || 0} invoices`;
}

function Matching({ st }: { st: QboStatus }) {
  const [data, setData] = useState<{ proposals: ProposalRow[]; links: LinkRow[]; ourWithout: { id: string; name: string; orders: number }[]; runAt: string | null } | null>(null);
  const [show, setShow] = useSticky<"proposed" | "unmatched" | "confirmed" | "rejected">("qbo.matchShow", "proposed");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => qboMatching().then((r) => (r.ok ? setData(r.data!) : setErr(r.error))), []);
  useEffect(() => { load(); }, [load]);
  const run = async (key: string, f: () => Promise<{ ok: boolean; error?: string; msg?: string }>) => {
    setBusy(key); setMsg("");
    const r = await f();
    setBusy(""); setMsg(r.ok ? r.msg || "Done." : r.error || "Didn't work."); setSel(new Set()); load();
  };
  const rows = useMemo(() => (data?.proposals || []).filter((p) => p.status === show), [data, show]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const p of data?.proposals || []) c[p.status] = (c[p.status] || 0) + 1; return c; }, [data]);
  const linksByLocal = useMemo(() => { const m = new Map<string, LinkRow[]>(); for (const l of data?.links || []) m.set(l.local_id, [...(m.get(l.local_id) || []), l]); return [...m.values()].sort((a, b) => a[0].local_name.localeCompare(b[0].local_name)); }, [data]);
  const changed = (data?.links || []).filter((l) => l.changed_in_qbo);
  if (!st.connected) return <div className="empty">Connect QuickBooks first (Setup). Matching reads QuickBooks&apos; customers and invoices; nothing is linked until you confirm.</div>;
  if (err) return <div className="err">{err}</div>;
  return (
    <>
      <section className="panel">
        <div className="panel-h"><h2>Match customers</h2><span className="faint" style={{ fontSize: 12 }}>Last run {when(data?.runAt)}</span></div>
        <div className="panel-b stack" style={{ gap: 10 }}>
          <div className="faint" style={{ fontSize: 13, maxWidth: 860 }}>Printavo made our customers in QuickBooks under Printavo&apos;s names. Matching finds each one by the strongest evidence: QuickBooks invoices with the same numbers as our Printavo orders, then email, then name (including the names they had in Printavo), then phone. Several QuickBooks customers can belong to one of ours (customers merged here): the one with the latest invoice gets new invoices, the others stay linked for their history. After linking, nothing goes by name again.</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn sm primary" type="button" disabled={!!busy} onClick={() => run("match", qboRunMatching)}>{busy === "match" ? "Reading QuickBooks… (a minute or two)" : data?.runAt ? "Run matching again" : "Run matching"}</button>
            <button className="btn sm" type="button" disabled={!!busy || !counts.proposed} onClick={() => run("high", () => qboConfirm({ minConfidence: 0.9 }))}>Confirm all 90% and up ({(data?.proposals || []).filter((p) => p.status === "proposed" && p.confidence >= 0.9).length})</button>
            <button className="btn sm" type="button" disabled={!!busy} onClick={() => run("adopt", qboAdopt)} title="Link our orders from the Printavo number up to the QuickBooks invoices Printavo made, and their payments">{busy === "adopt" ? "Looking…" : "Link Printavo's invoices and payments"}</button>
          </div>
          {msg && <div className="faint">{msg}</div>}
        </div>
      </section>

      {changed.length > 0 && (
        <section className="panel">
          <div className="panel-h"><h2>Changed in QuickBooks</h2><span className="faint" style={{ fontSize: 12 }}>Edits made there since we last sent them. They aren&apos;t overwritten without asking.</span></div>
          <div className="panel-b stack" style={{ gap: 6 }}>
            {changed.map((l) => <div key={l.id} className="row" style={{ gap: 8 }}><span><b>{l.local_name}</b> ({l.qbo_name} #{l.qbo_id}): {String(l.changed_in_qbo?.note || "")}</span><button className="btn sm ghost" type="button" onClick={() => run("seen", () => qboClearChanged(l.id))}>Seen</button></div>)}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-h"><h2>Proposals</h2>
          <div className="row" style={{ gap: 4 }}>{(["proposed", "unmatched", "confirmed", "rejected"] as const).map((k) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => { setShow(k); setSel(new Set()); }}>{k === "proposed" ? "To review" : k === "unmatched" ? "QuickBooks only" : k[0].toUpperCase() + k.slice(1)} {counts[k] || 0}</button>)}</div>
        </div>
        <div className="panel-b">
          {show === "proposed" && rows.length > 0 && <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <button className="btn sm" type="button" disabled={!sel.size || !!busy} onClick={() => run("conf", () => qboConfirm({ ids: [...sel] }))}>Confirm selected ({sel.size})</button>
            <button className="btn sm ghost" type="button" disabled={!sel.size || !!busy} onClick={() => run("rej", () => qboReject([...sel]))}>Reject selected</button>
          </div>}
          {show === "unmatched" && <div className="faint" style={{ fontSize: 12.5, marginBottom: 8 }}>QuickBooks customers nothing of ours matched: usually old or inactive ones. Link one by hand if you know who it is.</div>}
          {!rows.length ? <div className="empty">{data?.runAt ? "Nothing here." : "Run matching to see proposals."}</div> : (
            <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 860 }}>
              <thead><tr>{show === "proposed" && <th><input type="checkbox" aria-label="Select all" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}<th>Our customer</th><th>QuickBooks customer</th><th>Why</th><th className="r">Sure</th><th>Last invoice</th></tr></thead>
              <tbody>
                {rows.slice(0, 600).map((p) => (
                  <tr key={p.id} style={{ cursor: "default" }}>
                    {show === "proposed" && <td><input type="checkbox" aria-label="Select" checked={sel.has(p.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.id); else n.delete(p.id); setSel(n); }} /></td>}
                    <td>{p.local_id ? <a href={`/shop/customers/${p.local_id}`}>{p.local_name}</a> : <LinkByHand qboId={p.qbo_id} onDone={load} />}</td>
                    <td>{p.qbo_name} <span className="faint">#{p.qbo_id}{p.qbo_active ? "" : " · inactive"}</span>{p.is_primary && p.local_id ? <span className="faint"> · primary</span> : ""}</td>
                    <td style={{ fontSize: 12.5 }}>{p.local_id ? evidenceText(p) : `${(p.evidence as { invoices?: number }).invoices || 0} invoices in QuickBooks`}</td>
                    <td className="r" style={{ color: p.confidence >= 0.9 ? "var(--ok, #2E9D5B)" : p.confidence >= 0.6 ? "inherit" : "var(--danger)" }}>{p.local_id ? pct(+p.confidence) : ""}</td>
                    <td>{p.last_invoice_date || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          {rows.length > 600 && <div className="faint">Showing the first 600 of {rows.length}.</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Linked</h2><span className="faint" style={{ fontSize: 12 }}>{data?.links.length || 0} QuickBooks customers linked to {linksByLocal.length} of ours</span></div>
        <div className="panel-b">
          {!linksByLocal.length ? <div className="empty">Nothing linked yet.</div> : (
            <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>Our customer</th><th>QuickBooks customer</th><th>How</th><th>Last sent</th><th /></tr></thead>
              <tbody>
                {linksByLocal.slice(0, 800).flatMap((ls) => ls.sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((l, i) => (
                  <tr key={l.id} style={{ cursor: "default" }}>
                    <td>{i === 0 ? <a href={`/shop/customers/${l.local_id}`}>{l.local_name}</a> : ""}</td>
                    <td>{l.qbo_name || "?"} <span className="faint">#{l.qbo_id}</span> {l.is_primary ? <b style={{ fontSize: 12 }}>primary</b> : <span className="faint" style={{ fontSize: 12 }}>history only</span>}{l.qbo_owned_fields.length ? <span className="faint" style={{ fontSize: 12 }}> · QuickBooks keeps: {l.qbo_owned_fields.join(", ")}</span> : ""}</td>
                    <td className="faint" style={{ fontSize: 12.5 }}>{l.source.replace("matched_", "matched by ").replace("_", " ")}{l.confidence != null ? ` (${pct(+l.confidence)})` : ""}</td>
                    <td className="faint" style={{ fontSize: 12.5 }}>{l.last_pushed_at ? when(l.last_pushed_at) : ""}</td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      {!l.is_primary && <button className="btn sm ghost" type="button" disabled={!!busy} onClick={() => run("prim", () => qboSetPrimary(l.id))}>Make primary</button>}
                      <button className="btn sm ghost danger" type="button" disabled={!!busy} onClick={() => { if (confirm(`Unlink ${l.qbo_name} from ${l.local_name}? Nothing changes in QuickBooks.`)) run("unl", () => qboUnlink(l.id)); }}>Unlink</button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table></div>
          )}
        </div>
      </section>

      <Differences />

      {(data?.ourWithout.length || 0) > 0 && (
        <section className="panel">
          <div className="panel-h"><h2>Ours with no QuickBooks customer</h2><span className="faint" style={{ fontSize: 12 }}>Customers on orders #{st.settings.adopt_from_number}+ with nothing linked: made in QuickBooks with their first invoice from #{st.settings.live_from_number}. If one is already there, link it.</span></div>
          <div className="panel-b stack" style={{ gap: 6 }}>
            {data!.ourWithout.slice(0, 200).map((c) => <OurWithout key={c.id} c={c} onDone={load} />)}
          </div>
        </section>
      )}
    </>
  );
}

function LinkByHand({ qboId, onDone }: { qboId: string; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => { const t = setTimeout(() => { if (q.trim().length >= 2) qboFindCustomers(q).then((r) => r.ok && setHits(r.data || [])); else setHits([]); }, 250); return () => clearTimeout(t); }, [q]);
  return (
    <div style={{ position: "relative" }}>
      <input value={q} placeholder="Link to one of ours…" onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
      {hits.length > 0 && <div className="stack" style={{ gap: 2, marginTop: 4 }}>{hits.map((h) => <button key={h.id} type="button" className="btn sm ghost" style={{ justifyContent: "flex-start" }} onClick={async () => { const r = await qboLinkManual(h.id, qboId); setMsg(r.ok ? r.msg || "" : r.error); if (r.ok) onDone(); }}>{h.name}</button>)}</div>}
      {msg && <div className="faint" style={{ fontSize: 12 }}>{msg}</div>}
    </div>
  );
}

function OurWithout({ c, onDone }: { c: { id: string; name: string; orders: number }; onDone: () => void }) {
  const [id, setId] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <a href={`/shop/customers/${c.id}`} style={{ minWidth: 220 }}>{c.name}</a><span className="faint" style={{ fontSize: 12.5 }}>{c.orders} order{c.orders === 1 ? "" : "s"}</span>
      <input value={id} placeholder="QuickBooks customer #" onChange={(e) => setId(e.target.value)} style={{ width: 170 }} />
      <button className="btn sm ghost" type="button" disabled={!id.trim()} onClick={async () => { const r = await qboLinkManual(c.id, id); setMsg(r.ok ? r.msg || "" : r.error); if (r.ok) onDone(); }}>Link</button>
      {msg && <span className="faint" style={{ fontSize: 12 }}>{msg}</span>}
    </div>
  );
}

/* ---------------- queue ---------------- */

function Queue({ st, reload }: { st: QboStatus; reload: () => void }) {
  const [status, setStatus] = useSticky("qbo.queueStatus", "open");
  const [rows, setRows] = useState<QueueItem[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => qboQueue(status).then((r) => setRows(r.ok ? r.data! : [])), [status]);
  useEffect(() => { setRows(null); load(); }, [load]);
  const act = async (id: number, a: "retry" | "skip" | "resolve", res?: Record<string, unknown>) => {
    setBusy(true);
    const r = await qboQueueAction(id, a, res);
    setBusy(false); setMsg(r.ok ? r.msg || "" : r.error); load(); reload();
  };
  const c = st.counts;
  return (
    <section className="panel">
      <div className="panel-h"><h2>Queue</h2>
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {([["open", "Open", (c.pending || 0) + (c.error || 0) + (c.needs_review || 0) + (c.running || 0)], ["needs_review", "Needs review", c.needs_review], ["pending", "Waiting", c.pending], ["error", "Will retry", c.error], ["done", "Done", c.done], ["skipped", "Skipped", c.skipped], ["all", "All", null]] as const).map(([k, l, n]) => (
            <button key={k} type="button" className={"chip" + (status === k ? " on" : "")} onClick={() => setStatus(k)}>{l}{n != null ? ` ${n || 0}` : ""}</button>
          ))}
        </div>
      </div>
      <div className="panel-b">
        <div className="faint" style={{ fontSize: 12.5, marginBottom: 8 }}>Every change to a customer, an order from #{st.settings.adopt_from_number} up, or a payment lands here and is sent in order (customer, then invoice, then payment). In preview, each row shows exactly what would be sent.{msg ? ` ${msg}` : ""}</div>
        {!rows ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">Nothing here.</div> : (
          <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 820 }}>
            <thead><tr><th>What</th><th>Status</th><th>Why / what happened</th><th className="r">Tries</th><th>Changed</th></tr></thead>
            <tbody>
              {rows.flatMap((r) => {
                const isOpen = openId === r.id;
                const out = [
                  <tr key={r.id} onClick={() => setOpenId(isOpen ? null : r.id)}>
                    <td><span className="faint" style={{ fontSize: 12 }}>{r.entity}{r.op !== "upsert" ? ` · ${r.op}` : ""}</span><br />{r.href ? <a href={r.href} onClick={(e) => e.stopPropagation()}>{r.label}</a> : r.label}</td>
                    <td><span className="pill" style={{ ["--sc" as string]: STATUS_C[r.status] || "#7C8799" }}>{STATUS_L[r.status] || r.status}</span></td>
                    <td style={{ fontSize: 13, maxWidth: 520 }}>{r.reason || r.last_error || ""}</td>
                    <td className="r">{r.attempts || ""}</td>
                    <td className="faint" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{when(r.updated_at)}</td>
                  </tr>,
                ];
                if (isOpen) out.push(<tr key={r.id + "-d"} style={{ cursor: "default" }}><td colSpan={5}><Detail r={r} busy={busy} act={act} /></td></tr>);
                return out;
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}

function Detail({ r, busy, act }: { r: QueueItem; busy: boolean; act: (id: number, a: "retry" | "skip" | "resolve", res?: Record<string, unknown>) => void }) {
  const p = (r.payload_preview || {}) as { action?: string; summary?: { label: string; qty: number; unit: number; amount: number; item: string }[]; total?: number; storedTotal?: number; warnings?: string[]; problems?: string[]; conflicts?: { field: string; label: string; ours: string; qbo: string }[]; changes?: { field: string; from: string; to: string }[]; canLink?: string | null; existing?: { DisplayName?: string } };
  const conflicts = p.conflicts || [];
  return (
    <div className="stack" style={{ gap: 10, padding: "6px 0" }}>
      {r.last_error && r.last_error !== r.reason && <div className="err">{r.last_error}</div>}
      {p.summary && (
        <table className="items" style={{ minWidth: 0, maxWidth: 820 }}>
          <thead><tr><th>Line</th><th>Item</th><th className="r">Qty</th><th className="r">Each</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {p.summary.map((l, i) => <tr key={i}><td>{l.label}</td><td className="faint">{l.item}</td><td className="r">{l.qty}</td><td className="r">{(+l.unit).toFixed(2)}</td><td className="r">{(+l.amount).toFixed(2)}</td></tr>)}
            <tr><td colSpan={4}><b>Total</b>{p.storedTotal != null && p.storedTotal !== p.total ? <span className="faint"> (saved order total {p.storedTotal?.toFixed(2)})</span> : ""}</td><td className="r"><b>{p.total?.toFixed(2)}</b></td></tr>
          </tbody>
        </table>
      )}
      {(p.warnings || []).map((w) => <div key={w} className="faint">Note: {w}</div>)}
      {(p.problems || []).map((w) => <div key={w} className="err">{w}</div>)}
      {p.changes && p.changes.length > 0 && <div style={{ fontSize: 13 }}>{p.changes.map((c) => <div key={c.field}>{c.field}: <span className="faint">&quot;{c.from}&quot;</span> → <b>&quot;{c.to}&quot;</b></div>)}</div>}
      {conflicts.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {conflicts.map((c) => <div key={c.field} style={{ fontSize: 13 }}><b>{c.label}</b>: QuickBooks has &quot;{c.qbo}&quot;, ours is &quot;{c.ours}&quot;</div>)}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" type="button" disabled={busy} onClick={() => act(r.id, "resolve", { force_fields: conflicts.map((c) => c.field) })}>Ours wins (send ours)</button>
            <button className="btn sm ghost" type="button" disabled={busy} onClick={() => act(r.id, "resolve", { keep_qbo: conflicts.map((c) => c.field) })}>Keep QuickBooks&apos; (stop sending {conflicts.map((c) => c.label.toLowerCase()).join(", ")} for this customer)</button>
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {p.canLink && <button className="btn sm" type="button" disabled={busy} onClick={() => act(r.id, "resolve", { link_qbo_id: p.canLink })}>Link to it ({p.existing?.DisplayName} #{p.canLink})</button>}
        {r.entity === "invoice" && r.status === "needs_review" && /changed in QuickBooks/i.test(r.reason) && <button className="btn sm" type="button" disabled={busy} onClick={() => act(r.id, "resolve", { force: true })}>Send ours anyway</button>}
        {r.entity === "invoice" && r.status === "needs_review" && /back to a quote/i.test(r.reason) && <button className="btn sm" type="button" disabled={busy} onClick={() => act(r.id, "resolve", { void: true })}>Void in QuickBooks</button>}
        {["needs_review", "error", "skipped", "done"].includes(r.status) && <button className="btn sm" type="button" disabled={busy} onClick={() => act(r.id, "retry")}>Retry</button>}
        {["needs_review", "error", "pending"].includes(r.status) && <button className="btn sm ghost" type="button" disabled={busy} onClick={() => act(r.id, "skip")}>Skip</button>}
      </div>
      {r.payload_preview != null && (
        <details><summary className="faint" style={{ cursor: "pointer" }}>What would be sent ({p.action || "?"}){r.previewed_at ? `, built ${when(r.previewed_at)}` : ""}</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--surface-2)", padding: 10, borderRadius: 6, maxHeight: 420, overflow: "auto" }} data-notranslate>{JSON.stringify(r.payload_preview, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/* ---------------- log ---------------- */

function Log() {
  const [onlyErr, setOnlyErr] = useSticky("qbo.logErrors", false);
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => { setRows(null); qboLog(onlyErr).then((r) => setRows(r.ok ? r.data! : [])); }, [onlyErr]);
  return (
    <section className="panel">
      <div className="panel-h"><h2>Log</h2><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={onlyErr} onChange={(e) => setOnlyErr(e.target.checked)} /> Only problems</label></div>
      <div className="panel-b">
        {!rows ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">No requests to QuickBooks yet.</div> : (
          <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 820 }}>
            <thead><tr><th>When</th><th>Request</th><th>For</th><th>Result</th><th className="r">ms</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} style={{ cursor: "default" }}>
                  <td className="faint" style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{when(l.at)}</td>
                  <td style={{ fontSize: 12.5, maxWidth: 420, wordBreak: "break-word" }} data-notranslate>{l.method} {l.path}</td>
                  <td className="faint" style={{ fontSize: 12.5 }}>{l.entity || ""}{l.qbo_id ? ` #${l.qbo_id}` : ""}</td>
                  <td style={{ fontSize: 12.5 }}>{l.ok ? <span style={{ color: "var(--ok, #2E9D5B)" }}>OK</span> : <span className="err">{l.status || ""} {l.error}</span>}</td>
                  <td className="r faint">{l.ms ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}
