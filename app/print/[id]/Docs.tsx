import { threadByName, threads as threadsAll } from "@/lib/embroidery";
import { sheetThreadName } from "@/lib/worksheet";
import { colorHex, WILFLEX_HEX } from "@/lib/inkColors";
import { calcOrder, changeWord, shopNotes, printHow, termsText, inkNames, isLightColor, isPmsInk, lineQty, needsUnderbase, sizeLabel, FULL_COLOR, METHODS, SIZES, type Customer, type Design, type Group, type Imprint, type Order, type Payment, type Settings } from "@/lib/pricing";
import { money, parseDate } from "@/lib/format";
import { qrSvg } from "@/lib/qr";
import { jobLink } from "@/lib/zpl";
import { guessHex, spotFor } from "@/lib/mockup";
import { printSize } from "@/lib/groupLook";
import { fmtPhone } from "@/lib/phone";
import PaintedArt from "./PaintedArt";
import WoFit from "./WoFit";
import { isRelabel, setFor, type NeckLabelSet } from "@/lib/neckLabels";
import type { ReactNode } from "react";
import DstPicture from "@/components/DstPicture";
/** what a customer reads for a visual-only print (Oct 20, Nick: "the customer would only see the mockup, a dumb mockup") */
const MATCH_PREV = "Printed to match your previous order";

/**
 * The invoice / quote PDF and the work order (Oct 15, Nick: "completely reimagine both. The work order will be the
 * physical paper that follows the job around: all the art large and easy to read counts"). Approved from examples:
 * work order = the job page (big mockup, prints, counts with "Counted in / By" and "Final count / By") then one page
 * per print up close (the art at 75% on the shirt color with its measurements, press fill-ins, inks); no sign-offs.
 */
export type DocData = {
  o: Order; cust: Partial<Customer>; groups: Group[]; c: ReturnType<typeof calcOrder>; settings: Settings; pays: Payment[];
  designs: Record<string, Design>; designUrls: Record<string, string>;
  /** vector art (EPS / PDF / AI / SVG): a signed link to the original file, drawn at full resolution in the saved PDF */ designFiles?: Record<string, string>;
  /** per group: signed mockup pictures (photos only), the first is the big one */ mockups: string[][];
  /** per group: the shirt color behind the art */ hexes: string[];
  /** each garment color's shirt color (lower-case letters and digits → hex) */ colorHexes?: Record<string, string>;
  /** per group, per print: the largest it can print (inches) and on which size */ maxes: ({ w: number; h: number; on: string } | null)[][];
  printavo: boolean;
};

const DELIVERY: Record<string, string> = { pickup: "Pickup", ship: "Ship", deliver: "Delivery" };
const day = (s: string | null | undefined, f: Intl.DateTimeFormatOptions) => { const d = parseDate(s); return d ? d.toLocaleDateString("en-US", f).replace(",", "") : ""; };

const colorsLabel = (d: Imprint) => (d.method === "dtf" || d.colors >= FULL_COLOR ? "Full color" : `${d.colors || 1} color${d.colors === 1 || !d.colors ? "" : "s"}`);
const dropLabel = (d: Imprint) => (d.drop ? `${d.drop}" drop` : "Standard drop");
const inkLine = (n: string) => (WILFLEX_HEX[n] ? "Wilflex Epic Rio RFU" : isPmsInk(n) ? "PMS match" : "");
const isDark = (hex: string) => {
  const h = hex.replace("#", ""); if (h.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 120;
};
/** the screens it really takes on press: set by hand, else its colors plus an underbase on dark garments */
function screensOf(d: Imprint, allLight: boolean) {
  if (d.method !== "screen") return null;
  if (d.colors >= FULL_COLOR) return { n: d.screens && d.screens > 0 ? d.screens : 0, under: !allLight };
  const under = !allLight && needsUnderbase(d);
  return { n: d.screens && d.screens > 0 ? d.screens : Math.max(1, d.colors || 1) + (under ? 1 : 0), under };
}
const Swatch = ({ c }: { c: string }) => <span className="sw" style={{ background: c }} />;

/**
 * The art in its measured box. A logo with empty margins (art_box: where the art really sits in the file) is cropped to
 * them, so the drawn width × height lines meet the art's edges (Oct 20: the back art sat small inside its 11" × 14.67").
 */
/** the garment colors (other than the first) a print changes ink on, with the swap for each (Imprint.inkBy, Oct 26) */
const ckey = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export type Variant = { color: string; swap: Record<string, string> };
function variantsOf(d: Imprint, colors: string[]): Variant[] {
  if (d.visualOnly) return [];
  return colors.slice(1).map((color) => {
    const m = Object.entries(d.inkBy || {}).find(([k]) => ckey(k) === ckey(color))?.[1] || {};
    const swap: Record<string, string> = {};
    for (const [a, b] of Object.entries(m)) if (b && b.trim().toLowerCase() !== a.trim().toLowerCase()) swap[a.trim().toLowerCase()] = b.trim();
    return { color, swap };
  }).filter((v) => Object.keys(v.swap).length);
}
const swapInk = (k: string, sw?: Record<string, string> | null) => (sw && sw[k.trim().toLowerCase()]) || k;

/** each color stop's thread (the worksheet's, else the print's threads in turn), for drawing its DST */
function dstColorsOf(d: Imprint): string[] {
  const ws = d.emb?.file?.ws;
  const byCode = (code: string, chart: string) => threadsAll().find((x) => x.code === code && (/classic|rayon/i.test(chart) ? x.line === "Classic Rayon 40" : /isacord/i.test(chart) ? x.line === "Isacord 40" : x.line === "Polyneon 40"))?.hex;
  if (ws?.sequence?.length) return ws.sequence.map((x) => byCode(x.code, x.chart) || "#333333");
  return inkNames(d.inks || "").map((n) => threadByName(n)?.hex || colorHex(n) || "#333333");
}
function ArtPic({ d, des, pic, style, hires, swap }: { d: Imprint; des: Design | null; pic: string; style: { top: string; width: string; height: string }; hires?: string; swap?: Record<string, string> | null }) {
  const b = des?.art_box;
  const alt = des ? `D-${des.number}` : "";
  // the painted picture comes back already cut to the art; the file's art box only cuts it until then (Oct 26)
  const crop = b && b.w && b.h && b.of?.w && b.of?.h && !(b.w >= b.of.w * 0.98 && b.h >= b.of.h * 0.98) ? { x: b.x, y: b.y, w: b.w, h: b.h, of: { w: b.of.w, h: b.of.h } } : null;
  return <PaintedArt className="pic" src={pic} imp={d} inkMap={d.inkMap} designId={d.design_id} alt={alt} style={style} hires={hires} hiresName={des?.file_name} crop={crop} swap={swap} />;
}

/**
 * The work order's neck label line (Private Label): which set, its content, ink and width, and how many of each size's
 * label to print (Oct 20, Nick: "each size gets its own neck label").
 */
function neckLine(cust: Partial<Customer>, g: Group, fins: { id: string; name: string }[]): string {
  if (!fins.some(isRelabel)) return "";
  const ns = setFor((cust as { neck_labels?: NeckLabelSet[] }).neck_labels, g.neckLabel);
  const n: Record<string, number> = {};
  for (const l of g.lines) for (const [z, q] of Object.entries(l.sizes || {})) if (+(q as number) > 0) n[z] = (n[z] || 0) + +(q as number);
  const counts = SIZES.filter((z) => n[z]).map((z) => `${z} ${n[z]}`).join(" · ");
  if (!ns) return `NECK LABELS: cut the maker's tag out and print their label. No label set picked: check the customer's Brand standards → Neck labels. ${counts}`;
  const missing = ns.mode === "per_size" ? SIZES.filter((z) => n[z] && !ns.files?.[z]) : ns.template ? [] : ["the design"];
  return [`NECK LABELS: cut the maker's tag out, print "${ns.name || "neck label"}"${ns.content ? ` (${ns.content})` : ""}${ns.ink ? ` in ${ns.ink}` : ""}${ns.widthIn ? `, ${ns.widthIn}" wide` : ""}.`,
    `Print: ${counts}`, missing.length ? `No art on file for: ${missing.join(", ")}` : "", ns.note || ""].filter(Boolean).join(" ");
}

// ───────────────────────────── work order ─────────────────────────────
export function WorkOrderDoc(p: DocData & { notes: string; shopNotes: { tag: string; body: string; by_name: string; created_at: string }[]; printed: string }) {
  const { o, cust, groups, c } = p;
  // each group's pages (Oct 26, Nick: "the mock-ups aren't nearly big enough, and the little print cubes are too big… the
  // first page… small versions… then a larger mock-up and its printing underneath"; "make it fill the space… variable";
  // "4 items… is probably the max… more than that, create a second page"):
  //   1. the job: header, the mockups filling whatever room is left, the prints as a strip, up to 4 garments' counts, notes
  //   2. more garments' counts (8 a page) when there are over 4
  //   3. each mockup big, with its prints blown up under it (the full notes on the first when they're long)
  //   4. each print's press sheet
  const plans = groups.map((g, gi) => {
    const lines = g.lines.filter((l) => lineQty(l) > 0 || g.lines.length === 1);
    const first = gi === 0;
    const gc = c.groups[gi];
    const noteParts = [
      first && p.notes ? p.notes : "",
      gc?.finishing.length ? `Finishing: ${gc.finishing.map((f) => f.name).join(", ")}` : "",
      neckLine(cust, g, gc?.finishing || []),
      first && o.delivery_method !== "pickup" && o.ship_to ? `${o.delivery_method === "ship" ? "Ship to" : "Deliver to"}: ${o.ship_to}${o.ship_method ? ` (${o.ship_method})` : ""}` : "",
    ].filter(Boolean);
    const extra = first ? p.shopNotes.length + (p.cust.brand_print?.rules || []).length : 0;
    const noteText = noteParts.join("\n\n");
    const longNotes = noteText.length + extra * 120 > 380 || noteText.split("\n").length + extra > 6;
    const more: (typeof lines)[] = [];
    for (let i = 4; i < lines.length; i += 8) more.push(lines.slice(i, i + 8));
    // only the customer's own transfers (Oct 27, Nick: "you need really just two, a count in and then… the mock-up large,
    // for placement"): one placement page, no press sheets
    const allSup = g.imprints.length > 0 && g.imprints.every((d) => d.supplied);
    const mk = (p.mockups[gi] || []).slice(0, allSup ? 1 : 8);
    // notes too long to sit under the mockup get their own page (Oct 27, Nick: "they're flowing over… going everywhere")
    const veryLong = noteText.length + extra * 120 > 650 || noteText.split("\n").length + extra > 9;
    const notesPage = longNotes && (!mk.length || veryLong);
    const colorList = [...new Set(lines.map((l) => l.color).filter(Boolean))] as string[];
    const vars = g.imprints.map((d) => variantsOf(d, colorList));
    // one press sheet per print: a color change is noted on it, not a second set of pages (Oct 26, Nick: "if the art
    // doesn't change, you just need one close-up")
    const printPages = allSup ? 0 : g.imprints.length;
    return { lines, noteParts, longNotes, more, mk, notesPage, vars, allSup, n: 1 + more.length + mk.length + (notesPage ? 1 : 0) + printPages };
  });
  const total = plans.reduce((a, x) => a + x.n, 0);
  const starts: number[] = [];
  plans.reduce((a, x, i) => { starts[i] = a; return a + x.n; }, 1);
  const who = [cust.company, cust.name && cust.name !== cust.company ? cust.name : "", o.po_number ? `PO ${o.po_number}` : ""].filter(Boolean) as string[];
  const footL = `#${o.number} ${o.nickname}${cust.company || cust.name ? ` · ${cust.company || cust.name}` : ""}`;
  const due = day(o.due_date, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  const dueSub = [o.production_date ? `Print ${day(o.production_date, { weekday: "short", month: "short", day: "numeric" })}` : "", DELIVERY[o.delivery_method] || "Pickup"].filter(Boolean).join(" · ");
  const qr = qrSvg(jobLink(o.number), 2).svg;
  return (
    <>
      <WoFit />
      {groups.map((g, gi) => {
        const gc = c.groups[gi];
        const { lines, noteParts, longNotes, more, mk, notesPage, vars, allSup } = plans[gi];
        const allLight = !g.lines.some((l) => lineQty(l) > 0 && !isLightColor(l.color, p.settings.wholesale));
        const sizes = SIZES.filter((z) => lines.some((l) => l.sizes?.[z]));
        const colorList = [...new Set(lines.map((l) => l.color).filter(Boolean))] as string[];
        const colors = colorList.join(", ");
        const hex = p.hexes[gi] || "#9aa1ab";
        const first = gi === 0;
        // a mockup's garment color: one mockup per color, in the order of the lines
        const mkColor = (i: number) => (mk.length === colorList.length ? colorList[i] : "");
        const mkHex = (i: number) => (mkColor(i) && colorHex(mkColor(i))) || hex;
        // customer supplied transfers: the mockup is their placement reference
        const sup = g.imprints.find((d) => d.supplied)?.supplied || null;
        const pg = starts[gi];
        const pgMore = pg + 1, pgMk = pgMore + more.length, pgNotes = pgMk + mk.length, pgPrint = pgNotes + (notesPage ? 1 : 0);
        // each print's press sheet, then one more for each color change
        const printPg: number[] = [];
        g.imprints.reduce((a, _d, di) => { printPg[di] = a; return a + 1; }, pgPrint);
        // their transfers: the print box points at the placement page
        if (allSup) g.imprints.forEach((_d, di) => { printPg[di] = mk.length ? pgMk : pg; });
        const where = g.imprints.map((d) => d.supplied?.where || "").find(Boolean) || "";
        const notesBlock = (
          <>
            {noteParts.join("\n\n")}
            {first && (p.cust.brand_print?.rules || []).length > 0 && <div className="sn"><b>BRAND RULES: </b>{p.cust.brand_print!.rules!.join(" · ")}</div>}
            {first && p.shopNotes.map((n, i) => <div className="sn" key={i}>{n.tag ? <b>{n.tag.toUpperCase()}: </b> : null}{n.body} <small>({n.by_name}, {new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })})</small></div>)}
          </>
        );
        const top = (sub: string) => <div className="p2h"><div className="t disp">{o.nickname} · #{o.number}</div><div className="r">{sub}</div></div>;
        const countTable = (ls: typeof lines) => (
          <table className={"cnt" + (ls.length > 2 ? " tight" : "")}>
            <thead><tr><th>Garment</th>{sizes.map((z) => <th key={z} className="sz">{sizeLabel(z)}</th>)}<th className="sz" style={{ width: ".85in" }}>Total</th></tr></thead>
            <tbody>{ls.map((l) => <LineRows key={l.id} l={l} sizes={sizes} hex={p.hexes[gi]} single={lines.length === 1} colorHexes={p.colorHexes} />)}</tbody>
          </table>
        );
        return (
          <div key={g.id}>
            {/* 1. the job */}
            <section className="sheet wo1 wo-first">
              <div className="hd">
                <div>
                  <div className="lbl">Work order · #{o.number}{groups.length > 1 ? ` · group ${gi + 1} of ${groups.length}` : ""}</div>
                  <h1 className="disp">{o.nickname || "Untitled job"}</h1>
                  {who.length > 0 && <div className="who"><b>{who[0]}</b>{who.slice(1).map((x) => ` · ${x}`).join("")}</div>}
                  <div className="flags">
                    {o.rush && <span className="flag rush">RUSH</span>}
                    {groups.length > 1 && <span className="flag grp">{(g.name || `Group ${gi + 1}`).toUpperCase()}</span>}
                    {gc?.wholesale && <span className="flag cs">CUSTOMER SUPPLIED GOODS</span>}
                    {g.imprints.some((d) => d.supplied) && <span className="flag cs">CUSTOMER SUPPLIED TRANSFERS</span>}
                    {p.printavo && <span className="flag pv">RUN FROM PRINTAVO</span>}
                  </div>
                  {g.description?.trim() && <div className="gdesc wo">{g.description.trim()}</div>}
                </div>
                <div className="due"><div className="lbl">In hands</div><div className="d disp">{due || "NOT SET"}</div>{dueSub && <small>{dueSub}</small>}</div>
                <div className="codes"><div className="qr" dangerouslySetInnerHTML={{ __html: qr }} /><small>Scan: setup, notes, photos, time</small></div>
              </div>
              <div className="fade" style={{ margin: "10px 0 0" }} />
              {/* the mockups take whatever room the rest leaves (never under ~2.6"); up to 4 here, all of them big on their own pages */}
              <div className={"wo-mks n" + Math.min(4, Math.max(1, mk.length))}>
                {mk.length ? mk.slice(0, 4).map((u, i) => (
                  <div className="wo-m" key={u}>
                    <img src={u} alt="Mockup" />
                    {/* the style number with the color (Oct 27, Nick: "so that they can sync it in case they don't speak English") */}
                    {sup && !(g.mockupThumbs || []).length ? <span>{where ? <b className="wo-st">{where}</b> : null}Placement reference · big on page {pgMk + i}</span> : <span>{(() => { const st = mkColor(i) ? lines.find((l) => ckey(l.color) === ckey(mkColor(i)))?.style : lines.length && new Set(lines.map((l) => l.style)).size === 1 ? lines[0].style : ""; return st ? <b className="wo-st">{st}</b> : null; })()}{mkColor(i) || (i === 0 && colors ? colors : "")}{mk.length > 1 || mkColor(i) ? ` · big on page ${pgMk + i}` : ""}</span>}
                  </div>
                )) : <div className="wo-m none" style={{ background: hex }}>No mockup yet</div>}
              </div>
              {/* the prints: one card each, the same rows in the same order (Oct 26, Nick: "the print cards… aren't consistent…
                  it should just say front and back and sleeve"); a long list stays short here, the full cards on the mockup page */}
              <div className="lbl wo-pl">Prints</div>
              {g.imprints.length === 0 && <div className="wo-none">No prints on this group.</div>}
              {g.imprints.length > 4
                ? <div className="wo-plist">{g.imprints.map((d, di) => <span key={d.id}><b>{sideOf(d, g.imprints)}</b> {colorsLabel(d)}{inkNames(d.inks).length ? ` · ${inkNames(d.inks).join(", ")}` : ""} <i>p. {printPg[di]}</i></span>)}</div>
                : <div className="wo-cards">{g.imprints.map((d, di) => <PrintCard key={d.id} d={d} des={d.design_id ? p.designs[d.design_id] : null} all={g.imprints} allLight={allLight} page={printPg[di]} />)}</div>}
              <h2>Garments <span>{gc?.qty || 0} pieces · write the counts in the boxes{more.length ? ` · ${lines.length - 4} more garment${lines.length - 4 === 1 ? "" : "s"} on page ${pgMore}` : ""}</span></h2>
              {countTable(lines.slice(0, 4))}
              {(noteParts.length > 0 || (first && (p.shopNotes.length || (p.cust.brand_print?.rules || []).length))) && <>
                <h2>Notes {longNotes && <span>continued on page {notesPage ? pgNotes : pgMk}</span>}</h2>
                <div className={"notes" + (longNotes ? " clip" : "")}>{notesBlock}</div>
              </>}
              <div className="foot"><span>{footL}</span><span>Page {pg} of {total} · printed {p.printed}</span></div>
            </section>
            {/* 2. more garments (8 a page) */}
            {more.map((ls, mi) => (
              <section className="sheet wo1" key={"more" + mi}>
                {top(`Garments ${4 + mi * 8 + 1}–${4 + mi * 8 + ls.length} of ${lines.length}`)}
                <h2>Garments <span>write the counts in the boxes</span></h2>
                {countTable(ls)}
                <div className="foot"><span>{footL}</span><span>Page {pgMore + mi} of {total}</span></div>
              </section>
            ))}
            {/* 3. each mockup big, its prints blown up under it */}
            {mk.map((u, i) => {
              const col = mkColor(i), bg = col ? p.colorHexes?.[ckey(col)] || mkHex(i) : mkHex(i);
              const qty = col ? lines.filter((l) => l.color === col).reduce((a, l) => a + lineQty(l), 0) : gc?.qty || 0;
              return (
                <section className="sheet wo1" key={"mk" + i}>
                  {top([col || colors, `${qty} pcs`, mk.length > 1 ? `mockup ${i + 1} of ${mk.length}` : ""].filter(Boolean).join(" · "))}
                  <div className="wo-big"><img src={u} alt="Mockup" /></div>
                  {allSup && <>
                    <div className="wo-place"><b className="disp">{where || "Placement as shown"}</b><span>Customer supplied transfers{[g.imprints[0].supplied?.by, g.imprints[0].supplied?.ref ? `order ${g.imprints[0].supplied.ref}` : ""].filter(Boolean).length ? ` · ${[g.imprints[0].supplied?.by, g.imprints[0].supplied?.ref ? `order ${g.imprints[0].supplied.ref}` : ""].filter(Boolean).join(" · ")}` : ""} · press them where they are in this picture</span></div>
                    <div className="specs wo-place-f">{["Press temp", "Time", "Pressure", "Peel"].map((k) => <div className="sp" key={k}><div className="lbl">{k}</div><div className="v fill" /></div>)}</div>
                  </>}
                  {g.imprints.length > 0 && !allSup && (
                    <div className={"wo-cubes n" + Math.min(3, g.imprints.length)}>
                      {g.imprints.map((d, di) => {
                        const des = d.design_id ? p.designs[d.design_id] : null, pic = des ? p.designUrls[des.id] : "", sz = printSize(d, des);
                        const v = col ? vars[di].find((x) => ckey(x.color) === ckey(col)) : undefined;
                        return (
                          <div className="wo-cube" key={d.id}>
                            <div className={"a" + (isDark(bg) ? " dark" : "")} style={{ background: bg }}>
                              {pic ? <PaintedArt src={pic} imp={d} inkMap={d.inkMap} designId={d.design_id} swap={v?.swap} alt={des ? `D-${des.number}` : ""} /> : <span className="none">No art yet</span>}
                            </div>
                            <div className="s"><b className="disp">{sideOf(d, g.imprints)}</b> {d.visualOnly ? "· run it like last time" : `· ${[sz.label, inkNames(d.inks).map((k) => swapInk(k, v?.swap)).join(", ")].filter(Boolean).join(" · ")}`}{v ? <span className="wo-cc">{changeWord(d.method)}</span> : null}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {i === 0 && g.imprints.length > 4 && <div className="wo-cards">{g.imprints.map((d, di) => <PrintCard key={d.id} d={d} des={d.design_id ? p.designs[d.design_id] : null} all={g.imprints} allLight={allLight} page={printPg[di]} />)}</div>}
                  {i === 0 && longNotes && !notesPage && <><h2>Notes</h2><div className="notes wo-mk-notes">{notesBlock}</div></>}
                  <div className="foot"><span>{footL}</span><span>Page {pgMk + i} of {total}</span></div>
                </section>
              );
            })}
            {notesPage && (
              <section className="sheet wo1">
                {top("Notes")}
                <h2>Notes</h2>
                <div className="notes">{notesBlock}</div>
                <div className="foot"><span>{footL}</span><span>Page {pgNotes} of {total}</span></div>
              </section>
            )}
            {/* 4. each print's press sheet */}
            {!allSup && g.imprints.map((d, di) => (
              <div key={d.id} style={{ display: "contents" }}>
                <CloseUp d={d} di={di} n={g.imprints.length} p={p} gi={gi} allLight={allLight} colors={colors} qty={gc?.qty || 0} page={printPg[di]} total={total} footL={footL} />
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** which side of the garment a print is on: FRONT, BACK or SLEEVE (the location's own name only when two share a side) */
function sideOf(d: Imprint, all: Imprint[]): string {
  const side = (x: Imprint) => (/sleeve/i.test(x.location || "") ? "SLEEVE" : spotFor(x.location || "").view === "back" ? "BACK" : "FRONT");
  const me = side(d);
  return all.filter((x) => side(x) === me).length > 1 && d.location ? `${me} · ${d.location}` : me;
}

/** a print on the work order's first page: the same rows in the same order on every card */
function PrintCard({ d, des, all, allLight, page }: { d: Imprint; des: Design | null; all: Imprint[]; allLight: boolean; page: number }) {
  const sz = printSize(d, des), sc = screensOf(d, allLight), inks = d.visualOnly ? [] : inkNames(d.inks);
  const changes = d.visualOnly ? [] : Object.entries(d.inkBy || {}).map(([k, m]) => [k, Object.entries(m || {}).filter(([a, b]) => b && b.trim().toLowerCase() !== a.trim().toLowerCase())] as const).filter(([, ch]) => ch.length);
  const warns = [
    d.visualOnly ? "VISUAL MOCKUP ONLY: RUN IT LIKE LAST TIME, THEN CONFIRM THE SPECS" : "",
    d.method === "embroidery" && !d.digitized && !d.emb?.file ? "NEEDS DIGITIZING: STITCHES AND SIZE CONFIRMED AFTER THE SEW-OUT" : "",
    Object.keys(d.byColor?.skip || {}).length ? `BY SHIRT COLOR: ${Object.entries(d.byColor!.skip).map(([c, n]) => `${c.toUpperCase()} SKIPS ${n.join(" + ").toUpperCase()}`).join(" · ")}` : "",
    !d.visualOnly && (d.confirm?.size || d.confirm?.ink) ? `CONFIRM ${[d.confirm.size && "SIZE", d.confirm.ink && "INK"].filter(Boolean).join(" & ")} BEFORE PRINTING` : "",
  ].filter(Boolean);
  // their own transfers: who made them and where they go, nothing to set up (Oct 27, Nick)
  if (d.supplied) return (
    <div className="wo-pc">
      <div className="h"><b className="disp">HEAT PRESS</b><span>customer supplied transfers</span></div>
      <div className="kv">
        <i>Method</i><span>Heat press · <b>customer supplied transfers</b></span>
        <i>Transfers</i><span>{[d.supplied.by, d.supplied.ref ? `order ${d.supplied.ref}` : ""].filter(Boolean).join(" · ") || "From the customer"}</span>
        <i>Placement</i><span>{d.supplied.where ? `${d.supplied.where}, ` : ""}as on page {page}</span>
      </div>
    </div>
  );
  return (
    <div className="wo-pc">
      <div className="h"><b className="disp">{sideOf(d, all)}</b><span>close-up p. {page}</span></div>
      <div className="kv">
        <i>Method</i><span>{METHODS[d.method] || d.method} · <b>{colorsLabel(d)}</b>{d.printStyle === "fashion" ? " · fashion hit" : ""}{d.softHand ? " · soft hand" : ""}</span>
        {inks.length > 0 && <><i>{inks.length === 1 ? "Ink" : "Inks"}</i>
          <div className={"inks" + (inks.length > 2 ? " two" : "")}>{inks.map((k, n) => <span key={k}><Swatch c={colorHex(k) || "#ccc"} />{inks.length > 1 && <b>{n + 1} </b>}<b>{k}</b></span>)}</div></>}
        {changes.map(([k, ch]) => <span key={k} style={{ display: "contents" }}><i>On {k}</i><span>{ch.map(([a, b]) => <span key={a}><Swatch c={colorHex(b) || "#ccc"} /><b>{b}</b> ({changeWord(d.method).toLowerCase()}, not {a}) </span>)}</span></span>)}
        <i>Size</i><span>{d.visualOnly ? <b>Set on press (reorder)</b> : <>{sz.label ? <b>{sz.label}</b> : "—"} · {dropLabel(d).toLowerCase()}</>}</span>
        {d.method === "embroidery" ? (d.stitches ? <><i>Stitches</i><span>{d.stitches.toLocaleString()}</span></> : null)
          : sc ? <><i>Screens</i><span>{sc.n ? sc.n : "see separations"} · {d.printStyle === "fashion" ? "no underbase" : sc.under ? "underbase" : "no underbase"}</span></> : null}
      </div>
      {warns.map((w) => <div className="warn" key={w}>{w}</div>)}
    </div>
  );
}

function LineRows({ l, sizes, hex, single, colorHexes }: { l: Group["lines"][number]; sizes: readonly string[]; hex: string; single: boolean; colorHexes?: Record<string, string> }) {
  // the line's own garment color (Oct 27, Nick: the F260 Mauve swatch showed the Blue Spruce green): the order's garment
  // colors first (what the mockups use), then the name; never another line's color
  const own = colorHexes?.[ckey(l.color)] || colorHex(l.color) || (l.color ? guessHex(l.color) : "");
  const q = lineQty(l);
  const boxes = (
    <>{sizes.map((z) => <td key={z} className="sz"><div /></td>)}<td className="sz"><div /></td></>
  );
  return (
    <>
      <tr>
        <td className="g"><b>{[l.style, l.brand].filter(Boolean).join(" · ") || "Garment"}</b><br /><Swatch c={single ? hex : own || "#c9ced6"} />{[l.color, l.garment].filter(Boolean).join(" · ")}{l.extras && <div className="lnote"><b>{l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</b>{l.extrasFree === false ? "" : " (no charge)"}</div>}{l.note?.trim() && <div className="lnote">{l.note.trim()}</div>}</td>
        {sizes.map((z) => <td key={z} className="sz">{l.sizes?.[z as keyof typeof l.sizes] ? <b>{l.sizes[z as keyof typeof l.sizes]}</b> : ""}</td>)}
        <td className="tot"><b>{q}</b></td>
      </tr>
      <tr className="counted"><td>Counted in<div className="by">By ____________</div></td>{boxes}</tr>
      <tr className="counted last"><td>Final count<div className="by">By ____________</div></td>{boxes}</tr>
    </>
  );
}

function CloseUp({ d, di, n, p, gi, allLight, colors, qty, page, total, footL, variant }: { d: Imprint; di: number; n: number; p: DocData; gi: number; allLight: boolean; colors: string; qty: number; page: number; total: number; footL: string; /** this print's color change on another garment color (Oct 26) */ variant?: Variant }) {
  const { o, groups } = p;
  const des = d.design_id ? p.designs[d.design_id] : null, pic = des ? p.designUrls[des.id] : "";
  const sz0 = printSize(d, des), sc = screensOf(d, allLight), max = p.maxes[gi]?.[di] || null;
  // visual only: no guessed size or inks on the press sheet; the press writes what ran
  const sz = d.visualOnly ? { ...sz0, label: "" } : sz0;
  const hex = variant ? p.colorHexes?.[ckey(variant.color)] || guessHex(variant.color) || p.hexes[gi] || "#9aa1ab" : p.hexes[gi] || "#9aa1ab";
  // the art at 75%: scaled so it fills about three quarters of the panel, with its real measurements drawn on
  const s = sz.w && sz.h ? Math.min(4.8 / sz.w, 3.3 / sz.h) : sz.w ? 4.8 / sz.w : 0;
  const aw = s ? sz.w * s : 4.8, ah = s && sz.h ? sz.h * s : 3.3, top = 0.42;
  const inks = d.visualOnly ? [] : inkNames(d.inks).map((k) => swapInk(k, variant?.swap));
  // embroidery's own facts from the Mockup Creator (Oct 23): backing, topping, the digitized file
  const emb = d.method === "embroidery" ? d.emb || {} : null;
  const fills = d.method === "embroidery" ? ["Machine", "Hoop", ...(emb?.backing ? [] : ["Backing"]), "Trims"] : d.method === "dtf" ? ["Press temp", "Time", "Pressure", "Peel"] : ["Press", "Platen", "Flash / cure", "Off-contact"];
  const specs: [string, string][] = d.method === "embroidery"
    ? [["Size", sz.label || "—"], ["Drop", d.drop ? `${d.drop}"` : "Standard"], ["Stitches", d.stitches ? `${d.stitches.toLocaleString()}${emb?.stitchesFrom === "file" ? "" : emb?.stitchesFrom === "estimate" ? " (est.)" : ""}` : "—"], ["Threads", String(d.colors || inks.length || "—")],
      ...(emb?.backing ? [["Backing", `${emb.backing}${emb.topping && emb.topping !== "None" ? ` + ${emb.topping.replace(/ \(.*\)$/, "")}` : ""}`] as [string, string]] : []),
      ...(emb?.file ? [["File", emb.file.name] as [string, string]] : []),
      ...(emb?.puff || emb?.metallic ? [["Effects", [emb.puff && (emb.puffNote && !/all of it/.test(emb.puffNote) ? emb.puffNote : "3D puff"), emb.metallic && "Metallic"].filter(Boolean).join(", ")] as [string, string]] : [])]
    : d.supplied
      ? [["Transfers", "Customer supplied"], ["Made by", d.supplied.by || "—"], ["Their order", d.supplied.ref || "—"], ["Pieces", String(qty)]]
    : d.method === "dtf"
      ? [["Print size", sz.label || "—"], ["Drop", d.drop ? `${d.drop}"` : "Standard"], ["Transfer", "Full color"], ["Pieces", String(qty)]]
      : [["Print size", sz.label || "—"], ["Drop", d.drop ? `${d.drop}"` : "Standard"], ["Screens", sc?.n ? String(sc.n) : "—"], ["Underbase", d.printStyle === "fashion" ? "NO · fashion hit" : sc?.under ? "Yes" : "No"]];
  const inkRows = d.method === "dtf" ? [] : inks.length ? inks : Array.from({ length: d.colors >= FULL_COLOR ? 0 : Math.max(1, d.colors || 1) }, () => "");
  return (
    <section className="sheet">
      <div className="p2h"><div className="t disp">{o.nickname} · #{o.number}</div><div className="r">Print {di + 1} of {n} · {qty} pcs{colors ? ` · ${colors}` : ""}{groups.length > 1 ? ` · ${groups[gi].name || `Group ${gi + 1}`}` : ""}</div></div>
      <div className="loc"><div className="n disp">{(d.location || "Print").toUpperCase()}</div><div className="m">{METHODS[d.method] || d.method} · {colorsLabel(d)} · {dropLabel(d)}</div>{variant && <div className="cc-tag">{changeWord(d.method).toUpperCase()} · {variant.color.toUpperCase()}</div>}</div>
      {d.supplied ? (
        // their placement reference, big: the press follows it (Oct 27, Nick)
        <div className="art" style={{ background: "#fff" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {(p.mockups[gi] || [])[0] ? <img src={p.mockups[gi][0]} alt="Placement reference" style={{ position: "absolute", inset: "0.1in", width: "calc(100% - 0.2in)", height: "calc(100% - 0.2in)", objectFit: "contain" }} /> : <div className="none">No placement reference uploaded</div>}
        </div>
      ) : <div className={"art" + (isDark(hex) ? " dark" : "")} style={{ background: hex }}>
        {max && s > 0 && <div className="area" style={{ top: `${top}in`, width: `${max.w * s}in`, height: `${max.h * s}in` }}><span>max {max.w}&quot; × {max.h}&quot;{max.on ? ` on the ${max.on}` : ""}</span></div>}
        {pic && d.method === "embroidery" && emb?.file?.path
          // embroidery with its DST: the logo as it sews, thread by thread (Oct 27, Nick), the art until it's drawn
          ? <DstPicture path={emb.file.path} colors={dstColorsOf(d)} className="wo-dst" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: `${top}in`, width: `${aw}in`, height: `${ah}in` }}
              fallback={<ArtPic d={d} des={des} pic={pic} hires={des ? p.designFiles?.[des.id] : undefined} swap={variant?.swap} style={{ top: `${top}in`, width: `${aw}in`, height: `${ah}in` }} />} />
          : pic ? <ArtPic d={d} des={des} pic={pic} hires={des ? p.designFiles?.[des.id] : undefined} swap={variant?.swap} style={{ top: `${top}in`, width: `${aw}in`, height: `${ah}in` }} /> : <div className="none">No art picked for this print</div>}
        {pic && sz.w > 0 && <div className="dimw" style={{ top: `${top + ah + 0.06}in`, width: `${aw}in` }}>{sz.w.toFixed(2)}&quot;</div>}
        {pic && sz.h > 0 && <div className="dimh" style={{ top: `${top}in`, height: `${ah}in`, left: `calc(50% + ${aw / 2 + 0.14}in)` }}>{sz.h.toFixed(2)}&quot;</div>}
      </div>}
      <div className="specs">
        {specs.map(([k, v]) => <div className="sp" key={k}><div className="lbl">{k}</div><div className="v">{v}</div></div>)}
        {fills.map((k) => <div className="sp" key={k}><div className="lbl">{k}</div><div className="v fill" /></div>)}
      </div>
      {d.method === "embroidery" && emb?.file?.ws?.threads.length ? (
        // the digitizer's worksheet: each thread on its needle, then the stops in order (Oct 23, PBF: 12 threads, 58 stops)
        <>
          <table className="ink">
            <thead><tr><th style={{ width: ".55in" }}>Needle</th><th>Thread</th><th className="w">Stitches</th><th className="w">Stops</th><th style={{ width: ".7in" }}>Threaded</th></tr></thead>
            <tbody>{emb.file.ws.threads.map((t) => { const nm = t.name || threadsAll().find((x) => x.code === t.code && (/classic|rayon/i.test(t.chart) ? x.line === "Classic Rayon 40" : /isacord/i.test(t.chart) ? x.line === "Isacord 40" : x.line === "Polyneon 40"))?.name || ""; return <tr key={t.chart + t.code}><td><b>{t.needle}</b></td><td><Swatch c={threadsAll().find((x) => x.code === t.code && (/classic|rayon/i.test(t.chart) ? x.line === "Classic Rayon 40" : /isacord/i.test(t.chart) ? x.line === "Isacord 40" : x.line === "Polyneon 40"))?.hex || "#ccc"} /><b>{sheetThreadName({ ...t, name: nm })}</b></td><td>{t.stitches.toLocaleString()}</td><td>{t.stops}</td><td><span className="cb" /></td></tr>; })}</tbody>
          </table>
          {emb.file.ws.sequence.length > 1 && <div className="n2"><b>Stop order (needles):</b> {emb.file.ws.sequence.map((x) => x.needle).join(" → ")} <span className="faint">· {emb.file.ws.stops} stops, {emb.file.ws.trims} trims</span></div>}
        </>
      ) : d.method === "embroidery" ? (
        <table className="ink">
          <thead><tr><th style={{ width: ".4in" }}>#</th><th>Thread</th><th className="w">Needle</th><th style={{ width: ".7in" }}>Done</th></tr></thead>
          <tbody>{inkRows.map((k, i) => <tr key={i}><td><b>{i + 1}</b></td><td>{k ? <><Swatch c={threadByName(k)?.hex || colorHex(k) || "#ccc"} /><b>{k}</b>{threadByName(k)?.pms.length ? <small>PMS {threadByName(k)!.pms[0].replace(/^PMS\s*/i, "")}</small> : null}</> : null}</td><td /><td><span className="cb" /></td></tr>)}</tbody>
        </table>
      ) : inkRows.length > 0 || sc?.under ? (
        <table className="ink">
          <thead><tr><th style={{ width: ".4in" }}>#</th><th>Ink</th><th className="w">Mesh</th><th className="w">Squeegee</th><th className="w">Strokes</th><th style={{ width: ".7in" }}>Mixed</th></tr></thead>
          <tbody>
            {sc?.under && <tr><td><b>UB</b></td><td><Swatch c="#ffffff" /><b>White underbase</b><small>flash after</small></td><td /><td /><td /><td><span className="cb" /></td></tr>}
            {inkRows.map((k, i) => <tr key={i}><td><b>{i + 1}</b></td><td>{k ? <><Swatch c={colorHex(k) || "#ccc"} /><b>{k}</b>{inkLine(k) && <small>{inkLine(k)}</small>}{d.printStyle === "fashion" && <small>print · flash · print</small>}</> : null}</td><td /><td /><td /><td><span className="cb" /></td></tr>)}
          </tbody>
        </table>
      ) : null}
      {/* a fashion hit / soft hand: what the press does differently (Oct 16, Nick) */}
      {(d.printStyle === "fashion" || d.softHand) && <div className="n2 hit">{d.printStyle === "fashion" && <><span className="flag">FASHION HIT</span> No underbase. Print, flash, print each color through the same screen (2 hits).</>}{d.softHand && <>{d.printStyle === "fashion" ? " " : ""}<span className="flag">SOFT HAND</span> Mix soft hand additive into each ink.</>}</div>}
      {/* a color change (Oct 24): this print in another ink on a garment color */}
      {!d.visualOnly && Object.entries(d.inkBy || {}).some(([, m]) => Object.entries(m || {}).some(([a, b]) => b && b.trim().toLowerCase() !== a.trim().toLowerCase())) && (
        <div className="n2"><b>{changeWord(d.method).toUpperCase()}:</b> {Object.entries(d.inkBy || {}).flatMap(([k, m]) => Object.entries(m || {}).filter(([a, b]) => b && b.trim().toLowerCase() !== a.trim().toLowerCase()).map(([a, b]) => `on ${k}, ${b} instead of ${a}`)).join("; ")}</div>
      )}
      {/* a color change across variations (Oct 27): the same screens as a print in another group */}
      {!d.visualOnly && d.changeOf && (() => {
        const g = p.groups.find((x) => (x.imprints || []).some((y) => y.id === d.changeOf!.imprint));
        const ch = Object.entries(d.changeOf.inks || {});
        return <div className="n2"><b>{changeWord(d.method).toUpperCase()}:</b> same screens as {g?.name || "another group"}{g?.lines?.[0]?.color ? ` (${g.lines[0].color})` : ""}. {ch.map(([a, b]) => (!b.trim() ? `${a} not printed` : b.trim().toLowerCase() === a.trim().toLowerCase() ? `${a} stays` : `${b} instead of ${a}`)).join("; ")}.</div>;
      })()}
      {/* prints differently by shirt color (Oct 21, Nick): the screens left off on some colors */}
      {Object.keys(d.byColor?.skip || {}).length > 0 && <div className="n2 warn">BY SHIRT COLOR: {Object.entries(d.byColor!.skip).map(([c, n]) => `${c} shirts: skip ${n.join(" + ")} (pull the screen or don't flood it)`).join(". ")}</div>}
      {(d.confirm?.size || d.confirm?.ink) && <div className="n2 warn">CONFIRM {[d.confirm.size && "SIZE", d.confirm.ink && "INK"].filter(Boolean).join(" & ")} BEFORE PRINTING{d.confirm.why ? `: ${d.confirm.why}` : ""}</div>}
      {shopNotes(d.notes) && <div className="n2"><b>Notes:</b> {shopNotes(d.notes)}</div>}
      {(d.artChanges || []).length > 0 && <div className="n2"><b>Art changed for this print:</b> {d.artChanges!.join("; ")}</div>}
      <div className="foot"><span>{footL}</span><span>Page {page} of {total}</span></div>
    </section>
  );
}

// ───────────────────────────── art proof ─────────────────────────────
/**
 * The art proof PDF for the customer to approve (Oct 20, Nick: "a good proof, very visual, that has the images all
 * blown up, shows the imprint size and color… very similar to the work order, except much larger images, and it doesn't
 * need the count"). Per group: a cover with the first mockup, the prints, the garments and the approval box; the other
 * mockups two to a page; then each print up close on the shirt color with its size, placement and inks. No prices,
 * no quantities.
 */
export function ProofDoc(p: DocData & { printed: string; version?: number }) {
  const { o, cust, groups } = p;
  const sh = p.settings.shop;
  const who = [cust.company || cust.name, cust.company && cust.name && cust.name !== cust.company ? cust.name : ""].filter(Boolean).join(" · ");
  const due = day(o.due_date, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  // pages: per group a cover, then the mockups after the first (two to a page), then one per print
  const plan = groups.map((g, gi) => {
    const mk = p.mockups[gi] || [];
    const extra: string[][] = [];
    // every mockup on its own page, the full width of the page, all the same size (Oct 20, Nick: "I'd like the shirt
    // images to be larger")
    // one page per garment, not per line: lines of the same style and color (Hutchins' Frisco and McKinney, both
    // Heather Autumn) are the same picture (Oct 22, Nick on #40096: "there's two black shirts… two autumn shirts")
    const shown0 = g.lines.filter((l) => l.style || l.color);
    const key = (i: number) => { const l = shown0[i]; return l ? `${(l.style || "").trim().toLowerCase()}|${(l.color || "").trim().toLowerCase()}` : `#${i}`; };
    const seen = new Set([key(0)]), idx: number[] = [];
    for (let i = 1; i < mk.length; i++) { const k = key(i); if (seen.has(k)) continue; seen.add(k); idx.push(i); extra.push([mk[i]]); }
    const pcols = [...new Set(g.lines.filter((l) => lineQty(l) > 0).map((l) => l.color).filter(Boolean))] as string[];
    const pvars = g.imprints.map((d) => variantsOf(d, pcols));
    return { mk, extra, idx, prints: g.imprints.length, pvars };
  });
  const total = plan.reduce((a, x) => a + 1 + x.extra.length + x.prints, 0);
  let page = 0;
  const foot = () => { page++; return <div className="foot"><span>Art proof{p.version ? ` v${p.version}` : ""} · #{o.number} {o.nickname}{who ? ` · ${who}` : ""}</span><span>Page {page} of {total}</span></div>; };
  const approved = o.approved_at ? `${o.approved_name || "Approved"}, ${new Date(o.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}` : "";
  return (
    <>
      {groups.map((g, gi) => {
        const { mk, extra, idx } = plan[gi];
        const hex = p.hexes[gi] || "#9aa1ab";
        const shown = g.lines.filter((l) => l.style || l.color);
        const lines = shown.filter((l) => lineQty(l) > 0 || shown.length === 1);
        // each mockup picture is one garment (in the order they were saved)
        const capOf = (i: number) => { const l = shown[i]; return l ? [[l.brand, l.style].filter(Boolean).join(" "), l.color].filter(Boolean).join(" · ") : ""; };
        const gname = groups.length > 1 ? (g.name?.trim() || `Group ${gi + 1}`) : "";
        return (
          <div key={g.id}>
            <section className="sheet pf pf-cover">
              <div className="top">
                <div className="brand"><img src={sh.logoUrl || "/brand/fbs-logo.svg"} alt={sh.name} />
                  {(sh.phone || sh.email) && <div className="sub">{[fmtPhone(sh.phone), sh.email].filter(Boolean).join(" · ")}</div>}</div>
                <div className="doc"><div className="k disp">Art Proof</div><div className="n">#{o.number}{p.version ? ` · Version ${p.version}` : ""}{gname ? ` · ${gname}` : ""}</div><div className="meta">Prepared {p.printed}</div>
                  {approved && <div className="stamp">APPROVED</div>}</div>
              </div>
              <div className="pf-who">
                <div><div className="lbl">For</div><b>{cust.company || cust.name || "—"}</b><div className="faint">{[cust.company && cust.name && cust.name !== cust.company ? cust.name : "", cust.email].filter(Boolean).join(" · ")}</div></div>
                <div><div className="lbl">Job</div><b>{o.nickname || "—"}</b>{o.po_number && <div className="faint">PO {o.po_number}</div>}</div>
                <div><div className="lbl">In hands</div><b>{due || "To be set"}</b><div className="faint">{DELIVERY[o.delivery_method] || "Pickup"}</div></div>
              </div>
              {/* the first garment's mockup on the cover (Oct 20, Nick: "I still want the first garment selected to be the
                  mock-up on the first page"); the other garments follow, one to a page, full width */}
              <div className="pf-hero">
                {mk[0] ? <img src={mk[0]} alt="Mockup" /> : <div className="none" style={{ background: hex }}>Mockup coming</div>}
                {mk[0] && capOf(0) && <span>{capOf(0)}</span>}
              </div>
              <div className="pf-sum">
                <div>
                  <div className="lbl">Prints</div>
                  {g.imprints.length === 0 && <div className="pf-pr">No prints on this group.</div>}
                  {g.imprints.map((d) => {
                    const des = d.design_id ? p.designs[d.design_id] : null, sz = printSize(d, des), ink = d.visualOnly ? [] : inkNames(d.inks);
                    return (
                      <div className="pf-pr" key={d.id}>
                        <b>{d.location}</b> · {d.visualOnly ? MATCH_PREV : <>{printHow(d)}{sz.label ? <> · <b>{sz.label}</b></> : null}</>}
                        {ink.length > 0 && <div className="pf-inks">{ink.map((k) => <span key={k}><Swatch c={colorHex(k) || "#ccc"} />{k}</span>)}</div>}
                      </div>
                    );
                  })}
                </div>
                <div>
                  <div className="lbl">Garments</div>
                  {lines.filter((l, i) => lines.findIndex((y) => `${y.brand}|${y.style}|${y.color}`.toLowerCase() === `${l.brand}|${l.style}|${l.color}`.toLowerCase()) === i).map((l) => <div className="pf-pr" key={l.id}><Swatch c={colorHex(l.color) || guessHex(l.color) || hex} /><b>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}</div>)}
                </div>
              </div>
              <div className="pf-ok">
                <div className="t">Please check everything before you approve</div>
                <div className="s">Spelling, art, ink colors, print sizes and placement. Ink colors are matched to the names listed (PMS or stock ink); colors on a screen or a home printer are close but not exact. Sizes are the printed size on the garment. We start production once this proof is approved.</div>
                {/* data-pdf-*: these become fillable fields in the saved PDF (Oct 20, Nick: "make those editable fields so that
                    they can just sign it with Acrobat… and send it back to us") */}
                <div className="pf-boxes">
                  <span><i className="cb" data-pdf-check={`approved-${gi + 1}`} /> Approved as shown</span>
                  <span><i className="cb" data-pdf-check={`approved-with-changes-${gi + 1}`} /> Approved with the changes noted</span>
                  <span><i className="cb" data-pdf-check={`changes-needed-${gi + 1}`} /> Changes needed, send a new proof</span>
                </div>
                <div className="pf-notes" data-pdf-text={`changes-${gi + 1}`} data-pdf-multi="1"><span>Changes or notes</span></div>
                <div className="pf-sign"><div data-pdf-text={`signature-${gi + 1}`}>Signature</div><div data-pdf-text={`name-${gi + 1}`}>Name</div><div data-pdf-text={`date-${gi + 1}`}>Date</div></div>
                {approved && <div className="s ok">Approved online: {approved}</div>}
              </div>
              {foot()}
            </section>
            {extra.map((pair, xi) => (
              <section className="sheet pf" key={"m" + xi}>
                <div className="p2h"><div className="t disp">{capOf(idx[xi]) || "Mockup"}{gname ? ` · ${gname}` : ""}</div><div className="r">#{o.number} · {o.nickname}</div></div>
                {pair.map((u) => <div className={"pf-mk" + (pair.length === 1 ? " one" : "")} key={u}><img src={u} alt="Mockup" /></div>)}
                {foot()}
              </section>
            ))}
            {g.imprints.map((d, di) => (
              <div key={d.id} style={{ display: "contents" }}>
                <ProofPrint d={d} di={di} n={g.imprints.length} p={p} gi={gi} gname={gname} foot={foot()} />
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function ProofPrint({ d, di, n, p, gi, gname, foot, variant }: { d: Imprint; di: number; n: number; p: DocData; gi: number; gname: string; foot: ReactNode; /** the same print in its changed ink on another garment color */ variant?: Variant }) {
  const { o } = p;
  const des = d.design_id ? p.designs[d.design_id] : null, pic = des ? p.designUrls[des.id] : "";
  const sz = printSize(d, des), max = p.maxes[gi]?.[di] || null;
  const hex = variant ? p.colorHexes?.[ckey(variant.color)] || guessHex(variant.color) || p.hexes[gi] || "#9aa1ab" : p.hexes[gi] || "#9aa1ab";
  // the art as big as the panel takes, with room left for its measurements drawn beside and under it (Oct 23, Nick: "the
  // measurements are spilling out over the red box")
  const PW = 5.9, PH = 5.4;
  const s = sz.w && sz.h ? Math.min(PW / sz.w, PH / sz.h) : sz.w ? PW / sz.w : 0;
  const aw = s ? sz.w * s : PW, ah = s && sz.h ? sz.h * s : PH, top = 0.45;
  const inks = d.visualOnly ? [] : inkNames(d.inks).map((k) => swapInk(k, variant?.swap));
  // a visual-only mockup (a reorder production confirms on the print run): the picture, none of our guessed details
  const specs: [string, string][] = d.visualOnly ? [["Location", d.location || "—"], ["Print", MATCH_PREV]] : [
    ["Location", d.location || "—"], ["Print size", sz.label || "—"], ["Placement", d.drop ? `${d.drop}" below the collar` : "Standard"],
    ["Print", printHow(d)],
  ];
  return (
    <section className="sheet pf">
      <div className="p2h"><div className="t disp">{(d.location || "Print")}</div><div className="r">{variant ? <><b className="cc-tag">{changeWord(d.method).toUpperCase()} · {variant.color.toUpperCase()}</b> · </> : null}Print {di + 1} of {n}{gname ? ` · ${gname}` : ""} · #{o.number}</div></div>
      <div className={"art pf-art" + (isDark(hex) ? " dark" : "")} style={{ background: hex }}>
        {max && s > 0 && max.w * s < 7.4 && <div className="area" style={{ top: `${top}in`, width: `${max.w * s}in`, height: `${max.h * s}in` }}><span>largest print area {max.w}&quot; × {max.h}&quot;</span></div>}
        {pic ? <ArtPic d={d} des={des} pic={pic} hires={des ? p.designFiles?.[des.id] : undefined} swap={variant?.swap} style={{ top: `${top}in`, width: `${aw}in`, height: `${ah}in` }} /> : <div className="none">Art coming</div>}
        {pic && sz.w > 0 && <div className="dimw" style={{ top: `${top + ah + 0.06}in`, width: `${aw}in` }}>{sz.w.toFixed(2)}&quot;</div>}
        {pic && sz.h > 0 && <div className="dimh" style={{ top: `${top}in`, height: `${ah}in`, left: `calc(50% + ${aw / 2 + 0.14}in)` }}>{sz.h.toFixed(2)}&quot;</div>}
      </div>
      <div className="specs pf-specs">{specs.map(([k, v]) => <div className="sp" key={k}><div className="lbl">{k}</div><div className="v">{v}</div></div>)}</div>
      {inks.length > 0 && (
        <div className="pf-inkrow">
          <div className="lbl">{d.method === "embroidery" ? "Thread colors" : "Ink colors"}</div>
          <div className="pf-inklist">{inks.map((k) => <span key={k}><i style={{ background: colorHex(k) || "#ccc" }} /><b>{k}</b></span>)}</div>
        </div>
      )}
      {/* a color change is noted on the one proof page, not a second page (Oct 26) */}
      {!variant && Object.entries(d.inkBy || {}).some(([, m]) => Object.entries(m || {}).some(([x, y]) => y && y.trim().toLowerCase() !== x.trim().toLowerCase())) && (
        <div className="n2"><b>{changeWord(d.method)}:</b> {Object.entries(d.inkBy || {}).flatMap(([k, m]) => Object.entries(m || {}).filter(([x, y]) => y && y.trim().toLowerCase() !== x.trim().toLowerCase()).map(([x, y]) => `on ${k.charAt(0).toUpperCase() + k.slice(1)}, ${y} instead of ${x}`)).join("; ")}</div>
      )}
      {/* our own notes aren't the customer's (Oct 23, Nick: "on the PDF proof, we don't need… the notes"); what we changed
          in their art is, as a list */}
      {(d.artChanges || []).length > 0 && <div className="n2 pf-chg"><b>{d.artChanges!.length === 1 ? "A change we made to your art" : "Changes we made to your art"}:</b>
        <ul>{[...new Set(d.artChanges!.map((t) => t.trim().replace(/[.;\s]+$/, "")))].map((t, i) => <li key={i}>{t}</li>)}</ul>
        <span>Approve it, or tell us if it should stay as you sent it.</span></div>}
      {foot}
    </section>
  );
}

// ───────────────────────────── invoice / quote ─────────────────────────────
const SETUP_LABEL = (k: string, q: number, thread = false) => ({
  screens: `Setup: ${q} screen${q === 1 ? "" : "s"}`, remake: `Screen remake: ${q} screen${q === 1 ? "" : "s"}`, digitize: "Digitizing",
  pms: `PMS color match${q > 1 ? ` × ${q}` : ""}`, inkchange: `${thread ? "Thread changes" : "Ink changes"}${q > 1 ? ` × ${q}` : ""}`, min: "Minimum order charge",
} as Record<string, string>)[k] || "Setup";

export function InvoiceDoc(p: DocData) {
  const { o, cust, groups, c, settings, pays } = p;
  const sh = settings.shop, isQ = o.type === "quote", kind = isQ ? "Quote" : "Invoice";
  const issued = new Date(o.sent_at || o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  const due = day(o.due_date, { weekday: "short", month: "short", day: "numeric" });
  const prints = groups.reduce((a, g) => a + g.imprints.length, 0);
  const paidUp = !isQ && c.paid > 0 && c.balance <= 0.005;
  const contact = [cust.company && cust.name && cust.name !== cust.company ? cust.name : "", cust.address].filter(Boolean).join("\n");
  return (
    <section className="sheet">
      <div className="top">
        <div className="brand">
          <img src={sh.logoUrl || "/brand/fbs-logo.svg"} alt={sh.name} />
          {(sh.address || sh.phone || sh.email) && <div className="sub">{[sh.address, [fmtPhone(sh.phone), sh.email].filter(Boolean).join(" · ")].filter(Boolean).join("\n")}</div>}
        </div>
        <div className="doc">
          <div className="k disp">{kind}</div>
          <div className="n">#{o.number}</div>
          <div className="meta">Issued {issued}{due && <><br />In hands {due} · {DELIVERY[o.delivery_method] || "Pickup"}</>}</div>
        </div>
      </div>
      <div className="parties three">
        <div><div className="lbl">Bill to</div><b>{cust.company || cust.name || "—"}</b>{contact && `\n${contact}`}{cust.email && <><br /><span className="faint">{cust.email}</span></>}{cust.phone && <><br /><span className="faint">{fmtPhone(cust.phone)}</span></>}</div>
        {o.delivery_method === "pickup"
          ? <div><div className="lbl">Pickup</div>Pickup at {sh.name}{due && <><br /><span className="faint">{due}</span></>}</div>
          : <div><div className="lbl">{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}</div>{o.ship_to || "—"}{o.ship_method && <><br /><span className="faint">{o.ship_method}</span></>}</div>}
        {/* the order at a glance (Oct 16, Nick): PO, name, summary, balance due and terms. Quiet, not a billboard. */}
        <div className="osum">
          <div className="lbl">Order</div>
          {/* the job name gets the box's full width, so a long one doesn't wrap (Oct 16, Nick) */}
          <div className="osum-name">{o.nickname}</div>
          <dl>
            {o.po_number && <><dt>PO</dt><dd>{o.po_number}</dd></>}
            <dt>Summary</dt><dd className="nw">{c.qty} piece{c.qty === 1 ? "" : "s"} · {prints} print{prints === 1 ? "" : "s"}</dd>
            {o.approved_at && <><dt>Approved</dt><dd>{o.approved_name}, {new Date(o.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}</dd></>}
            <dt className="bd">{isQ ? "Quote total" : paidUp ? "Paid" : "Balance due"}</dt><dd className={"bd" + (paidUp ? " ok" : "")}>{isQ ? money(c.total) : paidUp ? "In full" : money(Math.max(0, c.balance))}</dd>
          </dl>
          {(cust.id || sh.terms) && <div className="osum-terms">{cust.id ? termsText(cust.payment_terms, o.delivery_method !== "ship") : sh.terms}
            {cust.payment_terms === "deposit" && !paidUp && c.paid < c.total / 2 - 0.005 && <> 50% down to start: <b>{money(c.total / 2)}</b>.</>}</div>}
        </div>
      </div>
      {groups.map((g, gi) => {
        const gc = c.groups[gi];
        if (!gc) return null;
        const lines = g.lines.map((l, li) => ({ l, lc: gc.lines[li] })).filter((x) => x.lc && (x.lc.qty > 0 || g.lines.length === 1));
        const pic = p.mockups[gi]?.[0];
        return (
          <div className="job" key={g.id}>
            {/* the group's name across the top, the mockup level with the items table (Oct 16, Nick) */}
            <div className="t disp">{g.name?.trim() || (groups.length > 1 ? `Group ${gi + 1}` : o.nickname)}</div>
            {g.description?.trim() && <div className="gdesc">{g.description.trim()}</div>}
            {pic ? <img className="pic" src={pic} alt="Mockup" /> : <div className="pic none">Mockup coming</div>}
            <div>
              <table className="it">
                <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Each</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {lines.map(({ l, lc }, i) => (
                    <tr key={l.id}>
                      <td>
                        <b>{[l.brand, l.style, l.garment].filter(Boolean).join(" ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}{gc.wholesale && <span className="faint"> (your garments)</span>}
                        {l.extras && <div className="lnote"><b>{l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</b>{l.extrasFree === false ? "" : " (no charge)"}</div>}{l.note?.trim() && <div className="lnote">{l.note.trim()}</div>}
                        <div className="chips">{SIZES.filter((z) => l.sizes?.[z]).map((z) => <span className="chip" key={z}>{sizeLabel(z)} <b>{l.sizes[z]}</b></span>)}</div>
                        {i === lines.length - 1 && g.imprints.map((d) => {
                          const sz = printSize(d, d.design_id ? p.designs[d.design_id] : null), ink = d.visualOnly ? [] : inkNames(d.inks);
                          const how = d.visualOnly ? MATCH_PREV : printHow(d);
                          // the print on one line, its inks as small swatches under it (Oct 16, Nick: the ink names wrapped
                          // across the line and looked messy)
                          return (
                            <div className="prl" key={d.id}>
                              <div><b>{d.location}</b> · {how}{sz.label && !d.visualOnly ? ` · ${sz.label}` : ""}</div>
                              {(d.artChanges || []).length > 0 && <div className="lnote">Changes we made to your art: {d.artChanges!.join("; ")}</div>}
                              {ink.length > 0 && <div className="prl-inks">{ink.map((n) => { const hx = colorHex(n); return <span className="prl-ink" key={n}><i style={{ background: hx || "transparent" }} />{n}</span>; })}</div>}
                            </div>
                          );
                        })}
                        {i === lines.length - 1 && gc.finishing.length > 0 && <div className="prl">Finishing: {gc.finishing.map((f) => { const ns = isRelabel(f) ? setFor((cust as { neck_labels?: NeckLabelSet[] }).neck_labels, g.neckLabel) : null; return ns ? `${f.name} (their ${ns.name || "neck label"} printed inside the neck)` : f.name; }).join(", ")}</div>}
                      </td>
                      <td className="r">{lc.qty}</td><td className="r">{money(lc.each)}</td><td className="r"><b>{money(lc.sub)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(gc.setupItems.length > 0 || gc.materials > 0) && (
                <table className="extra"><tbody>
                  {gc.setupItems.map((s, i) => <tr key={i}><td>{SETUP_LABEL(s.kind, s.qty, !!(s as { thread?: boolean }).thread)}</td><td className="r">{money(s.amount)}</td></tr>)}
                  {gc.materials > 0 && <tr><td>2XL+ materials</td><td className="r">{money(gc.materials)}</td></tr>}
                </tbody></table>
              )}
            </div>
          </div>
        );
      })}
      {o.fees.some((f) => +f.amount || (f as { free?: boolean }).free || (f as { tbd?: boolean }).tbd) && (
        <div className="others"><table className="extra"><tbody>
          {o.fees.filter((f) => +f.amount || (f as { free?: boolean }).free || (f as { tbd?: boolean }).tbd).map((f, i) => <tr key={i}><td>{(f as { tbd?: boolean }).tbd ? "Shipping" : f.label || "Fee"}</td><td className="r">{(f as { tbd?: boolean }).tbd ? "TBD" : (f as { free?: boolean }).free ? "Free" : money(+f.amount)}</td></tr>)}
        </tbody></table></div>
      )}
      <div className="sumw">
        <div className={"pay" + (pays.length || o.notes ? "" : " empty")}>
          {pays.length > 0 && <p><b>Payments</b>{pays.slice().sort((a, b) => (a.paid_on || "").localeCompare(b.paid_on || "")).map((x) => `\n${day(x.paid_on, { month: "short", day: "numeric" })} · ${x.method} · ${money(x.amount)}`).join("")}</p>}
          {o.notes && <p><b>Notes</b>{`\n${o.notes}`}</p>}
        </div>
        <div className="tot">
          <div className="r"><span>Subtotal</span><span>{money(c.items + c.setup + c.materials + c.fees)}</span></div>
          {c.discount ? <div className="r"><span>Discount{o.discount_type !== "amt" && o.discount_pct ? ` (${o.discount_pct}%)` : ""}</span><span>−{money(c.discount)}</span></div> : null}
          <div className="r"><span>Tax{o.tax_exempt ? "" : ` (${c.rate}%)`}</span><span>{o.tax_exempt ? "Exempt" : money(c.tax)}</span></div>
          <div className="r big"><span>Total{c.shippingTbd ? " + shipping TBD" : ""}</span><span>{money(c.total)}</span></div>
          {c.paid > 0 && <div className="r"><span>Paid</span><span>−{money(c.paid)}</span></div>}
          {!isQ && <div className="r bal2"><span>Balance due</span><span>{money(Math.max(0, c.balance))}</span></div>}
        </div>
      </div>
      <div className="ifoot"><div className="fade" /><div><span>Thank you for printing with {sh.name}!</span><span>{kind} #{o.number}</span></div></div>
    </section>
  );
}

// ───────────────────────────── sew-out approval ─────────────────────────────
export type SewoutRow = { id: string; imprint_id: string; version: number; status: string; note: string; sent_at: string | null; decided_at: string | null; decided_name: string | null; customer_comment: string; approved_via: string };
/**
 * The sew-out approval PDF (Oct 24, Nick: "take a picture, crop it and say here's your sew out… put it on a PDF that
 * has approval like our proof approval does now… on file for future reference"): the photo of the sewn logo big, what
 * it is (where, size, stitches, backing, threads with their PMS), the garments, and the approval box, fillable like the
 * art proof's. One page.
 */
export function SewoutDoc(p: DocData & { printed: string; sw: SewoutRow; photo: string }) {
  const { o, cust, groups, sw } = p;
  const sh = p.settings.shop;
  const who = [cust.company || cust.name, cust.company && cust.name && cust.name !== cust.company ? cust.name : ""].filter(Boolean).join(" · ");
  const due = day(o.due_date, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const gi = Math.max(0, groups.findIndex((g) => g.imprints.some((d) => d.id === sw.imprint_id)));
  const g = groups[gi], d = g?.imprints.find((x) => x.id === sw.imprint_id);
  const des = d?.design_id ? p.designs[d.design_id] : null;
  const threads = d ? inkNames(d.inks) : [];
  const shown = (g?.lines || []).filter((l) => l.style || l.color);
  const garments = shown.filter((l, i) => shown.findIndex((y) => `${y.brand}|${y.style}|${y.color}`.toLowerCase() === `${l.brand}|${l.style}|${l.color}`.toLowerCase()) === i);
  const ok = sw.status === "approved" && sw.decided_at
    ? `${sw.decided_name || "Approved"}, ${new Date(sw.decided_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}` : "";
  const emb = d?.emb || {};
  return (
    <section className="sheet pf pf-cover">
      <div className="top">
        <div className="brand"><img src={sh.logoUrl || "/brand/fbs-logo.svg"} alt={sh.name} />
          {(sh.phone || sh.email) && <div className="sub">{[fmtPhone(sh.phone), sh.email].filter(Boolean).join(" · ")}</div>}</div>
        <div className="doc"><div className="k disp">Sew-out Approval</div><div className="n">#{o.number} · Version {sw.version}</div><div className="meta">Prepared {p.printed}</div>
          {ok && <div className="stamp">APPROVED</div>}</div>
      </div>
      <div className="pf-who">
        <div><div className="lbl">For</div><b>{cust.company || cust.name || "—"}</b><div className="faint">{[cust.company && cust.name && cust.name !== cust.company ? cust.name : "", cust.email].filter(Boolean).join(" · ")}</div></div>
        <div><div className="lbl">Job</div><b>{o.nickname || "—"}</b>{o.po_number && <div className="faint">PO {o.po_number}</div>}</div>
        <div><div className="lbl">In hands</div><b>{due || "To be set"}</b><div className="faint">{DELIVERY[o.delivery_method] || "Pickup"}</div></div>
      </div>
      <div className="pf-hero">
        {p.photo ? <img src={p.photo} alt="Sew-out" /> : <div className="none">Sew-out photo</div>}
        <span>Your logo stitched on our machine{d ? ` · ${d.location}` : ""}</span>
      </div>
      <div className="pf-sum">
        <div>
          <div className="lbl">Embroidery</div>
          {d ? <div className="pf-pr">
            <b>{d.location}</b>{d.size ? <> · <b>{d.size}</b></> : null}{d.stitches ? ` · ${d.stitches.toLocaleString()} stitches` : ""}
            <div className="faint">{[des ? `D-${des.number}${des.name ? ` · ${des.name}` : ""}` : "", emb.backing ? `Backing: ${emb.backing}` : "", emb.puff ? (emb.puffNote && !/all of it/.test(emb.puffNote) ? emb.puffNote : "3D puff") : "", emb.metallic ? "Metallic thread" : ""].filter(Boolean).join(" · ")}</div>
            {threads.length > 0 && <div className="pf-inks">{threads.map((k) => { const t = threadByName(k); return <span key={k}><Swatch c={t?.hex || "#ccc"} />{k}{t?.pms[0] ? ` (PMS ${t.pms[0].replace(/^PMS\s*/i, "")})` : ""}</span>; })}</div>}
          </div> : <div className="pf-pr">This print isn&apos;t on the order anymore.</div>}
        </div>
        <div>
          <div className="lbl">Garments</div>
          {garments.map((l) => <div className="pf-pr" key={l.id}><Swatch c={colorHex(l.color) || guessHex(l.color) || "#9aa1ab"} /><b>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}</div>)}
          {sw.note && <div className="pf-pr"><b>Note:</b> {sw.note}</div>}
        </div>
      </div>
      <div className="pf-ok">
        <div className="t">Please check the sew-out before you approve</div>
        <div className="s">Spelling, thread colors, size and the small details. This is the real stitching on our machine; the run is sewn to match it. We start the run once this sew-out is approved, and keep it on file for reorders.</div>
        <div className="pf-boxes">
          <span><i className="cb" data-pdf-check="sewout-approved" /> Approved as sewn</span>
          <span><i className="cb" data-pdf-check="sewout-changes" /> Changes needed, send a new sew-out</span>
        </div>
        <div className="pf-notes" data-pdf-text="sewout-changes-text" data-pdf-multi="1"><span>Changes or notes</span></div>
        <div className="pf-sign"><div data-pdf-text="sewout-signature">Signature</div><div data-pdf-text="sewout-name">Name</div><div data-pdf-text="sewout-date">Date</div></div>
        {ok && <div className="s ok">Approved{sw.approved_via === "staff" ? "" : " online"}: {ok}</div>}
        {sw.status === "changes" && sw.customer_comment && <div className="s">Changes asked: {sw.customer_comment}</div>}
      </div>
      <div className="foot"><span>Sew-out v{sw.version} · #{o.number} {o.nickname}{who ? ` · ${who}` : ""}</span><span>Page 1 of 1</span></div>
    </section>
  );
}
