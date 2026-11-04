"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import BackLink from "@/components/BackLink";
import { contactDetail, contactList, lookUpOnline, saveContacts, type Addr, type ContactRow, type ContactState, type Detail } from "./actions";
import type { CompanyFound } from "@/lib/ai/companyLookup";
import { moveCustomers, moveList, sendCustomerPreview, sendPersonalNoteTest, setPersonal, setQuiet, type MoveRow } from "../move-list/actions";

/**
 * Update contacts (Nov 3, Nick: "for creative apparel… Scott Gray, Lyn, Lisa… their name, their email… who they are,
 * whether they get a contact or not… even their phone number… who want to have portal access"). Every account on the left,
 * biggest first; on the right, every person at that company found in the shop's mail, each with a phone from their email
 * signature, Contact / Portal / Main and what they do (orders, art, billing). People who look like regulars (20+ emails at
 * the company's own address) start ticked, in blue, until saved. Saves here only; Printavo isn't touched.
 */
/**
 * Portal customers: one tool for moving customers to the new system, their contacts, and their intro email (Nov 4, Nick:
 * "put those together into one tool… hide everyone who's already been sent… launch email sent, personal email sent,
 * haven't been sent, people who have logged in… click on them… update contact info, move to new… on the right… hasn't
 * been moved"). Portal intro emails (/shop/customers/move-list) opens here.
 */
type Show = "notmoved" | "unsent" | "launch" | "personal" | "visited" | "all";
const SHOWS: Show[] = ["notmoved", "unsent", "launch", "personal", "visited", "all"];
const LABEL: Record<Show, string> = { notmoved: "Not moved yet", unsent: "Moved, not sent", launch: "Launch email sent", personal: "Personal email sent", visited: "Logged in", all: "All" };
type Mail = "none" | "launch" | "nick" | "amanda";
const wasSent = (m?: MoveRow) => !!m && (!!m.launchSent || !!m.personal.sentAt);
const mailOf = (m?: MoveRow): Mail => (!m ? "none" : !m.personal.skip && m.personal.to.length ? (/^amanda/i.test(m.personal.from) ? "amanda" : "nick") : !m.quiet && m.email ? "launch" : "none");
const shortDay = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const ROLES = ["Orders", "Art", "Billing"];
const when = (d: string) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "");
const first = (n: string) => n.split(/\s+/)[0];
/** a number we found for someone: from their email signature, or from someone's phone contacts */
type PhoneOpt = { label: string; value: string };
type Row = { key: string; contactId?: string; name: string; email: string; phone: string; phoneFound: boolean; opts: PhoneOpt[]; contact: boolean; portal: boolean; main: boolean; roles: string[];
  n?: number; last?: string; boxes?: string[]; same?: boolean; suggested?: boolean; outsider?: boolean };

export default function UpdateContacts() {
  const [show, setShow] = useSticky<Show>("customers.portal.view", "notmoved");
  // whose accounts: "auto" until picked, then the person looking (their own) on first load
  const [who0, setWho] = useSticky<string>("customers.contacts.owner2", "auto");
  const [meOwner, setMeOwner] = useState("");
  const who = who0 === "auto" ? meOwner : who0;
  const [showOthers, setShowOthers] = useSticky<boolean>("customers.contacts.others", false);
  const [rows, setRows] = useState<ContactRow[] | null>(null), [owners, setOwners] = useState<string[]>([]);
  const [q, setQ] = useState(""), [cur, setCur] = useState(""), [err, setErr] = useState("");
  const [d, setD] = useState<Detail | null>(null), [co, setCo] = useState<{ company: string; phone: string; address: string; taxExempt: boolean; terms: string; priceType: string; notes: string; shipAddress: string; others: Addr[] }>({ company: "", phone: "", address: "", taxExempt: false, terms: "receipt", priceType: "retail", notes: "", shipAddress: "", others: [] });
  const [people, setPeople] = useState<Row[]>([]), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  // what was found online for this account (Look it up online), and which boxes were filled from it
  const [web, setWeb] = useState<CompanyFound | null | "busy">(null), [webErr, setWebErr] = useState(""), [fromWeb, setFromWeb] = useState<Set<string>>(new Set());

  // where each customer is in the move: moved, which intro email, sent, logged in (owner only; others see contacts only)
  const [mv, setMv] = useState<Map<string, MoveRow> | null>(null);
  const loadMv = async () => { const r = await moveList(); setMv(r.ok ? new Map(r.rows.map((x) => [x.id, x])) : new Map()); };
  useEffect(() => { void loadMv(); }, []);
  const inView = (r: ContactRow, s: Show) => {
    if (s === "all") return true;
    const m = mv?.get(r.id);
    if (!m) return s === "notmoved";
    if (s === "notmoved") return !m.movedAt;
    if (!m.movedAt) return false;
    return s === "unsent" ? !wasSent(m) : s === "launch" ? !!m.launchSent : s === "personal" ? !!m.personal.sentAt : m.visits.n > 0;
  };
  useEffect(() => { void contactList().then((r) => { if (r.ok) { setRows(r.rows); setOwners(r.owners); setMeOwner(r.meOwner); } else setErr(r.error); }); }, []);
  const all = rows || [];
  const mine = (r: ContactRow) => !who || first(r.owner).toLowerCase() === first(who).toLowerCase();
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter((r) => inView(r, show) && mine(r) && (!t || `${r.name} ${r.contact} ${r.email}`.toLowerCase().includes(t)));
  }, [all, show, who, q, mv]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (s: Show) => all.filter((r) => inView(r, s) && mine(r)).length;

  // open one: who's on the account, then everyone found in the mail; the regulars at the company start ticked
  const open = async (id: string) => {
    setCur(id); setD(null); setPeople([]); setNote(""); setErr(""); setWeb(null); setWebErr(""); setFromWeb(new Set());
    const r = await contactDetail(id);
    if (!r.ok) return setErr(r.error);
    const x = r.detail;
    // the numbers found for someone, to pick from (Nov 3, Nick: "signature and then from my phone… I can select which one is right")
    const optsOf = (sig?: string, cell?: string, cellFrom?: string): PhoneOpt[] => {
      const o: PhoneOpt[] = [];
      if (sig) o.push({ label: "Signature", value: sig });
      if (cell) { const same = o.find((y) => y.value.replace(/\D/g, "") === cell.replace(/\D/g, "")); if (same) same.label += ` and ${cellFrom || "phone"}`; else o.push({ label: cellFrom || "Phone contacts", value: cell }); }
      return o;
    };
    const addOpts = (row: Row, more: PhoneOpt[]) => { for (const m of more) if (!row.opts.some((y) => y.value.replace(/\D/g, "") === m.value.replace(/\D/g, ""))) row.opts.push(m); };
    const list: Row[] = x.contacts.filter((c) => c.email || c.name).map((c) => ({ key: c.id, contactId: c.id, name: c.name, email: c.email, phone: c.phone, phoneFound: false, opts: optsOf(c.foundPhone, c.cell, c.cellFrom),
      contact: true, portal: c.portal, main: c.isPrimary || (!!x.email && c.email === x.email), roles: c.roles }));
    if (x.email && !list.some((p) => p.email === x.email)) list.unshift({ key: "main", name: x.name, email: x.email, phone: "", phoneFound: false, opts: [], contact: true, portal: true, main: true, roles: [] });
    for (const p of x.found) {
      // a contact on file by name only (Printavo often had no email for them) is the same person found by name in the mail
      const nameOnly = p.email ? list.find((y) => !y.email && y.name && y.name.toLowerCase() === p.name.toLowerCase()) : undefined;
      if (nameOnly) nameOnly.email = p.email;
      const have = p.email ? list.find((y) => y.email === p.email) : undefined;
      if (have) { Object.assign(have, { n: p.n, last: p.last, boxes: p.boxes, same: p.sameCompany }); addOpts(have, optsOf(p.phone, p.cell, p.cellFrom)); continue; }
      // nobody found starts ticked (Nov 3, Nick: "by default, can you have no one checked… and I'll check them")
      list.push({ key: p.email || `ph-${p.name}`, name: p.name, email: p.email, phone: "", phoneFound: false, opts: optsOf(p.phone, p.cell, p.cellFrom), contact: false, portal: false, main: false, roles: [],
        n: p.n, last: p.last, boxes: p.boxes, same: p.sameCompany, outsider: !p.sameCompany });
    }
    // one main: the one on file, else the regular we've traded the most mail with
    if (!list.some((p) => p.main && p.contact)) { const m = list.filter((p) => p.contact).sort((a, b) => (b.n || 0) - (a.n || 0))[0]; if (m) m.main = true; }
    setD(x); setCo({ company: x.company, phone: x.phone, address: x.address, taxExempt: x.taxExempt, terms: x.terms, priceType: x.priceType, notes: x.notes, shipAddress: x.shipAddress, others: x.others }); setPeople(list);
  };
  useEffect(() => { if (!cur && list[0]) void open(list[0].id); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (key: string, patch: Partial<Row>) => setPeople((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch, suggested: false } : p)));
  const tick = (key: string, on: boolean) => setPeople((ps) => {
    const next = ps.map((p) => (p.key === key ? { ...p, contact: on, portal: on ? p.portal || !p.contactId : false, main: on ? p.main : false, suggested: false } : p));
    if (!next.some((p) => p.main && p.contact)) { const m = next.find((p) => p.contact); if (m) m.main = true; }
    return next;
  });
  const setMain = (key: string) => setPeople((ps) => ps.map((p) => ({ ...p, main: p.key === key, contact: p.key === key ? true : p.contact })));
  const role = (key: string, r: string) => setPeople((ps) => ps.map((p) => (p.key === key ? { ...p, roles: p.roles.includes(r) ? p.roles.filter((x) => x !== r) : [...p.roles, r], contact: true } : p)));
  const addBlank = () => setPeople((ps) => [...ps, { key: `new-${Date.now()}`, name: "", email: "", phone: "", phoneFound: false, opts: [], contact: true, portal: true, main: !ps.some((p) => p.main && p.contact), roles: [] }]);

  const lookUp = async () => {
    if (!d) return;
    setWeb("busy"); setWebErr("");
    const r = await lookUpOnline(d.id);
    if (!r.ok) { setWeb(null); return setWebErr(r.error); }
    setWeb(r.found);
  };
  const useWeb = (what: ("address" | "phone")[]) => {
    if (!web || web === "busy") return;
    setCo((c) => ({ ...c, ...(what.includes("address") && web.address ? { address: web.address } : {}), ...(what.includes("phone") && web.phone ? { phone: web.phone } : {}) }));
    setFromWeb((s) => new Set([...s, ...what]));
  };
  const next = () => { const i = list.findIndex((r) => r.id === cur); const n = list[i + 1] || list.find((r) => r.id !== cur); if (n) void open(n.id); };
  const save = async (move = false) => {
    if (!d) return;
    setBusy(true); setErr("");
    const r = await saveContacts({ id: d.id, ...co, move, people: people.filter((p) => p.contactId || p.contact).map((p) => ({ contactId: p.contactId, name: p.name, email: p.email, phone: p.phone, contact: p.contact, portal: p.portal, main: p.main, roles: p.roles })) });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    const m = people.find((p) => p.main && p.contact);
    setRows((rs) => (rs || []).map((x) => (x.id === d.id ? { ...x, name: co.company || x.name, contact: m?.name || x.contact, email: m?.email || x.email, state: "done", checkedAt: new Date().toISOString() } : x)));
    if (r.moved) void loadMv();
    setNote(`${r.moved ? "Moved to our system" : "Saved"}: ${co.company || m?.name || "the account"}${r.added ? `, ${r.added} added` : ""}${r.removed ? `, ${r.removed} taken off` : ""}.`);
    next();
  };

  const row = all.find((r) => r.id === cur);
  const m = cur ? mv?.get(cur) : undefined;
  /** move without touching contacts, and no email (Nov 4, Nick) */
  const moveNow = async () => {
    if (!d) return;
    setBusy(true); setErr("");
    const r = await moveCustomers([d.id], true);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setNote(`${co.company || "The account"} is moved to the new system. No email was sent.`);
    await loadMv(); next();
  };
  /** which intro email they get: none, the launch email, or a personal note from Nick or Amanda (nothing sends from here) */
  const setMail = async (v: Mail) => {
    if (!d) return;
    setErr("");
    const a = await setQuiet([d.id], v !== "launch");
    const b = await setPersonal([d.id], v === "nick" || v === "amanda", v === "amanda" ? "amanda@fbsprint.com" : v === "nick" ? "nicholas@fbsprint.com" : undefined);
    if (!a.ok) return setErr(a.error);
    if (!b.ok) return setErr(b.error);
    await loadMv();
  };
  const [pv, setPv] = useState("");
  const preview = async () => { if (!d) return; setPv("busy"); setErr(""); const x = await sendCustomerPreview(d.id); setPv(""); if (x.ok) setNote(`Both emails sent to ${x.to} as ${co.company || "they"} get them.`); else setErr(x.error); };
  const testNote = async () => { setPv("test"); setErr(""); const r = await sendPersonalNoteTest(); setPv(""); if (r.ok) setNote(`Both versions of the personal email sent from ${r.from} to ${r.to}.`); else setErr(r.error); };
  const theirs = people.filter((p) => !p.outsider);
  const outsiders = people.filter((p) => p.outsider);
  const chosen = people.filter((p) => p.contact).length;

  const personRow = (p: Row) => (
    <tr key={p.key} className={(p.contact ? "" : "ucx-off ") + (p.suggested ? "ucx-sugrow" : "")}>
      <td>
        <input className="ucx-in" aria-label="Name" placeholder="Name" value={p.name} onChange={(e) => edit(p.key, { name: e.target.value })} />
        {p.contactId || !p.n ? <input className="ucx-in ucx-em" aria-label="Email" placeholder="Email" value={p.email} onChange={(e) => edit(p.key, { email: e.target.value })} />
          : <div className="sub" data-notranslate>{p.email}</div>}
        {p.n ? <div className="sub">{p.suggested && <span className="ucx-found">Suggested · </span>}{p.n.toLocaleString()} email{p.n === 1 ? "" : "s"} with {(p.boxes || []).join(", ")} · last {when(p.last || "")}</div>
          : !p.contactId && p.boxes?.length ? <div className="sub">In {p.boxes.join(", ")}{p.email ? "" : " (no email there: add one for the portal)"}</div> : null}
      </td>
      <td><input className="ucx-in" aria-label="Phone" placeholder="Phone" value={p.phone} onChange={(e) => edit(p.key, { phone: e.target.value })} />
        {p.opts.length > 0 && <div className="ucx-opts">{p.opts.map((o) => {
          const on = o.value.replace(/\D/g, "") === p.phone.replace(/\D/g, "");
          return <button key={o.value} type="button" className={"ucx-opt" + (on ? " on" : "")} onClick={() => edit(p.key, { phone: on ? "" : o.value })} title={on ? "Clear it" : "Use this number"}><span>{o.label}</span><b>{o.value}</b></button>;
        })}</div>}</td>
      <td className="ucx-c"><input type="checkbox" aria-label={`${p.name || p.email} is a contact`} checked={p.contact} onChange={(e) => tick(p.key, e.target.checked)} /></td>
      <td className="ucx-c"><input type="checkbox" aria-label={`${p.name || p.email} can sign in to the portal`} checked={p.contact && p.portal} disabled={!p.contact || !p.email} onChange={(e) => edit(p.key, { portal: e.target.checked })} /></td>
      <td className="ucx-c"><input type="radio" name="ucx-main" aria-label={`${p.name || p.email} is the main contact`} checked={p.contact && p.main} onChange={() => setMain(p.key)} /></td>
      <td><div className="ucx-roles" role="group" aria-label="What they do">{ROLES.map((r) => <button key={r} type="button" className={"ucx-role" + (p.roles.includes(r) ? " on" : "")} onClick={() => role(p.key, r)}>{r}</button>)}</div></td>
    </tr>
  );

  return (
    <>
      <BackLink href="/shop/customers" label="Customers" />
      <div className="page-head">
        <div><h1>Portal customers</h1><div className="eyebrow">Move customers to the new system, update their contacts and pick their intro email. Customers already sent an email are hidden unless you pick them. Nothing sends from here.</div></div>
        <div className="row"><button type="button" className="btn" disabled={pv === "test"} onClick={() => void testNote()} title="The personal email in both versions, from your own mailbox to Nick and Amanda">{pv === "test" ? "Sending…" : "Test the personal email"}</button><Link className="btn" href="/shop/settings/launch-email">Launch email</Link></div>
      </div>
      {rows && <div className="stats">
        {(["notmoved", "unsent", "launch", "personal", "visited"] as Show[]).map((s) => <button key={s} type="button" className="stat" onClick={() => setShow(s)}><span className="v">{mv ? count(s) : "…"}</span><span className="k">{LABEL[s]}</span></button>)}
      </div>}
      <div className="toolbar">
        <div className="chips">{SHOWS.map((s) => <button key={s} type="button" className={"chip" + (show === s ? " on" : "")} onClick={() => setShow(s)}>{LABEL[s]}</button>)}</div>
        <input type="search" className="ucx-q" placeholder="Find an account" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}
      {rows === null ? <p className="faint">Loading accounts…</p> : (
        <div className="ucx">
          <section className="panel ucx-list">
            <div className="panel-h"><h2>Accounts</h2><span className="faint">{list.length}</span></div>
            {/* whose accounts: each owner works their own (Nov 3, Nick) */}
            <div className="ucx-who" role="group" aria-label="Whose accounts" style={{ gridTemplateColumns: `repeat(${owners.length + 1},minmax(0,1fr))` }}>
              {owners.map((o) => <button key={o} type="button" className={who === o ? "on" : ""} onClick={() => setWho(o)}>{o === meOwner ? "Mine" : first(o)}</button>)}
              <button type="button" className={!who ? "on" : ""} onClick={() => setWho("")}>Everyone</button>
            </div>
            <div className="ucx-items">
              {list.map((r) => (
                <button key={r.id} type="button" className={"ucx-i" + (r.id === cur ? " on" : "")} onClick={() => void open(r.id)}>
                  <span className={"ucx-dot " + r.state} aria-hidden />
                  <span className="ucx-it"><b data-notranslate>{r.name}</b><small>{r.state === "missing" ? "No contact" : r.state === "check" ? `${r.email} · never in our mail` : r.contact || r.email}{r.owner ? ` · ${first(r.owner)}` : ""}</small></span>
                  {(() => { const x = mv?.get(r.id); return !mv ? null : !x?.movedAt ? <span className="ucx-mv no">Not moved</span> : wasSent(x) ? <span className="ucx-mv sent">Sent {shortDay((x.launchSent || x.personal.sentAt)!)}</span> : <span className="ucx-mv yes">Moved</span>; })()}
                </button>
              ))}
              {!list.length && <p className="faint" style={{ padding: 12 }}>Nothing here.</p>}
            </div>
          </section>
          <section className="panel ucx-form">
            {!d ? <div className="panel-b faint">{cur ? "Looking through your email…" : "Pick an account."}</div> : (
              <>
                <div className="panel-h"><h2 data-notranslate>{co.company || "Customer"}</h2><span className="faint">{[d.owner && `Owner ${first(d.owner)}`, d.printavoAs.length && `In Printavo as "${d.printavoAs.join(" / ")}"`, row?.rank && `#${row.rank} by sales`].filter(Boolean).join(" · ")}</span><Link className="pd-link ucx-open" href={`/shop/customers/${d.id}`}>Open customer</Link></div>
                <div className="panel-b">
                  <div className="ucx-g">
                    <div className="field"><label htmlFor="ucx-c">Company name on invoices</label><input id="ucx-c" value={co.company} onChange={(e) => setCo({ ...co, company: e.target.value })} /></div>
                    <div className="field"><label htmlFor="ucx-p">Company phone</label><input id="ucx-p" type="tel" className={fromWeb.has("phone") ? "ucx-sug" : ""} value={co.phone} onChange={(e) => setCo({ ...co, phone: e.target.value })} /></div>
                    <div className="field ucx-lookup"><label>&nbsp;</label><button type="button" className="btn" disabled={web === "busy"} onClick={() => void lookUp()}>{web === "busy" ? "Looking it up…" : "Look it up online"}</button></div>
                    <div className="field ucx-wide"><label htmlFor="ucx-a">Billing address</label><textarea id="ucx-a" rows={2} className={fromWeb.has("address") ? "ucx-sug" : ""} value={co.address} onChange={(e) => setCo({ ...co, address: e.target.value })} /></div>
                  </div>
                  {/* more addresses, each with its own name (Nov 3, Nick: "Gateway, I need three addresses: billing, delivery, and admin office") */}
                  <div className="ucx-addrs">
                    {(co.shipAddress || co.others.length > 0) && <div className="ucx-lbl">Other addresses</div>}
                    {co.shipAddress && <div className="ucx-addr"><input className="ucx-in ucx-al" value="Ship to" readOnly aria-label="Name of this address" /><textarea rows={2} className="ucx-at" aria-label="Ship to address" value={co.shipAddress} onChange={(e) => setCo({ ...co, shipAddress: e.target.value })} />
                      <button type="button" className="btn icon ghost" aria-label="Remove the ship-to address" title="Remove" onClick={() => setCo({ ...co, shipAddress: "" })}>×</button></div>}
                    {co.others.map((a) => (
                      <div key={a.id} className="ucx-addr">
                        <input className="ucx-in ucx-al" placeholder="Name it: Delivery, Admin office…" aria-label="Name of this address" value={a.label} onChange={(e) => setCo({ ...co, others: co.others.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)) })} />
                        <textarea rows={2} className="ucx-at" placeholder="Street, city, state ZIP" aria-label={`${a.label || "Other"} address`} value={a.address} onChange={(e) => setCo({ ...co, others: co.others.map((x) => (x.id === a.id ? { ...x, address: e.target.value } : x)) })} />
                        <button type="button" className="btn icon ghost" aria-label={`Remove ${a.label || "this address"}`} title="Remove" onClick={() => setCo({ ...co, others: co.others.filter((x) => x.id !== a.id) })}>×</button>
                      </div>
                    ))}
                    <button type="button" className="btn sm ucx-addbtn" onClick={() => setCo({ ...co, others: [...co.others, { id: Math.random().toString(36).slice(2, 9), label: "", address: "" }] })}>+ Add an address</button>
                  </div>
                  {webErr && <div className="err" style={{ marginTop: 8 }}>{webErr}</div>}
                  {web && web !== "busy" && (
                    <div className={"ucx-web" + (web.sure === "low" ? " low" : "")}>
                      <div className="ucx-web-t">
                        <b>{web.address || web.phone ? "Found online" : "Nothing sure found online"}</b>
                        {(web.address || web.phone) && <span className="faint">{web.sure === "high" ? "Looks right" : web.sure === "medium" ? "Probably right: check it" : "Not sure it's the same company"}</span>}
                      </div>
                      {web.address && <div className="ucx-web-r"><span className="ucx-web-k">Address</span><span data-notranslate>{web.address}</span>{web.address !== co.address && <button type="button" className="btn sm" onClick={() => useWeb(["address"])}>Use</button>}</div>}
                      {web.phone && <div className="ucx-web-r"><span className="ucx-web-k">Phone</span><span data-notranslate>{web.phone}</span>{web.phone !== co.phone && <button type="button" className="btn sm" onClick={() => useWeb(["phone"])}>Use</button>}</div>}
                      {web.website && <div className="ucx-web-r"><span className="ucx-web-k">Website</span><span data-notranslate>{web.website}</span></div>}
                      {web.note && <div className="faint ucx-web-n">{web.note}</div>}
                      {web.sources.length > 0 && <div className="ucx-web-n">{web.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="ucx-web-s">{s.title}</a>)}</div>}
                      {web.address && web.phone && (web.address !== co.address || web.phone !== co.phone) && <button type="button" className="btn primary sm" onClick={() => useWeb(["address", "phone"])}>Use both</button>}
                    </div>
                  )}

                  <div className="ucx-sec"><span>People at {co.company || "this company"}</span><span className="faint">{chosen} chosen</span>
                    <button type="button" className="btn sm" onClick={addBlank}>+ Add person</button></div>
                  {theirs.length ? (
                    <div className="tbl-wrap"><table className="tbl ucx-t"><colgroup><col style={{ width: "34%" }} /><col style={{ width: "20%" }} /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "7%" }} /><col /></colgroup>
                      <thead><tr><th>Person</th><th>Phone</th><th className="ucx-c">Contact</th><th className="ucx-c">Portal</th><th className="ucx-c">Main</th><th>What they do</th></tr></thead>
                      <tbody>{theirs.map(personRow)}</tbody>
                    </table></div>
                  ) : <p className="faint ucx-none">Nobody at this company found in the shop&apos;s email. Add someone, or skip it.</p>}

                  {outsiders.length > 0 && <>
                    <button type="button" className="linkbtn ucx-more" onClick={() => setShowOthers(!showOthers)}>{showOthers ? "Hide" : "Show"} {outsiders.length} other {outsiders.length === 1 ? "person" : "people"} on these threads (other companies, shippers)</button>
                    {showOthers && <div className="tbl-wrap"><table className="tbl ucx-t"><colgroup><col style={{ width: "34%" }} /><col style={{ width: "20%" }} /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "7%" }} /><col /></colgroup>
                      <thead><tr><th>Person</th><th>Phone</th><th className="ucx-c">Contact</th><th className="ucx-c">Portal</th><th className="ucx-c">Main</th><th>What they do</th></tr></thead>
                      <tbody>{outsiders.map(personRow)}</tbody>
                    </table></div>}
                  </>}

                  {/* the rest of the move questionnaire (components/CustomerMove.tsx): terms, retail or wholesale, tax, notes */}
                  <div className="ucx-sec"><span>Terms and notes</span></div>
                  <div className="ucx-tn">
                    <div className="ucx-tn-f"><span className="ucx-lbl">Payment terms</span>
                      <div className="ucx-seg" role="group" aria-label="Payment terms" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
                        {([["prepay", "Pre-pay"], ["receipt", "On receipt"], ["deposit", "50/50"], ["net30", "Net 30"]] as [string, string][]).map(([k, l]) => <button key={k} type="button" className={co.terms === k ? "on" : ""} onClick={() => setCo({ ...co, terms: k })}>{l}</button>)}
                      </div></div>
                    <div className="ucx-tn-f ucx-tn-s"><span className="ucx-lbl">Pricing</span>
                      <div className="ucx-seg" role="group" aria-label="Retail or wholesale" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
                        {([["retail", "Retail"], ["wholesale", "Wholesale"]] as [string, string][]).map(([k, l]) => <button key={k} type="button" className={co.priceType === k ? "on" : ""} onClick={() => setCo({ ...co, priceType: k })}>{l}</button>)}
                      </div></div>
                    <div className="ucx-tn-f ucx-tn-x"><span className="ucx-lbl">Sales tax</span>
                      <button type="button" role="switch" aria-checked={co.taxExempt} className={"ucx-taxbtn" + (co.taxExempt ? " on" : "")} onClick={() => setCo({ ...co, taxExempt: !co.taxExempt })}>
                        <span className="ucx-box" aria-hidden>{co.taxExempt ? "✓" : ""}</span>Tax exempt</button></div>
                  </div>
                  <div className="field ucx-notes"><label htmlFor="ucx-nt">Notes (only the shop sees these)</label><textarea id="ucx-nt" rows={2} placeholder="Special pricing, how they like to be contacted, anything to remember" value={co.notes} onChange={(e) => setCo({ ...co, notes: e.target.value })} /></div>

                  <div className="ucx-foot">
                    <button type="button" className="btn" onClick={next}>Skip</button>
                    <span className="faint">Unticking someone already on the account takes them off it.</span>
                    <span className="spacer" />
                    {m && (wasSent(m) ? <span className="ucx-moved">Intro email sent {shortDay((m.launchSent || m.personal.sentAt)!)}</span> : (
                      <label className="ucx-mail"><span className="ucx-lbl">Intro email</span>
                        <select value={mailOf(m)} onChange={(e) => void setMail(e.target.value as Mail)} disabled={!m.email}>
                          <option value="none">No email</option><option value="launch">Launch email</option><option value="nick">Personal note from Nick</option><option value="amanda">Personal note from Amanda</option>
                        </select></label>))}
                    {m && !wasSent(m) && mailOf(m) !== "none" && <button type="button" className="btn ghost sm" disabled={!!pv} onClick={() => void preview()}>{pv === "busy" ? "Sending…" : "Preview to us"}</button>}
                    {(m?.movedAt || d.movedAt) ? <span className="ucx-moved">In the new system since {shortDay((m?.movedAt || d.movedAt)!)}</span>
                      : <><button type="button" className="btn" disabled={busy} onClick={() => void moveNow()} title="Move them now; contacts stay as they are, no email">Move to new system</button>
                        <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>{busy ? "Saving…" : "Save and move"}</button></>}
                    <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save and next"}</button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
