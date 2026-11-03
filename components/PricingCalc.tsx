"use client";
import { useMemo, useState } from "react";
import { digitizingFee, type PriceList } from "@/lib/pricing";
import { estimateStitches } from "@/lib/embroidery";

/**
 * Price calculators under the customer's price list (Nov 2, Nick: "put a calculator… 100 shirts. Is it a light or dark
 * garment? How many colors on the front? How many colors on the back?… front would be this much, second location…
 * screens… Same thing with embroidery… upload your logo, we'll estimate the stitch count… where you're putting it, how
 * many units… putting it on a hat"). Everything comes from their own price list, the same numbers their orders use.
 */
const m = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const tierOf = (q: number, t: number[]) => t.reduce((a, x, i) => (q >= x ? i : a), 0);
const SPOTS = ["Front", "Back", "Left chest", "Full front", "Left sleeve", "Right sleeve", "Pocket", "Left side", "Right side", "Neck"];
const special = (spot: string, pl: PriceList) => (pl.specialLocations?.length ? pl.specialLocations : ["Left sleeve", "Right sleeve", "Pocket", "Left side", "Right side"]).some((x) => x.toLowerCase() === spot.toLowerCase());

export function ScreenCalc({ pl }: { pl: PriceList }) {
  const tiers = pl.tiers || [];
  const cols = Math.max(...(pl.screen || []).map((r) => r.length), 0);
  const [qty, setQty] = useState("100");
  const [dark, setDark] = useState(true);
  const [poly, setPoly] = useState(false);
  const [locs, setLocs] = useState([{ spot: "Front", colors: 1 }, { spot: "Back", colors: 0 }]);
  const q = Math.max(0, Math.floor(+qty || 0)), charged = Math.max(q, pl.minQty || 0);
  const ti = tierOf(charged, tiers);
  const rows = locs.filter((l) => l.colors > 0).map((l) => {
    const under = dark && pl.darkAddsColor ? 1 : 0;
    const eff = l.colors + under;
    const custom = eff > cols;
    const base = custom ? 0 : +(pl.screen?.[ti]?.[eff - 1] || 0);
    const sp = special(l.spot, pl) ? +(pl.specialLocPrice || 0) : 0;
    const ink = poly ? +(pl.specialtyInk?.[ti] || 0) : 0;
    return { ...l, under, eff, custom, each: base + sp + ink, sp, ink, base };
  });
  const custom = rows.some((r) => r.custom);
  const screens = rows.reduce((a, r) => a + r.eff, 0);
  const setup = screens * (pl.screenFee || 0);
  const each = rows.reduce((a, r) => a + r.each, 0);
  const set = (i: number, k: "spot" | "colors", v: string | number) => setLocs((x) => x.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <section className="panel pl-sec pcx">
      <div className="panel-h"><h2>Price calculator</h2><span className="faint">Screen printing, from your price list</span></div>
      <div className="panel-b pcx-b">
        <div className="pcx-in">
          <div className="pcx-row">
            <label className="pcx-f"><span>Pieces</span><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} /></label>
            <div className="pcx-f"><span>Garment</span><div className="pcx-seg" role="radiogroup" aria-label="Garment color">
              <button type="button" role="radio" aria-checked={!dark} className={!dark ? "on" : ""} onClick={() => setDark(false)}>Light</button>
              <button type="button" role="radio" aria-checked={dark} className={dark ? "on" : ""} onClick={() => setDark(true)}>Dark</button>
            </div></div>
          </div>
          {locs.map((l, i) => (
            <div className="pcx-row pcx-loc" key={i}>
              <label className="pcx-f"><span>{i === 0 ? "Where" : `Location ${i + 1}`}</span>
                <select value={l.spot} onChange={(e) => set(i, "spot", e.target.value)}>{SPOTS.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label className="pcx-f"><span>Ink colors</span>
                <select value={l.colors} onChange={(e) => set(i, "colors", +e.target.value)}>{Array.from({ length: cols + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? "None" : n}</option>)}</select></label>
              {i > 1 && <button type="button" className="linkbtn pcx-x" aria-label="Remove this location" onClick={() => setLocs((x) => x.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          <div className="pcx-more">
            <button type="button" className="linkbtn" onClick={() => setLocs((x) => [...x, { spot: SPOTS.find((s) => !x.some((l) => l.spot === s)) || "Left sleeve", colors: 1 }])}>+ Add a location</button>
            {pl.specialtyInk?.length ? <label className="pcx-ck"><input type="checkbox" checked={poly} onChange={(e) => setPoly(e.target.checked)} /> Polyester, nylon or dyed garment</label> : null}
          </div>
        </div>
        <div className="pcx-out" aria-live="polite">
          {!q ? <p className="faint">Type how many pieces.</p> : !rows.length ? <p className="faint">Pick at least one location with ink colors.</p> : <>
            <dl className="pl-dl">
              {rows.map((r, i) => <div key={i}><dt>{r.spot} · {r.colors} color{r.colors > 1 ? "s" : ""}{r.under ? " + underbase" : ""}{r.sp ? " · special location" : ""}{r.ink ? " · specialty ink" : ""} <small>each</small></dt><dd>{r.custom ? "Quoted" : m(r.each)}</dd></div>)}
              <div><dt>Per piece</dt><dd><b>{custom ? "Quoted" : m(each)}</b></dd></div>
              <div><dt>Screens ({screens} × {m(pl.screenFee || 0)}) <small>one time</small></dt><dd>{m(setup)}</dd></div>
              <div className="tot"><dt>Total for {q.toLocaleString()}{charged > q ? ` (charged as ${charged})` : ""}</dt><dd><b>{custom ? "Quoted" : m(each * charged + setup)}</b></dd></div>
            </dl>
            <p className="pcx-fine">Before garments, finishing and tax.{dark && pl.darkAddsColor ? " Dark garments get a white underbase, counted as one more color." : ""}{custom ? ` ${cols + 1}+ colors are quoted for the job.` : ""}</p>
            <Ballpark />
          </>}
        </div>
      </div>
    </section>
  );
}

/** where it goes on the garment: how wide a logo sews there, and the tallest it can be */
const PLACES: { k: string; w: number; maxH: number }[] = [
  { k: "Left chest", w: 3.5, maxH: 3.5 }, { k: "Full front", w: 10, maxH: 10 }, { k: "Full back", w: 11, maxH: 12 },
  { k: "Hat front", w: 4.5, maxH: 2.25 }, { k: "Hat side", w: 2.5, maxH: 1.75 }, { k: "Sleeve", w: 3, maxH: 3 }, { k: "Bag or backpack", w: 5, maxH: 5 },
];
const GARMENTS: { k: string; specialty: boolean }[] = [
  { k: "T-shirt, polo or button-up", specialty: false }, { k: "Hat or beanie", specialty: true }, { k: "Fleece, hoodie or jacket", specialty: true },
  { k: "Bag or backpack", specialty: true }, { k: "Other flat garment", specialty: false },
];

/** how much of a picture is stitched: pixels that aren't see-through and aren't its background color (read off a corner) */
function coverage(img: HTMLImageElement): number {
  const W = 300, H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); if (!x) return 0.5;
  x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const bg = [d[0], d[1], d[2], d[3]];
  let on = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 96) continue;
    if (bg[3] > 200 && Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 60) continue;
    on++;
  }
  return on / (W * H);
}

export function EmbCalc({ pl }: { pl: PriceList }) {
  const embT = pl.embTiers?.length ? pl.embTiers : pl.tiers || [];
  const [qty, setQty] = useState("24");
  const [garment, setGarment] = useState(GARMENTS[0].k);
  const [place, setPlace] = useState(PLACES[0].k);
  const [stitches, setStitches] = useState(String(pl.embStitches || 6000));
  const [pic, setPic] = useState<{ url: string; name: string; aspect: number; cov: number } | null>(null);
  const [est, setEst] = useState(false);
  const pp = PLACES.find((p) => p.k === place) || PLACES[0];
  // how wide they'd like it (Nov 2, Nick: "how big do you think you want it… 10 inches, then this would be your cost");
  // empty = the usual size for that spot
  const [wide, setWide] = useState("");
  // a logo picked: its stitches estimated from its shape at this spot's size (the digitized file's count is the real one)
  const estimate = useMemo(() => {
    if (!pic) return 0;
    let w = +wide > 0 ? +wide : pp.w, h = w * pic.aspect;
    if (!(+wide > 0) && h > pp.maxH) { h = pp.maxH; w = h / pic.aspect; }
    return estimateStitches(w, h, pic.cov, 3);
  }, [pic, pp, wide]);
  const st = est && estimate ? estimate : Math.max(0, Math.floor(+stitches || 0));
  const q = Math.max(0, Math.floor(+qty || 0));
  const eti = tierOf(q, embT);
  const g = GARMENTS.find((x) => x.k === garment) || GARMENTS[0];
  const base = +(pl.embroidery?.[eti] || 0);
  const extra = pl.embPer1k && st > (pl.embStitches || 0) ? Math.ceil((st - (pl.embStitches || 0)) / 1000) * pl.embPer1k : 0;
  const spec = g.specialty ? +(pl.embSpecialty?.[eti] || 0) : 0;
  const each = base + extra + spec;
  const dig = digitizingFee({ stitches: st }, pl);
  const onFile = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { setPic({ url, name: f.name, aspect: img.naturalHeight / Math.max(1, img.naturalWidth), cov: coverage(img) }); setEst(true); };
    img.src = url;
  };
  return (
    <section className="panel pl-sec pcx">
      <div className="panel-h"><h2>Price calculator</h2><span className="faint">Embroidery, from your price list</span></div>
      <div className="panel-b pcx-b">
        <div className="pcx-in">
          <div className="pcx-row">
            <label className="pcx-f"><span>Pieces</span><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} /></label>
            <label className="pcx-f"><span>Garment</span><select value={garment} onChange={(e) => { setGarment(e.target.value); if (/^Hat/.test(e.target.value) && !/^Hat/.test(place)) setPlace("Hat front"); if (/^Bag/.test(e.target.value)) setPlace("Bag or backpack"); }}>{GARMENTS.map((x) => <option key={x.k}>{x.k}</option>)}</select></label>
          </div>
          <div className="pcx-row">
            <label className="pcx-f"><span>Where it goes</span><select value={place} onChange={(e) => { setPlace(e.target.value); setWide(""); }}>{PLACES.map((p) => <option key={p.k} value={p.k}>{p.k}</option>)}</select></label>
            <label className="pcx-f"><span>Stitches</span><input inputMode="numeric" value={est && estimate ? String(estimate) : stitches} onChange={(e) => { setEst(false); setStitches(e.target.value.replace(/[^\d]/g, "")); }} /></label>
          </div>
          {pic && <div className="pcx-row">
            <label className="pcx-f"><span>How wide, in inches</span><input inputMode="decimal" placeholder={`About ${pp.w}`} value={wide} onChange={(e) => setWide(e.target.value.replace(/[^\d.]/g, ""))} /></label>
            <div className="pcx-f pcx-hint"><span>&nbsp;</span><small>Usually about {pp.w}&quot; on a {pp.k.toLowerCase()}.</small></div>
          </div>}
          <label className={"pcx-up" + (pic ? " has" : "")}>
            <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
            {pic ? <><img src={pic.url} alt="" /><span><b>{pic.name}</b><small>About {estimate.toLocaleString()} stitches at {+wide > 0 ? `${wide}" wide` : `${pp.k.toLowerCase()} size`}. Choose another logo to change it.</small></span></>
              : <span><b>Upload your logo</b><small>We&apos;ll estimate the stitch count for where it goes.</small></span>}
          </label>
        </div>
        <div className="pcx-out" aria-live="polite">
          {!q ? <p className="faint">Type how many pieces.</p> : <>
            <dl className="pl-dl">
              <div><dt>Embroidery up to {(pl.embStitches || 0).toLocaleString()} stitches <small>each</small></dt><dd>{m(base)}</dd></div>
              {extra > 0 && <div><dt>{st.toLocaleString()} stitches: {Math.ceil((st - (pl.embStitches || 0)) / 1000)} more thousand <small>each</small></dt><dd>+{m(extra)}</dd></div>}
              {spec > 0 && <div><dt>Specialty item ({g.k.toLowerCase()}) <small>each</small></dt><dd>+{m(spec)}</dd></div>}
              <div><dt>Per piece</dt><dd><b>{m(each)}</b></dd></div>
              <div><dt>Digitizing your logo <small>one time</small></dt><dd>{m(dig)}</dd></div>
              <div className="tot"><dt>Total for {q.toLocaleString()}</dt><dd><b>{m(each * q + dig)}</b></dd></div>
            </dl>
            <p className="pcx-fine">Before garments and tax.{q < (embT[0] || 0) ? ` Embroidery starts at ${embT[0]} pieces.` : ""} The stitch count is set once your logo is digitized; a logo we&apos;ve digitized before has no digitizing charge.</p>
            <Ballpark />
          </>}
        </div>
      </div>
    </section>
  );
}

/** the same plain note under both calculators (Nov 2, Nick: "these are just estimates… FBS has the right to change the
 *  price… once seeing it… a good ballpark… a nice way to say it") */
function Ballpark() {
  return <p className="pcx-ball">This is a ballpark to help you plan, based on your price list without seeing your artwork. Once we see the art and the garments, the price can change with the design&apos;s detail, the stitch count or the garment itself. Your quote always shows the final price before anything is made.</p>;
}
