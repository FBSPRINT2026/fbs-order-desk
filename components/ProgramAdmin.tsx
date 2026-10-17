"use client";
import PrintavoSetup from "@/components/PrintavoSetup";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { applyProgramProposal, programAssist, type ProgramProposal } from "@/app/shop/program-pricing-actions";
import { LOCATIONS } from "@/lib/pricing";
import { BIG_SIZES, BACKS, COMMON_INCLUDED, FRONTS, cardHasPrices, newRateCard, PROGRAM_SIZES, tiersOf, type Program, type ProgramImprint, type ProgramItem, type RateCard } from "@/lib/programs";

const blankItem = (programId: string, position: number): Omit<ProgramItem, "id"> => ({ program_id: programId, name: "", style: "", brand: "", garment: "", colors: [], sizes: ["S", "M", "L", "XL", "2XL"], price: 0, min_qty: 0, imprints: [{ location: "Full Front", method: "screen", colors: 1, inks: "", size: "", notes: "" }], design_id: null, image_path: "", notes: "", active: true, position });

/**
 * Staff: a customer's program pricing. The rate card (Oct 14): their price per print on a base shirt, used when an order
 * is set to Program. Then items they order often, each with a flat price per piece (any quantity),
 * the garment, colors, sizes, print details, their logo and a picture. These make up the customer's program order form.
 */
export default function ProgramAdmin({ customerId }: { customerId: string }) {
  const sb = createClient();
  const [program, setProgram] = useState<Program | null>(null);
  const [items, setItems] = useState<ProgramItem[]>([]);
  const [designs, setDesigns] = useState<{ id: string; name: string }[]>([]);
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState("");
  const [ver, setVer] = useState(0);
  const load = useCallback(async () => {
    const [{ data: ps }, { data: ds }] = await Promise.all([
      sb.from("programs").select("*").eq("customer_id", customerId).order("created_at").limit(1),
      sb.from("designs").select("id, name").eq("customer_id", customerId).is("archived_at", null).eq("draft", false).order("number", { ascending: false }),
    ]);
    const p = ((ps || [])[0] || null) as Program | null;
    setProgram(p); setDesigns((ds || []) as never);
    if (p) {
      const { data: its } = await sb.from("program_items").select("*").eq("program_id", p.id).is("archived_at", null).order("position");
      const list = (its || []) as ProgramItem[];
      setItems(list);
      const paths = list.flatMap((i) => [i.image_path, i.image_back || ""]).filter(Boolean);
      if (paths.length) { const { data: sg } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); setImgs(Object.fromEntries(paths.map((pth, i) => [pth, sg?.[i]?.signedUrl || ""]))); }
    }
    setLoaded(true); setVer((x) => x + 1);
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const saveProgram = async (patch: Partial<Program>) => { if (!program) return; setProgram({ ...program, ...patch }); await sb.from("programs").update(patch).eq("id", program.id); setState("Saved"); };
  /** a design's price breaks: saved lowest first; price / min_qty keep the first break (the portal order form reads those) */
  const saveTiers = (it: ProgramItem, list: { min: number; price: number }[]) => {
    const t = list.map((x) => ({ min: Math.max(0, Math.round(x.min || 0)), price: Math.round((x.price || 0) * 100) / 100 })).sort((a, b) => a.min - b.min);
    const priced = t.filter((x) => x.price > 0);
    saveItem(it.id, { tiers: t, price: priced[0]?.price || 0, min_qty: priced[0]?.min || 0 });
  };
  const saveItem = async (id: string, patch: Partial<ProgramItem>) => { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x))); const { error } = await sb.from("program_items").update(patch).eq("id", id); setState(error ? "Couldn't save: " + error.message : "Saved"); };

  if (!loaded) return <div className="gb-empty">Loading…</div>;
  if (!program) return (
    <div className="pga">
    <>
    <PrintavoSetup customerId={customerId} onApplied={load} />
    <ProgramAssist customerId={customerId} about={[]} onApplied={load} />
    </>
    <div className="pg-none">
      <div className="pg-none-ic" aria-hidden="true">★</div>
      <h3>No program yet</h3>
      <p>Set up program pricing for this customer: their own price for each print (1/1, 2/1, 3/3…) on a base shirt, with a minimum. On an order, pick <b>Program</b> next to Retail / Wholesale and the prices fill in.</p>
      <button type="button" className="btn primary" onClick={async () => { await sb.from("programs").insert({ customer_id: customerId, name: "Program", active: false, rate_card: newRateCard() }); load(); }}>Set it up by hand</button>
    </div>
    </div>
  );
  return (
    <div className="pga">
      <div className="aa-bar"><div className="aa-bar-l"><h2>Program pricing</h2><span className="aa-sum">{items.filter((i) => i.active).length} design price{items.filter((i) => i.active).length === 1 ? "" : "s"} · {state || "Saves as you type"}</span></div>
        <label className="check"><input type="checkbox" checked={program.active} onChange={(e) => saveProgram({ active: e.target.checked })} /> Show in their portal</label>
      </div>
      <PrintavoSetup customerId={customerId} onApplied={load} />
      <ProgramAssist customerId={customerId} about={program.rate_card?.about || []} onApplied={load} />
      <RateCardEditor key={ver} card={program.rate_card || null} onSave={(rate_card) => saveProgram({ rate_card })} />
      <h3 className="pga-sub">Prices by design <span className="faint">(a design's own price at a quantity: on an order set to Program it wins over the rate card; also their portal order form)</span></h3>
      <div className="pga-head">
        <label>Program name<input type="text" value={program.name} onChange={(e) => saveProgram({ name: e.target.value })} placeholder="e.g. Two Men Moving: crew apparel" /></label>
        <label className="wide">Note shown to the customer<input type="text" value={program.notes} onChange={(e) => saveProgram({ notes: e.target.value })} placeholder="e.g. Prices include one-color front and back. Ships in 7 business days." /></label>
      </div>
      <div className="pga-items">
        {items.map((it) => (
          <article key={it.id} className={"pga-item" + (it.active ? "" : " off")}>
            <div className="pga-img">
              {(["image_path", "image_back"] as const).map((field) => {
                const path = (it[field] || "") as string;
                return (
                  <div key={field} className="pga-pic">
                    {path && imgs[path] ? <img src={imgs[path]} alt={`${it.name || "Design"} ${field === "image_path" ? "front" : "back"}`} /> : <span>👕</span>}
                    <label className="btn sm">{field === "image_path" ? "Front" : "Back"}<input type="file" hidden accept="image/*" onChange={async (e) => {
                      const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
                      const up = `programs/${customerId}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
                      const r = await sb.storage.from("proofs").upload(up, f, { contentType: f.type || undefined });
                      if (r.error) { setState(r.error.message); return; }
                      const { data: sg } = await sb.storage.from("proofs").createSignedUrl(up, 3600);
                      setImgs((x) => ({ ...x, [up]: sg?.signedUrl || "" }));
                      saveItem(it.id, { [field]: up } as Partial<ProgramItem>);
                    }} /></label>
                  </div>
                );
              })}
            </div>
            <div className="pga-fields">
              <div className="pga-row">
                <label className="grow">Design name<input type="text" value={it.name} onChange={(e) => saveItem(it.id, { name: e.target.value })} placeholder="Mewjira" /></label>
                <label className="grow">Their design on file<select value={it.design_id || ""} onChange={(e) => saveItem(it.id, { design_id: e.target.value || null })}><option value="">None (matched by name)</option>{designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              </div>
              <div className="pga-mode" role="radiogroup" aria-label="How this design is priced">
                <label className="check"><input type="radio" name={`pm-${it.id}`} checked={it.price_mode === "flat"} onChange={() => saveItem(it.id, { price_mode: "flat", tiers: [{ min: 0, price: tiersOf(it)[0]?.price || it.price || 0 }], min_qty: 0 })} /> Flat rate <span className="faint">(same price at any quantity)</span></label>
                <label className="check"><input type="radio" name={`pm-${it.id}`} checked={it.price_mode !== "flat"} onChange={() => saveItem(it.id, { price_mode: "breaks" })} /> Price breaks <span className="faint">(by quantity)</span></label>
              </div>
              {it.price_mode === "flat" ? (
                <div className="pga-tier-r"><span className="pga-tier-h">Price per piece</span><div className="qp-amt-in"><span>$</span><input type="text" inputMode="decimal" aria-label="Flat price each" key={`f-${it.price}`} defaultValue={it.price ? (+it.price).toFixed(2) : ""} placeholder="0.00" onBlur={(e) => { const v = Math.round((+e.target.value.replace(/[^\d.]/g, "") || 0) * 100) / 100; saveItem(it.id, { price: v, min_qty: 0, tiers: [{ min: 0, price: v }] }); }} /></div><span className="faint">each, any quantity</span></div>
              ) : (
              <div className="pga-tier" key={JSON.stringify(it.tiers || [])}>
                <span className="pga-tier-h">Price per piece</span>
                {(it.tiers?.length ? it.tiers : tiersOf(it).length ? tiersOf(it) : [{ min: 0, price: 0 }]).map((t, k, all) => (
                  <div key={k} className="pga-tier-r">
                    <label>From<input type="number" min={0} defaultValue={t.min || ""} placeholder="any" onBlur={(e) => saveTiers(it, all.map((x, j) => (j === k ? { ...x, min: +e.target.value || 0 } : x)))} /> pcs</label>
                    <div className="qp-amt-in"><span>$</span><input type="text" inputMode="decimal" aria-label="Price each" defaultValue={t.price ? t.price.toFixed(2) : ""} placeholder="0.00" onBlur={(e) => saveTiers(it, all.map((x, j) => (j === k ? { ...x, price: +e.target.value.replace(/[^\d.]/g, "") || 0 } : x)))} /></div>
                    <span className="faint">each</span>
                    {all.length > 1 && <button type="button" className="btn icon ghost sm" aria-label="Remove this price break" onClick={() => saveTiers(it, all.filter((_, j) => j !== k))}>✕</button>}
                  </div>
                ))}
                <button type="button" className="btn sm" onClick={() => { const t = it.tiers?.length ? it.tiers : tiersOf(it); const last = t[t.length - 1]; saveItem(it.id, { tiers: [...t, { min: (last?.min || 0) + 50, price: 0 }] }); }}>+ Price break</button>
              </div>
              )}
              <label className="check pga-sup"><input type="checkbox" checked={!!it.supplied} onChange={(e) => saveItem(it.id, { supplied: e.target.checked })} /> Customer supplied shirts <span className="faint">(the price is the print only: no shirt, screens or setup)</span></label>
              {it.supplied ? (
                <div className="pga-supplied">Customer supplied: no shirt in this price.</div>
              ) : (<>
                <div className="pga-row">
                  <label>Brand<input type="text" value={it.brand} onChange={(e) => saveItem(it.id, { brand: e.target.value })} placeholder="Gildan" /></label>
                  <label>Style #<input type="text" value={it.style} onChange={(e) => saveItem(it.id, { style: e.target.value })} placeholder="5000" /></label>
                  <label className="grow">Garment<input type="text" value={it.garment} onChange={(e) => saveItem(it.id, { garment: e.target.value })} placeholder="Heavy Cotton T-Shirt" /></label>
                </div>
                <div className="pga-row">
                  <label className="grow">Colors they can pick (comma between)<input type="text" defaultValue={it.colors.join(", ")} onBlur={(e) => saveItem(it.id, { colors: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Black, Navy" /></label>
                </div>
                <div className="pga-sizes"><span>Sizes</span>{PROGRAM_SIZES.map((z) => <button key={z} type="button" className={it.sizes.includes(z) ? "on" : ""} onClick={() => saveItem(it.id, { sizes: it.sizes.includes(z) ? it.sizes.filter((x) => x !== z) : PROGRAM_SIZES.filter((x) => x === z || it.sizes.includes(x)) })}>{z}</button>)}</div>
              </>)}
              <div className="pga-imps">
                <span>Print</span>
                {it.imprints.map((im, k) => {
                  const setIm = (patch: Partial<ProgramImprint>) => saveItem(it.id, { imprints: it.imprints.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                  return (
                    <div key={k} className="pga-imp">
                      <select value={im.location} onChange={(e) => setIm({ location: e.target.value })}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select>
                      <select value={im.method} onChange={(e) => setIm({ method: e.target.value as ProgramImprint["method"] })}><option value="screen">Screen print</option><option value="embroidery">Embroidery</option><option value="dtf">DTF</option></select>
                      <input type="text" value={im.inks} onChange={(e) => setIm({ inks: e.target.value })} placeholder="Ink colors" />
                      <input type="text" value={im.size} onChange={(e) => setIm({ size: e.target.value })} placeholder='Size (e.g. 11" wide)' />
                      <button type="button" className="btn icon ghost sm" aria-label="Remove print" onClick={() => saveItem(it.id, { imprints: it.imprints.filter((_, j) => j !== k) })}>✕</button>
                    </div>
                  );
                })}
                <button type="button" className="btn sm" onClick={() => saveItem(it.id, { imprints: [...it.imprints, { location: "Full Back", method: "screen", colors: 1, inks: "", size: "", notes: "" }] })}>+ Print location</button>
              </div>
              <div className="pga-row">
                <label className="grow">Note for the customer<input type="text" value={it.notes} onChange={(e) => saveItem(it.id, { notes: e.target.value })} placeholder="e.g. Includes name drop on back" /></label>
                <label className="check"><input type="checkbox" checked={it.active} onChange={(e) => saveItem(it.id, { active: e.target.checked })} /> Active</label>
                <button type="button" className="btn sm ghost" onClick={async () => { await saveItem(it.id, { archived_at: new Date().toISOString(), active: false }); setItems((xs) => xs.filter((x) => x.id !== it.id)); }}>Remove</button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <button type="button" className="btn primary" onClick={async () => { const { error } = await sb.from("program_items").insert({ ...blankItem(program.id, items.length), price_mode: "flat", supplied: program.rate_card?.garmentIncluded === false }); if (error) setState(error.message); load(); }}>+ Add a design price</button>
    </div>
  );
}

/**
 * The rate card (Oct 14, Nick): Peticolas pays $11.50 for a 1/1 on a Next Level 6210 at 50 pieces or more, no setup;
 * another shirt is the difference in blank cost × 1.2 more (or less). Furry Feline supplies their own shirts: print-only
 * prices. Saved when a field is left.
 */
function RateCardEditor({ card, onSave }: { card: RateCard | null; onSave: (c: RateCard) => void }) {
  const sb = createClient();
  const [c, setC] = useState<RateCard>(card || newRateCard());
  const [cost, setCost] = useState<number | null>(card?.base.cost ?? null);
  const style = c.base.style.trim(), brand = c.base.brand.trim();
  useEffect(() => {
    if (!style) { setCost(null); return; }
    let live = true;
    sb.from("garments").select("cost, brand").ilike("style", style).limit(5).then(({ data }) => {
      if (!live) return;
      const rows = (data || []) as { cost: number; brand: string }[];
      const hit = rows.find((x) => !brand || x.brand.toLowerCase() === brand.toLowerCase()) || rows[0];
      setCost(hit?.cost ? +hit.cost : null);
    });
    return () => { live = false; };
  }, [style, brand]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (n: RateCard) => { setC(n); onSave({ ...n, base: { ...n.base, cost: cost ?? n.base.cost } }); };
  const money2 = (v: string) => Math.round((+v.replace(/[^\d.]/g, "") || 0) * 100) / 100;
  const set = (patch: Partial<RateCard>) => save({ ...c, ...patch });
  const gridOn = c.gridOn ?? cardHasPrices(c);
  // finishing included in the price: the common ones and the shop's own finishing list, plus anything typed
  const [shopFin, setShopFin] = useState<string[]>([]);
  useEffect(() => { sb.from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => setShopFin(((data?.data as { finishing?: { name: string }[] } | null)?.finishing || []).map((f) => f.name).filter(Boolean))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const inc = c.included || [];
  const finChoices = [...new Set([...COMMON_INCLUDED, ...shopFin, ...inc])];
  const toggleInc = (x: string) => set({ included: inc.includes(x) ? inc.filter((y) => y !== x) : [...inc, x] });
  const [incDraft, setIncDraft] = useState("");
  const ex = c.garmentIncluded && cost != null ? c.prices["1/1"] || Object.values(c.prices).find((x) => x > 0) : null;
  return (
    <>
    <section className="rc">
      <div className="rc-h"><h3>Rules on every Program job</h3><span className="faint">Apply whenever an order is set to <b>Program</b>, with or without a rate card</span></div>
      <div className="pga-row">
        <label className="check"><input type="checkbox" checked={!!c.noSetupEver} onChange={(e) => set({ noSetupEver: e.target.checked })} /> No setup on any job</label>
        <label>Screens, each<div className="qp-amt-in"><span>$</span><input type="text" inputMode="decimal" defaultValue={c.screenFee != null ? String(c.screenFee) : ""} onBlur={(e) => { const v = e.target.value.trim(); set({ screenFee: v === "" ? null : money2(v) }); }} placeholder="normal" /></div></label>
      </div>
    </section>
    <section className={"rc" + (gridOn ? "" : " off")}>
      <div className="rc-h">
        <h3>Rate card</h3>
        <label className="rc-switch"><input type="checkbox" role="switch" checked={gridOn} onChange={(e) => set({ gridOn: e.target.checked })} /> {gridOn ? "On" : "Off"}</label>
        <span className="faint">{gridOn ? "A price for each print (1/1, 2/1…) on a base shirt, for designs without their own price" : "Not used: orders price by design (below) or normally"}</span>
      </div>
      {gridOn && <>
      <div className="pga-row">
        <label>Base shirt brand<input type="text" value={c.base.brand} onChange={(e) => setC({ ...c, base: { ...c.base, brand: e.target.value } })} onBlur={() => save(c)} placeholder="Next Level" /></label>
        <label>Style #<input type="text" value={c.base.style} onChange={(e) => setC({ ...c, base: { ...c.base, style: e.target.value } })} onBlur={() => save(c)} placeholder="6210" /></label>
        <span className="rc-cost">{cost != null ? <>Blank cost now <b>{money(cost)}</b></> : style ? "Not in the garment catalog yet" : ""}</span>
      </div>
      <div className="pga-row">
        <label className="check"><input type="radio" name="rc-g" checked={c.garmentIncluded} onChange={() => set({ garmentIncluded: true })} /> Price includes the shirt</label>
        <label className="check"><input type="radio" name="rc-g" checked={!c.garmentIncluded} onChange={() => set({ garmentIncluded: false })} /> Print only (they supply shirts)</label>
      </div>
      <div className="pga-row">
        {c.garmentIncluded && <label>Other shirts: difference ×<input type="text" inputMode="decimal" defaultValue={String(c.markup)} onBlur={(e) => set({ markup: +e.target.value.replace(/[^\d.]/g, "") || 1 })} style={{ width: 70 }} /></label>}
        <label>Minimum pieces<input type="number" min={0} defaultValue={c.minQty || ""} onBlur={(e) => set({ minQty: +e.target.value || 0 })} style={{ width: 90 }} /></label>
        <label className="check"><input type="checkbox" checked={c.waiveSetup} onChange={(e) => set({ waiveSetup: e.target.checked })} /> No setup on grid prices</label>
      </div>
      <div className="pga-row rc-up">
        <span>Big sizes, per piece</span>
        {BIG_SIZES.map((z) => <label key={z}>{z}<div className="qp-amt-in"><span>$</span><input type="text" inputMode="decimal" defaultValue={c.sizeUp?.[z] != null ? String(c.sizeUp[z]) : ""} onBlur={(e) => set({ sizeUp: { ...c.sizeUp, [z]: money2(e.target.value) } })} placeholder="0.00" /></div></label>)}
      </div>
      <div className="pga-row rc-inc">
        <span>Finishing included in the price</span>
        <div className="rc-inc-chips">
          {finChoices.map((x) => <button key={x} type="button" className={"chip" + (inc.includes(x) ? " on" : "")} aria-pressed={inc.includes(x)} onClick={() => toggleInc(x)}>{inc.includes(x) ? "✓ " : ""}{x}</button>)}
          <input type="text" value={incDraft} placeholder="Add another…" aria-label="Add included finishing" onChange={(e) => setIncDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && incDraft.trim()) { e.preventDefault(); if (!inc.includes(incDraft.trim())) set({ included: [...inc, incDraft.trim()] }); setIncDraft(""); } }} style={{ width: 150 }} />
        </div>
      </div>
      <div className="rc-grid-wrap">
        <table className="rc-grid">
          <caption>Price per piece by colors: front / back{c.garmentIncluded && style ? ` (on a ${style})` : ""}. Leave a box empty if there&apos;s no deal for it.</caption>
          {/* Back as a banner over its numbers, Front as a banner down the side of its numbers; 0 = no print on that side (Oct 17, Nick) */}
          <thead>
            <tr><td colSpan={2} /><th colSpan={BACKS.length} className="rc-ban" scope="colgroup">Back</th></tr>
            <tr><td colSpan={2} />{BACKS.map((b) => <th key={b} className="rc-n" scope="col">{b}</th>)}</tr>
          </thead>
          <tbody>
            {FRONTS.map((f, i) => (
              <tr key={f}>
                {i === 0 && <th rowSpan={FRONTS.length} className="rc-ban rc-side" scope="rowgroup"><span>Front</span></th>}
                <th className="rc-n" scope="row">{f}</th>
                {BACKS.map((b) => {
                  const k = `${f}/${b}`, v = c.prices[k];
                  if (!f && !b) return <td key={k} className="rc-none" />;
                  return <td key={k}><input type="text" inputMode="decimal" aria-label={`${k} price`} title={k} defaultValue={v ? v.toFixed(2) : ""} placeholder={k}
                    onBlur={(e) => { const n = money2(e.target.value); const prices = { ...c.prices }; if (n > 0) prices[k] = n; else delete prices[k]; if (n !== (v || 0)) set({ prices }); }} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ex && cost != null && <p className="faint rc-ex">Example: a shirt whose blank costs {money(cost + 2)} on a 1/1 = {money(ex)} + ({money(cost + 2)} − {money(cost)}) × {c.markup} = <b>{money(Math.round((ex + 2 * c.markup) * 100) / 100)}</b>. A cheaper shirt comes down the same way.</p>}
      </>}
    </section>
    </>
  );
}

/**
 * The AI box (Oct 14, Nick): the account manager says the deal in their own words ("Tiger Blue: always $15 a screen,
 * they supply print-ready separations"); the AI proposes the exact settings; Apply puts them on the program.
 */
function ProgramAssist({ customerId, about, onApplied }: { customerId: string; about: { text: string; by: string; at: string }[]; onApplied: () => void }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [p, setP] = useState<{ proposal: ProgramProposal; text: string } | null>(null);
  const ask = async () => {
    if (!text.trim() || busy) return;
    setBusy("ask"); setErr(""); setP(null);
    const r = await programAssist({ customerId, text }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setP({ proposal: r.proposal, text });
  };
  const apply = async () => {
    if (!p) return;
    setBusy("apply"); setErr("");
    const r = await applyProgramProposal({ customerId, proposal: p.proposal, text: p.text }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setP(null); setText(""); onApplied();
  };
  const c = p?.proposal.card, ds = p?.proposal.design_prices || [];
  const changes: string[] = [];
  if (c) {
    if (c.screen_fee !== undefined) changes.push(c.screen_fee == null ? "Remove the price per screen" : `Screens: ${money(c.screen_fee)} each, on every job`);
    if (c.waive_setup != null) changes.push(c.waive_setup ? "No setup charge" : "Setup charged");
    if (c.base_style || c.base_brand) changes.push(`Base shirt: ${[c.base_brand, c.base_style].filter(Boolean).join(" ")}`);
    if (c.garment_included != null) changes.push(c.garment_included ? "Prices include the shirt" : "Print only (they supply shirts)");
    if (c.markup != null) changes.push(`Other shirts: blank-cost difference × ${c.markup}`);
    if (c.min_qty != null) changes.push(`Minimum ${c.min_qty} pieces`);
    for (const [z, n] of Object.entries(c.size_up || {})) changes.push(`${z}: ${money(+(n || 0))} a piece`);
    for (const x of c.prices || []) changes.push(`${x.front}/${x.back}: ${money(x.price)} a piece`);
  }
  for (const d of ds) changes.push(`${d.name}: ${money(d.price)} a piece${d.min_qty ? ` at ${d.min_qty}+` : ""}`);
  return (
    <section className="pas">
      <div className="pas-h"><span className="pas-ic" aria-hidden>✦</span><div><h3>Tell the AI their deal</h3><p className="faint">In your own words. It proposes the settings; nothing changes until you press Apply.</p></div></div>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={"e.g. Tiger Blue always pays $15 a screen because they send print-ready separations.\ne.g. Peticolas: 1/1 on a 6210 is $11.50 at 50+, 2/2 is $12.50, no setup, other shirts the difference × 1.2."}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask(); }} />
      <div className="pas-row"><button type="button" className="btn primary" disabled={!text.trim() || !!busy} onClick={() => void ask()}>{busy === "ask" ? "Working it out…" : "Set it up"}</button>{err && <span className="pas-err">{err}</span>}</div>
      {p && (
        <div className="pas-prop">
          <p className="pas-sum">{p.proposal.summary}</p>
          {changes.length > 0 && <ul className="pas-list">{changes.map((x) => <li key={x}>{x}</li>)}</ul>}
          {!!p.proposal.not_supported?.length && <div className="pas-note"><b>Kept as a note on their orders</b> (the settings can't do these yet):<ul>{p.proposal.not_supported.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {!!p.proposal.questions?.length && <div className="pas-note"><b>To set it exactly:</b><ul>{p.proposal.questions.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          <div className="pas-row">
            <button type="button" className="btn primary" disabled={!!busy || (!changes.length && !p.proposal.not_supported?.length)} onClick={() => void apply()}>{busy === "apply" ? "Applying…" : "Apply"}</button>
            <button type="button" className="btn ghost" disabled={!!busy} onClick={() => setP(null)}>Discard</button>
          </div>
        </div>
      )}
      {about.length > 0 && (
        <details className="pas-about"><summary>What's been said about their deal ({about.length})</summary>
          <ul>{about.map((a, i) => <li key={i}><span className="faint">{new Date(a.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {a.by.split("@")[0]}</span> {a.text}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
