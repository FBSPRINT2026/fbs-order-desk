"use client";
import { useEffect, useMemo, useState } from "react";
import { reorderProducts, saveProduct, setProductActive, storeDesigns, suggestPrice, uploadStoreImage, type StoreBundle } from "@/app/merch-actions";
import { bySize, isYouthSize, r2, storeImg, unitPrice, type Product, type ProductColor, type YouthBlank } from "@/lib/merch";
import { guessHex, ssImg } from "@/lib/mockup";
import { renderMockup } from "@/lib/mockupRender";
import type { Garment } from "@/lib/pricing";

const money = (n: number) => (+n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
type Design = { id: string; number: number; name: string; url: string; width_px: number | null; height_px: number | null; colors: number; inks: string };
type Hit = { styleID: number; brand: string; style: string; title: string; image: string; supplier: "ss" | "sanmar" };

/** The store's products: what's on it, the price breakdown (FBS + give-back = shopper price), and the quick builder. */
export default function ProductsTab({ b, reload }: { b: StoreBundle; reload: () => void }) {
  const [edit, setEdit] = useState<Product | "new" | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const list = b.products.filter((p) => showHidden || p.active);
  const move = async (i: number, d: number) => {
    const ids = b.products.map((p) => p.id); const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderProducts(b.store.id, ids); reload();
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => setEdit("new")}>+ Add a product</button>
        <span className="faint" style={{ fontSize: 13 }}>Pick the art, the shirt and the colors: the mockups and FBS&apos;s price are made for you.</span>
        <span className="spacer" />
        {b.products.some((p) => !p.active) && <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" style={{ width: "auto" }} checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />Show hidden</label>}
      </div>
      {!list.length ? <div className="empty">No products yet. Add the first one.</div> : (
        <div className="ms-prods">
          {list.map((p) => {
            const i = b.products.indexOf(p), c0 = p.colors[0];
            const sizes = [...p.sizes].sort(bySize);
            return (
              <div key={p.id} className={"ms-prod" + (p.active ? "" : " off")}>
                <div className="ms-prod-img">{c0 && (c0.image || c0.photo) ? <img src={storeImg(c0.image || c0.photo)} alt="" /> : null}</div>
                <div className="ms-prod-b">
                  <b>{p.name}</b>
                  <div className="faint">{[p.brand, p.style].filter(Boolean).join(" ")}{p.imprint?.youth ? ` + youth ${p.imprint.youth.style}` : ""} · {p.colors.map((c) => c.name).join(", ")}</div>
                  <div className="faint">{sizes[0]}–{sizes[sizes.length - 1]}</div>
                  <div className="ms-price"><span>FBS {money(p.base_price)}</span><span>+ give-back {money(p.giveback)}</span><b>= {money(unitPrice(p, "M"))}</b>{Object.keys(p.upcharges || {}).length > 0 && <span className="faint">{Object.entries(p.upcharges).filter(([, v]) => +v).map(([z, v]) => `${z} ${+v > 0 ? "+" : ""}${money(+v)}`).join(", ")}</span>}</div>
                </div>
                <div className="ms-prod-a">
                  <button type="button" className="btn sm" onClick={() => setEdit(p)}>Edit</button>
                  <button type="button" className="btn sm ghost" onClick={async () => { await setProductActive(b.store.id, p.id, !p.active); reload(); }}>{p.active ? "Hide" : "Show"}</button>
                  <span className="row" style={{ gap: 2 }}><button type="button" className="btn icon ghost sm" aria-label="Move up" onClick={() => move(i, -1)}>↑</button><button type="button" className="btn icon ghost sm" aria-label="Move down" onClick={() => move(i, 1)}>↓</button></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit && <Builder b={b} product={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

const LOCS: { k: string; w: number }[] = [{ k: "Full Front", w: 11 }, { k: "Left Chest", w: 4 }, { k: "Medium Front", w: 9 }, { k: "Full Back", w: 12 }];

async function lookup(h: { styleID?: number; style?: string; supplier?: string }): Promise<Garment> {
  const q = h.supplier === "sanmar" ? `style=${encodeURIComponent(h.style || "")}&supplier=sanmar` : h.styleID ? `styleid=${h.styleID}` : `style=${encodeURIComponent(h.style || "")}`;
  const r = await fetch(`/api/ss/lookup?${q}`); const j = await r.json();
  if (!r.ok || !j.garment) throw new Error(j.error || "Couldn't load that style.");
  return j.garment as Garment;
}

function StylePick({ label, onPick, current }: { label: string; onPick: (g: Garment) => void; current: Garment | null }) {
  const [q, setQ] = useState(""), [hits, setHits] = useState<Hit[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) { setHits([]); return; }
    const id = setTimeout(() => { fetch(`/api/ss/search?q=${encodeURIComponent(t)}`).then((r) => r.json()).then((j) => setHits(j.results || [])).catch(() => setHits([])); }, 300);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <div className="field">
      <label>{label}</label>
      {current && <div className="faint" style={{ fontSize: 13 }}>{current.brand} {current.style} · {current.description?.slice(0, 60)} <button type="button" className="linkbtn" onClick={() => setQ(current.style)}>Change</button></div>}
      {(!current || q) && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Style # or name: 5000, 64000, Comfort Colors 1717, PC54…" />}
      {hits.length > 0 && <div className="ms-hits">{hits.slice(0, 12).map((h) => (
        <button key={`${h.supplier}${h.styleID}${h.style}`} type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(""); try { onPick(await lookup(h)); setQ(""); setHits([]); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(false); }}>
          {h.image ? <img src={h.supplier === "sanmar" ? ssImg(h.image) : ssImg(h.image)} alt="" /> : <span />}<span><b>{h.brand} {h.style}</b><small>{h.title} · {h.supplier === "sanmar" ? "SanMar" : "S&S"}</small></span>
        </button>
      ))}</div>}
      {busy && <div className="faint">Loading colors and sizes…</div>}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}

function Builder({ b, product, onClose, onSaved }: { b: StoreBundle; product: Product | null; onClose: () => void; onSaved: () => void }) {
  const staff = b.staff;
  const [designs, setDesigns] = useState<Design[] | null>(null);
  useEffect(() => { storeDesigns(b.store.id).then((r) => setDesigns(r.ok ? r.data : [])); }, [b.store.id]);
  const [designId, setDesignId] = useState(product?.design_id || "");
  const [loc, setLoc] = useState(product?.imprint?.location || "Full Front");
  const [width, setWidth] = useState(product?.imprint?.width || 11);
  const [inks, setInks] = useState(product?.imprint?.colors || 1);
  const [method, setMethod] = useState(product?.imprint?.method || "screen");
  const [g, setG] = useState<Garment | null>(null);
  const [yg, setYg] = useState<Garment | null>(null);
  const [colors, setColors] = useState<string[]>(product?.colors.map((c) => c.name) || []);
  const [sizes, setSizes] = useState<string[]>(product?.sizes || []);
  const [name, setName] = useState(product?.name || ""), [desc, setDesc] = useState(product?.description || "");
  const [base, setBase] = useState(product?.base_price || 0), [give, setGive] = useState(product?.giveback ?? 5);
  const [ups, setUps] = useState<Record<string, number>>(product?.upcharges || {});
  const [pers, setPers] = useState(product?.personalize?.[0] || null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  // editing: load the blank(s) again for their colors and photos
  useEffect(() => {
    if (!product) return;
    if (product.style) lookup({ style: product.style, supplier: product.supplier }).then(setG).catch(() => {});
    const y = product.imprint?.youth;
    if (y?.style) lookup({ style: y.style, supplier: y.supplier }).then(setYg).catch(() => {});
  }, [product]);
  const design = designs?.find((d) => d.id === designId) || null;
  useEffect(() => { if (design && !product) setInks(design.colors || 1); }, [design, product]);
  const hexOf = (gg: Garment | null, c: string) => gg?.color_images?.[c]?.hex || guessHex(c);
  const photoOf = (gg: Garment | null, c: string) => { const ci = gg?.color_images?.[c] || Object.entries(gg?.color_images || {}).find(([k]) => k.toLowerCase() === c.toLowerCase())?.[1]; return ci?.front ? ssImg(ci.front) : ""; };
  const allSizes = useMemo(() => [...new Set([...(yg?.sizes || []).filter(isYouthSize), ...(g?.sizes || [])])].sort(bySize), [g, yg]);
  // a new blank: every color off, the usual sizes on, and FBS's price suggested
  const pickAdult = (gg: Garment) => { setG(gg); setSizes((s) => [...new Set([...s.filter(isYouthSize), ...(gg.sizes || []).filter((z) => !isYouthSize(z) && !/^[4-6]XL$/.test(z))])]); if (!name) setName(gg.description?.split(/[-–]/)[0].trim().slice(0, 40) || `${gg.brand} ${gg.style}`); };
  const pickYouth = (gg: Garment) => { setYg(gg); setSizes((s) => [...new Set([...s, ...(gg.sizes || []).filter(isYouthSize)])]); };
  useEffect(() => {
    if (!g?.id || !colors[0]) return;
    suggestPrice(b.store.id, { garment_id: g.id, color: colors[0], method, colors: inks, locations: 1 }).then((r) => {
      if (!r.ok) return;
      if (!product || !staff) setBase(r.data.base);
      if (!product) setUps(r.data.upcharges);
    });
  }, [g?.id, colors[0], method, inks]); // eslint-disable-line react-hooks/exhaustive-deps
  const youthOnlyColors = yg ? colors.filter((c) => !(yg.colors || []).some((x) => x.toLowerCase() === c.toLowerCase())) : [];

  async function save() {
    setErr("");
    if (!name.trim()) return setErr("Name the product.");
    if (!g) return setErr("Pick the shirt.");
    if (!colors.length) return setErr("Pick at least one color.");
    if (!sizes.length) return setErr("Pick the sizes.");
    setBusy("Making the mockups…");
    try {
      // a mockup per color (the art on that color's photo); without art, the blank's photo
      const out: ProductColor[] = [];
      for (const c of colors) {
        const photo = photoOf(g, c) || photoOf(yg, c);
        const old = product?.colors.find((x) => x.name === c);
        let image = "";
        const same = old && product?.design_id === designId && product?.imprint?.location === loc && product?.imprint?.width === width;
        if (same && old?.image) image = old.image;
        else if (design?.url && photo) {
          const blob = await renderMockup({ photo, art: design.url, location: loc, widthIn: width, artRatio: design.width_px && design.height_px ? design.height_px / design.width_px : undefined });
          const fd = new FormData(); fd.set("store", b.store.id); fd.set("kind", "mockup"); fd.set("file", new File([blob], "mockup.png", { type: "image/png" }));
          const up = await uploadStoreImage(fd);
          if (!up.ok) throw new Error(up.error);
          image = up.data.path;
        }
        const colorSizes = sizes.filter((z) => (isYouthSize(z) ? (yg?.colors || []).some((x) => x.toLowerCase() === c.toLowerCase()) : true));
        out.push({ name: c, hex: hexOf(g, c), image, photo, sizes: colorSizes });
      }
      setBusy("Saving…");
      const youth: YouthBlank | null = yg && sizes.some(isYouthSize) ? { supplier: yg.supplier || "ss", style: yg.supplier === "sanmar" ? yg.supplier_style || yg.style : yg.style, brand: yg.brand, garment_id: yg.id, sizes: sizes.filter(isYouthSize), cost: yg.size_costs || {} } : null;
      const r = await saveProduct(b.store.id, {
        id: product?.id, name, description: desc, design_id: designId || null,
        imprint: { location: loc, width, colors: inks, method, inks: design?.inks || "", youth },
        supplier: g.supplier || "ss", style: g.supplier === "sanmar" ? g.supplier_style || g.style : g.style, brand: g.brand, garment_id: g.id,
        colors: out, sizes, cost: g.size_costs || {}, base_price: base, giveback: give, upcharges: ups, personalize: pers?.label ? [pers] : [], active: product?.active ?? true,
      });
      if (!r.ok) throw new Error(r.error);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(""); }
  }

  const shopper = r2(+base + +give);
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Product" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet" style={{ maxWidth: 1040 }}>
        <div className="pp-sheet-h"><b>{product ? `Edit ${product.name}` : "Add a product"}</b><button type="button" className="btn icon ghost" aria-label="Close" disabled={!!busy} onClick={onClose}>✕</button></div>
        <div className="ms-build">
          <div className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label>1. The art</label>
              {!designs ? <div className="faint">Loading their designs…</div> : !designs.length ? <div className="faint">No designs on this account yet. Add them in Artwork (or in the customer&apos;s Artwork area), then come back.</div> : (
                <div className="ms-designs">{designs.map((d) => <button key={d.id} type="button" className={designId === d.id ? "on" : ""} onClick={() => setDesignId(d.id === designId ? "" : d.id)} title={`D-${d.number} ${d.name}`}>{d.url ? <img src={d.url} alt="" /> : <span>D-{d.number}</span>}<small>{d.name || `D-${d.number}`}</small></button>)}</div>
              )}
              <div className="grid g3" style={{ marginTop: 8 }}>
                <div className="field"><label>Where</label><select value={loc} onChange={(e) => { setLoc(e.target.value); setWidth(LOCS.find((l) => l.k === e.target.value)?.w || 11); }}>{LOCS.map((l) => <option key={l.k}>{l.k}</option>)}</select></div>
                <div className="field"><label>Width (in)</label><input type="number" min={1} max={14} step={0.5} value={width} onChange={(e) => setWidth(+e.target.value)} /></div>
                <div className="field"><label>Print</label><select value={method} onChange={(e) => setMethod(e.target.value)}><option value="screen">Screen print</option><option value="embroidery">Embroidery</option><option value="dtf">DTF</option></select></div>
                {method === "screen" && <div className="field"><label>Ink colors</label><input type="number" min={1} max={12} value={inks} onChange={(e) => setInks(+e.target.value)} /></div>}
              </div>
            </div>
            <StylePick label="2. The shirt (adult sizes)" current={g} onPick={pickAdult} />
            <StylePick label="Youth version (optional, e.g. 5000B with 5000)" current={yg} onPick={pickYouth} />
            {g && <div className="field">
              <label>3. Colors</label>
              <div className="ms-colors">{(g.colors || []).map((c) => <button key={c} type="button" className={colors.includes(c) ? "on" : ""} onClick={() => setColors(colors.includes(c) ? colors.filter((x) => x !== c) : [...colors, c])}><i style={{ background: hexOf(g, c) }} />{c}</button>)}</div>
              {youthOnlyColors.length > 0 && <small className="faint">No youth sizes in {youthOnlyColors.join(", ")} (the youth style doesn&apos;t come in it).</small>}
            </div>}
            {g && <div className="field">
              <label>4. Sizes</label>
              <div className="ms-colors">{allSizes.map((z) => <button key={z} type="button" className={sizes.includes(z) ? "on" : ""} onClick={() => setSizes(sizes.includes(z) ? sizes.filter((x) => x !== z) : [...sizes, z].sort(bySize))}>{z}</button>)}</div>
            </div>}
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <div className="ms-mock">{design?.url && g && colors[0] && photoOf(g, colors[0]) ? <MockPreview photo={photoOf(g, colors[0])} art={design.url} loc={loc} width={width} ratio={design.width_px && design.height_px ? design.height_px / design.width_px : undefined} /> : g && colors[0] && photoOf(g, colors[0]) ? <img src={photoOf(g, colors[0])} alt="" /> : <span className="faint">The mockup shows here.</span>}</div>
            <div className="field"><label>Product name (shoppers see this)</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wolves Spirit Tee" /></div>
            <div className="field"><label>Description (optional)</label><textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Soft, classic-fit cotton tee." /></div>
            <div className="ms-pricebox">
              <div className="field"><label>FBS price</label>{staff ? <input type="number" min={0} step={0.5} value={base} onChange={(e) => setBase(+e.target.value)} /> : <b>{money(base)}</b>}</div>
              <span>+</span>
              <div className="field"><label>Give-back</label><input type="number" min={0} step={0.5} value={give} onChange={(e) => setGive(+e.target.value)} /></div>
              <span>=</span>
              <div className="field"><label>Shopper pays</label><b style={{ fontSize: 20 }}>{money(shopper)}</b></div>
            </div>
            <small className="faint">{staff ? "FBS price is suggested from your retail pricing at the store's expected pieces." : "FBS's price covers the shirt and the printing. Your give-back goes back to your organization."} Sizes with an upcharge add it on top.</small>
            {staff && sizes.length > 0 && <div className="ms-ups">{sizes.map((z) => <label key={z}><span>{z}</span><input type="number" step={0.5} value={ups[z] ?? 0} onChange={(e) => setUps({ ...ups, [z]: +e.target.value })} /></label>)}</div>}
            <details><summary className="faint" style={{ cursor: "pointer" }}>Personalization (name or number on the shirt)</summary>
              <div className="grid g3" style={{ marginTop: 8 }}>
                <div className="field"><label>Label</label><input value={pers?.label || ""} onChange={(e) => setPers({ label: e.target.value, price: pers?.price || 0, max: pers?.max || 12 })} placeholder="Name on back" /></div>
                <div className="field"><label>Extra $</label><input type="number" min={0} step={0.5} value={pers?.price || 0} onChange={(e) => setPers({ label: pers?.label || "", price: +e.target.value, max: pers?.max || 12 })} /></div>
                <div className="field"><label>Max letters</label><input type="number" min={1} max={30} value={pers?.max || 12} onChange={(e) => setPers({ label: pers?.label || "", price: pers?.price || 0, max: +e.target.value })} /></div>
              </div>
            </details>
            {err && <div className="pv-err">{err}</div>}
            <div className="row"><span className="spacer" /><button type="button" className="btn ghost" disabled={!!busy} onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!!busy} onClick={save}>{busy || (product ? "Save product" : "Add to the store")}</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** a live mockup while picking (the same renderer as the saved ones) */
function MockPreview({ photo, art, loc, width, ratio }: { photo: string; art: string; loc: string; width: number; ratio?: number }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let dead = false, made = "";
    renderMockup({ photo, art, location: loc, widthIn: width, artRatio: ratio, size: 600 }).then((bl) => { if (dead) return; made = URL.createObjectURL(bl); setUrl(made); }).catch(() => setUrl(photo));
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [photo, art, loc, width, ratio]);
  return url ? <img src={url} alt="Mockup" /> : <span className="faint">Making the mockup…</span>;
}
