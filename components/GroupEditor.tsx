"use client";
import { ADULT_SIZES, FULL_COLOR, designLabel, designOther, INK_COLORS, THREAD_COLORS, LOCATIONS, METHODS, ONE_SIZE, SIZES, YOUTH_SIZES, newGLine, newImprint, uid, type Design, type GLine, type Garment, type Group, type GroupCalc, type Method, type PriceList, type Settings } from "@/lib/pricing";
import { money } from "@/lib/format";
import { smallerSpot } from "@/lib/mockup";
import DesignSearch from "@/components/DesignSearch";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  gi: number;
  g: Group;
  gc: GroupCalc;
  settings: Settings;
  prices: PriceList;
  catalog: Garment[];
  canRemove: boolean;
  armed: string;
  arm: (k: string) => void;
  update: (fn: (g: Group) => void) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSaveToCatalog: (l: GLine) => void;
  onLookup?: (style: string, styleID?: number) => Promise<Garment | null>;
  designs?: Design[];
  onMockup?: () => void;
  /** why a mockup can't be made yet (no customer / no garment) */
  mockupBlock?: string;
  /** signed links for the group's saved mockup thumbnails */
  thumbUrls?: Record<string, string>;
  onStarDesign?: (d: Design, starred: boolean) => void;
  designUrls?: Record<string, string>;
  onUploadDesign?: (file: File, name: string) => Promise<Design | null>;
  lookingUp?: string;
};

/** Screen prints: the inks listed must match the number of colors chosen. */
const inkCount = (s: string) => (s || "").split(/[,;/+]|\s&\s/).map((x) => x.trim()).filter(Boolean).length;
const inkMismatch = (d: { method: string; colors: number; inks: string }) => {
  if (d.method === "dtf" || (d.method === "screen" && d.colors >= FULL_COLOR)) return "";
  const n = inkCount(d.inks);
  if (!n || n === d.colors) return "";
  const what = d.method === "embroidery" ? "thread" : "ink";
  return `${n} ${what}${n > 1 ? "s" : ""} listed for ${d.colors} color${d.colors > 1 ? "s" : ""}`;
};
const lineTotal = (l: GLine) => SIZES.reduce((a, z) => a + (+(l.sizes?.[z] || 0)), 0);
const numOr =(v: string): number | "" => (v === "" ? "" : isNaN(+v) ? "" : +v);

/** Printavo-style line item group: garment rows sharing a set of imprints. */
export default function GroupEditor({ gi, g, gc, settings, prices, catalog, canRemove, armed, arm, update, onDuplicate, onRemove, onSaveToCatalog, onLookup, lookingUp, designs, designUrls, onUploadDesign, onMockup, mockupBlock, thumbUrls, onStarDesign }: Props) {
  const [askSkip, setAskSkip] = useState(false);
  const [blockMsg, setBlockMsg] = useState("");
  const startMockup = () => { if (mockupBlock) { setBlockMsg(mockupBlock); return; } setBlockMsg(""); onMockup?.(); };
  // exact style match; if the same number exists under several brands, only the brand given (or none) counts
  const findStyle = (style: string, brand?: string) => {
    const hits = catalog.filter((x) => x.style.toLowerCase() === style.trim().toLowerCase());
    if (brand) return hits.find((x) => x.brand.toLowerCase() === brand.toLowerCase());
    return hits.length === 1 ? hits[0] : undefined;
  };

  function onStyle(li: number, style: string, found?: Garment) {
    update((x) => {
      const l = x.lines[li];
      l.style = style;
      const hit = found || findStyle(style);
      if (hit) {
        // 2XL+ material charge = supplier's size price above the base price
        const sc = hit.size_costs || {};
        const up: GLine["sizeUp"] = {};
        for (const z of ["2XL", "3XL", "4XL", "5XL"] as const) if (sc[z] && hit.cost) up[z] = Math.max(0, Math.round((sc[z] - +hit.cost) * 100) / 100);
        l.sizeUp = Object.keys(up).length ? up : undefined;
        // picking a catalog style always refreshes its details and blank cost
        l.garment = hit.description;
        l.brand = hit.brand;
        if (!gc.wholesale) l.cost = +hit.cost || "";
        // the catalog decides which sizes this garment comes in
        const run = (hit.sizes || []).filter((z) => (SIZES as readonly string[]).includes(z));
        if (run.length) {
          const os = run.length === 1 && run[0] === ONE_SIZE;
          const keep: GLine["sizes"] = {};
          if (os) { const q = lineTotal(l); if (q) keep[ONE_SIZE] = q; }
          else for (const z of run) { const v = l.sizes?.[z as keyof GLine["sizes"]]; if (v) keep[z as keyof GLine["sizes"]] = v; }
          l.sizes = keep;
          l.sizeRun = run;
          l.oneSize = os;
        }
      }
    });
  }

  // Sizes shown for a row: the catalog's size run for that style, otherwise the adult run
  // (plus youth if the row already has youth quantities from an older order).
  const colsFor = (l: GLine): string[] => {
    const run = (l.sizeRun || []).filter((z) => z !== ONE_SIZE);
    if (run.length) return run;
    const youth = !!g.youth || YOUTH_SIZES.some((z) => l.sizes?.[z]);
    return [...(youth ? YOUTH_SIZES : []), ...ADULT_SIZES];
  };
  // Imprints and finishing stay grayed out until the group has a mockup (or staff choose to skip it)
  const locked = !!onMockup && !g.mockupAt && !g.mockupSkipped;
  return (
    <section className="line">
      <div className="line-h">
        <input type="text" className="grp-name" aria-label="Group name" placeholder={`Group ${gi + 1}`} value={g.name || ""} onChange={(e) => update((x) => { x.name = e.target.value; })} />
        <span className="spacer" />
        <button className="btn sm ghost" type="button" onClick={onDuplicate}>Duplicate group</button>
        {canRemove && <button className={"btn sm ghost danger" + (armed === "grp" + g.id ? " armed" : "")} type="button" onClick={() => (armed === "grp" + g.id ? onRemove() : arm("grp" + g.id))}>{armed === "grp" + g.id ? "Remove group?" : "Remove"}</button>}
      </div>
      {gc.wholesale && <div className="cs-banner">Customer supplied goods</div>}
      <div className="line-b">
        <div className="lbl" style={{ marginBottom: -4 }}>GARMENTS</div>
        <div className={"gl-list" + (gc.wholesale ? " ws" : "")}>
          <div className="gl-row gl-head">
            <span className="a-st">Style #</span><span className="a-br">Brand</span><span className="a-co">Color</span><span className="a-de">Description</span>
            {!gc.wholesale && <span className="a-cs">Cost</span>}
            <span className="a-qt c">Qty</span><span className="a-ea r">Each</span><span className="a-to r">Total</span>
          </div>
          {g.lines.map((l, li) => {
            const lc = gc.lines[li];
            const hit = findStyle(l.style, l.brand);
            const sized = !l.oneSize && lineTotal(l) > 0; // sizes entered below, so Qty is their total
            const setQty = (s: keyof GLine["sizes"], raw: string) => update((x) => { const v = Math.max(0, Math.floor(+raw || 0)); if (v) x.lines[li].sizes[s] = v; else delete x.lines[li].sizes[s]; });
            return (
              <div key={l.id} className="gl">
                <div className="gl-row">
                  <div className="a-st">
                    <StylePicker value={l.style} catalog={catalog} busy={!!lookingUp}
                      onType={(v) => onStyle(li, v)}
                      onPick={(gm) => onStyle(li, gm.style, gm)}
                      onPickSS={(h) => onLookup ? onLookup(h.style, h.styleID).then((gm) => { if (gm) onStyle(li, gm.style, gm); }) : Promise.resolve()} />
                    {lookingUp && lookingUp === l.style.trim().toUpperCase() && <div className="ink-hint">Pulling from S&amp;S…</div>}
                  </div>
                  <div className="a-br"><input type="text" tabIndex={-1} className="pre" title="Filled from the catalog. Click to change." aria-label="Brand" placeholder="Brand" value={l.brand || ""} onChange={(e) => update((x) => { x.lines[li].brand = e.target.value; })} /></div>
                  <div className="a-co">
                    <ColorPicker value={l.color} colors={hit?.colors || []} onChange={(v) => update((x) => { x.lines[li].color = v; })} />
                  </div>
                  <div className="a-de"><input type="text" tabIndex={-1} className="pre" title="Filled from the catalog. Click to change." aria-label="Description" placeholder="Description" value={l.garment} onChange={(e) => update((x) => { x.lines[li].garment = e.target.value; })} /></div>
                  {!gc.wholesale && <div className="a-cs"><input type="number" step="0.01" min="0" tabIndex={-1} className="pre" title="Click to change" aria-label="Blank cost" placeholder="0.00" value={l.cost} onChange={(e) => update((x) => { x.lines[li].cost = numOr(e.target.value); })} /></div>}
                  <div className="a-qt c">
                    {/* Qty is the sum of the sizes. With no sizes entered, typing here makes it a one-size item (hats, koozies). */}
                    <input type="number" min="0" step="1" inputMode="numeric" tabIndex={l.oneSize ? 0 : -1} className={"pre qty" + (sized ? " locked" : "")} readOnly={sized}
                      title={sized ? "Total of the sizes below. Clear the sizes to type a single qty." : "Click to enter a qty for a one-size item (hats, koozies, bags)"}
                      value={sized ? lc?.qty ?? 0 : l.sizes?.OS || ""} placeholder="0"
                      onChange={(e) => { if (sized) return; update((x) => { const r = x.lines[li]; const v = Math.max(0, Math.floor(+e.target.value || 0)); const osOnly = r.sizeRun?.length === 1 && r.sizeRun[0] === ONE_SIZE; r.oneSize = osOnly || v > 0; r.sizes = v ? { [ONE_SIZE]: v } : {}; }); }} />
                  </div>
                  <div className="a-ea r"><input type="number" step="0.01" min="0" tabIndex={-1} title="Click to override" aria-label="Price each" className={"pre" + (lc?.hasOv ? " ov" : "")} placeholder={lc ? lc.calcEach.toFixed(2) : ""} value={l.priceOverride ?? ""} onChange={(e) => update((x) => { x.lines[li].priceOverride = e.target.value === "" ? null : +e.target.value; })} /></div>
                  <div className="a-to r num"><b>{money(lc?.sub)}</b></div>
                  <div className="a-x">{g.lines.length > 1 && <button className="btn icon ghost" type="button" tabIndex={-1} aria-label="Remove garment" onClick={() => update((x) => { x.lines.splice(li, 1); })}>✕</button>}</div>
                </div>
                {l.oneSize ? (
                  <div className="os-note">{l.sizeRun?.length === 1 ? "One size. Enter the quantity in Qty." : "One-size item. Clear the Qty to switch back to sizes."}</div>
                ) : (
                  <div className="szrow">
                    {(colsFor(l) as (keyof GLine["sizes"])[]).map((s, si, arr) => {
                      const up = !gc.wholesale && l.sizeUp && l.sizeUp[s] !== undefined ? l.sizeUp[s] : prices.upcharges[s as keyof typeof prices.upcharges];
                      return (
                        <label key={s} className={"szc" + (s === "YXL" && si < arr.length - 1 ? " ysep" : "")}>
                          <span>{s}</span>
                          <input type="number" min="0" step="1" inputMode="numeric" className={"sz" + (l.sizes?.[s] ? " has" : "")} value={l.sizes?.[s] || ""} onChange={(e) => setQty(s, e.target.value)} />
                          <small className="upc">{up ? `+${up}` : "\u00a0"}</small>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="row">
          <button className="btn sm" type="button" onClick={() => update((x) => { x.lines.push(newGLine()); })}>+ Add garment</button>
          <button className="btn sm ghost" type="button" onClick={() => update((x) => { const last = x.lines[x.lines.length - 1]; x.lines.push({ ...last, id: uid(), color: "", sizes: {}, priceOverride: null }); })}>+ Same style, new color</button>
        </div>
        <div className={"gl-row grp-total" + (gc.wholesale ? " ws" : "")}>
          <span className="a-de r"><span className="lbl2">Total pieces</span></span>
          <b className="a-qt c num">{gc.qty}</b>
          <b className="a-to r num">{money(gc.sub)}</b>
        </div>

        <div className="imprints">
          <div className="imp-top">
            <div className="lbl">IMPRINTS</div>
            {onMockup && <button className={"btn sm" + (locked ? " primary" : "")} type="button" onClick={startMockup} title={mockupBlock || undefined}>{g.mockupAt ? "Edit mockup" : "Create mockup"}</button>}
            {blockMsg && mockupBlock && <span className="ink-warn" style={{ margin: 0 }}>{blockMsg}</span>}
            {g.mockupAt && <span className="faint" style={{ fontSize: 12 }}>Mockup saved {new Date(g.mockupAt).toLocaleDateString()}</span>}
            {(g.mockupThumbs || []).map((p) => thumbUrls?.[p] ? <a key={p} href={thumbUrls[p]} target="_blank" rel="noreferrer" className="mk-thumb" title="Open the mockup"><img src={thumbUrls[p]} alt="Mockup" /></a> : null)}
            {!g.mockupAt && g.mockupSkipped && <span className="faint" style={{ fontSize: 12 }}>No mockup</span>}
          </div>
          {locked && askSkip && (
            <div className="confirm-bar">
              <span>You haven&apos;t created a mockup for this group yet. Are you sure you want to fill in the imprints without one?</span>
              <button className="btn sm primary" type="button" onClick={startMockup}>Create mockup</button>
              <button className="btn sm" type="button" onClick={() => { setAskSkip(false); update((x) => { x.mockupSkipped = true; }); }}>Continue without a mockup</button>
              <button className="btn sm ghost" type="button" onClick={() => setAskSkip(false)}>Cancel</button>
            </div>
          )}
          <div className={"mk-lock" + (locked ? " on" : "")}>
          {locked && <button type="button" className="mk-cover" aria-label="Imprints are locked until a mockup is created" onClick={() => setAskSkip(true)}><span>Create a mockup first — or click here to fill this in without one</span></button>}
          <div inert={locked || undefined} className="mk-body">
          <div>
            <table className="pv-grid imp-table">
              <colgroup><col style={{ width: "13%" }} /><col style={{ width: "14%" }} /><col style={{ width: 56 }} /><col style={{ width: "19%" }} /><col style={{ width: "14%" }} /><col style={{ width: "10%" }} /><col /><col style={{ width: 58 }} /><col style={{ width: 30 }} /></colgroup>
              <thead><tr><th>Method</th><th>Location</th><th>Colors</th><th>Ink or thread / PMS</th><th>Print size</th><th>Drop</th><th>Notes</th><th className="r">Each</th><th /></tr></thead>
              <tbody>
                {g.imprints.map((d, di) => (
                  <Fragment key={d.id}>
                  <tr className="imp-main">
                    <td><select aria-label="Method" value={d.method} onChange={(e) => update((x) => { x.imprints[di].method = e.target.value as Method; })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                    <td>{LOCATIONS.includes(d.location)
                      ? <select aria-label="Location" value={d.location} onChange={(e) => update((x) => { x.imprints[di].location = e.target.value === "__custom" ? "" : e.target.value; })}>{LOCATIONS.map((z) => <option key={z} value={z}>{z}</option>)}<option value="__custom">Custom…</option></select>
                      : <div className="loc-custom"><input type="text" autoFocus={!d.location} aria-label="Custom location" placeholder="Custom location" value={d.location} onChange={(e) => update((x) => { x.imprints[di].location = e.target.value; })} /><button type="button" className="btn icon ghost" tabIndex={-1} title="Back to the location list" aria-label="Back to the location list" onClick={() => update((x) => { x.imprints[di].location = "Full Front"; })}>▾</button></div>}</td>
                    <td>{d.method === "screen" || d.method === "embroidery"
                      ? <select aria-label="Number of colors" value={d.method === "embroidery" ? Math.min(d.colors, 15) : d.colors} onChange={(e) => update((x) => { x.imprints[di].colors = +e.target.value; })}>{(d.method === "embroidery" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map((n) => <option key={n} value={n}>{n}</option>)}{d.method === "screen" && <option value={FULL_COLOR}>Full color</option>}</select>
                      : <span className="faint" style={{ fontSize: 12 }}>Full color</span>}</td>
                    <td>
                      <div className="ink-combo">
                        <InkField list={d.method === "embroidery" ? THREAD_COLORS : INK_COLORS} placeholder={d.method === "embroidery" ? "Type a thread color" : "Type a color or PMS"} value={d.inks} bad={!!inkMismatch(d)} title={inkMismatch(d) || ""} onChange={(v) => update((x) => { x.imprints[di].inks = v; })} />
                        <select aria-label={d.method === "embroidery" ? "Add a thread color" : "Add a Wilflex RFU ink"} tabIndex={-1} value="" onChange={(e) => { const v = e.target.value; if (v) update((x) => { const cur = x.imprints[di].inks.trim().replace(/,\s*$/, ""); x.imprints[di].inks = cur ? `${cur}, ${v}` : v; }); }}>
                          <option value="" hidden>▾</option>
                          {(d.method === "embroidery" ? THREAD_COLORS : INK_COLORS).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      {inkMismatch(d) && <div className="ink-warn">{inkMismatch(d)}</div>}
                    </td>
                    <td><SizeField value={d.size} onChange={(v) => update((x) => { x.imprints[di].size = v; })} /></td>
                    <td>
                      <label className="sz-dim">
                        <InchInput label="Drop in inches (blank = standard)" placeholder="Standard" num={d.drop || ""} onNum={(v) => update((x) => { x.imprints[di].drop = v; })} />
                      </label>
                    </td>
                    <td><input type="text" aria-label="Imprint notes" placeholder='3" below collar' value={d.notes} onChange={(e) => update((x) => { x.imprints[di].notes = e.target.value; })} /></td>
                    <td className="r num">{money(gc.imprints[di]?.each)}</td>
                    <td><button className="btn icon ghost" type="button" aria-label="Remove imprint" onClick={() => update((x) => { x.imprints.splice(di, 1); })}>✕</button></td>
                  </tr>
                  <tr className="imp-design">
                    <td colSpan={9}>
                      <DesignPick imprint={d} designs={designs || []} urls={designUrls || {}} canUpload={!!onUploadDesign} onStar={onStarDesign}
                        onPick={(des) => update((x) => {
                          const im = x.imprints[di];
                          im.design_id = des?.id || undefined;
                          // bring the design's ink info along when the imprint doesn't have any yet
                          if (des && !im.inks.trim() && des.inks) im.inks = des.inks;
                          if (des && (im.method === "screen" || im.method === "embroidery") && des.colors && !im.inks.trim()) im.colors = des.colors;
                        })}
                        onUpload={async (f, name) => { if (!onUploadDesign) return; const des = await onUploadDesign(f, name); if (des) update((x) => { x.imprints[di].design_id = des.id; }); }} />
                      {(() => {
                        // a small print on a big location (3.5" on the Full Front) is usually a left chest
                        const m = (d.size || "").match(/^([\d.]+)/); if (!m) return null;
                        const des = (designs || []).find((z) => z.id === d.design_id);
                        const r = des?.width_px && des?.height_px ? des.height_px / des.width_px : 0;
                        const tall = /tall/i.test(d.size), v = +m[1];
                        const w = tall ? (r ? v / r : 0) : v, h = tall ? v : r ? v * r : 0;
                        const sug = d.keepLocation ? [] : smallerSpot(d.location, w || h, h);
                        if (!sug.length) return null;
                        return (
                          <div className="ink-warn row" style={{ gap: 6, marginTop: 4 }}>
                            <span>{v}&quot; is small for the {d.location}. Should this be {sug.join(" or ")}?</span>
                            {sug.map((z) => <button key={z} type="button" className="btn sm" onClick={() => update((x) => { x.imprints[di].location = z; })}>{z}</button>)}
                            <button type="button" className="btn sm ghost" onClick={() => update((x) => { x.imprints[di].keepLocation = true; })}>Keep {d.location}</button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn sm" type="button" onClick={() => update((x) => { const used = x.imprints.map((d) => d.location); x.imprints.push(newImprint(["Full Back", ...LOCATIONS].find((z) => !used.includes(z)) || "Full Front")); })}>+ Add imprint</button>
          </div>
          </div>
        </div>

        <div className="grp-foot">
          <div className={"grp-foot-l mk-lock" + (locked ? " on" : "")}>
            {locked && <button type="button" className="mk-cover" tabIndex={-1} aria-label="Finishing is locked until a mockup is created" onClick={() => setAskSkip(true)} />}
            <div inert={locked || undefined} className="mk-body">
            {settings.finishing.length > 0 && (
        <div className="imprints">
                <div className="lbl" style={{ marginBottom: 6 }}>FINISHING</div>
                <div className="row" style={{ gap: 14 }}>
                  {settings.finishing.map((f) => (
                    <label key={f.id} className="check" style={{ fontSize: 13 }}>
                      <input type="checkbox" checked={(g.finishing || []).includes(f.id)} onChange={(e) => update((x) => { const set = new Set(x.finishing || []); if (e.target.checked) set.add(f.id); else set.delete(f.id); x.finishing = [...set]; })} />
                      {f.name} <span className="faint">({money(f.price)}/pc)</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            </div>
          </div>
          <div className="price-box">
            {(() => {
              // Split the group's line items into garments / imprints / finishing (overrides land in garments)
              const imp = gc.lines.reduce((a, lc) => a + lc.qty * lc.printEach, 0);
              const fin = gc.qty * gc.finishEach;
              const gar = gc.sub - imp - fin;
              return (
                <>
                  <div className="pb-r"><span>Garments</span><b>{money(gar)}</b></div>
                  <div className="pb-r"><span>Imprints</span><b>{money(imp)}</b></div>
                  {fin ? <div className="pb-r"><span>Finishing</span><b>{money(fin)}</b></div> : null}
                  {gc.setup ? <div className="pb-r"><span>Setup{gc.inkFees ? " (incl. ink changes)" : ""}</span><b>{money(gc.setup)}</b></div> : null}
                  {gc.materials ? <div className="pb-r"><span>2XL+ Materials Charge</span><b>{money(gc.materials)}</b></div> : null}
                </>
              );
            })()}
            <div className="pb-r pb-t"><span>Group total</span><b>{money(gc.sub + gc.setup + gc.materials)}</b></div>
          </div>
        </div>
      </div>
    </section>
  );
}


/** Ink colors box: grows downward as it fills, and completes Wilflex RFU names.
 *  Type part of a color ("nav") then Space or Enter to fill it in ("Navy, "). */
export function InkField({ value, bad, title, onChange, list = INK_COLORS, placeholder = "Type a color or PMS" }: { value: string; bad: boolean; title: string; onChange: (v: string) => void; list?: readonly string[]; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }, [value]);
  const cut = value.lastIndexOf(",");
  const head = cut >= 0 ? value.slice(0, cut + 1) : "";
  const part = (cut >= 0 ? value.slice(cut + 1) : value).trim();
  const matches = part ? list.filter((c) => c.toLowerCase().startsWith(part.toLowerCase())).sort((x, y) => x.length - y.length) : [];
  const exact = matches.find((c) => c.toLowerCase() === part.toLowerCase());
  const best = exact || matches[0];
  const fill = (c: string) => onChange(`${head}${head ? " " : ""}${c}, `.replace(/^\s+/, ""));
  return (
    <div className="ink-field">
      <textarea ref={ref} rows={1} aria-label="Ink colors" className={bad ? "bad" : ""} title={title} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (best) fill(best);
          } else if (e.key === " " && matches.length === 1 && !exact) {
            e.preventDefault();
            fill(matches[0]);
          }
        }} />
      {best && best.toLowerCase() !== part.toLowerCase() && <div className="ink-hint">{matches.length === 1 ? "Space or Enter" : "Enter"} → {best}</div>}
    </div>
  );
}

/** Print size: fill width OR height (inches). Once one has a number the other box hides.
 *  Stored on the imprint as text, e.g. 11" wide or 4" tall. */
export function SizeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = (value || "").trim();
  const m = v.match(/^(.*?)\s*\b(w|wide|width|h|high|tall|height)$/i);
  const num = (m ? m[1] : v).replace(/["]/g, "").replace(/\s*(in\.?|inch(es)?)$/i, "").trim();
  const dim: "W" | "H" | "" = !v ? "" : m && /^(h|tall)/i.test(m[2]) ? "H" : "W";
  const set = (d: "W" | "H", raw: string) => {
    const t = raw.replace(/["]/g, "").trim();
    const isMax = /^m(a(x)?)?$/i.test(t);
    onChange(t ? `${isMax ? t.toUpperCase() : `${t}"`} ${d === "W" ? "wide" : "tall"}` : "");
  };
  const box = (d: "W" | "H") => (
    <label className={"sz-dim" + (dim === d ? " on" : "")} key={d}>
      <InchInput label={d === "W" ? "Print width in inches" : "Print height in inches"} placeholder={d === "W" ? "Width" : "Height"} num={dim === d ? num : ""} onNum={(v) => set(d, v)} />
      <span>{dim === d ? (d === "W" ? "wide" : "tall") : d}</span>
    </label>
  );
  return <div className="sz-field">{[dim !== "H" ? box("W") : null, dim !== "W" ? box("H") : null]}</div>;
}

/** Number box that shows inches as 11" (the quote follows the number). */
function InchInput({ num, onNum, label, placeholder }: { num: string; onNum: (v: string) => void; label: string; placeholder: string }) {
  const numeric = /^[\d.\/ -]+$/.test(num);
  const shown = num ? (numeric ? `${num}"` : num.toUpperCase()) : "";
  return (
    <input type="text" inputMode="decimal" aria-label={label} placeholder={placeholder} value={shown}
      onChange={(e) => {
        let raw = e.target.value;
        // backspacing over the " removes the last digit instead
        if (numeric && shown && !raw.includes('"') && raw === num) raw = raw.slice(0, -1);
        onNum(raw.replace(/["]/g, "").replace(/\s*(in\.?|inch(es)?)$/i, "").trim());
      }} />
  );
}

type SSHit = { styleID: number; brand: string; style: string; title: string; image: string };
/** Style # box: type a number and pick from your catalog or from every matching S&S style. */
function StylePicker({ value, catalog, busy, onType, onPick, onPickSS }: {
  value: string; catalog: Garment[]; busy: boolean;
  onType: (v: string) => void; onPick: (g: Garment) => void; onPickSS: (h: SSHit) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SSHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  useEffect(() => {
    if (!open || q.length < 2) { setHits([]); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ss/search?q=${encodeURIComponent(q)}`);
        const j = await r.json().catch(() => ({}));
        if (live) setHits(Array.isArray(j.results) ? j.results : []);
      } finally { if (live) setLoading(false); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);
  const stripped = q.replace(/^[a-z]{1,2}(?=\d)/, "");
  const rank = (b: string) => { const i = ["gildan", "next level", "bella", "hanes"].findIndex((x) => (b || "").toLowerCase().startsWith(x)); return i < 0 ? 4 : i; };
  const local = q ? catalog.filter((c) => [c.style, `${c.brand} ${c.style}`].some((x) => { const v = x.toLowerCase(); return v.startsWith(q) || v.startsWith(stripped) || v.includes(" " + stripped); })).sort((a, b) => rank(a.brand) - rank(b.brand) || a.style.localeCompare(b.style)).slice(0, 8) : [];
  const items: ({ kind: "cat"; g: Garment } | { kind: "ss"; h: SSHit })[] = [
    ...local.map((g) => ({ kind: "cat" as const, g })),
    ...hits.filter((h) => !catalog.some((c) => c.ss_style_id === h.styleID)).map((h) => ({ kind: "ss" as const, h })),
  ];
  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    setOpen(false);
    if (it.kind === "cat") onPick(it.g); else onPickSS(it.h);
  };
  return (
    <div className="style-pick">
      <input type="text" aria-label="Style number" placeholder="Style #" value={value} autoComplete="off"
        onChange={(e) => { onType(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); choose(active); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && q.length >= 2 && (items.length || loading) ? (
        <div className="style-menu" role="listbox">
          {items.map((it, i) => (
            <div key={it.kind === "cat" ? "c" + it.g.id : "s" + it.h.styleID} role="option" aria-selected={i === active}
              className={"sm-item" + (i === active ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); choose(i); }} onMouseEnter={() => setActive(i)}>
              <b>{it.kind === "cat" ? `${it.g.brand} ${it.g.style}` : `${it.h.brand} ${it.h.style}`}</b>
              <span>{it.kind === "cat" ? it.g.description : it.h.title}</span>
              {it.kind === "ss" && <em>S&amp;S</em>}
            </div>
          ))}
          {loading && <div className="sm-note">Searching S&amp;S…</div>}
          {busy && <div className="sm-note">Pulling from S&amp;S…</div>}
        </div>
      ) : null}
    </div>
  );
}

/** Color box: click shows the style's full color list (even when a color is already chosen); typing filters it. */
function ColorPicker({ value, colors, onChange }: { value: string; colors: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  const list = typed && q ? colors.filter((c) => c.toLowerCase().includes(q)).sort((a, b) => +!a.toLowerCase().startsWith(q) - +!b.toLowerCase().startsWith(q)) : colors;
  const pick = (c: string) => { onChange(c); setOpen(false); setTyped(false); };
  return (
    <div className="style-pick">
      <input type="text" aria-label="Color" placeholder="Color" value={value} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setTyped(true); setOpen(true); setActive(0); }}
        onFocus={() => { setTyped(false); setOpen(true); setActive(Math.max(0, colors.indexOf(value))); }}
        onClick={() => { if (!open) { setTyped(false); setOpen(true); } }}
        onBlur={() => setTimeout(() => { setOpen(false); setTyped(false); }, 150)}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(list[active]); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && list.length > 0 && (
        <div className="style-menu color-menu" role="listbox">
          {list.map((c, i) => (
            <div key={c} role="option" aria-selected={c === value} ref={i === active ? (el) => { el?.scrollIntoView({ block: "nearest" }); } : undefined} className={"sm-item" + (i === active ? " on" : "") + (c === value ? " cur" : "")}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActive(i)}>
              <b>{c}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Under each imprint: which customer design prints here, with its size worked out from the print size. */
function DesignPick({ imprint, designs, urls, canUpload, onPick, onUpload, onStar }: {
  imprint: { design_id?: string; size: string }; designs: Design[]; urls: Record<string, string>; canUpload: boolean;
  onStar?: (d: Design, starred: boolean) => void;
  onPick: (d: Design | null) => void; onUpload: (f: File, name: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const cur = designs.find((x) => x.id === imprint.design_id);
  const m = (imprint.size || "").match(/^([\d.]+)\D*(wide|tall)?/i);
  const val = m ? +m[1] : 0;
  const given: "W" | "H" = m && /tall/i.test(m[2] || "") ? "H" : "W";
  const other = cur && val ? designOther(cur, val, given) : 0;
  return (
    <div className="dp">
      <span className="dp-l">Design</span>
      <DesignSearch designs={designs} urls={urls} value={imprint.design_id} onPick={onPick} onStar={onStar} placeholder="Choose the customer's design…" />
      {canUpload && (
        <label className="btn sm ghost" style={{ cursor: "pointer" }}>{busy ? "Uploading…" : "Upload new art"}
          <input type="file" hidden accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.eps,.psd" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setBusy(true); try { await onUpload(f, f.name.replace(/\.[^.]+$/, "")); } finally { setBusy(false); } }} />
        </label>
      )}
      {cur && val > 0 && other > 0 && <span className="dp-size">{val}&quot; {given === "W" ? "wide" : "tall"} → <b>{other}&quot; {given === "W" ? "tall" : "wide"}</b></span>}
      {cur && !cur.width_px && <span className="faint" style={{ fontSize: 12 }}>Add a preview image to this design to get its size</span>}
    </div>
  );
}
