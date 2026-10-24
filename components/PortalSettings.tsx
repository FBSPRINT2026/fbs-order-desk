"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mySavedMethods, removeSavedMethod, type SavedPM } from "@/app/portal/pay-actions";
import { brandLogoUploadUrl, myPeople, removePerson, saveBrandLogo, saveMySettings, savePerson, setMessageEmail, type Person } from "@/app/portal/settings-actions";

type C = { address: string; ship_address: string };

/**
 * The customer's Settings (app/portal/settings): the people at the company (everyone signs in with their own email),
 * addresses, and their company logo for their sales sheets. The company name is ours to set.
 */
export default function PortalSettings({ c, customerId, logoUrl, preview, shopName, mailOn }: { c: C; customerId: string; logoUrl: string; preview: boolean; shopName: string; /** our messages emailed to them too */ mailOn: boolean }) {
  const [mail, setMail] = useState(mailOn);
  const [v, setV] = useState(c);
  const [logo, setLogo] = useState(logoUrl);
  const [state, setState] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [up, setUp] = useState(false);
  const changed = JSON.stringify(v) !== JSON.stringify(c);
  async function save() {
    setBusy(true); setErr("");
    const r = await saveMySettings(v);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't save.");
    setState("Saved.");
  }
  async function upload(f: File) {
    setUp(true); setErr("");
    try {
      const t = await brandLogoUploadUrl(f.name);
      if (!t.ok) throw new Error(t.error);
      const u = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
      if (u.error) throw new Error(u.error.message);
      const r = await saveBrandLogo(t.path);
      if (!r.ok) throw new Error(r.error);
      setLogo(r.url || URL.createObjectURL(f));
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't upload the logo."); }
    setUp(false);
  }
  return (
    <div className="stack ps-wrap">
      {err && <div className="banner" role="alert">{err}</div>}
      <People customerId={customerId} preview={preview} shopName={shopName} />
      <SavedCards preview={preview} />
      <section className="panel">
        <div className="panel-h"><h2>Messages</h2></div>
        <div className="panel-b">
          <label className="check"><input type="checkbox" checked={mail} disabled={preview} onChange={async (e) => { const on = e.target.checked; setMail(on); const r = await setMessageEmail(on); if (!r.ok) { setMail(!on); setErr(r.error || ""); } }} /> Email me when {shopName} sends a message</label>
          <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>Off: messages wait for you in your Messages tab here.</div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Addresses</h2></div>
        <div className="panel-b stack">
          <div className="grid g2">
            <div className="field"><label htmlFor="ps-address">Billing address</label><textarea id="ps-address" rows={3} value={v.address} disabled={preview} onChange={(e) => { setV({ ...v, address: e.target.value }); setState(""); }} placeholder="Street, city, state, ZIP" /></div>
            <div className="field"><label htmlFor="ps-ship">Shipping address (if different)</label><textarea id="ps-ship" rows={3} value={v.ship_address} disabled={preview} onChange={(e) => { setV({ ...v, ship_address: e.target.value }); setState(""); }} placeholder="Street, city, state, ZIP" /></div>
          </div>
          <div className="ps-foot"><span className="save-state">{state}</span><button type="button" className="btn primary" disabled={preview || busy || !changed} onClick={save}>{busy ? "Saving…" : "Save addresses"}</button></div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Your company logo</h2><span className="faint">Goes on the sales sheets you make in the Mockup Creator, to share with your clients</span></div>
        <div className="panel-b ps-logo">
          <div className="ps-logo-box">{logo ? <img src={logo} alt="Your company logo" /> : <span className="faint">No logo yet</span>}</div>
          <div className="row" style={{ gap: 8 }}>
            <label className={"btn" + (preview ? " disabled" : "")} style={{ cursor: preview ? "default" : "pointer" }}>{up ? "Uploading…" : logo ? "Replace logo" : "Upload logo"}
              <input type="file" hidden disabled={preview || up} accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) void upload(x); }} />
            </label>
            {logo && <button type="button" className="btn ghost" disabled={preview || up} onClick={async () => { const r = await saveBrandLogo(null); if (r.ok) setLogo(""); else setErr(r.error || ""); }}>Remove</button>}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Everyone at the company: see them all, add, change, take someone off. A changed email is asked about first. */
function People({ customerId, preview, shopName }: { customerId: string; preview: boolean; shopName: string }) {
  const [list, setList] = useState<Person[] | null>(null);
  const [edit, setEdit] = useState<(Person & { was: string }) | null>(null);
  const [ask, setAsk] = useState(false);
  const [armed, setArmed] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { const r = await myPeople(customerId); if (r.ok) setList(r.people); else setErr(r.error); };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const blank: Person & { was: string } = { id: "new", name: "", email: "", phone: "", title: "", main: false, you: false, was: "" };
  async function save(confirmed = false) {
    if (!edit) return;
    const em = edit.email.trim().toLowerCase();
    // a sign-in email being changed: asked first (Oct 24, Nick)
    if (!confirmed && edit.id !== "new" && edit.was && em !== edit.was.toLowerCase()) { setAsk(true); return; }
    setBusy(true); setErr("");
    const r = await savePerson({ id: edit.id, name: edit.name, email: em, phone: edit.phone, title: edit.title });
    setBusy(false); setAsk(false);
    if (!r.ok) return setErr(r.error || "Couldn't save.");
    setEdit(null);
    void load();
  }
  async function remove(p: Person) {
    if (armed !== p.id) { setArmed(p.id); setTimeout(() => setArmed((x) => (x === p.id ? "" : x)), 3500); return; }
    setArmed(""); setErr("");
    const r = await removePerson(p.id);
    if (!r.ok) return setErr(r.error || "Couldn't remove them.");
    void load();
  }
  const form = edit && (
    <div className="ps-edit">
      <div className="grid g4">
        <div className="field"><label htmlFor="pp-name">Name</label><input id="pp-name" type="text" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="pp-email">Sign-in email</label><input id="pp-email" type="email" value={edit.email} onChange={(e) => { setEdit({ ...edit, email: e.target.value }); setAsk(false); }} /></div>
        <div className="field"><label htmlFor="pp-phone">Phone</label><input id="pp-phone" type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
        <div className="field"><label htmlFor="pp-title">Title (optional)</label><input id="pp-title" type="text" placeholder="e.g. Buyer" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
      </div>
      {ask && (
        <div className="ps-ask" role="alert">
          <span>{edit.you ? <>Change <b>your</b> sign-in email to <b>{edit.email.trim()}</b>? You&apos;ll sign in with it from now on.</> : <>Change {edit.name || "their"} sign-in email to <b>{edit.email.trim()}</b>? They&apos;ll sign in with it from now on.</>}</span>
          <button type="button" className="btn sm primary" disabled={busy} onClick={() => save(true)}>Yes, change it</button>
          <button type="button" className="btn sm ghost" onClick={() => { setEdit({ ...edit, email: edit.was }); setAsk(false); }}>Keep {edit.was}</button>
        </div>
      )}
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" onClick={() => { setEdit(null); setAsk(false); }}>Cancel</button>
        {!ask && <button type="button" className="btn primary" disabled={busy || !edit.email.trim()} onClick={() => save()}>{busy ? "Saving…" : edit.id === "new" ? "Add person" : "Save"}</button>}
      </div>
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-h"><h2>People</h2><span className="faint">Everyone here signs in with their own email and sees all of your orders</span></div>
      <div className="panel-b stack">
        {err && <div className="banner" role="alert">{err}</div>}
        {!list ? <div className="faint">Loading…</div> : (
          <div className="tbl-wrap"><table className="tbl ps-people">
            <thead><tr><th>Name</th><th>Sign-in email</th><th>Phone</th><th /></tr></thead>
            <tbody>
              {list.map((p) => edit?.id === p.id ? (
                <tr key={p.id}><td colSpan={4}>{form}</td></tr>
              ) : (
                <tr key={p.id}>
                  <td><b>{p.name || "—"}</b>{p.main && <span className="ps-tag">Main</span>}{p.you && <span className="ps-tag you">You</span>}{p.title && <div className="sub">{p.title}</div>}</td>
                  <td data-notranslate>{p.email}</td>
                  <td className="nw">{p.phone}</td>
                  <td className="ps-acts">
                    <button type="button" className="btn sm ghost" disabled={preview || !!edit} onClick={() => { setEdit({ ...p, was: p.email }); setAsk(false); }}>Edit</button>
                    {!p.main && <button type="button" className={"btn sm ghost" + (armed === p.id ? " danger armed" : "")} disabled={preview || !!edit} onClick={() => remove(p)}>{armed === p.id ? "Remove them?" : "Remove"}</button>}
                  </td>
                </tr>
              ))}
              {edit?.id === "new" && <tr><td colSpan={4}>{form}</td></tr>}
            </tbody>
          </table></div>
        )}
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span className="faint" style={{ fontSize: 12.5 }}>To change the main contact or your company name, send {shopName} a message.</span>
          <button type="button" className="btn" disabled={preview || !!edit} onClick={() => { setEdit(blank); setAsk(false); }}>+ Add a person</button>
        </div>
      </div>
    </section>
  );
}

/** Their cards and bank accounts on file (Oct 24, Nick): only the brand and last 4; remove any time. */
function SavedCards({ preview }: { preview: boolean }) {
  const [list, setList] = useState<SavedPM[] | null>(null);
  const [armed, setArmed] = useState(""), [err, setErr] = useState("");
  useEffect(() => { void mySavedMethods().then((r) => setList(r.list)); }, []);
  if (!list) return null;
  return (
    <section className="panel">
      <div className="panel-h"><h2>Saved payment methods</h2><span className="faint">Tick &ldquo;Keep this on file&rdquo; when you pay to save one. The numbers stay with our payment processor (Stax).</span></div>
      <div className="panel-b">
        {err && <div className="banner" role="alert">{err}</div>}
        {list.length ? (
          <ul className="ps-cards">{list.map((x) => (
            <li key={x.id}>
              <span><b>{x.method === "bank" ? `${x.brand || "Bank account"} ending ${x.last4}` : `${x.brand ? x.brand.charAt(0).toUpperCase() + x.brand.slice(1) : "Card"} ending ${x.last4}`}</b>{x.exp ? <span className="faint"> · exp {x.exp}</span> : null}{x.holder ? <span className="faint"> · {x.holder}</span> : null}</span>
              <button type="button" className={"btn sm ghost" + (armed === x.id ? " danger armed" : "")} disabled={preview} onClick={async () => {
                if (armed !== x.id) { setArmed(x.id); setTimeout(() => setArmed((a) => (a === x.id ? "" : a)), 3500); return; }
                setArmed(""); const r = await removeSavedMethod(x.id);
                if (r.ok) setList((l) => (l || []).filter((y) => y.id !== x.id)); else setErr(r.error || "Couldn't remove it.");
              }}>{armed === x.id ? "Remove it?" : "Remove"}</button>
            </li>
          ))}</ul>
        ) : <div className="faint">Nothing saved yet.</div>}
      </div>
    </section>
  );
}
