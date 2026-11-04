"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ONE_SIZE, type GLine, type Group } from "@/lib/pricing";
import { sendItemProofs } from "@/lib/itemProofs";
import { IMPRINT_TYPES, SIGN_FINISHING, SIGN_MATERIALS, kindLabel, newSimpleGroup, qtyOf, signEach, specText, sqft, type ProductKind, type SimpleSpec } from "@/lib/simpleOrders";

/**
 * The middle of a signage / promotional products / paper printing order (lib/simpleOrders.ts; Nov 4, Nick): one card per
 * item with its picture, what it is, the quantity and the price. Signage is priced by the square foot (size × the
 * material's rate, typed over if needed). Each line's picture is what the customer approves. Every other part of the
 * order page is the same as an apparel order.
 */
type Kind = Exclude<ProductKind, "apparel">;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PROOF: Record<string, [string, string]> = { sent: ["Proof sent", "wait"], approved: ["Approved", "ok"], changes: ["Needs changes", "no"] };

export default function SimpleLines({ orderId, kind, groups, update, hidePrices, save }: {
  orderId: string; kind: Kind; groups: Group[]; update: (fn: (groups: Group[]) => void) => void; hidePrices?: boolean;
  /** saves the order now (before the proofs go out, so the server sends what's on screen) */ save: () => Promise<void>;
}) {
  const [msg, setMsg] = useState("");
  /** every item with a picture (not approved yet) goes to the customer to approve, in one email */
  const sendProofs = async () => {
    setBusy("send"); setErr(""); setMsg("");
    await save();
    const r = await sendItemProofs(orderId);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    update((gs) => { gs.splice(0, gs.length, ...(r.groups as Group[])); });
    setMsg(`${r.n} proof${r.n === 1 ? "" : "s"} sent${r.emailed ? " and emailed to the customer" : " (no email went: check their email settings)"}. They answer each item in their portal.`);
  };
  const sb = createClient();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const lines = groups.flatMap((g, gi) => g.lines.map((l, li) => ({ g, gi, l, li })));
  const paths = lines.map((x) => x.l.spec?.image).filter((p): p is string => !!p);
  const key = paths.join("|");
  useEffect(() => {
    if (!paths.length) return;
    void sb.storage.from("proofs").createSignedUrls(paths, 3600).then(({ data }) => {
      const m: Record<string, string> = {};
      for (const d of data || []) if (d.path && d.signedUrl) m[d.path] = d.signedUrl;
      setUrls(m);
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /** change one line; its description and (signage) its price follow */
  const edit = (gi: number, li: number, fn: (l: GLine, s: SimpleSpec) => void, reprice = false) => update((gs) => {
    const l = gs[gi]?.lines[li]; if (!l) return;
    const s: SimpleSpec = { kind, ...(l.spec || {}) } as SimpleSpec;
    fn(l, s);
    if (kind === "signage" && reprice) { const e = signEach(s); if (e > 0) l.priceOverride = e; }
    l.spec = s; l.note = specText(s);
  });
  const spec = (gi: number, li: number, patch: Partial<SimpleSpec>, reprice = false) => edit(gi, li, (_l, s) => Object.assign(s, patch), reprice);

  const upload = async (gi: number, li: number, f: File) => {
    setBusy(`${gi}-${li}`); setErr("");
    const l = groups[gi]?.lines[li];
    const path = `orders/${orderId}/items/${l?.id || "x"}-${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || "application/octet-stream" });
    setBusy("");
    if (error) return setErr(`The picture didn't upload: ${error.message}`);
    spec(gi, li, { image: path, imageName: f.name, proof: undefined });
  };

  const isPdf = (p?: string) => !!p && /\.pdf$/i.test(p);
  return (
    <section className="panel sol">
      <div className="panel-h"><h2>{kindLabel(kind)}</h2><span className="faint">Outsourced: a simple invoice, never on the production boards.</span>
        <button type="button" className="btn sol-send" disabled={!!busy || !lines.some((x) => x.l.spec?.image)} title="Every item's picture goes to the customer to approve" onClick={() => void sendProofs()}>{busy === "send" ? "Sending…" : "Send proofs for approval"}</button></div>
      <div className="panel-b">
        {err && <div className="err">{err}</div>}
        {msg && <div className="ok-note">{msg}</div>}
        {!lines.length && <p className="faint">No items yet.</p>}
        {lines.map(({ gi, l, li }) => {
          const s: SimpleSpec = { kind, ...(l.spec || {}) } as SimpleSpec;
          const q = qtyOf(l), each = +(l.priceOverride || 0) || 0, url = s.image ? urls[s.image] : "";
          const pf = s.proof ? PROOF[s.proof.status] : null;
          const id = `${gi}-${li}`;
          return (
            <div key={l.id} className="sol-ln">
              <label className={"sol-img" + (s.image ? " has" : "")} title={s.image ? "Change the picture" : "Add a picture: what the customer approves"}>
                {s.image ? (isPdf(s.image) ? <span className="sol-pdf">PDF<small>{s.imageName}</small></span> : url ? <img src={url} alt={l.garment || "Item"} /> : <span className="faint">…</span>)
                  : <span className="sol-add">{busy === id ? "Uploading…" : "+ Picture"}</span>}
                <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(gi, li, f); }} />
              </label>
              <div className="sol-body">
                <div className="sol-top">
                  <input className="sol-name" aria-label="Item name" placeholder={kind === "signage" ? "Mambo 5K start banner" : kind === "promo" ? "20 oz vacuum tumbler" : "Business cards: Sarah Lee"} value={l.garment} onChange={(e) => edit(gi, li, (x) => { x.garment = e.target.value; })} />
                  {pf && <span className={"sol-pf " + pf[1]} title={s.proof?.note || ""}>{pf[0]}</span>}
                  <button type="button" className="btn icon ghost" aria-label="Remove this item" title="Remove" onClick={() => update((gs) => { gs[gi].lines.splice(li, 1); if (!gs[gi].lines.length) gs.splice(gi, 1); })}>×</button>
                </div>
                {s.proof?.status === "changes" && s.proof.note && <div className="sol-note"><b>Customer asked:</b> {s.proof.note}</div>}
                <div className="sol-f">
                  {kind === "signage" && <>
                    <label><span>Material</span><select value={s.material || ""} onChange={(e) => { const m = SIGN_MATERIALS.find((x) => x.name === e.target.value); spec(gi, li, { material: e.target.value, ...(m ? { rate: m.rate } : {}) }, true); }}>
                      {[...new Set([...SIGN_MATERIALS.map((m) => m.name), s.material || ""])].filter(Boolean).map((m) => <option key={m}>{m}</option>)}</select></label>
                    <label className="sol-sz"><span>Size (W × H)</span><span className="sol-wh">
                      <input type="number" min="0" step="0.25" aria-label="Width" value={s.w ?? ""} onChange={(e) => spec(gi, li, { w: +e.target.value || undefined }, true)} />×
                      <input type="number" min="0" step="0.25" aria-label="Height" value={s.h ?? ""} onChange={(e) => spec(gi, li, { h: +e.target.value || undefined }, true)} />
                      <select aria-label="Feet or inches" value={s.unit || "ft"} onChange={(e) => spec(gi, li, { unit: e.target.value as "ft" | "in" }, true)}><option value="ft">ft</option><option value="in">in</option></select></span></label>
                    <label><span>Sides</span><select value={s.sides || "single"} onChange={(e) => spec(gi, li, { sides: e.target.value as "single" | "double" })}><option value="single">Single</option><option value="double">Double</option></select></label>
                    <label><span>Finishing</span><input list="sol-fin" value={s.finishing || ""} onChange={(e) => spec(gi, li, { finishing: e.target.value })} /></label>
                    {!hidePrices && <label><span>$ / sq ft</span><input type="number" min="0" step="0.05" value={s.rate ?? ""} onChange={(e) => spec(gi, li, { rate: +e.target.value || 0 }, true)} /></label>}
                  </>}
                  {kind === "promo" && <>
                    <label><span>Item #</span><input value={s.itemNo || ""} onChange={(e) => spec(gi, li, { itemNo: e.target.value })} /></label>
                    <label><span>Supplier</span><input placeholder="Hit Promo, Bullet…" value={s.supplier || ""} onChange={(e) => spec(gi, li, { supplier: e.target.value })} /></label>
                    <label><span>Product color</span><input value={s.productColor || ""} onChange={(e) => spec(gi, li, { productColor: e.target.value })} /></label>
                    <label><span>Imprint type</span><input list="sol-imp" value={s.imprintType || ""} onChange={(e) => spec(gi, li, { imprintType: e.target.value })} /></label>
                    <label><span>Imprint color</span><input placeholder="PMS 286" value={s.imprintColor || ""} onChange={(e) => spec(gi, li, { imprintColor: e.target.value })} /></label>
                  </>}
                  {kind === "paper" && <>
                    <label><span>Size</span><input placeholder='3.5 × 2' value={s.size || ""} onChange={(e) => spec(gi, li, { size: e.target.value })} /></label>
                    <label><span>Stock</span><input placeholder="16 pt matte" value={s.stock || ""} onChange={(e) => spec(gi, li, { stock: e.target.value })} /></label>
                    <label><span>Ink / sides</span><input placeholder="4/4 full color" value={s.ink || ""} onChange={(e) => spec(gi, li, { ink: e.target.value })} /></label>
                    <label className="sol-wide"><span>Details</span><input placeholder="Folds, coating, corners, names…" value={s.details || ""} onChange={(e) => spec(gi, li, { details: e.target.value })} /></label>
                  </>}
                </div>
                <div className="sol-bot">
                  {kind === "signage" && !hidePrices && sqft(s) > 0 ? <span className="sol-calc">{sqft(s)} sq ft × {money(+(s.rate || 0))} = {money(signEach(s))} each</span> : <span />}
                  <span className="sol-money">
                    <label><span>Qty</span><input type="number" min="0" value={q || ""} onChange={(e) => edit(gi, li, (x) => { x.sizes = { [ONE_SIZE]: Math.max(0, Math.round(+e.target.value || 0)) }; })} /></label>
                    {!hidePrices && <label><span>Each</span><input type="number" min="0" step="0.01" value={l.priceOverride ?? ""} onChange={(e) => edit(gi, li, (x) => { x.priceOverride = e.target.value === "" ? null : +e.target.value; })} /></label>}
                    {!hidePrices && <b>{money(q * each)}</b>}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <datalist id="sol-fin">{SIGN_FINISHING.map((f) => <option key={f} value={f} />)}</datalist>
        <datalist id="sol-imp">{IMPRINT_TYPES.map((f) => <option key={f} value={f} />)}</datalist>
        <button type="button" className="btn" onClick={() => update((gs) => { gs.push(newSimpleGroup(kind)); })}>+ Add item</button>
      </div>
    </section>
  );
}
