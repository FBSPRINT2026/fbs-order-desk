"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLES, calcGroup, mergeSettings, newGLine, newImprint, uid, type PriceList, type Settings } from "@/lib/pricing";
import { money } from "@/lib/format";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [state, setState] = useState("");
  const [staff, setStaff] = useState<{ email: string; name: string; role: string }[]>([]);
  const [newRole, setNewRole] = useState("admin");
  const [newStaff, setNewStaff] = useState("");
  const [tab, setTab] = useState<"retail" | "wholesale">("retail");
  const [shade, setShade] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const sb = createClient();
    sb.from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => setS(mergeSettings(data?.data)));
    sb.from("staff").select("email,name,role").order("email").then(({ data }) => setStaff(data || []));
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
    const { error } = await createClient().from("staff").insert({ email, role: newRole });
    if (error) return setState(error.message.includes("row-level") ? "Only the owner or an admin can add staff." : error.message);
    setStaff((p) => [...p, { email, name: "", role: newRole }]);
    setNewStaff("");
  }
  async function setRole(email: string, role: string) {
    const { error } = await createClient().from("staff").update({ role }).eq("email", email);
    if (error) return setState(error.message.includes("row-level") ? "Only the owner can change that." : error.message);
    setStaff((p) => p.map((x) => (x.email === email ? { ...x, role } : x)));
    setState("Role updated");
  }
  async function removeStaff(email: string) {
    if (staff.length <= 1) return;
    await createClient().from("staff").delete().eq("email", email);
    setStaff((p) => p.filter((x) => x.email !== email));
  }

  if (!s) return <div className="empty">Loading…</div>;
  const pl: PriceList = tab === "wholesale" ? s.wholesale : s;
  const updPl = (fn: (p: PriceList) => void) => upd((d) => fn(tab === "wholesale" ? d.wholesale : d));
  // Live check: 100 black tees at a $2.00 blank, 1-color front + 1-color back.
  const chk = calcGroup({ id: "chk", lines: [{ ...newGLine(), color: "Black", cost: 2, sizes: { M: 100 } }], imprints: [newImprint("Full Front"), newImprint("Full Back")] }, { waive_setup: false, price_type: tab }, s);

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Drives every quote&apos;s auto-pricing</div><h1>Pricing & shop</h1></div>
        <div className="row"><span className="save-state">{state}</span><button className="btn primary" type="button" onClick={save}>Save changes</button></div>
      </div>
      <div className="stack">
        <section className="panel">
          <div className="panel-h"><h2>Tax & payments</h2></div>
          <div className="panel-b grid g4">
            <div className="field"><label htmlFor="s-tax">Default sales tax %</label><input id="s-tax" type="number" step="0.01" value={s.taxRate} onChange={(e) => upd((d) => { d.taxRate = n(e.target.value); })} /></div>
            <div className="field"><label htmlFor="s-dep">Deposit %</label><input id="s-dep" type="number" step="5" min="0" max="100" value={s.depositPct} onChange={(e) => upd((d) => { d.depositPct = n(e.target.value); })} /></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h">
            <h2>Price lists</h2>
            <div className="chips">
              <button type="button" className={"chip" + (tab === "retail" ? " on" : "")} onClick={() => setTab("retail")}>Retail</button>
              <button type="button" className={"chip" + (tab === "wholesale" ? " on" : "")} onClick={() => setTab("wholesale")}>Wholesale</button>
            </div>
          </div>
          <div className="panel-b stack">
            <div className="muted" style={{ fontSize: 13 }}>{tab === "retail" ? "Retail: you supply the garments. Price = blank cost + markup + imprints below." : "Wholesale: the customer supplies the garments. Price = imprints below only."}</div>
            <div className="grid g4">
              {tab === "retail" && <div className="field"><label htmlFor="s-markup">Blank markup %</label><input id="s-markup" type="number" step="1" value={s.markup} onChange={(e) => upd((d) => { d.markup = n(e.target.value); })} /></div>}
              <div className="field"><label htmlFor="s-screen">Screen setup, per color</label><input id="s-screen" type="number" step="0.5" value={pl.screenFee} onChange={(e) => updPl((d) => { d.screenFee = n(e.target.value); })} /></div>
              <div className="field"><label htmlFor="s-dig">Digitizing, per location</label><input id="s-dig" type="number" step="0.5" value={pl.digitizing} onChange={(e) => updPl((d) => { d.digitizing = n(e.target.value); })} /></div>
              <div className="field"><label htmlFor="s-ink">Ink change fee, each</label><input id="s-ink" type="number" step="0.5" value={pl.inkChangeFee} onChange={(e) => updPl((d) => { d.inkChangeFee = n(e.target.value); })} /></div>
              {(["2XL", "3XL", "4XL", "5XL"] as const).map((z) => (
                <div key={z} className="field"><label htmlFor={`s-up-${z}`}>{z} material fee per piece</label><input id={`s-up-${z}`} type="number" step="0.25" value={pl.upcharges[z] ?? 0} onChange={(e) => updPl((d) => { d.upcharges[z] = n(e.target.value); })} /></div>
              ))}
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="lbl">PRICE PER PIECE ({tab.toUpperCase()}){pl.blankAdd ? " · all-inclusive" : ""}</div>
              {(pl.screenLight || pl.dtgLight) && (
                <div className="chips">
                  <button type="button" className={"chip" + (shade === "dark" ? " on" : "")} onClick={() => setShade("dark")}>Dark garments</button>
                  <button type="button" className={"chip" + (shade === "light" ? " on" : "")} onClick={() => setShade("light")}>Light garments</button>
                </div>
              )}
            </div>
            {pl.blankAdd && <div className="muted" style={{ fontSize: 12.5 }}>Each shirt = garment cost + <b>Blank +</b> for the quantity, plus one print price per location. Screen prints switch to <b>Full color</b> (digital) pricing for the whole shirt when that is cheaper. No screen setup fees.</div>}
            {(() => {
              const light = shade === "light" && !!(pl.screenLight || pl.dtgLight);
              const scr = light && pl.screenLight ? pl.screenLight : pl.screen;
              const dtg = light && pl.dtgLight ? pl.dtgLight : pl.dtg;
              const cols = Math.max(...scr.map((r) => r.length), 1);
              const setScr = (i: number, j: number, v: number) => updPl((d) => { const t = light && d.screenLight ? d.screenLight : d.screen; t[i][j] = v; });
              const setDtg = (i: number, v: number) => updPl((d) => { const t = light && d.dtgLight ? d.dtgLight : d.dtg; if (t) t[i] = v; });
              return (
                <div className="matrix-wrap">
                  <table className="matrix">
                    <thead><tr><th>Min qty</th>{pl.blankAdd && <th>Blank +</th>}{Array.from({ length: cols }, (_, c) => <th key={c}>{c + 1}c</th>)}{dtg && <th>Full color</th>}<th>Embroidery</th><th>DTF</th></tr></thead>
                    <tbody>
                      {pl.tiers.map((t, i) => (
                        <tr key={tab + shade + i}>
                          <td className="tier"><input type="number" min="1" aria-label={`Tier ${i + 1} minimum`} value={t} onChange={(e) => updPl((d) => { d.tiers[i] = n(e.target.value); })} /></td>
                          {pl.blankAdd && <td><input type="number" step="0.01" aria-label={`${t}+ blank add`} value={pl.blankAdd[i] ?? 0} onChange={(e) => updPl((d) => { if (d.blankAdd) d.blankAdd[i] = n(e.target.value); })} /></td>}
                          {Array.from({ length: cols }, (_, j) => <td key={j}><input type="number" step="0.01" aria-label={`${t}+ pieces, ${j + 1} colors`} value={scr[i]?.[j] ?? 0} onChange={(e) => setScr(i, j, n(e.target.value))} /></td>)}
                          {dtg && <td><input type="number" step="0.01" aria-label={`${t}+ full color`} value={dtg[i] ?? 0} onChange={(e) => setDtg(i, n(e.target.value))} /></td>}
                          <td><input type="number" step="0.05" aria-label={`${t}+ embroidery`} value={pl.embroidery[i] ?? 0} onChange={(e) => updPl((d) => { d.embroidery[i] = n(e.target.value); })} /></td>
                          <td><input type="number" step="0.05" aria-label={`${t}+ DTF`} value={pl.dtf[i] ?? 0} onChange={(e) => updPl((d) => { d.dtf[i] = n(e.target.value); })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            {pl.lightColors && <div className="field"><label htmlFor="s-light">Light garment colors (comma separated)</label><input id="s-light" type="text" value={pl.lightColors.join(", ")} onChange={(e) => updPl((d) => { d.lightColors = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); })} /></div>}
            <div className="preview">Check: <b>100 black tees</b>{tab === "retail" ? <> on a <b>$2.00</b> blank</> : <> supplied by the customer</>}, 1-color front + 1-color back → <b>{money(chk.lines[0]?.calcEach)} each</b>, {money(chk.sub + chk.setup)} total{chk.setup ? ` (incl. ${money(chk.setup)} setup)` : ""}.</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Finishing add-ons</h2><button className="btn sm" type="button" onClick={() => upd((d) => { d.finishing.push({ id: uid(), name: "", price: 0 }); })}>+ Add</button></div>
          <div className="panel-b stack">
            <div className="muted" style={{ fontSize: 13 }}>Per-piece extras you can tick on any group, for retail or wholesale jobs.</div>
            {s.finishing.map((f, i) => (
              <div key={f.id} className="fee-row">
                <input type="text" aria-label="Add-on name" placeholder="Fold & bag" value={f.name} onChange={(e) => upd((d) => { d.finishing[i].name = e.target.value; })} />
                <input type="number" step="0.05" aria-label="Price per piece" value={f.price} onChange={(e) => upd((d) => { d.finishing[i].price = n(e.target.value); })} />
                <button className="btn icon ghost" type="button" aria-label="Remove add-on" onClick={() => upd((d) => { d.finishing.splice(i, 1); })}>✕</button>
              </div>
            ))}
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
          <div className="panel-h"><h2>Shop staff</h2><span className="faint" style={{ fontSize: 12 }}>These emails sign in to the shop side. Roles will decide what each person sees.</span></div>
          <div className="panel-b stack">
            {staff.map((x) => (
              <div key={x.email} className="pay-row">
                <span style={{ flex: 1 }}>{x.email}</span>
                <select aria-label={`Role for ${x.email}`} value={x.role || "admin"} disabled={x.role === "owner"} onChange={(e) => setRole(x.email, e.target.value)} style={{ width: 240 }}>
                  {Object.entries(ROLES).filter(([k]) => k !== "owner" || x.role === "owner").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {staff.length > 1 && x.role !== "owner" && <button className="btn sm ghost danger" type="button" onClick={() => removeStaff(x.email)}>Remove</button>}
              </div>
            ))}
            <div className="row"><input type="email" placeholder="name@fbsprint.com" value={newStaff} onChange={(e) => setNewStaff(e.target.value)} style={{ maxWidth: 280 }} aria-label="New staff email" /><select aria-label="Role for new staff" value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ width: 240 }}>{Object.entries(ROLES).filter(([k]) => k !== "owner").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className="btn" type="button" onClick={addStaff}>Add staff</button></div>
          </div>
        </section>
      </div>
    </>
  );
}
