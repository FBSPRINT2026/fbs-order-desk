"use client";
import SettingsTabs, { ConnectionsPanel } from "@/components/SettingsTabs";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLES, calcGroup, mergeSettings, newGLine, newImprint, uid, type PriceList, type Settings } from "@/lib/pricing";
import { money } from "@/lib/format";
import { getAiStatus } from "@/app/shop/ai-actions";
import { useSticky } from "@/lib/useSticky";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [state, setState] = useState("");
  const [staff, setStaff] = useState<{ email: string; name: string; role: string }[]>([]);
  const [newRole, setNewRole] = useState("admin");
  const [newStaff, setNewStaff] = useState("");
  const [tab, setTab] = useSticky<"retail" | "wholesale">("settings.priceTab", "retail");
  const [shade, setShade] = useState<"dark" | "light">("dark");
  const [aiKey, setAiKey] = useState<boolean | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => setS(mergeSettings(data?.data)));
    sb.from("staff").select("email,name,role").order("email").then(({ data }) => setStaff(data || []));
    getAiStatus().then((r) => setAiKey(r.ok ? r.hasKey : false));
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
        <div><div className="eyebrow">Pricing, payments, garments, AI and connections</div><h1>Settings</h1></div>
        <div className="row"><span className="save-state">{state}</span><button className="btn primary" type="button" onClick={save}>Save changes</button></div>
      </div>
      <SettingsTabs />
      <div className="stack">
        <section className="panel" id="pricing">
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

        <section className="panel" id="shop">
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

        <section className="panel" id="brand">
          <div className="panel-h"><h2>Menu logo</h2><span className="faint" style={{ fontSize: 12 }}>The logo at the top of the shop&apos;s left menu (dark background: use a light version)</span></div>
          <div className="panel-b grid g2" style={{ alignItems: "start" }}>
            <div className="stack" style={{ gap: 10 }}>
              <div className="field"><label htmlFor="b-logo">Logo image link</label><input id="b-logo" type="text" placeholder="/brand/fbs-logo-white.svg" value={s.brand.sideLogoUrl} onChange={(e) => upd((d) => { d.brand.sideLogoUrl = e.target.value; })} />
                <small className="faint">Built in: <button type="button" className="linkbtn" onClick={() => upd((d) => { d.brand.sideLogoUrl = "/brand/fbs-logo-white.svg"; })}>FBS (white letters)</button> · <button type="button" className="linkbtn" onClick={() => upd((d) => { d.brand.sideLogoUrl = "/brand/fbs-logo.svg"; })}>FBS (original)</button></small></div>
              <div className="field"><label htmlFor="b-w">Logo width: {s.brand.sideLogoWidth}px</label><input id="b-w" type="range" min={32} max={200} step={2} value={s.brand.sideLogoWidth} onChange={(e) => upd((d) => { d.brand.sideLogoWidth = n(e.target.value); })} /></div>
              <div className="field"><label htmlFor="b-tag">Line under the logo</label><input id="b-tag" type="text" value={s.brand.sideTagline} onChange={(e) => upd((d) => { d.brand.sideTagline = e.target.value; })} /></div>
            </div>
            <div className="brand-prev" aria-label="Preview">
              <div className="brand brand-logo">{s.brand.sideLogoUrl ? <img src={s.brand.sideLogoUrl} alt="Logo preview" style={{ width: s.brand.sideLogoWidth }} /> : <b>{s.shop.name}</b>}{s.brand.sideTagline && <span>{s.brand.sideTagline}</span>}</div>
            </div>
          </div>
        </section>

        <section className="panel" id="payments">
          <div className="panel-h"><h2>Customer payments</h2><span className="faint" style={{ fontSize: 12 }}>What customers see when they pay in their portal</span></div>
          <div className="panel-b grid g3">
            <div className="field"><label htmlFor="s-cardfee">Credit card fee %</label><input id="s-cardfee" type="number" step="0.05" min="0" max="10" value={s.pay.cardFeePct} onChange={(e) => upd((d) => { d.pay.cardFeePct = n(e.target.value); })} />
              <span className="faint" style={{ fontSize: 11.5 }}>Added only when they pay by credit card. Stax caps card surcharges at 3%, and debit cards can&apos;t be surcharged.</span></div>
            <div className="field"><label htmlFor="s-zelle">Zelle (email or phone)</label><input id="s-zelle" type="text" placeholder="payments@fbsprint.com" value={s.pay.zelle} onChange={(e) => upd((d) => { d.pay.zelle = e.target.value; })} /></div>
            <div className="field"><label htmlFor="s-venmo">Venmo handle</label><input id="s-venmo" type="text" placeholder="@FBS-Print" value={s.pay.venmo} onChange={(e) => upd((d) => { d.pay.venmo = e.target.value; })} /></div>
          </div>
        </section>

        <section className="panel" id="assistant">
          <div className="panel-h"><h2>Assistant &amp; AI</h2><span className="faint" style={{ fontSize: 12 }}>When the Assistant flags follow-ups, and what AI may do</span></div>
          <div className="panel-b stack">
            <div className="lbl">FOLLOW-UP RULES (work without AI)</div>
            <div className="grid g4">
              <div className="field"><label htmlFor="a-q">Quote follow-up after (days)</label><input id="a-q" type="number" min="1" value={s.assistant.quoteFollowUpDays} onChange={(e) => upd((d) => { d.assistant.quoteFollowUpDays = Math.max(1, n(e.target.value)); })} /></div>
              <div className="field"><label htmlFor="a-p">Proof reminder after (days)</label><input id="a-p" type="number" min="1" value={s.assistant.proofFollowUpDays} onChange={(e) => upd((d) => { d.assistant.proofFollowUpDays = Math.max(1, n(e.target.value)); })} /></div>
              <div className="field"><label htmlFor="a-r">Reply is urgent after (hours)</label><input id="a-r" type="number" min="1" value={s.assistant.replyWithinHours} onChange={(e) => upd((d) => { d.assistant.replyWithinHours = Math.max(1, n(e.target.value)); })} /></div>
              <div className="field"><label htmlFor="a-pr">Price order requests within (days)</label><input id="a-pr" type="number" min="0" value={s.assistant.priceRequestDays} onChange={(e) => upd((d) => { d.assistant.priceRequestDays = Math.max(0, n(e.target.value)); })} /></div>
              <div className="field"><label htmlFor="a-risk">Flag jobs due within (days)</label><input id="a-risk" type="number" min="1" value={s.assistant.atRiskDays} onChange={(e) => upd((d) => { d.assistant.atRiskDays = Math.max(1, n(e.target.value)); })} /></div>
              <div className="field"><label htmlFor="a-pk">Pickup reminder after (days)</label><input id="a-pk" type="number" min="1" value={s.assistant.pickupRemindDays} onChange={(e) => upd((d) => { d.assistant.pickupRemindDays = Math.max(1, n(e.target.value)); })} /></div>
              <div className="field"><label htmlFor="a-idle">Check in with customers idle (days)</label><input id="a-idle" type="number" min="30" value={s.assistant.reorderAfterDays} onChange={(e) => upd((d) => { d.assistant.reorderAfterDays = Math.max(30, n(e.target.value)); })} /></div>
            </div>
            <label className="check"><input type="checkbox" checked={s.assistant.digest} onChange={(e) => upd((d) => { d.assistant.digest = e.target.checked; })} /> Email me a daily follow-up list (7am, to the shop notification address; needs CRON_SECRET in Vercel)</label>

            <div className="lbl" style={{ marginTop: 8 }}>AI (CLAUDE)</div>
            <div className={"ai-box"}>
              <div className="muted" style={{ fontSize: 13 }}>
                {aiKey === null ? "Checking…" : aiKey ? "An Anthropic API key is set in Vercel." : <>No API key yet. Create one in the Claude Console, then add it in Vercel → Settings → Environment Variables as <b className="mono">ANTHROPIC_API_KEY</b> and redeploy.</>}
                {" "}AI never changes an order, sends a message or charges anyone on its own: it drafts and suggests, and your staff decide.
              </div>
              <label className="check"><input type="checkbox" checked={s.assistant.ai.enabled} onChange={(e) => upd((d) => { d.assistant.ai.enabled = e.target.checked; })} /> <b>Use AI</b> (drafting follow-ups, reading order emails, checking orders)</label>
              <label className="check"><input type="checkbox" disabled={!s.assistant.ai.enabled} checked={s.assistant.ai.readEmails} onChange={(e) => upd((d) => { d.assistant.ai.readEmails = e.target.checked; })} /> Read incoming customer emails and suggest replies and orders</label>
              <label className="check"><input type="checkbox" disabled={!s.assistant.ai.enabled} checked={s.assistant.ai.customerAssist} onChange={(e) => upd((d) => { d.assistant.ai.customerAssist = e.target.checked; })} /> Let customers describe an order in their own words in the portal (AI fills in the order form for them to check)</label>
              <div className="grid g2">
                <div className="field"><label htmlFor="a-model">Model for drafting and reading orders</label>
                  <select id="a-model" value={s.assistant.ai.model} onChange={(e) => upd((d) => { d.assistant.ai.model = e.target.value; })}>
                    <option value="claude-sonnet-5">Claude Sonnet 5 (recommended)</option>
                    <option value="claude-opus-5-5">Claude Opus 5.5 (most capable, costs more)</option>
                    <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (fastest, cheapest)</option>
                    {!["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"].includes(s.assistant.ai.model) && <option value={s.assistant.ai.model}>{s.assistant.ai.model}</option>}
                  </select></div>
                <div className="field"><label htmlFor="a-fast">Model for sorting emails</label>
                  <select id="a-fast" value={s.assistant.ai.fastModel} onChange={(e) => upd((d) => { d.assistant.ai.fastModel = e.target.value; })}>
                    <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (recommended)</option>
                    <option value="claude-sonnet-5">Claude Sonnet 5</option>
                    {!["claude-sonnet-5", "claude-haiku-4-5-20251001"].includes(s.assistant.ai.fastModel) && <option value={s.assistant.ai.fastModel}>{s.assistant.ai.fastModel}</option>}
                  </select></div>
              </div>
              <div className="field"><label htmlFor="a-voice">How your messages should sound</label><textarea id="a-voice" rows={2} value={s.assistant.ai.voice} onChange={(e) => upd((d) => { d.assistant.ai.voice = e.target.value; })} /></div>
            </div>
          </div>
        </section>

        <section className="panel" id="staff">
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
        <section className="panel" id="owners">
          <div className="panel-h"><h2>Account owners</h2><span className="faint" style={{ fontSize: 12 }}>Who handles which customers. &quot;My accounts&quot; views (dashboard, production calendar) use this. Add an email to link an owner to their shop login.</span></div>
          <div className="panel-b stack">
            {(s.accountOwners || []).map((o, i) => (
              <div key={i} className="pay-row">
                <input type="text" aria-label="Owner name" placeholder="Name" value={o.name} onChange={(e) => upd((d) => { d.accountOwners![i].name = e.target.value; })} style={{ maxWidth: 240 }} />
                <input type="email" aria-label="Owner email" placeholder="email (optional)" value={o.email} onChange={(e) => upd((d) => { d.accountOwners![i].email = e.target.value.trim().toLowerCase(); })} style={{ maxWidth: 280 }} />
                <button className="btn sm ghost danger" type="button" onClick={() => upd((d) => { d.accountOwners!.splice(i, 1); })}>Remove</button>
              </div>
            ))}
            <div className="row"><button className="btn sm" type="button" onClick={() => upd((d) => { d.accountOwners = [...(d.accountOwners || []), { name: "", email: "" }]; })}>+ Add account owner</button><span className="faint" style={{ fontSize: 12 }}>Save Changes at the top to keep them.</span></div>
          </div>
        </section>
        <ConnectionsPanel />
      </div>
    </>
  );
}
