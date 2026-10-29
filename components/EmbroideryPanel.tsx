"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Imprint } from "@/lib/pricing";
import { mergeProduction, type ProductionSettings } from "@/lib/production";
import { lineName, backingFor, closestThreads, coverageOf, embGarment, embWarnings, estimateStitches, findThreads, threadByName, threadLabel, type EmbSpec, type Thread } from "@/lib/embroidery";
import { loadThreadStock, stockKey } from "@/lib/threadStock";
import PuffPicker from "@/components/PuffPicker";

/**
 * The Mockup Creator's embroidery print (Oct 23, Nick: "when you select the logo and you're on embroidery, not screen
 * printing, a whole different process has to occur… we're no longer picking colors or PMS colors, we're picking
 * threads… Madeira… then everything you have to do is think in stitches"). Shown instead of the ink colors and "How it
 * prints" when the print's method is Embroidery; screen prints never see it.
 *   - Thread colors: each color of the logo → the closest Madeira thread (with its PMS), changed by picking another
 *   - Stitches: estimated from the size and how much of the logo is stitched, until the digitized file (DST) says
 *   - 3D puff
 * Only that (Oct 29, Nick: "it's just too much information for the mock-up builder… just like with the screen printing
 * side, you just select the color. It should give the stitch estimate… just select 3D"): sew time, backing and topping,
 * the thread line, small detail, metallic and the digitizer's files aren't here. The backing and topping still default
 * for the garment (the work order and the digitizing request use them); the files come in on the order (Already
 * digitized?) and on Digitizing.
 */
type Row = { hexes: string[]; cur?: { name: string; hex: string } };
let prodCache: ProductionSettings | null = null;

export default function EmbroideryPanel({ im, rows, artUrl, wIn, hIn, garment, shirtLight, onPick, onHover, setIm, designId, portal, fabric }: {
  /** the garment's own color, behind the drawn stitches */ fabric?: string;
  im: Imprint; rows: Row[];
  /** the logo as painted (for how much of it is stitched) */ artUrl: string;
  wIn: number; hIn: number;
  /** the garment's style and name ("Port Authority K500 Silk Touch Polo") */ garment: string; shirtLight: boolean;
  onPick: (hexes: string[], v: { name: string; hex: string } | null) => void;
  onHover: (hexes: string[], v: { name: string; hex: string } | null) => void;
  /** changes to the print; `emb` is merged into what's there */ setIm: (patch: Omit<Partial<Imprint>, "emb"> & { emb?: Partial<EmbSpec> }) => void;
  designId?: string; portal?: boolean;
}) {
  const emb: EmbSpec = im.emb || {};
  const line = emb.line || "Polyneon 40";
  const [stock, setStock] = useState<Set<string>>(new Set());
  useEffect(() => { if (!portal) void loadThreadStock(createClient()).then(setStock).catch(() => null); }, [portal]);
  const [prod, setProd] = useState<ProductionSettings | null>(prodCache);
  useEffect(() => {
    if (prodCache || portal) return;
    void createClient().from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => { prodCache = mergeProduction((data?.data as { production?: unknown } | null)?.production); setProd(prodCache); });
  }, [portal]);

  // how much of the logo is stitched: read off the painted logo
  const [cov, setCov] = useState<number | null>(emb.coverage ?? null);
  useEffect(() => {
    if (!artUrl) return;
    let live = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true }); if (!g) return;
      g.drawImage(img, 0, 0, w, h);
      try { const v = coverageOf(g.getImageData(0, 0, w, h).data, w, h); if (live) setCov(Math.round(v * 100) / 100); } catch { /* a picture from elsewhere */ }
    };
    img.src = artUrl;
    return () => { live = false; };
  }, [artUrl]);

  const sewing = rows.filter((r) => r.cur && r.cur.name !== "none");
  const nThreads = new Set(sewing.map((r) => r.cur!.name)).size || rows.length || 1;
  const est = cov != null && wIn > 0 ? estimateStitches(wIn, hIn || wIn, cov, nThreads, { puff: emb.puff }) : 0;
  // the estimate keeps the print's stitch count (and its price) up to date until a file or a person sets it
  const from = emb.stitchesFrom || (im.stitches ? "staff" : "estimate");
  useEffect(() => {
    if (from !== "estimate" || !est) return;
    if (im.stitches === est && emb.coverage === cov && emb.stitchesFrom === "estimate") return;
    setIm({ stitches: est, emb: { stitchesFrom: "estimate", coverage: cov ?? undefined } });
  }, [est, from]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = embGarment(garment);
  const back = backingFor(g, { light: shirtLight, big: wIn > 6 });
  // the backing for the garment, set once so the work order has it (changed here when it's different)
  useEffect(() => {
    if (emb.backing) return;
    setIm({ emb: { backing: back.backing, topping: back.topping } });
  }, [back.backing]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (ch: Partial<EmbSpec>) => setIm({ emb: ch });

  // only what would stop it sewing right (a polo's buttons, too big for the spot)
  const warns = embWarnings(g, im.location, Math.round(wIn * 100) / 100);

  return (
    <div className="emb">
      <ThreadColors rows={rows} line={line} stock={stock} onPick={onPick} onHover={onHover} />
      <div className="emb-facts">
        <div className="emb-row">
          <label className="emb-l" htmlFor={`st-${im.id}`}>Stitches</label>
          <input id={`st-${im.id}`} type="number" min={0} step={100} className="emb-st" value={im.stitches ?? ""} placeholder={est ? String(est) : "—"}
            onChange={(e) => setIm({ stitches: e.target.value ? Math.max(0, Math.round(+e.target.value)) : undefined, emb: { stitchesFrom: e.target.value ? "staff" : "estimate" } })} />
          <span className="faint emb-from">
            {from === "file" && emb.file ? <>from the digitized file</>
              : from === "staff" ? <>typed{est ? <> · estimate ≈ {est.toLocaleString()} <button type="button" className="lc-link" onClick={() => setIm({ stitches: est, emb: { stitchesFrom: "estimate" } })}>Use it</button></> : null}</>
              : est ? <>≈ estimated: {wIn.toFixed(2)}&quot; × {(hIn || wIn).toFixed(2)}&quot;, {Math.round((cov || 0) * 100)}% of it stitched. The digitized file sets the real count.</> : "estimated once the logo and size are set"}
          </span>
        </div>
        <div className="emb-row emb-checks">
          <label className="check" title="Raised: satin stitched over foam. Sews slower, more stitches"><input type="checkbox" checked={!!emb.puff} onChange={(e) => set({ puff: e.target.checked || undefined })} /> 3D puff</label>
        </div>
        {/* 3D puff: all of it or only some parts, and big enough to puff (Oct 26) */}
        {emb.puff && artUrl && (
          <PuffPicker artUrl={artUrl} rows={rows.map((r) => ({ key: r.hexes.join(","), hexes: r.hexes, label: r.cur && r.cur.name !== "none" ? r.cur.name : r.hexes[0] }))} wIn={wIn}
            sel={emb.puffParts || {}} minIn={prod?.embroidery.puffMinIn ?? 0.125} maxIn={prod?.embroidery.puffMaxIn ?? 0.5}
            onChange={(sel) => set({ puffParts: sel })}
            onSummary={(note, warn) => { if (note !== (emb.puffNote || "") || warn !== (emb.puffWarn || "")) set({ puffNote: note || undefined, puffWarn: warn || undefined }); }} />
        )}
        {warns.length > 0 && <ul className="emb-warn">{warns.map((w, i) => <li key={i} className="bad">{w}</li>)}</ul>}
      </div>
    </div>
  );
}

/** each color in the logo → its Madeira thread: the closest ones to pick from, or find any by number, name or PMS */
function ThreadColors({ rows, line, stock, onPick, onHover }: { rows: Row[]; line: Thread["line"]; stock: Set<string>; onPick: (hexes: string[], v: { name: string; hex: string } | null) => void; onHover: (hexes: string[], v: { name: string; hex: string } | null) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const pickT = (r: Row, t: Thread | null) => { onHover(r.hexes, null); onPick(r.hexes, t ? { name: threadLabel(t), hex: t.hex } : { name: "none", hex: r.hexes[0] }); setOpen(null); setQ(""); };
  return (
    <div className="mk-colors emb-threads">
      <div className="lbl">THREAD COLORS</div>
      {rows.map((r) => {
        const k = r.hexes.join(), cur = r.cur, t = cur && cur.name !== "none" ? threadByName(cur.name) : null;
        const near = closestThreads(r.hexes[0], { line, n: 5, stock });
        const found = open === k && q.trim() ? findThreads(q, line, 20) : [];
        return (
          <div key={k} className={"emb-tr" + (open === k ? " on" : "")}>
            <button type="button" className="emb-tr-b" onClick={() => { setOpen(open === k ? null : k); setQ(""); }} aria-expanded={open === k}>
              <span className="mk-srcs">{r.hexes.slice(0, 3).map((h) => <span key={h} className="sw" style={{ background: h }} />)}</span><span className="arrow">→</span>
              {cur?.name === "none" ? <span className="emb-tr-n faint">Not sewn (the shirt shows)</span> : <>
                <span className="sw emb-spool" style={{ background: cur?.hex || r.hexes[0] }} />
                <span className="emb-tr-n">{cur?.name || "Pick a thread"}{t?.pms.length ? <span className="faint"> · PMS {t.pms[0].replace(/^PMS\s*/i, "")}</span> : null}{t && stock.has(stockKey(t.line, t.code)) ? <span className="emb-stk">standard</span> : null}</span>
              </>}
              <span className="mk-bs-a" aria-hidden>{open === k ? "▾" : "▸"}</span>
            </button>
            {open === k && (
              <div className="emb-tr-pop">
                <div className="emb-tr-h">Closest {lineName(line)} threads <span className="faint">· standard colors are on the wall; the rest are special order</span></div>
                {near.map((x) => (
                  <button key={x.code} type="button" className={"emb-opt" + (t?.code === x.code ? " on" : "")} onMouseEnter={() => onHover(r.hexes, { name: threadLabel(x), hex: x.hex })} onMouseLeave={() => onHover(r.hexes, null)} onClick={() => pickT(r, x)}>
                    <span className="sw" style={{ background: x.hex }} /><span className="emb-opt-t" title={`${x.code} ${x.name}${x.pms.length ? ` · PMS ${x.pms[0]}` : ""}`}><b>{x.code}</b> {x.name}{x.pms.length ? <span className="faint"> · PMS {x.pms[0].replace(/^PMS\s*/i, "")}</span> : null}</span>{x.stocked && <span className="emb-stk">standard</span>}<span className={"emb-dE " + (x.dE < 3 ? "ok" : x.dE < 6 ? "" : "far")}>{x.word}</span>
                  </button>
                ))}
                <input className="emb-q" placeholder="Find a thread: number, name or PMS" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a thread" autoFocus />
                {found.map((x) => (
                  <button key={x.code} type="button" className="emb-opt" onMouseEnter={() => onHover(r.hexes, { name: threadLabel(x), hex: x.hex })} onMouseLeave={() => onHover(r.hexes, null)} onClick={() => pickT(r, x)}>
                    <span className="sw" style={{ background: x.hex }} /><span className="emb-opt-t"><b>{x.code}</b> {x.name}{x.pms.length ? <span className="faint"> · PMS {x.pms[0].replace(/^PMS\s*/i, "")}</span> : null}</span>{stock.has(stockKey(x.line, x.code)) && <span className="emb-stk">standard</span>}
                  </button>
                ))}
                {q.trim() && !found.length && <p className="faint emb-none">No {lineName(line)} thread matches “{q}”.</p>}
                <button type="button" className="emb-opt emb-skip" onClick={() => pickT(r, null)}>Not sewn: the shirt shows through</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
