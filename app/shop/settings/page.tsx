"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings, type Settings } from "@/lib/pricing";
import { money } from "@/lib/format";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [state, setState] = useState("");
  const [staff, setStaff] = useState<{ email: string; name: string }[]>([]);
  const [newStaff, setNewStaff] = useState("");

  useEffect(() => {
    const sb = createClient();
    sb.from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => setS(mergeSettings(data?.data)));
    sb.from("staff").select("email,name").order("email").then(({ data }) => setStaff(data || []));
  }, []);

  function upd(fn: (d: Settings) => void) {
    setS((prev) => { const n: Settings = JSON.parse(JSON.stringify(prev)); fn(n); return n; });
    setState("Unsaved changes");
  }
  const n = (v: string) => (v === "" ? 0 : +v);

  async function save() {
    if (!s) return;
    setState("Saving…");
    const { error } = await createClient().from("settings").upsert({ id: 1, data: s, updated_at: new Date().toISOString() });
    setState(error ? "Save failed: " + error.message : "Saved");
  }
  async function addStaff() {
    const email = newStaff.trim().toLowerCase();
    if (!email.includes("@")) return;
    const { error } = await createClient().from("staff").insert({ email });
    if (error) return setState(error.message);
    setStaff((p) => [...p, { email, name: "" }]);
    setNewStaff("");
  }
  async function removeStaff(email: string) {
    if (staff.length <= 1) return;
    await createClient().from("staff").delete().eq("email", email);
    setStaff((p) => p.filter((x) => x.email !== email));
  }

  if (!s) return <div className="empty">Loading…</div>;
  const ti = (q: number) => { let i = 0; s.tiers.forEach((m, ix) => { if (q >= m) i = ix; }); return i; };
  const pi = ti(48), g = Math.round(3.5 * (1 + s.markup / 100) * 100) / 100, prints = +s.screen[pi][1] + +s.screen[pi][0], each = g + prints;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Drives every quote&apos;s auto-pricing</div><h1>Pricing & shop</h1></div>
        <div className="row"><span className="save-state">{state}</span><button className="btn primary" type="button" onClick={save}>Save changes</button></div>
      </div>
      <div className="stack">
        <section className="panel">
          <div className="panel-h"><h2>Garments, tax & payments</h2></div>
          <div className="panel-b grid g4">
            <div className="field"><label htmlFor="s-markup">Blank markup %</label><input id="s-markup" type="number" step="1" value={s.markup} onChange={(e) => upd((d) => { d.markup = n(e.target.value); })} /></div>
            <div className="field"><label htmlFor="s-tax">Default sales tax %</label><input id="s-tax" type="number" step="0.01" value={s.taxRate} onChange={(e) => upd((d) => { d.taxRate = n(e.target.value); })} /></div>
            <div className="field"><label htmlFor="s-screen">Screen setup, per color</label><input id="s-screen" type="number" step="0.5" value={s.screenFee} onChange={(e) => upd((d) => { d.screenFee = n(e.target.value); })} /></div>
            <div className="field"><label htmlFor="s-dig">Digitizing, per location</label><input id="s-dig" type="number" step="0.5" value={s.digitizing} onChange={(e) => upd((d) => { d.digitizing = n(e.target.value); })} /></div>
            {(["2XL", "3XL", "4XL", "5XL"] as const).map((z) => (
              <div key={z} className="field"><label htmlFor={`s-up-${z}`}>{z} upcharge each</label><input id={`s-up-${z}`} type="number" step="0.25" value={s.upcharges[z] ?? 0} onChange={(e) => upd((d) => { d.upcharges[z] = n(e.target.value); })} /></div>
            ))}
            <div className="field"><label htmlFor="s-dep">Online deposit %</label><input id="s-dep" type="number" step="5" min="0" max="100" value={s.depositPct} onChange={(e) => upd((d) => { d.depositPct = n(e.target.value); })} /></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Print price matrix</h2><span className="faint" style={{ fontSize: 12 }}>Price per piece, per location</span></div>
          <div className="panel-b stack">
            <div className="matrix-wrap">
              <table className="matrix">
                <thead><tr><th>Min qty</th>{[1, 2, 3, 4, 5, 6].map((c) => <th key={c}>Screen {c}c</th>)}<th>Embroidery</th><th>DTF</th></tr></thead>
                <tbody>
                  {s.tiers.map((t, i) => (
                    <tr key={i}>
                      <td className="tier"><input type="number" min="1" aria-label={`Tier ${i + 1} minimum`} value={t} onChange={(e) => upd((d) => { d.tiers[i] = n(e.target.value); })} /></td>
                      {s.screen[i].map((v, j) => <td key={j}><input type="number" step="0.05" aria-label={`${t}+ pieces, ${j + 1} colors`} value={v} onChange={(e) => upd((d) => { d.screen[i][j] = n(e.target.value); })} /></td>)}
                      <td><input type="number" step="0.05" aria-label={`${t}+ embroidery`} value={s.embroidery[i]} onChange={(e) => upd((d) => { d.embroidery[i] = n(e.target.value); })} /></td>
                      <td><input type="number" step="0.05" aria-label={`${t}+ DTF`} value={s.dtf[i]} onChange={(e) => upd((d) => { d.dtf[i] = n(e.target.value); })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="preview">Check: <b>48 tees</b> at a <b>$3.50</b> blank, 2-color front + 1-color back → blank {money(g)} + prints {money(prints)} = <b>{money(each)} each</b>, {money(each * 48)} plus {money(3 * s.screenFee)} in screens.</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Shop info</h2><span className="faint" style={{ fontSize: 12 }}>Shown in the customer portal, emails and invoices</span></div>
          <div className="panel-b grid g2">
            <div className="field"><label htmlFor="s-name">Shop name</label><input id="s-name" type="text" value={s.shop.name} onChange={(e) => upd((d) => { d.shop.name = e.target.value; })} /></div>
            <div className="field"><label htmlFor="s-logo">Logo image link (optional)</label><input id="s-logo" type="text" placeholder="https://…/logo.png" value={s.shop.logoUrl} onChange={(e) => upd((d) => { d.shop.logoUrl = e.target.value; })} /></div>
            <div className="field"><label htmlFor="s-email">Email</label><input id="s-email" type="email" value={s.shop.email} onChange={(e) => upd((d) => { d.shop.email = e.target.value; })} /></div>
            <div className="field"><label htmlFor="s-phone">Phone</label><input id="s-phone" type="tel" value={s.shop.phone} onChange={(e) => upd((d) => { d.shop.phone = e.target.value; })} /></div>
            <div className="field"><label htmlFor="s-addr">Address</label><textarea id="s-addr" rows={2} value={s.shop.address} onChange={(e) => upd((d) => { d.shop.address = e.target.value; })} /></div>
            <div className="field"><label htmlFor="s-terms">Terms (customers agree to these when approving)</label><textarea id="s-terms" rows={2} value={s.shop.terms} onChange={(e) => upd((d) => { d.shop.terms = e.target.value; })} /></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Shop staff</h2><span className="faint" style={{ fontSize: 12 }}>These emails sign in to the shop side</span></div>
          <div className="panel-b stack">
            {staff.map((x) => (
              <div key={x.email} className="pay-row"><span>{x.email}</span>{staff.length > 1 && <button className="btn sm ghost danger" type="button" onClick={() => removeStaff(x.email)}>Remove</button>}</div>
            ))}
            <div className="row"><input type="email" placeholder="name@fbsprint.com" value={newStaff} onChange={(e) => setNewStaff(e.target.value)} style={{ maxWidth: 280 }} aria-label="New staff email" /><button className="btn" type="button" onClick={addStaff}>Add staff</button></div>
          </div>
        </section>
      </div>
    </>
  );
}
