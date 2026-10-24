"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brandLogoUploadUrl, saveBrandLogo, saveMySettings } from "@/app/portal/settings-actions";

type C = { company: string; name: string; email: string; phone: string; contact2_name: string; contact2_email: string; contact2_phone: string; address: string; ship_address: string };

/** The customer's Settings form (app/portal/settings): contacts, addresses, and their company logo for their sales sheets. */
export default function PortalSettings({ c, logoUrl, preview, shopName }: { c: C; logoUrl: string; preview: boolean; shopName: string }) {
  const [v, setV] = useState(c);
  const [logo, setLogo] = useState(logoUrl);
  const [state, setState] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [up, setUp] = useState(false);
  const set = (k: keyof C) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setV({ ...v, [k]: e.target.value }); setState(""); };
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
  const f = (k: keyof C, label: string, type = "text", ph = "") => (
    <div className="field"><label htmlFor={"ps-" + k}>{label}</label><input id={"ps-" + k} type={type} value={v[k]} placeholder={ph} disabled={preview} onChange={set(k)} /></div>
  );
  return (
    <div className="stack ps-wrap">
      {err && <div className="banner" role="alert">{err}</div>}
      <section className="panel">
        <div className="panel-h"><h2>Company</h2><span className="faint">To change your company name or sign-in email, send {shopName} a message.</span></div>
        <div className="panel-b grid g2">
          <div className="field"><label htmlFor="ps-company">Company name</label><input id="ps-company" type="text" value={v.company} readOnly disabled title="Set by us. Send us a message to change it." /></div>
          <div className="field"><label htmlFor="ps-email">Sign-in email</label><input id="ps-email" type="email" value={v.email} readOnly disabled /></div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Contacts</h2><span className="faint">Who we reach out to about your orders</span></div>
        <div className="panel-b stack">
          <div className="grid g2">{f("name", "Main contact")}{f("phone", "Phone", "tel")}</div>
          <div className="grid g3">{f("contact2_name", "Second contact")}{f("contact2_email", "Their email", "email")}{f("contact2_phone", "Their phone", "tel")}</div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Addresses</h2></div>
        <div className="panel-b grid g2">
          <div className="field"><label htmlFor="ps-address">Billing address</label><textarea id="ps-address" rows={3} value={v.address} disabled={preview} onChange={set("address")} placeholder="Street, city, state, ZIP" /></div>
          <div className="field"><label htmlFor="ps-ship">Shipping address (if different)</label><textarea id="ps-ship" rows={3} value={v.ship_address} disabled={preview} onChange={set("ship_address")} placeholder="Street, city, state, ZIP" /></div>
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
      <div className="ps-foot"><span className="save-state">{state}</span><button type="button" className="btn primary" disabled={preview || busy || !changed} onClick={save}>{busy ? "Saving…" : "Save changes"}</button></div>
    </div>
  );
}
