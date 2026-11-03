"use client";
import { useEffect, useState } from "react";
import { EMAIL_KINDS, kindOn, recipientsOf, type EmailKind, type EmailPerson, type EmailPrefs as Prefs } from "@/lib/customerEmails";
import { loadEmailPrefs, saveEmailPrefs, setAutoEmails } from "@/app/portal/email-prefs-actions";

/**
 * Who gets which email (Nov 3, Nick: "a list by everybody… art and approvals, they should be able to check who gets
 * those… shipping notifications… ready for pickup… maybe they don't want to get any emails"): one row per email, one
 * column per person, a switch to stop an email for everyone. Proofs and approvals and On hold can't be turned off and
 * keep at least one person. The portal's Settings and the shop's customer page show this same panel.
 */
export default function EmailPrefs({ customerId, preview = false, shop = false, compact = false }: { customerId: string; preview?: boolean; /** the shop's customer page: the automatic-emails switch shows */ shop?: boolean;
  /** a narrow side panel (the shop's customer details): one summary line, the grid in a window of its own (Nov 3, Nick: "this
   *  new email thing is blocking… I can't get to the bottom") */ compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<EmailPerson[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [auto, setAuto] = useState(true), [owner, setOwner] = useState(false);
  const [err, setErr] = useState(""), [saved, setSaved] = useState("");
  useEffect(() => {
    void loadEmailPrefs(customerId).then((r) => {
      if (!r.ok) return setErr(r.error);
      setPeople(r.people); setPrefs(r.prefs); setAuto(r.auto); setOwner(r.owner);
    });
  }, [customerId]);
  const save = async (next: Prefs) => {
    const before = prefs;
    setPrefs(next); setErr(""); setSaved("");
    if (preview) return;
    const r = await saveEmailPrefs(customerId, next);
    if (!r.ok) { setPrefs(before); return setErr(r.error); }
    setPrefs(r.prefs); setSaved("Saved");
  };
  if (err && !people) return <section className="panel"><div className="panel-h"><h2>Emails</h2></div><div className="panel-b"><div className="err">{err}</div></div></section>;
  if (!people) return <section className="panel"><div className="panel-h"><h2>Emails</h2></div><div className="panel-b faint">Loading…</div></section>;
  const toggle = (k: EmailKind, email: string) => {
    const cur = recipientsOf(prefs, k, people);
    const def = EMAIL_KINDS.find((x) => x.k === k)!;
    const has = cur.includes(email);
    const to = has ? cur.filter((e) => e !== email) : [...cur, email];
    if (!to.length && def.locked) return setErr(`Someone has to get ${def.label.toLowerCase()}.`);
    // the last one unticked on an email that can be off: it's off
    void save({ ...prefs, [k]: to.length ? { on: true, to } : { on: false, to: cur } });
  };
  const onOff = (k: EmailKind, on: boolean) => void save({ ...prefs, [k]: { on, to: prefs[k]?.to || recipientsOf({ ...prefs, [k]: { on: true } }, k, people) } });
  const first = (p: EmailPerson) => (p.name && p.name !== p.email ? p.name.split(/\s+/)[0] : p.email.split("@")[0]);
  if (compact && !open) {
    const on = EMAIL_KINDS.filter((d) => kindOn(prefs, d.k));
    const who = [...new Set(on.flatMap((d) => recipientsOf(prefs, d.k, people)))].map((e) => first(people.find((p) => p.email === e) || { email: e, name: "" }));
    return (
      <section className="panel emp">
        <div className="panel-h"><h2>Emails</h2><button type="button" className="btn sm" onClick={() => setOpen(true)}>Who gets what</button></div>
        <div className="panel-b emp-sum">
          <span>{on.length} of {EMAIL_KINDS.length} emails on{who.length ? `, to ${who.slice(0, 3).join(", ")}${who.length > 3 ? ` +${who.length - 3}` : ""}` : ""}.</span>
          {shop && !auto && <span className="faint">Automatic emails are off for every customer.</span>}
        </div>
      </section>
    );
  }
  const grid = (
    <section className="panel emp">
      <div className="panel-h"><h2>Emails</h2><span className="faint">Who gets each email{saved ? ` · ${saved}` : ""}</span></div>
      <div className="panel-b">
        {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
        {shop && !auto && (
          <div className="emp-auto">
            <span><b>Automatic emails are off for every customer.</b> On hold, shipped, ready, delivered and carrier updates don&apos;t go out until they&apos;re turned on. Proofs, receipts and messages go as usual.</span>
            {owner && <button type="button" className="btn sm" onClick={async () => { const r = await setAutoEmails(true); if (r.ok) setAuto(true); else setErr(r.error); }}>Turn them on</button>}
          </div>
        )}
        {shop && auto && owner && <div className="emp-auto on"><span>Automatic emails are on for every customer.</span><button type="button" className="btn sm ghost" onClick={async () => { const r = await setAutoEmails(false); if (r.ok) setAuto(false); else setErr(r.error); }}>Turn off</button></div>}
        {!people.length ? <p className="faint" style={{ margin: 0 }}>Add someone with an email under People first.</p> : (
          <div className="tbl-wrap">
            <table className="tbl emp-t">
              <thead><tr><th>Email</th><th className="emp-c">Send it</th>{people.map((p) => <th key={p.email} className="emp-c" title={p.email}>{first(p)}</th>)}</tr></thead>
              <tbody>
                {EMAIL_KINDS.map((d) => {
                  const on = kindOn(prefs, d.k), to = recipientsOf(prefs, d.k, people);
                  return (
                    <tr key={d.k} className={on ? "" : "off"}>
                      <td><b>{d.label}</b><div className="sub">{d.sub}</div></td>
                      <td className="emp-c">{d.locked ? <span className="emp-lock" title="Always sent to at least one person">Always</span>
                        : <button type="button" role="switch" aria-checked={on} aria-label={`Send ${d.label}`} className={"emp-sw" + (on ? " on" : "")} disabled={preview} onClick={() => onOff(d.k, !on)}><span /></button>}</td>
                      {people.map((p) => (
                        <td key={p.email} className="emp-c">
                          <input type="checkbox" aria-label={`${d.label} to ${p.email}`} checked={on && to.includes(p.email)} disabled={preview || !on} onChange={() => toggle(d.k, p.email)} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Proofs and approvals and On hold always go to at least one person. Turning an email off stops it for everyone.</div>
      </div>
    </section>
  );
  if (!compact) return grid;
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Who gets each email" onClick={() => setOpen(false)}>
      <div className="dla emp-dlg" onClick={(e) => e.stopPropagation()}>
        <div className="emp-dlg-h"><span className="spacer" /><button type="button" className="btn sm" onClick={() => setOpen(false)}>Done</button></div>
        {grid}
      </div>
    </div>
  );
}
