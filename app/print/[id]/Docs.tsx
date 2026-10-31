import { hasSpotChange, spotLines } from "@/lib/spotChange";
import { cwLetter, hasColorwayArt, printArtUrl, printOnColor, withLiveSew, withSewFile } from "@/lib/brands";
import { persOf, PERS_SHOW } from "@/lib/pricing";
import { isThirdParty, thirdPartyLabel } from "@/lib/thirdParty";
import { threadByName } from "@/lib/embroidery";
import { changeVersions, inkChanges, inkChangesText } from "@/lib/inkBy";
import { needleThreads, stopColors } from "@/lib/needleThreads";
import { colorHex, WILFLEX_HEX } from "@/lib/inkColors";
import { calcOrder, changeWord, shopNotes, printHow, termsText, inkNames, isLightColor, isPmsInk, lineQty, needsUnderbase, sizeLabel, youthSplit, kidLine, FULL_COLOR, METHODS, SIZES, YOUTH_SIZES, ADULT_SIZES, type Customer, type Design, type Group, type Imprint, type Order, type Payment, type Settings } from "@/lib/pricing";
import { money, parseDate } from "@/lib/format";
import { qrSvg } from "@/lib/qr";
import { jobLink } from "@/lib/zpl";
import { guessHex, lineColor, lineHex, spotFor } from "@/lib/mockup";
import { printSize } from "@/lib/groupLook";
import { fmtPhone } from "@/lib/phone";
import PaintedArt from "./PaintedArt";
import WoFit from "./WoFit";
import InkFit from "./InkFit";
import { inkShort } from "@/lib/inkShort";
import { isRelabel, setFor, type NeckLabelSet } from "@/lib/neckLabels";
import type { ReactNode } from "react";
import DstPicture from "@/components/DstPicture";
import { PrintThumb } from "@/components/LogoThumb";
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
  /** per group, per garment line: that line's own mockup picture ("" when it has none) */ byLine?: string[][];
  /** per group: the shirt color behind the art */ hexes: string[];
  /** each garment color's shirt color (lower-case letters and digits → hex) */ colorHexes?: Record<string, string>;
  /** per group, per print: the largest it can print (inches) and on which size */ maxes: ({ w: number; h: number; on: string } | null)[][];
  printavo: boolean;
};

const DELIVERY: Record<string, string> = { pickup: "Pickup", ship: "Ship", deliver: "Delivery", tbd: "Pickup / ship: TBD" };
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
export type Variant = { color: string; swap: Record<string, string>; /** a colorway change: the colorway this sheet runs */ cw?: string };
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
/**
 * The press sheets a group's prints get: one each, and a print with a colorway change (Imprint.colorwayBy, Oct 31) one
 * per colorway, each as that colorway runs (lib/brands.ts printOnColor: its own sew file, threads, stitches and picture)
 * with the garments and pieces it goes on. A colorway is a different file on the machine, not a thread swap.
 */
type Sheet = { d: Imprint; di: number; variant?: Variant; qty?: number };
function sheetsOf(g: Group, designs: Record<string, Design>): Sheet[] {
  return g.imprints.flatMap((d, di): Sheet[] => {
    const des = d.design_id ? designs[d.design_id] : null;
    const by = Object.entries(d.colorwayBy || {});
    if (!des || !by.length || d.visualOnly || d.supplied) return [{ d, di }];
    const ls = g.lines.filter((l) => (l.color || "").trim() && lineQty(l) > 0);
    const cwOf = (color: string) => by.find(([c]) => ckey(c) === ckey(color))?.[1] || "";
    const names = ["", ...new Set(by.map(([, n]) => n))];
    return names.map((name) => {
      const on = ls.filter((l) => ckey(cwOf(l.color)) === ckey(name));
      const colors = [...new Set(on.map((l) => l.color))];
      const x = name ? printOnColor(d, des, colors[0] || "") : { ...d, inkBy: Object.fromEntries(Object.entries(d.inkBy || {}).filter(([c]) => !cwOf(c))) };
      return { d: x, di, qty: on.reduce((a, l) => a + lineQty(l), 0), variant: { color: colors.join(", "), swap: {}, cw: x.colorway || name } };
    }).filter((x) => x.qty > 0);
  });
}

/** each color stop's thread (the worksheet's, else the print's threads in turn), for drawing its DST */
function dstColorsOf(d: Imprint): string[] {
  return stopColors(d.emb?.file?.ws, d.inks || "");
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
export function WorkOrderDoc(p0: DocData & { notes: string; shopNotes: { tag: string; body: string; by_name: string; created_at: string }[]; printed: string }) {
  // each embroidered print with the sew file it sews, its logo's when it has none of its own (lib/brands.ts withSewFile),
  // each needle on the thread we really run as the logo has it now (withLiveSew)
  const p = { ...p0, groups: p0.groups.map((g) => ({ ...g, imprints: (g.imprints || []).map((im) => withLiveSew(withSewFile(im, im.design_id ? p0.designs[im.design_id] : null, g.lines || []), im.design_id ? p0.designs[im.design_id] : null)) })) };
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
      first && o.delivery_method !== "pickup" && o.ship_to ? `${o.delivery_method === "ship" ? "Ship to" : "Deliver to"}: ${o.ship_to}${o.ship_method || isThirdParty(o) ? ` (${[o.ship_method, isThirdParty(o) ? thirdPartyLabel(o.third_party, true) : ""].filter(Boolean).join(", ")})` : ""}` : "",
    ].filter(Boolean);
    const extra = first ? p.shopNotes.length + (p.cust.brand_print?.rules || []).length : 0;
    const noteText = noteParts.join("\n\n");
    const longNotes = noteText.length + extra * 120 > 380 || noteText.split("\n").length + extra > 6;
    const more: (typeof lines)[] = [];
    for (let i = 4; i < lines.length; i += 8) more.push(lines.slice(i, i + 8));
    // only the customer's own transfers (Oct 27, Nick: "you need really just two, a count in and then… the mock-up large,
    // for placement"): one placement page, no press sheets
    const allSup = g.imprints.length > 0 && g.imprints.every((d) => d.supplied);
    // a logo mockup (our logo on the shirt color, made in the logo builder) is the same picture as the close-ups: no page
    // of its own (Oct 30, Nick: "you've got too many boxes… the same thing repeating like 5 times")
    const logoMk = g.mockupKind === "logo" && !allSup;
    const mk = logoMk ? [] : (p.mockups[gi] || []).slice(0, allSup ? 1 : 8);
    // …but it still shows on the first page (Oct 30, #40284 said "No mockup yet" with a mockup made): the picture, no page
    const firstMk = logoMk ? (p.mockups[gi] || []).slice(0, 1) : mk;
    // notes too long to sit under the mockup get their own page (Oct 27, Nick: "they're flowing over… going everywhere")
    const veryLong = noteText.length + extra * 120 > 650 || noteText.split("\n").length + extra > 9;
    const notesPage = longNotes && (!mk.length || veryLong);
    const colorList = [...new Set(lines.map((l) => l.color).filter(Boolean))] as string[];
    const vars = g.imprints.map((d) => variantsOf(d, colorList));
    // one press sheet per print: a color change is noted on it, not a second set of pages (Oct 26, Nick: "if the art
    // doesn't change, you just need one close-up")
    // two close-ups a page (Oct 30, Nick: "a close-up of the left chest with the details on it, and then below it, close-up of
    // the full back"): a front and back print share one page
    const printPages = allSup ? 0 : Math.ceil(sheetsOf(g, p.designs).length / 2);
    return { lines, noteParts, longNotes, more, mk, firstMk, notesPage, vars, allSup, n: 1 + more.length + mk.length + (notesPage ? 1 : 0) + printPages };
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
        const { lines, noteParts, longNotes, more, mk, firstMk, notesPage, vars, allSup } = plans[gi];
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
        const sheets = sheetsOf(g, p.designs);
        sheets.forEach((sh, k) => { if (printPg[sh.di] == null) printPg[sh.di] = pgPrint + Math.floor(k / 2); });
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
                  {who.length > 0 && <div className="who"><b>{who[0]}</b>{who.slice(1).map((x) => <span key={x} className="nw"> · {x}</span>)}</div>}
                </div>
                <div className="due"><div className="lbl">In hands</div><div className="d disp">{due || "NOT SET"}</div>{dueSub && <small>{dueSub}</small>}</div>
                <div className="codes"><div className="qr" dangerouslySetInnerHTML={{ __html: qr }} /><small>Scan: setup, notes, photos, time</small></div>
              </div>
              {/* the tags on one line across the page, under the header (Oct 30, Nick: "these can be on the same line"); no
                  color bar here (Nick: "why does this page have the rainbow banner?") */}
              <div className="flags">
                {o.rush && <span className="flag rush">RUSH</span>}
                {groups.length > 1 && <span className="flag grp">{(g.name || `Group ${gi + 1}`).toUpperCase()}</span>}
                {gc?.wholesale && <span className="flag cs">CUSTOMER SUPPLIED GOODS</span>}
                {g.imprints.some((d) => d.supplied) && <span className="flag cs">CUSTOMER SUPPLIED TRANSFERS</span>}
                {p.printavo && <span className="flag pv">RUN FROM PRINTAVO</span>}
              </div>
              {g.description?.trim() && <div className="gdesc wo">{g.description.trim()}</div>}
              {/* the mockups take whatever room the rest leaves (never under ~2.6"); up to 4 here, all of them big on their own pages */}
              <div className={"wo-mks n" + Math.min(4, Math.max(1, firstMk.length))}>
                {firstMk.length ? firstMk.slice(0, 4).map((u, i) => (
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
              <h2>Garments <span>{gc?.allQty || 0} pieces · write the counts in the boxes{more.length ? ` · ${lines.length - 4} more garment${lines.length - 4 === 1 ? "" : "s"} on page ${pgMore}` : ""}</span></h2>
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
              const qty = col ? lines.filter((l) => l.color === col).reduce((a, l) => a + lineQty(l), 0) : gc?.allQty || 0;
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
                      {g.imprints.map((d0, di) => {
                        const des = d0.design_id ? p.designs[d0.design_id] : null;
                        // on this mockup's garment color: a colorway change runs that colorway (its own picture), else the print
                        const dc = col ? printOnColor(d0, des, col) : d0, d = dc;
                        const pic = des ? printArtUrl(p.designUrls, des.id, d) : "", sz = printSize(d, des);
                        const v = col && dc === d0 ? vars[di].find((x) => ckey(x.color) === ckey(col)) : undefined;
                        return (
                          <div className="wo-cube" key={d.id}>
                            <div className={"a" + (isDark(bg) ? " dark" : "")} style={{ background: bg }}>
                              {pic ? <PaintedArt src={pic} imp={d} inkMap={d.inkMap} designId={d.design_id} swap={v?.swap} alt={des ? `D-${des.number}` : ""} /> : <span className="none">No art yet</span>}
                            </div>
                            <div className="s"><b className="disp">{sideOf(d, g.imprints)}</b> {d.visualOnly ? "· run it like last time" : `· ${[d.colorway && des ? `${cwLetter(des, { name: d.colorway }) || ""} ${d.colorway}`.trim() : "", sz.label, inkNames(d.inks).map((k) => swapInk(k, v?.swap)).join(", ")].filter(Boolean).join(" · ")}`}{v ? <span className="wo-cc">{changeWord(d.method)}</span> : dc !== d0 ? <span className="wo-cc">Colorway</span> : null}</div>
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
            {!allSup && sheets.map((sh, k) => (k % 2 ? null : sheets[k + 1]
              ? (
                <section key={sh.d.id + k} className="sheet cu-pair">
                  {[sh, sheets[k + 1]].map((x, j) => <CloseUp key={x.d.id + (k + j)} half d={x.d} di={x.di} n={g.imprints.length} p={p} gi={gi} allLight={allLight} colors={x.variant ? x.variant.color : colors} qty={x.qty ?? (gc?.allQty || 0)} page={pgPrint + Math.floor(k / 2)} total={total} footL={footL} variant={x.variant} />)}
                  <div className="foot"><span>{footL}</span><span>Page {pgPrint + Math.floor(k / 2)} of {total}</span></div>
                </section>
              )
              : <div key={sh.d.id + k} style={{ display: "contents" }}><CloseUp d={sh.d} di={sh.di} n={g.imprints.length} p={p} gi={gi} allLight={allLight} colors={sh.variant ? sh.variant.color : colors} qty={sh.qty ?? (gc?.allQty || 0)} page={pgPrint + Math.floor(k / 2)} total={total} footL={footL} variant={sh.variant} /></div>))}
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
  const own = (lineHex(l) || "") || colorHexes?.[ckey(l.color)] || colorHex(l.color) || (l.color ? guessHex(l.color) : "");
  const q = lineQty(l);
  const boxes = (
    <>{sizes.map((z) => <td key={z} className="sz"><div /></td>)}<td className="sz"><div /></td></>
  );
  return (
    <>
      <tr>
        <td className="g"><b>{[l.style, l.brand].filter(Boolean).join(" · ") || "Garment"}</b><br /><Swatch c={single ? hex : own || "#c9ced6"} />{[l.color, l.garment].filter(Boolean).join(" · ")}{l.shopUse ? <div className="lnote"><b>{l.extrasPrint === false ? "Ours, not printed" : "Ours, printed"}</b> (not on the customer&apos;s invoice)</div> : l.extras && <div className="lnote"><b>{l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</b>{l.extrasFree === false ? "" : " (no charge)"}</div>}{l.note?.trim() && <div className="lnote">{l.note.trim()}</div>}{persOf(l).length > PERS_SHOW
          ? <div className="lnote"><b>Personalization:</b> {persOf(l).reduce((a, e) => a + (e.qty || 1), 0)} names ({SIZES.map((z) => [z, persOf(l).filter((e) => e.size === z).reduce((a, e) => a + (e.qty || 1), 0)] as const).filter(([, q]) => q).map(([z, q]) => `${z} ${q}`).join(", ")}) on the {persOf(l)[0].loc || "Right Chest"}: the list is in Production files{persOf(l).find((e) => e.list)?.list ? ` (${persOf(l).find((e) => e.list)!.list!.name})` : ""}</div>
          : persOf(l).map((e) => <div key={e.id} className="lnote"><b>Personalization:</b> {e.text}{e.size ? ` · ${e.size}` : ""} · {e.qty} · {e.loc || "Right Chest"}</div>)}</td>
        {sizes.map((z) => <td key={z} className="sz">{l.sizes?.[z as keyof typeof l.sizes] ? <b>{l.sizes[z as keyof typeof l.sizes]}</b> : ""}</td>)}
        <td className="tot"><b>{q}</b></td>
      </tr>
      <tr className="counted"><td>Counted in<div className="by">By ____________</div></td>{boxes}</tr>
      <tr className="counted last"><td>Final count<div className="by">By ____________</div></td>{boxes}</tr>
    </>
  );
}

function CloseUp({ d, di, n, p, gi, allLight, colors, qty, page, total, footL, variant, half }: { d: Imprint; di: number; n: number; p: DocData; gi: number; allLight: boolean; colors: string; qty: number; page: number; total: number; footL: string; /** one of two close-ups on a page (CloseUpPair): no page of its own, no footer */ half?: boolean; /** this print's color change on another garment color (Oct 26) */ variant?: Variant }) {
  const { o, groups } = p;
  const des = d.design_id ? p.designs[d.design_id] : null, pic = des ? printArtUrl(p.designUrls, des.id, d) : "";
  const sz0 = printSize(d, des), sc = screensOf(d, allLight), max = p.maxes[gi]?.[di] || null;
  // visual only: no guessed size or inks on the press sheet; the press writes what ran
  const sz = d.visualOnly ? { ...sz0, label: "" } : sz0;
  const vc = variant ? variant.color.split(",")[0].trim() : "";
  const hex = vc ? p.colorHexes?.[ckey(vc)] || guessHex(vc) || p.hexes[gi] || "#9aa1ab" : p.hexes[gi] || "#9aa1ab";
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
  // the logo's colorway the print is (Swap on the order, Oct 31): its letter and name, first, so the press and the
  // machine run the right version
  if (d.colorway && des) { const L = cwLetter(des, { name: d.colorway }); specs.unshift(["Colorway", `${L ? `${L} · ` : ""}${d.colorway}`]); }
  // youth screens: the press sees both sizes and their pieces (Oct 31, Nick picked the table, option C)
  const grp = groups[gi];
  if (grp && !d.visualOnly && youthSplit(grp, d)) {
    const ysz = printSize({ ...d, size: d.youth?.size || "" }, des);
    const pcs = (kid: boolean) => grp.lines.filter((l) => kidLine(l) === kid).reduce((a, l) => a + lineQty(l), 0);
    const at = specs.findIndex(([k]) => k === "Print size" || k === "Size");
    if (at >= 0) specs.splice(at, 1, [`Adult (${pcs(false)} pcs)`, sz.label || "—"], [`Youth (${pcs(true)} pcs)`, `${ysz.label || "—"}${d.method === "screen" ? " · own screen" : ""}`]);
  }
  const inkRows = d.method === "dtf" ? [] : inks.length ? inks : Array.from({ length: d.colors >= FULL_COLOR ? 0 : Math.max(1, d.colors || 1) }, () => "");
  return (
    <Wrap half={half}>
      <div className="p2h"><div className="t disp">{o.nickname} · #{o.number}</div><div className="r">Print {di + 1} of {n} · {qty} pcs{colors ? ` · ${colors}` : ""}{groups.length > 1 ? ` · ${groups[gi].name || `Group ${gi + 1}`}` : ""}</div></div>
      <div className="loc"><div className="n disp">{(d.location || "Print").toUpperCase()}</div><div className="m">{METHODS[d.method] || d.method} · {colorsLabel(d)} · {dropLabel(d)}</div>{hasSpotChange(d, groups[gi]?.lines || []) && <div className="m"><b>Location change:</b> {spotLines(d, groups[gi].lines).map((x) => `${x.letter} · ${x.spot}: ${x.what}`).join("  ⟳  ")} · same file</div>}{variant && <div className="cc-tag">{variant.cw ? `COLORWAY ${des ? `${cwLetter(des, { name: variant.cw })} ` : ""}· ${variant.cw.toUpperCase()} · ON ${variant.color.toUpperCase()}` : `${changeWord(d.method).toUpperCase()} · ${variant.color.toUpperCase()}`}</div>}</div>
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
          ? <DstPicture path={emb.file.path} colors={dstColorsOf(d)} art={pic} className="wo-dst" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: `${top}in`, width: `${aw}in`, height: `${ah}in` }}
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
            <tbody>{needleThreads(emb.file.ws, d.inks || "").map((nt) => { const t = emb.file!.ws!.threads.find((x) => x.needle === nt.needle)!; return <tr key={nt.needle + nt.label}><td><b>{nt.needle}</b></td><td><Swatch c={nt.hex} /><b>{nt.label}</b>{nt.from !== "sheet" && t?.name ? <small>worksheet: {t.name}</small> : null}</td><td>{t?.stitches.toLocaleString()}</td><td>{t?.stops}</td><td><span className="cb" /></td></tr>; })}</tbody>
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
      {/* puff ink (Oct 30): what the press does differently */}
      {d.method === "screen" && d.puff && <div className="n2 hit"><span className="flag">PUFF INK</span> Puff print. {needsUnderbase(d) ? "Underbase set on this print." : "No underbase."}</div>}
      {/* a color change (Oct 24): this print in another ink on a garment color */}
      {inkChanges(d).length > 0 && <div className="n2"><b>{changeWord(d.method).toUpperCase()}:</b> {inkChangesText(d)}</div>}
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
      {!half && <div className="foot"><span>{footL}</span><span>Page {page} of {total}</span></div>}
    </Wrap>
  );
}
/** a close-up as its own page, or half of a page shared with the next print's */
function Wrap({ half, children }: { half?: boolean; children?: ReactNode }) {
  return half ? <div className="cu-half">{children}</div> : <section className="sheet">{children}</section>;
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
  /** one print's line under a mockup: on the cover every garment's sizes (adult and youth); on a garment's own page, the
   *  size it prints at on that garment (Oct 31, Nick: the youth page "with nothing on it… put the youth information below") */
  const printLine = (g: Group, d: Imprint, on?: Group["lines"][number]) => {
    const des = d.design_id ? p.designs[d.design_id] : null, ink = d.visualOnly ? [] : inkNames(d.inks);
    const split = youthSplit(g, d), kid = !!on && kidLine(on);
    const sz = printSize(split && kid ? { ...d, size: d.youth?.size || "" } : d, des);
    const yLabel = (d.youth?.size || "").replace(/\s*wide$/, "");
    const tail = d.visualOnly ? null : !on
      ? (split ? <> · Youth <b>{yLabel}</b> (own screen)</> : g.youthSet && d.youth?.same ? " · youth same screen" : null)
      : split ? (kid ? " · youth screen" : " · adult screen") : g.youthSet && d.youth?.same && kid ? " · same screen as adult" : null;
    return (
      <div className="pf-pr" key={d.id}>
        <b>{d.location}</b> · {d.visualOnly ? MATCH_PREV : <>{printHow(d)}{sz.label ? <> · {split && !on ? "Adult " : ""}<b>{sz.label}</b></> : null}{tail}</>}
        {ink.length > 0 && <div className="pf-inks">{ink.map((k) => <span key={k}><Swatch c={colorHex(k) || "#ccc"} />{k}</span>)}</div>}
      </div>
    );
  };
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
                  {g.imprints.map((d) => printLine(g, d))}
                </div>
                <div>
                  <div className="lbl">Garments</div>
                  {lines.filter((l, i) => lines.findIndex((y) => `${y.brand}|${y.style}|${y.color}`.toLowerCase() === `${l.brand}|${l.style}|${l.color}`.toLowerCase()) === i).map((l) => <div className="pf-pr" key={l.id}><Swatch c={(lineHex(l) || "") || colorHex(l.color) || guessHex(l.color) || hex} /><b>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}</div>)}
                </div>
              </div>
              {/* no approval box on the PDF (Oct 29, Nick: "take the approval out… we're going to use this system"): the
                  customer approves on their proof page (/proof/…); the mockup takes the room */}
              {approved && <div className="pf-appr">Approved: {approved}</div>}
              {foot()}
            </section>
            {extra.map((pair, xi) => (
              <section className="sheet pf" key={"m" + xi}>
                <div className="p2h"><div className="t disp">{capOf(idx[xi]) || "Mockup"}{gname ? ` · ${gname}` : ""}</div><div className="r">#{o.number} · {o.nickname}</div></div>
                {pair.map((u) => <div className={"pf-mk sumd" + (pair.length === 1 ? " one" : "")} key={u}><img src={u} alt="Mockup" /></div>)}
                {(() => {
                  // this garment's own prints and sizes under its picture, like the cover's
                  const l = shown[idx[xi]];
                  const same = l ? g.lines.filter((y) => `${y.brand}|${y.style}|${y.color}`.toLowerCase() === `${l.brand}|${l.style}|${l.color}`.toLowerCase()) : [];
                  const sizes = SIZES.map((z) => [z, same.reduce((a, y) => a + (+(y.sizes?.[z] || 0)), 0)] as const).filter(([, n]) => n > 0);
                  return l && (
                    <div className="pf-sum">
                      <div><div className="lbl">Prints</div>{g.imprints.length === 0 ? <div className="pf-pr">No prints on this group.</div> : g.imprints.map((d) => printLine(g, d, l))}</div>
                      <div><div className="lbl">Garment</div>
                        <div className="pf-pr"><Swatch c={(lineHex(l) || "") || colorHex(l.color) || guessHex(l.color) || "#ccc"} /><b>{[l.brand, l.style].filter(Boolean).join(" ")}</b>{l.color ? ` · ${l.color}` : ""}</div>
                        {sizes.length > 0 && <div className="pf-pr faint">{sizes.map(([z, n]) => `${z} ${n}`).join(" · ")} · {sizes.reduce((a, [, n]) => a + n, 0)} pcs</div>}
                      </div>
                    </div>
                  );
                })()}
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
  const des = d.design_id ? p.designs[d.design_id] : null, pic = des ? printArtUrl(p.designUrls, des.id, d) : "";
  const sz = printSize(d, des), max = p.maxes[gi]?.[di] || null;
  const hex = variant ? p.colorHexes?.[ckey(variant.color)] || guessHex(variant.color) || p.hexes[gi] || "#9aa1ab" : p.hexes[gi] || "#9aa1ab";
  // the art as big as the panel takes, with room left for its measurements drawn beside and under it (Oct 23, Nick: "the
  // measurements are spilling out over the red box")
  const PW = 5.9, PH = 5.4;
  const s = sz.w && sz.h ? Math.min(PW / sz.w, PH / sz.h) : sz.w ? PW / sz.w : 0;
  const aw = s ? sz.w * s : PW, ah = s && sz.h ? sz.h * s : PH, top = 0.45;
  const inks = d.visualOnly ? [] : inkNames(d.inks).map((k) => swapInk(k, variant?.swap));
  // the color change's versions (A as printed, then each change) with the garments each goes on (lib/inkBy.ts)
  const ccVers = variant ? [] : changeVersions(d, o.groups[gi]?.lines || []).map((v) => ({ ...v, hex: v.letter === "A" ? p.hexes[gi] || "#9aa1ab" : p.colorHexes?.[ckey(v.colors[0])] || guessHex(v.colors[0]) || "#9aa1ab" }));
  // the tile: the art fit in a 1" square
  const tileW = sz.w && sz.h ? Math.min(0.82, (0.82 * sz.w) / sz.h) : 0.82, tileH = sz.w && sz.h ? Math.min(0.82, (0.82 * sz.h) / sz.w) : 0.82;
  // a visual-only mockup (a reorder production confirms on the print run): the picture, none of our guessed details
  const specs: [string, string][] = d.visualOnly ? [["Location", d.location || "—"], ["Print", MATCH_PREV]] : [
    ["Location", d.location || "—"], ["Print size", (sz.label || "—") + (o.groups[gi] && youthSplit(o.groups[gi], d) ? ` adult · youth ${(d.youth?.size || "").replace(/\s*wide$/, "")} (own screen)` : o.groups[gi]?.youthSet && d.youth?.same ? " · youth same screen" : "")], ["Placement", d.drop ? `${d.drop}" below the collar` : "Standard"],
    ["Print", printHow(d)],
  ];
  return (
    <section className="sheet pf">
      <div className="p2h"><div className="t disp">{(d.location || "Print")}</div><div className="r">{variant ? <><b className="cc-tag">{changeWord(d.method).toUpperCase()} · {variant.color.toUpperCase()}</b> · </> : null}Print {di + 1} of {n}{gname ? ` · ${gname}` : ""} · #{o.number}</div></div>
      <div className={"art pf-art" + (isDark(hex) ? " dark" : "") + (ccVers.length > 1 ? " pf-art-cc" : "")} style={{ background: hex }}>
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
      {/* a color change is shown on the one proof page, not a second page (Oct 26): each version small, the art in its ink on
          its garment color, a block of that ink under it (Oct 30, Nick: "show a small visual… a small block with the PMS
          color underneath it") */}
      {!variant && ccVers.length > 1 && (
        <div className="pf-cc">
          <div className="lbl">{changeWord(d.method)}</div>
          <div className="pf-cc-row">
            {ccVers.map((v) => (
              <div className="pf-cc-v" key={v.letter}>
                <div className="pf-cc-pic">
                  <div className={"art pf-cc-tile" + (isDark(v.hex) ? " dark" : "")} style={{ background: v.hex }}>
                    {/* a colorway change's version: that colorway's own picture, as it is */}
                    {pic ? (() => { const own = v.colorway && des && hasColorwayArt(p.designUrls, des.id, { colorway: v.colorway }) ? printArtUrl(p.designUrls, des.id, { colorway: v.colorway }) : ""; return <ArtPic d={own ? { ...d, inkMap: undefined } : d} des={des} pic={own || pic} swap={own ? null : v.swap} style={{ top: `${(1 - tileH) / 2}in`, width: `${tileW}in`, height: `${tileH}in` }} />; })() : null}
                  </div>
                  <i className="pf-cc-blk" style={{ background: colorHex(v.ink.split(",")[0].trim()) || "#ccc" }} />
                </div>
                <div className="pf-cc-t">
                  <b>{v.colorway ? `Colorway ${des ? `${cwLetter(des, { name: v.colorway })} · ` : ""}${v.colorway}` : `${v.letter} · ${v.letter === "A" ? "As printed" : changeWord(d.method)}`}</b>
                  <span>on {v.colors.join(", ")}{v.styles ? ` · ${v.styles}` : ""}</span>
                  <span className="pf-cc-ink"><i style={{ background: colorHex(v.ink.split(",")[0].trim()) || "#ccc" }} /><b>{v.ink}</b></span>
                  {v.from && <small>instead of {v.from}</small>}
                </div>
              </div>
            ))}
          </div>
        </div>
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

/** a garment's sizes on the quote / invoice, one line (Oct 30, Nick): S to 3XL always (a size not ordered shows 0), YS to YXL
 *  the same for youth, any other size (XS, 4XL, 5XL, baby, toddler, one size) only when it's ordered */
function invoiceSizes(sizes: Record<string, number> | undefined) {
  const has = (z: string) => +(sizes?.[z] || 0) > 0;
  const youth = YOUTH_SIZES.some(has), adult = ADULT_SIZES.some(has) || !SIZES.some(has);
  // baby, toddler and one-size items have no fixed run: only the sizes ordered
  const base = new Set<string>([...(adult ? ["S", "M", "L", "XL", "2XL", "3XL"] : []), ...(youth ? ["YS", "YM", "YL", "YXL"] : [])]);
  // "extra" (blue) only beside the usual run; a baby or one-size item just shows what was ordered
  return SIZES.filter((z) => base.has(z) || has(z)).map((z) => ({ z, n: +(sizes?.[z] || 0), extra: base.size > 0 && !base.has(z) }));
}
const flat = (x: string | null | undefined) => (x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** a print's decoration method as the invoice says it */
const DECO: Record<string, string> = { screen: "Screen printing", embroidery: "Embroidery", dtf: "Heat press", heat: "Heat press", transfer: "Heat press" };
/** a ship-to address made tidy for the invoice's box (Oct 30, Nick: "it just looks like bad text in there"): a label someone
 *  typed into it ("Deliver-TO ADDRESS:") is dropped, a note in brackets ("(Will be couriered)") goes small under it, and
 *  ALL-CAPS lines are written normally (short words like TX, USA, PO and initials with no vowels like PSWM keep their capitals); the first line is the name */
function shipLines(text: string): { lines: string[]; notes: string[] } {
  const lines: string[] = [], notes: string[] = [];
  for (let raw of text.split(/\n+/)) {
    raw = raw.replace(/^\s*(deliver|ship)(ping)?[-\s]*to\s*(address)?\s*:?\s*/i, "").trim();
    const note = raw.match(/\(([^)]+)\)\s*$/);
    if (note) { notes.push(note[1].trim().replace(/^./, (c) => c.toUpperCase())); raw = raw.replace(/\([^)]*\)\s*$/, "").trim(); }
    if (!raw) continue;
    if (raw === raw.toUpperCase() && /[A-Z]{4}/.test(raw)) raw = raw.toLowerCase().replace(/\b([a-z])([a-z]*)/g, (w, a, b) => ((w.length <= 3 && /^(tx|usa|po|llc|inc|ste|apt|ne|nw|se|sw|dfw)$/.test(w)) || /^[bcdfghjklmnpqrstvwxz]{2,}$/.test(w) ? w.toUpperCase() : a.toUpperCase() + b));
    lines.push(raw.replace(/^attn\b:?/i, "Attn:"));
  }
  return { lines, notes };
}

/**
 * The quote / invoice (Oct 30, Nick: "the top part just takes up way too much space. The most important information is the
 * bottom part"), approved as shown:
 *  - top: the logo; on the right two lines, "Quote #40214" and "PO 2231 · Due Fri Nov 14" (the in-hands date);
 *  - Bill to (the company and the contact, no address) and Job (name, pieces, pickup / ship method) side by side;
 *  - each group: its name and pieces, then a row per garment: brand and style in bold · color, Qty / Each / Amount on the
 *    same line (the name wraps inside its column, never into Qty); the garment's name small under it; then the
 *    thumbnail beside one line of sizes and a short line per print (Front, Back…) with its inks as dots and names that
 *    fit inside the page (InkFit: full names, then short names, then two lines, then smaller type; never cut off);
 *    customer supplied garments get a thin "Customer / supplied" stamp up the left of their thumbnail;
 *  - setup charges under each group; the ship-to box (only when it isn't their own address) and the payment terms at the
 *    bottom left, the totals at the bottom right.
 * The same component draws the quote, the invoice, the saved PDF and the customer's view of it.
 */
export function InvoiceDoc(p: DocData) {
  const { o, cust, groups, c, settings, pays } = p;
  const sh = settings.shop, isQ = o.type === "quote", kind = isQ ? "Quote" : "Invoice";
  const issued = new Date(o.sent_at || o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  const due = day(o.due_date, { weekday: "short", month: "short", day: "numeric" });
  const paidUp = !isQ && c.paid > 0 && c.balance <= 0.005;
  const contact = cust.company && cust.name && cust.name !== cust.company ? cust.name : "";
  const how = o.delivery_method === "ship" ? [o.ship_method || "Ship", isThirdParty(o) ? thirdPartyLabel(o.third_party) : ""].filter(Boolean).join(", ") : o.delivery_method === "deliver" ? "Delivery" : o.delivery_method === "tbd" ? "Pickup or ship TBD" : "Pickup";
  // ship to: a box at the bottom, only when it goes somewhere other than their own address (Oct 30, Nick)
  const shipTo = (o.delivery_method === "ship" || o.delivery_method === "deliver") && (o.ship_to || "").trim() && flat(o.ship_to) !== flat(cust.address) ? String(o.ship_to).trim() : "";
  const deposit = cust.payment_terms === "deposit" && !paidUp && c.paid < c.total / 2 - 0.005 ? c.total / 2 - c.paid : 0;
  // the payments in the totals, oldest first, each with its date and how it was paid (only when they add up to what's paid)
  const sorted = pays.slice().sort((a, b) => (a.paid_on || a.created_at || "").localeCompare(b.paid_on || b.created_at || ""));
  const payRows = Math.abs(sorted.reduce((a, x) => a + (+x.amount || 0), 0) - c.paid) < 0.01 ? sorted.map((x, k) => {
    const amt = +x.amount || 0, m = (x.method || "").trim();
    const ref = /check/i.test(m) && (x.note || "").match(/#?\s*(\d{3,})/) ? ` #${(x.note || "").match(/#?\s*(\d{3,})/)![1]}` : "";
    const on = day(x.paid_on || x.created_at, { month: "short", day: "numeric" });
    const first = k === 0 && amt > 0 && cust.payment_terms === "deposit" && amt < c.total - 0.005;
    return { id: x.id, amount: amt, on, label: amt < 0 ? "Refunded" : first ? "Deposit paid" : "Paid", how: [on, m ? m.replace(/^./, (ch) => ch.toUpperCase()) + ref : ""].filter(Boolean).join(" · ") };
  }) : [];
  return (
    <section className="sheet iv2">
      <div className="iv2-head">
        <img className="iv2-logo" src={sh.logoUrl || "/brand/fbs-logo.svg"} alt={sh.name} />
        <div className="iv2-no"><b className="disp">{kind} #{o.number}</b>{(o.po_number || due) && <span>{[o.po_number ? `PO ${o.po_number}` : "", due ? `Due ${due}` : ""].filter(Boolean).join(" · ")}</span>}</div>
      </div>
      <div className="iv2-who">
        <div><div className="lbl">Bill to</div><b>{cust.company || cust.name || "—"}</b>{contact && <span>{contact}</span>}</div>
        <div className="r"><div className="lbl">Job</div><b>{o.nickname || `#${o.number}`}</b><span>{c.qty} pcs · {how}</span></div>
      </div>
      {groups.map((g, gi) => {
        const gc = c.groups[gi];
        if (!gc) return null;
        const lines = g.lines.map((l, li) => ({ l, li, lc: gc.lines[li] })).filter((x) => x.lc && (x.lc.qty > 0 || g.lines.length === 1));
        const prints = g.imprints.map((d) => ({ d, inks: d.visualOnly ? [] : inkNames(d.inks) }));
        return (
          <div className="iv2-g" key={g.id}>
            <div className="iv2-gh disp"><span>{g.name?.trim() || (groups.length > 1 ? `Group ${gi + 1}` : o.nickname || "Items")}{prints.length > 0 && <span className="iv2-gm"> · {[...new Set(prints.map(({ d }) => DECO[d.method] || METHODS[d.method] || d.method).filter(Boolean))].join(" + ")}</span>}</span><small>{gc.lines.reduce((a, x) => a + (x?.qty || 0), 0)} pcs</small></div>
            {g.description?.trim() && <div className="iv2-gd">{g.description.trim()}</div>}
            <div className="iv2-cols lbl"><span>Item</span><span>Qty</span><span>Each</span><span>Amount</span></div>
            {lines.map(({ l, li, lc }) => {
              // the line's own mockup; the group's first only for its own color (never another color's picture); else the print's logo
              // on the garment's color
              const pic = p.byLine?.[gi]?.[li] || (lineColor(l) === lineColor(g.lines[0]) ? p.mockups[gi]?.[0] : "") || "";
              const logo = g.imprints.map((d) => (d.design_id ? p.designUrls[d.design_id] : "")).find(Boolean) || "";
              const sz = invoiceSizes(l.sizes as Record<string, number>);
              const name = [l.brand, l.style].filter(Boolean).join(" ") || l.garment || "Garment";
              return (
                <div className="iv2-ln" key={l.id}>
                  <div className="iv2-row"><span className="iv2-nm"><b>{name}</b>{l.color ? <> · {l.color}</> : null}{l.garment && name !== l.garment && <small className="iv2-nsub"> {l.garment}</small>}</span><span>{lc.qty}</span><span>{money(lc.each)}</span><span><b>{money(lc.sub)}</b></span></div>
                  {(l.garment && name !== l.garment) && <div className="iv2-sub">{l.garment}</div>}
                  {l.extras && <div className="iv2-note"><b>{l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</b>{l.extrasFree === false ? "" : " (no charge)"}</div>}
                  {l.note?.trim() && <div className="iv2-note">{l.note.trim()}</div>}
                  {(() => { const its = (gc.persItems || []).filter((x) => x.lineId === l.id); if (!its.length) return null;
                    if (its.length > PERS_SHOW) { const q = its.reduce((a, x) => a + x.qty, 0), amt = its.reduce((a, x) => a + x.amount, 0); return <div className="iv2-note"><b>Personalization:</b> {q} names · {money(its[0].unit)} each = {money(amt)}</div>; }
                    return its.map((x, k) => <div key={k} className="iv2-note"><b>Personalization:</b> {x.text}{x.size ? ` · Size ${x.size}` : ""} · Qty {x.qty} · {money(x.unit)} each = {money(x.amount)}</div>); })()}
                  <div className="iv2-det">
                    {gc.wholesale && <div className="iv2-cs">Customer<br />supplied</div>}
                    {pic ? <img className="iv2-th" src={pic} alt="" /> : <div className={"iv2-th none" + (logo ? " lg" : "")} style={{ ["--sc" as string]: guessHex(lineColor(l)) || "#e8ebf0" }}>{logo && <img src={logo} alt="" />}</div>}
                    <div className="iv2-blk">
                      <div className={"iv2-sz" + (sz.length > 7 ? " many" : "")}>{sz.map(({ z, n, extra }) => <span key={z} className={n ? (extra ? "x" : "") : "z"}>{sizeLabel(z)}<b>{n}</b></span>)}</div>
                      {prints.length > 0 && (
                        <div className="iv2-prs">
                          {/* how it's decorated, then each spot (Oct 30, Nick: "right underneath sizes… screen printing, embroidery,
                              or heat press, whatever it is, then go into the front") */}
                          <div className="iv2-pr iv2-how"><em>Decoration</em><span>{[...new Set(prints.map(({ d }) => DECO[d.method] || METHODS[d.method] || d.method).filter(Boolean))].join(" + ")}</span></div>
                          {prints.map(({ d, inks }) => (
                            <div className="iv2-pr" key={d.id}>
                              <em>{d.location || "Print"}</em>
                              {inks.length
                                ? <span className="iv2-inks">{inks.map((n) => { const hx = colorHex(n) || guessHex(n); return <span key={n}><i style={{ background: hx || "transparent" }} /><span className="f">{n}</span><span className="s">{inkShort(n)}</span></span>; })}</span>
                                : <span className="iv2-inks"><span>{d.visualOnly ? MATCH_PREV : printHow(d)}</span></span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {gc.finishing.length > 0 && <div className="iv2-set fin"><span>Finishing: {gc.finishing.map((f) => { const ns = isRelabel(f) ? setFor((cust as { neck_labels?: NeckLabelSet[] }).neck_labels, g.neckLabel) : null; return ns ? `${f.name} (their ${ns.name || "neck label"} printed inside the neck)` : f.name; }).join(", ")}</span></div>}
            {g.imprints.some((d) => (d.artChanges || []).length) && <div className="iv2-note">Changes we made to your art: {g.imprints.flatMap((d) => d.artChanges || []).join("; ")}</div>}
            {gc.setupItems.map((s, i) => <div className="iv2-set" key={`s${i}`}><span>{s.youth ? "Youth " + SETUP_LABEL(s.kind, s.qty, !!(s as { thread?: boolean }).thread).replace(/^Setup: /, "setup: ").replace(/^Digitizing/, "digitizing") : SETUP_LABEL(s.kind, s.qty, !!(s as { thread?: boolean }).thread)}</span><span>{money(s.amount)}</span></div>)}
            {gc.materials > 0 && <div className="iv2-set"><span>2XL+ materials</span><span>{money(gc.materials)}</span></div>}
          </div>
        );
      })}
      {o.fees.some((f) => +f.amount || (f as { free?: boolean }).free || (f as { tbd?: boolean }).tbd) && (
        <div className="iv2-g iv2-fees">
          {o.fees.filter((f) => +f.amount || (f as { free?: boolean }).free || (f as { tbd?: boolean }).tbd).map((f, i) => <div className="iv2-set" key={i}><span>{(f as { tbd?: boolean }).tbd ? "Shipping" : f.label || "Fee"}</span><span>{(f as { tbd?: boolean }).tbd ? "TBD" : (f as { free?: boolean }).free ? "Free" : money(+f.amount)}</span></div>)}
        </div>
      )}
      {/* the bottom (Oct 30, Nick): the totals right under the items with the payment terms under them; on the left the
          delivery address (only when it's somewhere else), payments, and the customer notes only when "Add customer notes to
          the invoice" is ticked on the order */}
      <div className="iv2-sum">
        <div className="iv2-left">
          {paidUp && <div className="iv2-full">Paid in full{payRows.length ? ` · ${payRows[payRows.length - 1].on}` : ""}</div>}
          {shipTo && (() => { const sl = shipLines(shipTo); return (
            <div className="iv2-ship"><div className="lbl">{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}{o.ship_method ? ` · ${o.ship_method}` : ""}{isThirdParty(o) ? ` · ${thirdPartyLabel(o.third_party)}` : ""}</div>
              {sl.lines.map((x, k) => <div key={k} className={k === 0 ? "nm" : ""}>{x}</div>)}
            </div>); })()}
          {o.notes_on_invoice && o.notes?.trim() && <div className="iv2-terms"><div className="lbl">Notes</div><div style={{ whiteSpace: "pre-wrap" }}>{o.notes}</div></div>}
        </div>
        <div>
          <div className="tot">
            <div className="r"><span>Subtotal</span><span>{money(c.items + c.setup + c.materials + c.fees)}</span></div>
            {c.discount ? <div className="r"><span>Discount{o.discount_type !== "amt" && o.discount_pct ? ` (${o.discount_pct}%)` : ""}</span><span>−{money(c.discount)}</span></div> : null}
            <div className="r"><span>Tax{o.tax_exempt ? "" : ` (${c.rate}%)`}</span><span>{o.tax_exempt ? "Exempt" : money(c.tax)}</span></div>
            <div className="r big"><span>Total{c.shippingTbd ? " + shipping TBD" : ""}</span><span>{money(c.total)}</span></div>
            {/* each payment its own dated row (Oct 30, Nick: "put the date in the payment… if they paid half down… payment paid
                10/30"): "Deposit paid · Oct 30 · Card", a check with its number; a refund as a refund */}
            {payRows.length ? payRows.map((x) => <div className="r iv2-pay" key={x.id}><span>{x.label}<small>{x.how}</small></span><span>{x.amount < 0 ? "+" : "−"}{money(Math.abs(x.amount))}</span></div>)
              : c.paid > 0 && <div className="r iv2-pay"><span>Paid</span><span>−{money(c.paid)}</span></div>}
            {deposit > 0 && <div className="r bal2"><span>Deposit due to start</span><span>{money(deposit)}</span></div>}
            {!isQ && <div className="r bal2"><span>Balance due</span><span>{money(Math.max(0, c.balance))}</span></div>}
          </div>
          <div className="iv2-pt">{cust.id ? termsText(cust.payment_terms, o.delivery_method === "pickup") : sh.terms}<span>Issued {issued}{o.approved_at && o.approved_name ? ` · approved by ${o.approved_name}` : ""}</span></div>
        </div>
      </div>
      <div className="ifoot"><div className="fade" /><div><span>{[sh.name, sh.address, fmtPhone(sh.phone)].filter(Boolean).join(" · ").replace(/\n+/g, ", ")}</span><span className="iv2-ty disp">Thank you for your business</span></div></div>
      <InkFit />
    </section>
  );
}

// ───────────────────────────── sew-out approval ─────────────────────────────
export type SewoutRow = { id: string; imprint_id: string; version: number; status: string; note: string; sent_at: string | null; decided_at: string | null; decided_name: string | null; customer_comment: string; approved_via: string;
  placement_path?: string | null; sewn?: { file?: { path: string; name: string; v?: number; wIn: number; hIn: number; stitches: number } | null; threads: { needle?: number; ordered: string; sewn: string }[] } | null };
/**
 * The sew-out approval PDF (Oct 24, Nick: "take a picture, crop it and say here's your sew out… put it on a PDF that
 * has approval like our proof approval does now… on file for future reference"). Oct 29, Nick: "cropped, with rounded
 * corners and… a drop shadow… here's an actual image of your sew-out for approval… it can bring in the DST as you sewed
 * it… 4x2"; "we might take another photo for placement"; "select the real thread we used". So: the photo big in a
 * rounded, shadowed frame, the placement photo beside it when there is one, the stitch file drawn as sewn with its
 * measured size, the threads really sewn (and what they replaced), the garments, and the approval box. One page.
 */
export function SewoutDoc(p: DocData & { printed: string; sw: SewoutRow; photo: string; placement?: string }) {
  const { o, cust, groups, sw } = p;
  const sh = p.settings.shop;
  const who = [cust.company || cust.name, cust.company && cust.name && cust.name !== cust.company ? cust.name : ""].filter(Boolean).join(" · ");
  const due = day(o.due_date, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const gi = Math.max(0, groups.findIndex((g) => g.imprints.some((d) => d.id === sw.imprint_id)));
  const g = groups[gi], d = g?.imprints.find((x) => x.id === sw.imprint_id);
  const des = d?.design_id ? p.designs[d.design_id] : null;
  // the threads really sewn (the sew-out's own record), else the print's
  const sewnThreads = sw.sewn?.threads?.length ? sw.sewn.threads : (d ? inkNames(d.inks) : []).map((n) => ({ needle: undefined as number | undefined, ordered: n, sewn: n }));
  const shown = (g?.lines || []).filter((l) => l.style || l.color);
  const garments = shown.filter((l, i) => shown.findIndex((y) => `${y.brand}|${y.style}|${y.color}`.toLowerCase() === `${l.brand}|${l.style}|${l.color}`.toLowerCase()) === i);
  const ok = sw.status === "approved" && sw.decided_at
    ? `${sw.decided_name || "Approved"}, ${new Date(sw.decided_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}` : "";
  const emb = d?.emb || {};
  // the stitch file sewn: its size and stitches, drawn in the threads sewn (each color stop's needle → the thread on it)
  const file = sw.sewn?.file || (emb.file ? { path: emb.file.path, name: emb.file.name, wIn: emb.file.wIn, hIn: emb.file.hIn, stitches: emb.file.stitches } : null);
  const hexOf = (n: string) => threadByName(n)?.hex || colorHex(n) || "#333333";
  const inch = (n: number) => `${Math.round(n * 100) / 100}"`;
  const art = des ? printArtUrl(p.designUrls, des.id, d) : "";
  return (
    <section className="sheet pf pf-cover so">
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
      <div className="so-head">
        <h2>Here&apos;s an actual photo of your sew-out for approval</h2>
        <p>Your logo stitched on our machine, the same way the whole run will sew. Please look it over and approve it, or tell us what to change.</p>
      </div>
      {/* the sew-out big, with the art we sent beside it to compare (Oct 29, Nick: "the main thing is the sew out… large and
          in the center… a smaller version that says compared to original file… down below… the placement and threads") */}
      <div className="so-hero">
        <figure className="so-ph">
          {p.photo ? <img src={p.photo} alt="Your sew-out" /> : <div className="none">Sew-out photo</div>}
          <figcaption>The sew-out, close up{d ? ` · ${d.location}` : ""}</figcaption>
        </figure>
        {des && d && art && <figure className="so-org">
          <div className="lbl">Compared to</div>
          <div className="so-org-pic"><PrintThumb d={des} url={art} print={d} lines={g?.lines} /></div>
          <figcaption>The original file</figcaption>
        </figure>}
      </div>
      <div className={"so-below" + (p.placement ? " pl" : "")}>
        {p.placement && <figure className="so-ph so-pl">
          <img src={p.placement} alt="Where it sits on the garment" />
          <figcaption>Placement on the garment</figcaption>
        </figure>}
          <div className="so-facts">
            {file && <div><span>Size</span><b>{inch(file.wIn)} × {inch(file.hIn)}</b></div>}
            {(file?.stitches || d?.stitches) ? <div><span>Stitches</span><b>{(file?.stitches || d?.stitches || 0).toLocaleString()}</b></div> : null}
            {des && <div><span>Logo</span><b>D-{des.number}</b></div>}
            {d && <div><span>Placement</span><b>{d.location}</b></div>}
            <div className="wide"><span>Thread{sewnThreads.length === 1 ? "" : "s"}</span>{sewnThreads.map((t, i) => {
              const th = threadByName(t.sewn); const swapped = t.sewn.toLowerCase() !== t.ordered.toLowerCase();
              return <b key={i} className="so-th"><Swatch c={hexOf(t.sewn)} />{t.needle && sewnThreads.length > 1 ? `${t.needle}. ` : ""}{t.sewn}{th?.pms[0] ? ` (PMS ${th.pms[0].replace(/^PMS\s*/i, "")})` : ""}{swapped && <small> in place of {t.ordered}</small>}</b>;
            })}</div>
            {garments.length > 0 && <div className="full"><span>Garment{garments.length === 1 ? "" : "s"}</span>{garments.map((l) => <b key={l.id} className="so-th"><Swatch c={(lineHex(l) || "") || colorHex(l.color) || guessHex(l.color) || "#9aa1ab"} />{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}{l.color ? ` · ${l.color}` : ""}</b>)}</div>}
            {(emb.backing || emb.puff || emb.metallic) && <div className="full"><span>Details</span><b>{[emb.backing ? `Backing: ${emb.backing}` : "", emb.puff ? (emb.puffNote && !/all of it/.test(emb.puffNote) ? emb.puffNote : "3D puff") : "", emb.metallic ? "Metallic thread" : ""].filter(Boolean).join(" · ")}</b></div>}
            {sw.note && <div className="full so-note"><b>Note:</b> {sw.note}</div>}
          </div>
      </div>
      {/* no approval box on the PDF (Oct 29, Nick: "take the approval out… we're going to use this system"): the customer
          approves on their proof page; what they said shows here once they have */}
      {ok && <div className="pf-appr">Approved{sw.approved_via === "staff" ? "" : " online"}: {ok}</div>}
      {sw.status === "changes" && sw.customer_comment && <div className="pf-appr bad">Changes asked: {sw.customer_comment}</div>}
      <div className="foot"><span>Sew-out v{sw.version} · #{o.number} {o.nickname}{who ? ` · ${who}` : ""}</span><span>Page 1 of 1</span></div>
    </section>
  );
}
