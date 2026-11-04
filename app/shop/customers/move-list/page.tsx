"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import BackLink from "@/components/BackLink";
import { moveList, sendCustomerPreview, sendPersonalNoteTest, setPersonal, setQuiet, type MoveRow } from "./actions";

/**
 * Portal intro emails (Nov 3, Nick: "we'll just call that the Portal email tool… introductory email tool… we're going to
 * check whether they get the email, they get the personal email, or they get no email tonight. Nothing else"). Every
 * customer in the portal, with two ticks: the launch email (from portal@) and the personal note from Nick or Amanda (to
 * their main contact). Neither ticked is no email. Nothing is sent from here; the sends go when Nick says.
 * Moving customers and their contacts is Update contacts (app/shop/customers/contacts).
 */
/** when they were last in: "Today 11:42 AM", "Nov 3" */
const when = (iso: string) => { const d = new Date(iso), t = new Date(); const same = d.toDateString() === t.toDateString(); return same ? `Today ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
type Show = "all" | "launch" | "personal" | "none" | "visited";
const LABEL: Record<Show, string> = { all: "Everyone in the portal", launch: "Launch email", personal: "Personal email", none: "No email", visited: "Been in the portal" };
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const first = (n: string) => n.split(/\s+/)[0];
const launchOn = (r: MoveRow) => !r.quiet && !!r.email;
const personalOn = (r: MoveRow) => !r.personal.skip && r.personal.to.length > 0;

export default function IntroEmails() {
  const [show, setShow] = useSticky<Show>("customers.introEmails.show", "all");
  const [who, setWho] = useSticky<string>("customers.introEmails.owner", "");
  const [rows, setRows] = useState<MoveRow[] | null>(null);
  const [q, setQ] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(""), [note, setNote] = useState("");
  /** the personal note as it really looks: from your mailbox to Nick and Amanda (Nov 3, Nick) */
  const test = async () => { setBusy("test"); setErr(""); setNote(""); const r = await sendPersonalNoteTest(); setBusy(""); if (r.ok) setNote(`Both versions (standard and ClickUp customers) sent from ${r.from} to ${r.to}.`); else setErr(r.error); };
  /** both emails as this customer gets them, to Nick and Amanda (Nov 4) */
  const preview = async (r: MoveRow) => { setBusy("pv" + r.id); setErr(""); setNote(""); const x = await sendCustomerPreview(r.id); setBusy(""); if (x.ok) setNote(`${r.name}: both emails sent to ${x.to} as ${r.name} gets them (launch email to ${x.launchFirst || "them"}, personal note${x.kind === "clickup" ? ", ClickUp version," : ""} to ${x.noteFirst || "them"} at ${x.noteTo}, from ${x.from}).`); else setErr(x.error); };
  const load = async () => { const r = await moveList(); if (r.ok) { setRows(r.rows.filter((x) => x.movedAt)); setErr(""); } else setErr(r.error); };
  useEffect(() => { void load(); }, []);

  const all = rows || [];
  const owners = [...new Set(all.map((r) => first(r.owner)).filter(Boolean))].sort();
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter((r) => (show === "all" || (show === "visited" ? r.visits.n > 0 : show === "launch" ? launchOn(r) : show === "personal" ? personalOn(r) : !launchOn(r) && !personalOn(r)))
      && (!who || first(r.owner) === who) && (!t || `${r.name} ${r.contact} ${r.email}`.toLowerCase().includes(t)));
  }, [all, show, who, q]);
  const count = (s: Show) => all.filter((r) => s === "all" || (s === "visited" ? r.visits.n > 0 : s === "launch" ? launchOn(r) : s === "personal" ? personalOn(r) : !launchOn(r) && !personalOn(r))).length;

  const launch = async (rs: MoveRow[], on: boolean) => {
    setBusy(rs.length > 1 ? "bulk" : rs[0].id);
    const r = await setQuiet(rs.map((x) => x.id), !on);
    setBusy(""); if (!r.ok) return setErr(r.error);
    await load();
  };
  const personal = async (rs: MoveRow[], on: boolean, from?: string) => {
    setBusy(rs.length > 1 ? "bulk" : rs[0].id);
    const r = await setPersonal(rs.map((x) => x.id), on, from);
    setBusy(""); if (!r.ok) return setErr(r.error);
    await load();
  };
  const unsentL = list.filter((r) => r.email && !r.launchSent), unsentP = list.filter((r) => r.email && !r.personal.sentAt);
  const allL = unsentL.length > 0 && unsentL.every(launchOn), allP = unsentP.length > 0 && unsentP.every(personalOn);

  return (
    <>
      <BackLink href="/shop/customers" label="Customers" />
      <div className="page-head">
        <div><h1>Portal intro emails</h1><div className="eyebrow">Who gets the launch email, who gets a personal note from Nick or Amanda, and who gets nothing. Nothing sends from here.</div></div>
        <div className="row"><button type="button" className="btn" disabled={busy === "test"} onClick={() => void test()} title="The personal email in both versions (standard and ClickUp customers), from your own mailbox to Nick and Amanda">{busy === "test" ? "Sending…" : "Test the personal email"}</button><Link className="btn" href="/shop/customers/contacts">Update contacts</Link><Link className="btn" href="/shop/settings/launch-email">Launch email</Link></div>
      </div>
      {rows && <div className="stats">
        {(["all", "launch", "personal", "none", "visited"] as Show[]).map((s) => <button key={s} type="button" className="stat" onClick={() => setShow(s)}><span className="v">{count(s)}</span><span className="k">{LABEL[s]}</span></button>)}
      </div>}
      <div className="toolbar">
        <div className="chips">{(["all", "launch", "personal", "none", "visited"] as Show[]).map((s) => <button key={s} type="button" className={"chip" + (show === s ? " on" : "")} onClick={() => setShow(s)}>{LABEL[s]}</button>)}</div>
        <div className="chips">
          <button type="button" className={"chip" + (!who ? " on" : "")} onClick={() => setWho("")}>Everyone&apos;s</button>
          {owners.map((o) => <button key={o} type="button" className={"chip" + (who === o ? " on" : "")} onClick={() => setWho(o)}>{o}&apos;s</button>)}
        </div>
        <input type="search" className="mvl-q" placeholder="Find a customer" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}
      {rows === null ? <p className="faint">Loading…</p> : !list.length ? <p className="faint">No customers here.</p> : (
        <div className="tbl-wrap">
          <table className="tbl mvl-tbl">
            <thead><tr>
              <th>Customer</th><th>Owner</th>
              <th className="mvl-c"><label className="mvl-hc"><input type="checkbox" aria-label="Launch email for everyone shown" checked={allL} disabled={busy === "bulk"} onChange={() => void launch(unsentL, !allL)} /> Launch email</label></th>
              <th className="mvl-c"><label className="mvl-hc"><input type="checkbox" aria-label="Personal email for everyone shown" checked={allP} disabled={busy === "bulk"} onChange={() => void personal(unsentP, !allP)} /> Personal email</label></th>
              <th>From</th><th>In the portal</th><th />
            </tr></thead>
            <tbody>{list.map((r) => {
              const pOn = personalOn(r), fromAmanda = /^amanda/i.test(r.personal.from);
              return (
                <tr key={r.id} className={!launchOn(r) && !pOn ? "mvl-none" : ""}>
                  <td><Link href={`/shop/customers/${r.id}`} data-notranslate>{r.name}</Link><div className="sub" data-notranslate>{r.email ? [r.contact, r.email].filter(Boolean).join(" · ") : <span className="mvl-noemail">No email on file: add one in Update contacts</span>}</div></td>
                  <td className="nowrap">{r.owner ? first(r.owner) : <span className="faint">—</span>}</td>
                  <td className="mvl-c">{r.launchSent ? <span className="mvl-in">Sent {day(r.launchSent)}</span>
                    : <input type="checkbox" aria-label={`Launch email to ${r.name}`} checked={launchOn(r)} disabled={!r.email || busy === r.id} onChange={(e) => void launch([r], e.target.checked)} />}</td>
                  <td className="mvl-c">{r.personal.sentAt ? <span className="mvl-in">Sent {day(r.personal.sentAt)}</span>
                    : <input type="checkbox" aria-label={`Personal email to ${r.name}`} checked={pOn} disabled={!r.email || busy === r.id} onChange={(e) => void personal([r], e.target.checked)} />}
                    {pOn && <div className="sub" data-notranslate>to {r.personal.to.join(", ")}</div>}
                    {pOn && r.clickup && <div className="sub mvl-cu" title="They work with us through ClickUp: their note says ClickUp and Printavo stay open to mid-month and offers their team a training">ClickUp version</div>}</td>
                  <td>{pOn ? <div className="mvl-from" role="group" aria-label="Who it's from">
                    <button type="button" className={!fromAmanda ? "on" : ""} disabled={busy === r.id} onClick={() => fromAmanda && void personal([r], true, "nicholas@fbsprint.com")}>Nick</button>
                    <button type="button" className={fromAmanda ? "on" : ""} disabled={busy === r.id} onClick={() => !fromAmanda && void personal([r], true, "amanda@fbsprint.com")}>Amanda</button>
                  </div> : <span className="faint">—</span>}</td>
                  <td className="nowrap">{r.visits.n ? <span title={r.visits.who.join(", ")}>{when(r.visits.last!)}<div className="sub">{r.visits.n} {r.visits.n === 1 ? "visit" : "visits"} · {r.visits.who.length} {r.visits.who.length === 1 ? "person" : "people"}</div></span> : <span className="faint">Not yet</span>}</td>
                  <td className="nowrap">{(launchOn(r) || pOn) && <button type="button" className="btn sm ghost" disabled={!!busy} title="Both emails exactly as this customer gets them, sent to Nick and Amanda" onClick={() => void preview(r)}>{busy === "pv" + r.id ? "Sending…" : "Preview to us"}</button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
