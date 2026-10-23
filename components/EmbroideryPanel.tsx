"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Imprint } from "@/lib/pricing";
import { mergeProduction, type ProductionSettings } from "@/lib/production";
import { BACKINGS, THREAD_LINES, TOPPINGS, lineName, backingFor, closestThreads, coverageOf, cycleMinutes, embGarment, embMax, embWarnings, estimateStitches, findThreads, piecesPerHour, threadByName, threadLabel, type EmbSpec, type Thread } from "@/lib/embroidery";
import { drawDst, readDst, type DstInfo } from "@/lib/dst";
import { loadThreadStock, stockKey } from "@/lib/threadStock";
import { lastOf, type EmbLast } from "@/lib/embroideryLast";

/**
 * The Mockup Creator's embroidery print (Oct 23, Nick: "when you select the logo and you're on embroidery, not screen
 * printing, a whole different process has to occur… we're no longer picking colors or PMS colors, we're picking
 * threads… Madeira… then everything you have to do is think in stitches"). Shown instead of the ink colors and "How it
 * prints" when the print's method is Embroidery; screen prints never see it.
 *   - Thread colors: each color of the logo → the closest Madeira thread (with its PMS), changed by picking another
 *   - Stitches: estimated from the size and how much of the logo is stitched, until the digitized file (DST) says
 *   - How long it sews (a cycle, pieces an hour on each machine), backing and topping for the garment, 3D puff, metallic
 *   - Where a needle can't go (a polo's buttons) and the usual largest size here
 */
type Row = { hexes: string[]; cur?: { name: string; hex: string } };
let prodCache: ProductionSettings | null = null;

export default function EmbroideryPanel({ im, rows, artUrl, wIn, hIn, garment, shirtLight, onPick, onHover, setIm, designId, portal }: {
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

  // what this logo was sewn with last time (a reorder starts from it)
  const [last, setLast] = useState<EmbLast | null>(null);
  useEffect(() => {
    if (!designId || portal) return;
    void createClient().from("designs").select("specs").eq("id", designId).maybeSingle().then(({ data }) => setLast(lastOf(data?.specs)));
  }, [designId, portal]);

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

  const stitches = im.stitches || est || 0;
  const cap = g === "cap";
  const cyc = prod && stitches ? cycleMinutes(stitches, prod.embroidery, { cap, colors: nThreads, puff: emb.puff, metallic: emb.metallic, detail: emb.detail }) : null;
  const heads = (prod?.machines || []).filter((m) => m.type === "embroidery" && m.active !== false).sort((a, b) => b.heads - a.heads);
  const warns = embWarnings(g, im.location, Math.round(wIn * 100) / 100);
  const mx = embMax(im.location);

  // the digitized file (DST): its stitch count replaces the estimate
  const [dst, setDst] = useState<DstInfo | null>(null);
  const [dstErr, setDstErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pv = useRef<HTMLDivElement>(null);
  const threadHexes = useMemo(() => sewing.map((r) => r.cur!.hex), [sewing]);
  useEffect(() => {
    if (!dst || !pv.current) return;
    pv.current.innerHTML = "";
    const c = drawDst(dst, threadHexes, 360); c.className = "emb-dst-c"; pv.current.appendChild(c);
  }, [dst, threadHexes]);
  async function takeDst(f: File) {
    setDstErr(""); setBusy(true);
    try {
      const info = readDst(await f.arrayBuffer());
      setDst(info);
      let path = "";
      if (!portal) {
        const sb = createClient();
        path = `embroidery/${designId || "loose"}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
        const up = await sb.storage.from("proofs").upload(path, f, { contentType: "application/octet-stream" });
        if (up.error) path = "";
        // kept with the logo too, so a reorder finds it (the thread room's digitizing list reads it)
        if (path && designId) {
          const { data } = await sb.from("designs").select("specs").eq("id", designId).maybeSingle();
          const sp = (data?.specs || {}) as Record<string, unknown>;
          const files = (((sp.embroidery as { files?: unknown[] } | undefined)?.files) || []) as unknown[];
          await sb.from("designs").update({ specs: { ...sp, embroidery: { ...(sp.embroidery as object || {}), files: [{ path, name: f.name, stitches: info.stitches, colors: info.colors, wIn: info.wIn, hIn: info.hIn, at: new Date().toISOString() }, ...files].slice(0, 10) } } }).eq("id", designId);
        }
      }
      setIm({ stitches: info.stitches, emb: { stitchesFrom: "file", file: { path, name: f.name, stitches: info.stitches, colors: info.colors, wIn: info.wIn, hIn: info.hIn, at: new Date().toISOString() } } });
    } catch (e) { setDstErr(e instanceof Error ? e.message : "Couldn't read that file."); }
    setBusy(false);
  }

  return (
    <div className="emb">
      <div className="mk-plan emb-how"><b>How it sews:</b> Embroidery, {nThreads} thread color{nThreads === 1 ? "" : "s"}{emb.puff ? ", 3D puff" : ""}{emb.metallic ? ", metallic" : ""}.</div>
      {last && (
        <div className="emb-last">
          <b>Last time</b> <span className="faint">#{last.order} · {new Date(last.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          <div>{[last.threads, last.size && `${last.location} ${last.size}`, last.stitches && `${last.stitches.toLocaleString()} stitches`, last.backing, last.topping && last.topping !== "None" && last.topping, last.puff && "3D puff", last.metallic && "metallic"].filter(Boolean).join(" · ")}</div>
          {(last.backing !== emb.backing || last.topping !== emb.topping || !!last.puff !== !!emb.puff) && <button type="button" className="lc-link" onClick={() => setIm({ emb: { backing: last.backing || emb.backing, topping: last.topping || emb.topping, puff: last.puff || undefined, metallic: last.metallic || undefined, line: (last.line as EmbSpec["line"]) || emb.line } })}>Use the same backing and effects</button>}
        </div>
      )}
      <ThreadColors rows={rows} line={line} stock={stock} onPick={onPick} onHover={onHover} />

      <div className="emb-facts">
        <div className="emb-row">
          <label className="emb-l" htmlFor={`st-${im.id}`}>Stitches</label>
          <input id={`st-${im.id}`} type="number" min={0} step={100} className="emb-st" value={im.stitches ?? ""} placeholder={est ? String(est) : "—"}
            onChange={(e) => setIm({ stitches: e.target.value ? Math.max(0, Math.round(+e.target.value)) : undefined, emb: { stitchesFrom: e.target.value ? "staff" : "estimate" } })} />
          <span className="faint emb-from">
            {from === "file" && emb.file ? <>from the digitized file ({emb.file.name})</>
              : from === "staff" ? <>typed{est ? <> · estimate ≈ {est.toLocaleString()} <button type="button" className="lc-link" onClick={() => setIm({ stitches: est, emb: { stitchesFrom: "estimate" } })}>Use it</button></> : null}</>
              : est ? <>≈ estimated: {wIn.toFixed(2)}&quot; × {(hIn || wIn).toFixed(2)}&quot;, {Math.round((cov || 0) * 100)}% of it stitched</> : "estimated once the logo and size are set"}
          </span>
        </div>
        {cyc && (
          <div className="emb-row emb-run">
            <span className="emb-l">Sews in</span>
            <span><b>{cyc.min.toFixed(1)} min</b> a cycle at {cyc.spm} stitches a minute{cap ? " (caps)" : ""}</span>
            {heads.length > 0 && <span className="faint emb-heads">{heads.map((m) => `${m.heads === 1 ? "single head" : m.heads + " head"} ≈ ${piecesPerHour(cyc.min, m.heads)}/hr`).join(" · ")}</span>}
          </div>
        )}
        <div className="emb-row emb-two">
          <label><span className="emb-l">Backing</span>
            <select value={emb.backing || back.backing} onChange={(e) => set({ backing: e.target.value })} aria-label="Backing">{[...new Set([...(emb.backing && !(BACKINGS as readonly string[]).includes(emb.backing) ? [emb.backing] : []), ...BACKINGS])].map((b) => <option key={b}>{b}</option>)}</select>
          </label>
          <label><span className="emb-l">Topping</span>
            <select value={emb.topping || back.topping} onChange={(e) => set({ topping: e.target.value })} aria-label="Topping">{TOPPINGS.map((b) => <option key={b}>{b}</option>)}</select>
          </label>
        </div>
        <p className="faint emb-why">{back.why}{(emb.backing && emb.backing !== back.backing) ? ` (we'd use ${back.backing})` : ""}</p>
        <div className="emb-row emb-checks">
          <label className="check" title="Raised: satin stitched over foam. Sews slower, more stitches"><input type="checkbox" checked={!!emb.puff} onChange={(e) => set({ puff: e.target.checked || undefined })} /> 3D puff</label>
          <label className="check" title="Metallic thread: sews slower, breaks more"><input type="checkbox" checked={!!emb.metallic} onChange={(e) => set({ metallic: e.target.checked || undefined })} /> Metallic thread</label>
          <label className="check" title="Small lettering or fine detail: sews slower"><input type="checkbox" checked={!!emb.detail} onChange={(e) => set({ detail: e.target.checked || undefined })} /> Small detail</label>
          <select className="emb-line" value={line} onChange={(e) => set({ line: e.target.value as Thread["line"] })} aria-label="Thread line">{THREAD_LINES.map((l) => <option key={l} value={l}>{lineName(l)}</option>)}</select>
        </div>
        {(warns.length > 0 || mx) && (
          <ul className="emb-warn">
            {warns.map((w, i) => <li key={i} className="bad">{w}</li>)}
            {mx && !warns.some((w) => w.includes("usual")) && <li>Usual {im.location} embroidery: {mx.usual}.</li>}
          </ul>
        )}
        {!portal && (
          <div className="emb-row emb-file">
            <span className="emb-l">Digitized file</span>
            {emb.file ? <span><b>{emb.file.name}</b> · {emb.file.stitches.toLocaleString()} stitches · {emb.file.colors} color{emb.file.colors === 1 ? "" : "s"} · {emb.file.wIn}&quot; × {emb.file.hIn}&quot;</span> : <span className="faint">Not digitized yet: the stitches are an estimate</span>}
            <label className="btn sm" style={{ cursor: "pointer" }}>{busy ? "Reading…" : emb.file ? "Replace DST" : "Add the DST"}<input type="file" hidden accept=".dst,.DST" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void takeDst(f); }} /></label>
          </div>
        )}
        {dstErr && <div className="err">{dstErr}</div>}
        {emb.file && wIn > 0 && Math.abs(emb.file.wIn - wIn) > 0.15 && <p className="emb-warn-1">The file sews {emb.file.wIn}&quot; wide; this print is set to {wIn.toFixed(2)}&quot;. A digitized file can&apos;t be resized much: ask the digitizer for the new size.</p>}
        {dst && <div className="emb-dst" ref={pv} aria-label="The stitches in the file" />}
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
      <div className="lbl">THREAD COLORS IN THIS LOGO <span className="faint">{lineName(line)}</span></div>
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
                <span className="emb-tr-n">{cur?.name || "Pick a thread"}{t?.pms.length ? <span className="faint"> · PMS {t.pms[0].replace(/^PMS\s*/i, "")}</span> : null}{t && stock.has(stockKey(t.line, t.code)) ? <span className="emb-stk">in stock</span> : null}</span>
              </>}
              <span className="mk-bs-a" aria-hidden>{open === k ? "▾" : "▸"}</span>
            </button>
            {open === k && (
              <div className="emb-tr-pop">
                <div className="emb-tr-h">Closest {lineName(line)} threads</div>
                {near.map((x) => (
                  <button key={x.code} type="button" className={"emb-opt" + (t?.code === x.code ? " on" : "")} onMouseEnter={() => onHover(r.hexes, { name: threadLabel(x), hex: x.hex })} onMouseLeave={() => onHover(r.hexes, null)} onClick={() => pickT(r, x)}>
                    <span className="sw" style={{ background: x.hex }} /><span className="emb-opt-t" title={`${x.code} ${x.name}${x.pms.length ? ` · PMS ${x.pms[0]}` : ""}`}><b>{x.code}</b> {x.name}{x.pms.length ? <span className="faint"> · PMS {x.pms[0].replace(/^PMS\s*/i, "")}</span> : null}</span>{x.stocked && <span className="emb-stk">in stock</span>}<span className={"emb-dE " + (x.dE < 3 ? "ok" : x.dE < 6 ? "" : "far")}>{x.word}</span>
                  </button>
                ))}
                <input className="emb-q" placeholder="Find a thread: number, name or PMS" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a thread" autoFocus />
                {found.map((x) => (
                  <button key={x.code} type="button" className="emb-opt" onMouseEnter={() => onHover(r.hexes, { name: threadLabel(x), hex: x.hex })} onMouseLeave={() => onHover(r.hexes, null)} onClick={() => pickT(r, x)}>
                    <span className="sw" style={{ background: x.hex }} /><span className="emb-opt-t"><b>{x.code}</b> {x.name}{x.pms.length ? <span className="faint"> · PMS {x.pms[0].replace(/^PMS\s*/i, "")}</span> : null}</span>{stock.has(stockKey(x.line, x.code)) && <span className="emb-stk">in stock</span>}
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
