"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ONE_SIZE, type GLine, type Group } from "@/lib/pricing";
import { itemMockup } from "@/lib/itemProofs";
import BusinessCardTool from "@/components/tools/BusinessCardTool";
import type { CardFill } from "@/lib/printTemplates";
import { IMPRINT_TYPES, SIGN_FINISHING, SIGN_MATERIALS, kindLabel, linePic, backPic, newSimpleGroup, pdfFirstPage, qtyOf, signEach, specText, sqft, type ProductKind, type SimpleSpec } from "@/lib/simpleOrders";

/**
 * The middle of a signage / promotional products / paper printing order (lib/simpleOrders.ts; Nov 4, Nick): one card per
 * item with its picture, what it is, the quantity and the price. Signage is priced by the square foot (size × the
 * material's rate, typed over if needed). Each line's picture is what the customer approves. Every other part of the
 * order page is the same as an apparel order.
 */
type Kind = Exclude<ProductKind, "apparel">;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PROOF: Record<string, [string, string]> = { sent: ["Proof sent", "wait"], approved: ["Approved", "ok"], changes: ["Needs changes", "no"] };

export default function SimpleLines({ orderId, customerId, kind, groups, update, hidePrices, save, onLogo }: {
  orderId: string; /** the order's customer, for their own card templates */ customerId?: string | null; kind: Kind; groups: Group[]; update: (fn: (groups: Group[]) => void) => void; hidePrices?: boolean;
  /** saves the order now (before the proofs go out, so the server sends what's on screen) */ save: () => Promise<void>;
  /** Add logo: the Mockup Creator's logo mockup for this item's group (the same tool an apparel group's Add logo opens;
   *  Nick, Nov 20 2026, #50177 Peticolas patches: "promotional product orders have the add logo feature") */ onLogo?: (groupId: string) => void;
}) {
  const sb = createClient();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  /** the business card tool, open for one item */
  const [card, setCard] = useState<{ gi: number; li: number } | null>(null);
  const lines = groups.flatMap((g, gi) => g.lines.map((l, li) => ({ g, gi, l, li })));
  // a group's logo mockup (Add logo) is its items' picture when they have none of their own
  const logoPic = (g: Group) => (g.mockupKind === "logo" && g.mockupThumbs?.[0]) || "";
  const paths = [...lines.map((x) => linePic(x.l.spec)), ...lines.map((x) => backPic(x.l.spec)), ...groups.map(logoPic)].filter((p): p is string => !!p);
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

  /** `made`: a picture made with the file (a business card's proof), used in place of the file's first page */
  const upload = async (gi: number, li: number, f: File, made?: File, extra?: Partial<SimpleSpec>) => {
    setBusy(`${gi}-${li}`); setErr("");
    const l = groups[gi]?.lines[li];
    const path = `orders/${orderId}/items/${l?.id || "x"}-${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) { setBusy(""); return setErr(`The picture didn't upload: ${error.message}`); }
    // a PDF: its first page as a picture, for the order, the quote and the customer's proof
    const preview = made ? await savePreview(made, path) : /pdf/i.test(f.type) || /\.pdf$/i.test(f.name) ? await makePreview(f, path) : undefined;
    // the picture is the order's mockup for this item: the usual Send to customer sends it as the proof
    const shown = preview || (/\.(png|jpe?g|webp|gif)$/i.test(path) ? path : "");
    if (shown && /\.png$/i.test(shown)) await sb.storage.from("proofs").upload(shown.replace(/\.png$/i, "-thumb.png"), preview ? (await (await sb.storage.from("proofs").download(shown)).data) || f : f, { contentType: "image/png", upsert: true });
    const mk = shown ? await itemMockup(orderId, l?.id || "", l?.garment || "", shown, l?.spec?.mockupId) : null;
    setBusy("");
    spec(gi, li, { image: path, imageName: f.name, preview, proof: undefined, mockupId: mk && mk.ok ? mk.id || undefined : l?.spec?.mockupId, ...(extra || {}) });
  };
  /** a paper item's back (Nick, Nov 25 2026, #50226): its file and, for a PDF, its first page as a picture */
  const uploadBack = async (gi: number, li: number, f: File) => {
    setBusy(`${gi}-${li}-b`); setErr("");
    const l = groups[gi]?.lines[li];
    const path = `orders/${orderId}/items/${l?.id || "x"}-back-${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) { setBusy(""); return setErr(`The back didn't upload: ${error.message}`); }
    const backPreview = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name) ? await makePreview(f, path) : undefined;
    setBusy("");
    spec(gi, li, { back: path, backName: f.name, backPreview, proof: undefined });
  };
  const savePreview = async (png: File, path: string) => {
    const pp = path.replace(/\.[^.]+$/, "") + "-preview.png";
    const { error } = await sb.storage.from("proofs").upload(pp, png, { contentType: "image/png", upsert: true });
    return error ? undefined : pp;
  };

  const isPdf = (p?: string) => !!p && /\.pdf$/i.test(p);
  const makePreview = async (src: Blob, path: string) => {
    const png = await pdfFirstPage(src, path.split("/").pop() || "proof.pdf");
    if (!png) return undefined;
    const pp = path.replace(/\.pdf$/i, "") + "-preview.png";
    const { error } = await sb.storage.from("proofs").upload(pp, png, { contentType: "image/png", upsert: true });
    return error ? undefined : pp;
  };
  // a picture added before previews and mockups were made: its PDF preview and its mockup now (once)
  const healed = useRef(new Set<string>());
  useEffect(() => {
    lines.forEach(({ gi, li, l }) => {
      const s = l.spec;
      if (!s?.image || (s.mockupId && (s.preview || !isPdf(s.image))) || busy || healed.current.has(l.id)) return;
      healed.current.add(l.id);
      void (async () => {
        let pp = s.preview || (isPdf(s.image!) ? "" : /\.(png|jpe?g|webp|gif)$/i.test(s.image!) ? s.image! : "");
        if (!pp && isPdf(s.image!)) { const { data } = await sb.storage.from("proofs").download(s.image!); if (data) pp = (await makePreview(data, s.image!)) || ""; }
        if (!pp) return;
        if (/\.png$/i.test(pp)) { const png = (await sb.storage.from("proofs").download(pp)).data; if (png) await sb.storage.from("proofs").upload(pp.replace(/\.png$/i, "-thumb.png"), png, { contentType: "image/png", upsert: true }); }
        const mk = s.mockupId ? null : await itemMockup(orderId, l.id, l.garment || "", pp);
        spec(gi, li, { ...(isPdf(s.image!) ? { preview: pp } : {}), mockupId: mk?.ok ? mk.id || undefined : s.mockupId });
      })();
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="panel sol">
      <div className="panel-h"><h2>{kindLabel(kind)}</h2><span className="faint">{kind === "general" ? "Item, description, quantity and amount: never on the production boards." : "Outsourced: a simple invoice, never on the production boards."}</span></div>
      <div className="panel-b">
        {err && <div className="err">{err}</div>}
        {!lines.length && <p className="faint">No items yet.</p>}
        {lines.map(({ gi, l, li }) => {
          const s: SimpleSpec = { kind, ...(l.spec || {}) } as SimpleSpec;
          const lp = linePic(s) || (!s.image ? logoPic(groups[gi]) : "");
          const q = qtyOf(l), each = +(l.priceOverride || 0) || 0, url = lp ? urls[lp] : "";
          const pf = s.proof ? PROOF[s.proof.status] : null;
          const id = `${gi}-${li}`;
          return (
            <div key={l.id} className={"sol-ln" + (kind === "paper" ? " sol-two" : "") + (kind === "general" ? " sol-plain" : "")}>
              {kind !== "general" && <label className={"sol-img" + (s.image ? " has" : "")} title={s.image ? "Change the picture" : "Add a picture: what the customer approves"}>
                {s.image ? (url ? <img src={url} alt={l.garment || "Item"} /> : isPdf(s.image) ? <span className="sol-pdf">PDF<small>{s.imageName}</small></span> : <span className="faint">…</span>)
                  : url ? <img src={url} alt={l.garment || "Item"} />
                  : <span className="sol-add">{busy === id ? "Uploading…" : "+ Picture"}</span>}
                <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(gi, li, f); }} />
                {kind === "paper" && <span className="sol-side">Front</span>}
              </label>}
              {kind === "paper" && (() => {
                const bp = backPic(s), bu = bp ? urls[bp] : "";
                return (
                  <div className="sol-back">
                    <label className={"sol-img" + (s.back ? " has" : "")} title={s.back ? "Change the back" : "Add the back: printed on the other side"}>
                      {s.back ? (bu ? <img src={bu} alt="Back" /> : isPdf(s.back) ? <span className="sol-pdf">PDF<small>{s.backName}</small></span> : <span className="faint">…</span>)
                        : <span className="sol-add">{busy === `${id}-b` ? "Uploading…" : "+ Back"}</span>}
                      <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadBack(gi, li, f); }} />
                      {s.back && <span className="sol-side">Back</span>}
                    </label>
                    {s.back && <button type="button" className="linkbtn" onClick={() => spec(gi, li, { back: undefined, backName: undefined, backPreview: undefined, proof: undefined })}>Remove back</button>}
                  </div>
                );
              })()}
              <div className="sol-body">
                <div className="sol-top">
                  <input className="sol-name" aria-label="Item name" placeholder={kind === "signage" ? "Mambo 5K start banner" : kind === "promo" ? "20 oz vacuum tumbler" : kind === "general" ? "Item (Shipping, Design fee…)" : "Business cards: Sarah Lee"} value={l.garment} onChange={(e) => edit(gi, li, (x) => { x.garment = e.target.value; })} />
                  {pf && <span className={"sol-pf " + pf[1]} title={s.proof?.note || ""}>{pf[0]}</span>}
                  {onLogo && kind === "promo" && li === 0 && <button type="button" className="btn sm" title="The logo, its size, spot and colors on a close-up: the same Add logo as an apparel order. It becomes this item's picture and proof" onClick={() => onLogo(groups[gi].id)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ marginRight: 5, verticalAlign: "-2px" }}><path d="M4 5h11M4 5v14h16v-7M8.5 15.5l3-3 2.5 2.5 2-2 3 3M18 3v6M15 6h6" /></svg>
                    {groups[gi].mockupKind === "logo" && groups[gi].mockupAt ? "Edit logo" : "Add logo"}</button>}
                  {kind === "paper" && <button type="button" className="btn sm" title="Make the card from the customer's template: type the name, title, address…" onClick={() => setCard({ gi, li })}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden style={{ marginRight: 5, verticalAlign: "-2px" }}><rect x="2.5" y="5.5" width="19" height="13" rx="1.5" /><path d="M6 10h6M6 13.5h9" /></svg>
                    {s.card ? "Edit card" : "Business card"}</button>}
                  <button type="button" className="btn icon ghost" aria-label="Remove this item" title="Remove" onClick={() => { if (l.spec?.mockupId) void itemMockup(orderId, l.id, "", "", l.spec.mockupId); update((gs) => { gs[gi].lines.splice(li, 1); if (!gs[gi].lines.length) gs.splice(gi, 1); }); }}>×</button>
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
                  {kind === "general" && <label className="sol-wide"><span>Description</span><textarea rows={2} value={s.desc || ""} placeholder="What the customer reads under the item" onChange={(e) => spec(gi, li, { desc: e.target.value })} /></label>}
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
                    {!hidePrices && <label><span>{kind === "general" ? "Rate" : "Each"}</span><input type="number" min="0" step="0.01" value={l.priceOverride ?? ""} onChange={(e) => edit(gi, li, (x) => { x.priceOverride = e.target.value === "" ? null : +e.target.value; })} /></label>}
                    {!hidePrices && <b>{money(q * each)}</b>}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {card && (() => {
          const l = groups[card.gi]?.lines[card.li];
          return <BusinessCardTool customerId={customerId || null} fill={(l?.spec as SimpleSpec | undefined)?.card} onClose={() => setCard(null)}
            onDone={async (r) => {
              const { gi, li } = card;
              const named = !l?.garment || /^Business cards\b/i.test(l.garment);
              await upload(gi, li, r.pdf, r.proof, { card: r.fill, size: (l?.spec as SimpleSpec | undefined)?.size || "3.5 × 2" });
              if (named) edit(gi, li, (x) => { x.garment = r.itemName; });
            }} />;
        })()}
        <datalist id="sol-fin">{SIGN_FINISHING.map((f) => <option key={f} value={f} />)}</datalist>
        <datalist id="sol-imp">{IMPRINT_TYPES.map((f) => <option key={f} value={f} />)}</datalist>
        <button type="button" className="btn" onClick={() => update((gs) => { gs.push(newSimpleGroup(kind)); })}>+ Add item</button>
      </div>
    </section>
  );
}
