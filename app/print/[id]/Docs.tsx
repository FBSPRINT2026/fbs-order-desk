import { colorHex, WILFLEX_HEX } from "@/lib/inkColors";
import { calcOrder, printHow, termsText, inkNames, isLightColor, isPmsInk, lineQty, needsUnderbase, sizeLabel, FULL_COLOR, METHODS, SIZES, type Customer, type Design, type Group, type Imprint, type Order, type Payment, type Settings } from "@/lib/pricing";
import { money, parseDate } from "@/lib/format";
import { qrSvg } from "@/lib/qr";
import { jobLink } from "@/lib/zpl";
import { guessHex, spotFor } from "@/lib/mockup";
import { printSize } from "@/lib/groupLook";
import { fmtPhone } from "@/lib/phone";
import PaintedArt from "./PaintedArt";
import type { ReactNode } from "react";

/**
 * The invoice / quote PDF and the work order (Oct 15, Nick: "completely reimagine both. The work order will be the
 * physical paper that follows the job around: all the art large and easy to read counts"). Approved from examples:
 * work order = the job page (big mockup, prints, counts with "Counted in / By" and "Final count / By") then one page
 * per print up close (the art at 75% on the shirt color with its measurements, press fill-ins, inks); no sign-offs.
 */
export type DocData = {
  o: Order; cust: Partial<Customer>; groups: Group[]; c: ReturnType<typeof calcOrder>; settings: Settings; pays: Payment[];
  designs: Record<string, Design>; designUrls: Record<string, string>;
  /** per group: signed mockup pictures (photos only), the first is the big one */ mockups: string[][];
  /** per group: the shirt color behind the art */ hexes: string[];
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
function ArtPic({ d, des, pic, style }: { d: Imprint; des: Design | null; pic: string; style: { top: string; width: string; height: string } }) {
  const b = des?.art_box;
  const alt = des ? `D-${des.number}` : "";
  if (!b || !b.w || !b.h || !b.of?.w || !b.of?.h || (b.w >= b.of.w * 0.98 && b.h >= b.of.h * 0.98))
    return <PaintedArt className="pic" src={pic} inkMap={d.inkMap} designId={d.design_id} alt={alt} style={style} />;
  return (
    <div className="pic" style={{ ...style, overflow: "hidden" }}>
      <PaintedArt src={pic} inkMap={d.inkMap} designId={d.design_id} alt={alt}
        style={{ position: "absolute", maxWidth: "none", left: `${(-b.x / b.w) * 100}%`, top: `${(-b.y / b.h) * 100}%`, width: `${(b.of.w / b.w) * 100}%`, height: `${(b.of.h / b.h) * 100}%` }} />
    </div>
  );
}

// ───────────────────────────── work order ─────────────────────────────
export function WorkOrderDoc(p: DocData & { notes: string; shopNotes: { tag: string; body: string; by_name: string; created_at: string }[]; printed: string }) {
  const { o, cust, groups, c } = p;
  const total = groups.reduce((a, g) => a + 1 + g.imprints.length, 0);
  const starts: number[] = [];
  groups.reduce((a, g, i) => { starts[i] = a; return a + 1 + g.imprints.length; }, 1);
  const who = [cust.company, cust.name && cust.name !== cust.company ? cust.name : "", o.po_number ? `PO ${o.po_number}` : ""].filter(Boolean) as string[];
  const footL = `#${o.number} ${o.nickname}${cust.company || cust.name ? ` · ${cust.company || cust.name}` : ""}`;
  const due = day(o.due_date, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  const dueSub = [o.production_date ? `Print ${day(o.production_date, { weekday: "short", month: "short", day: "numeric" })}` : "", DELIVERY[o.delivery_method] || "Pickup"].filter(Boolean).join(" · ");
  const qr = qrSvg(jobLink(o.number), 2).svg;
  return (
    <>
      {groups.map((g, gi) => {
        const gc = c.groups[gi];
        const allLight = !g.lines.some((l) => lineQty(l) > 0 && !isLightColor(l.color, p.settings.wholesale));
        const lines = g.lines.filter((l) => lineQty(l) > 0 || g.lines.length === 1);
        const sizes = SIZES.filter((z) => lines.some((l) => l.sizes?.[z]));
        const colors = [...new Set(lines.map((l) => l.color).filter(Boolean))].join(", ");
        const mk = p.mockups[gi] || [];
        const hex = p.hexes[gi] || "#9aa1ab";
        const first = gi === 0;
        const noteParts = [
          first && p.notes ? p.notes : "",
          gc?.finishing.length ? `Finishing: ${gc.finishing.map((f) => f.name).join(", ")}` : "",
          first && o.delivery_method !== "pickup" && o.ship_to ? `${o.delivery_method === "ship" ? "Ship to" : "Deliver to"}: ${o.ship_to}${o.ship_method ? ` (${o.ship_method})` : ""}` : "",
        ].filter(Boolean);
        const pg = starts[gi];
        return (
          <div key={g.id}>
            {/* the job */}
            <section className="sheet">
              <div className="hd">
                <div>
                  <div className="lbl">Work order · #{o.number}{groups.length > 1 ? ` · group ${gi + 1} of ${groups.length}` : ""}</div>
                  <h1 className="disp">{o.nickname || "Untitled job"}</h1>
                  {who.length > 0 && <div className="who"><b>{who[0]}</b>{who.slice(1).map((x) => ` · ${x}`).join("")}</div>}
                  <div className="flags">
                    {o.rush && <span className="flag rush">RUSH</span>}
                    {groups.length > 1 && <span className="flag grp">{(g.name || `Group ${gi + 1}`).toUpperCase()}</span>}
                    {gc?.wholesale && <span className="flag cs">CUSTOMER SUPPLIED GOODS</span>}
                    {p.printavo && <span className="flag pv">RUN FROM PRINTAVO</span>}
                  </div>
                </div>
                <div className="due"><div className="lbl">In hands</div><div className="d disp">{due || "NOT SET"}</div>{dueSub && <small>{dueSub}</small>}</div>
                <div className="codes"><div className="qr" dangerouslySetInnerHTML={{ __html: qr }} /><small>Scan: setup, notes, photos, time</small></div>
              </div>
              <div className="fade" style={{ margin: "12px 0 4px" }} />
              {/* front and back (or sleeves): the mockup shows both views side by side, so it runs the full width and the
                  prints sit in a row underneath (Oct 15, Nick: "what will the mockup look like with a two sided print") */}
              <div className={"hero" + (new Set(g.imprints.map((d) => spotFor(d.location || "").view)).size > 1 ? " wide" : "") + (lines.length >= 3 ? " h3l" : lines.length === 2 ? " h2l" : "")}>
                <div className="mk">
                  {mk[0] ? <img className="big" src={mk[0]} alt="Mockup" /> : <div className="none" style={{ background: hex }}>No mockup yet</div>}
                  {mk.length > 1 && <div className="more">{mk.slice(1, 5).map((u, i) => <img key={i} src={u} alt="" />)}</div>}
                  <span>Mockup{colors ? ` · ${colors}` : ""}</span>
                </div>
                <div className={"hp" + (g.imprints.length > 2 ? " many" : "")}>
                  <div className="lbl">Prints</div>
                  {g.imprints.length === 0 && <div className="pp"><div className="s">No prints on this group.</div></div>}
                  {g.imprints.map((d, di) => {
                    const des = d.design_id ? p.designs[d.design_id] : null, sz = printSize(d, des), sc = screensOf(d, allLight);
                    return (
                      <div className="pp" key={d.id}>
                        <div className="t disp">{(d.location || "Print").toUpperCase()}</div>
                        <div className="s">{METHODS[d.method] || d.method} · <b>{colorsLabel(d)}</b></div>
                        {inkNames(d.inks).length > 0 && <div className="s inks">{inkNames(d.inks).map((k) => <span key={k} className="ink"><Swatch c={colorHex(k) || "#ccc"} /><b>{k}</b></span>)}</div>}
                        <div className="s">{sz.label && <><b>{sz.label}</b> · </>}{dropLabel(d)}</div>
                        {sc && <div className="s">{sc.n ? `${sc.n} screen${sc.n === 1 ? "" : "s"}` : "Screens: see separations"} · {d.printStyle === "fashion" ? <b>FASHION HIT: no underbase</b> : sc.under ? "underbase" : "no underbase"}</div>}
                        {(d.printStyle === "fashion" || d.softHand) && <div className="s hitf">{d.printStyle === "fashion" && <span className="flag">FASHION HIT</span>}{d.softHand && <span className="flag">SOFT HAND</span>}</div>}
                        {d.method === "embroidery" && d.stitches ? <div className="s">{d.stitches.toLocaleString()} stitches</div> : null}
                        {(d.confirm?.size || d.confirm?.ink) && <div className="warn">CONFIRM {[d.confirm.size && "SIZE", d.confirm.ink && "INK"].filter(Boolean).join(" & ")} BEFORE PRINTING</div>}
                        <div className="s f">Close-up on page {pg + 1 + di} ›</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <h2>Garments <span>{gc?.qty || 0} pieces · write the counts in the boxes</span></h2>
              <table className="cnt">
                <thead><tr><th>Garment</th>{sizes.map((z) => <th key={z} className="sz">{sizeLabel(z)}</th>)}<th className="sz" style={{ width: ".85in" }}>Total</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <LineRows key={l.id} l={l} sizes={sizes} hex={p.hexes[gi]} single={lines.length === 1} />
                  ))}
                </tbody>
              </table>
              <h2>Notes</h2>
              <div className="notes">
                {noteParts.join("\n\n")}
                {first && (p.cust.brand_print?.rules || []).length > 0 && <div className="sn"><b>BRAND RULES: </b>{p.cust.brand_print!.rules!.join(" · ")}</div>}
                {first && p.shopNotes.map((n, i) => <div className="sn" key={i}>{n.tag ? <b>{n.tag.toUpperCase()}: </b> : null}{n.body} <small>({n.by_name}, {new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })})</small></div>)}
              </div>
              <div className="foot"><span>{footL}</span><span>Page {pg} of {total} · printed {p.printed}</span></div>
            </section>
            {/* each print up close */}
            {g.imprints.map((d, di) => (
              <CloseUp key={d.id} d={d} di={di} n={g.imprints.length} p={p} gi={gi} allLight={allLight} colors={colors} qty={gc?.qty || 0} page={pg + 1 + di} total={total} footL={footL} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function LineRows({ l, sizes, hex, single }: { l: Group["lines"][number]; sizes: readonly string[]; hex: string; single: boolean }) {
  const q = lineQty(l);
  const boxes = (
    <>{sizes.map((z) => <td key={z} className="sz"><div /></td>)}<td className="sz"><div /></td></>
  );
  return (
    <>
      <tr>
        <td className="g"><b>{[l.style, l.brand].filter(Boolean).join(" · ") || "Garment"}</b><br /><Swatch c={single ? hex : colorHex(l.color) || hex} />{[l.color, l.garment].filter(Boolean).join(" · ")}</td>
        {sizes.map((z) => <td key={z} className="sz">{l.sizes?.[z as keyof typeof l.sizes] ? <b>{l.sizes[z as keyof typeof l.sizes]}</b> : ""}</td>)}
        <td className="tot"><b>{q}</b></td>
      </tr>
      <tr className="counted"><td>Counted in<div className="by">By ____________</div></td>{boxes}</tr>
      <tr className="counted last"><td>Final count<div className="by">By ____________</div></td>{boxes}</tr>
    </>
  );
}

function CloseUp({ d, di, n, p, gi, allLight, colors, qty, page, total, footL }: { d: Imprint; di: number; n: number; p: DocData; gi: number; allLight: boolean; colors: string; qty: number; page: number; total: number; footL: string }) {
  const { o, groups } = p;
  const des = d.design_id ? p.designs[d.design_id] : null, pic = des ? p.designUrls[des.id] : "";
  const sz = printSize(d, des), sc = screensOf(d, allLight), max = p.maxes[gi]?.[di] || null;
  const hex = p.hexes[gi] || "#9aa1ab";
  // the art at 75%: scaled so it fills about three quarters of the panel, with its real measurements drawn on
  const s = sz.w && sz.h ? Math.min(4.8 / sz.w, 3.3 / sz.h) : sz.w ? 4.8 / sz.w : 0;
  const aw = s ? sz.w * s : 4.8, ah = s && sz.h ? sz.h * s : 3.3, top = 0.42;
  const inks = inkNames(d.inks);
  const fills = d.method === "embroidery" ? ["Machine", "Hoop", "Backing", "Trims"] : d.method === "dtf" ? ["Press temp", "Time", "Pressure", "Peel"] : ["Press", "Platen", "Flash / cure", "Off-contact"];
  const specs: [string, string][] = d.method === "embroidery"
    ? [["Size", sz.label || "—"], ["Drop", d.drop ? `${d.drop}"` : "Standard"], ["Stitches", d.stitches ? d.stitches.toLocaleString() : "—"], ["Threads", String(d.colors || inks.length || "—")]]
    : d.method === "dtf"
      ? [["Print size", sz.label || "—"], ["Drop", d.drop ? `${d.drop}"` : "Standard"], ["Transfer", "Full color"], ["Pieces", String(qty)]]
      : [["Print size", sz.label || "—"], ["Drop", d.drop ? `${d.drop}"` : "Standard"], ["Screens", sc?.n ? String(sc.n) : "—"], ["Underbase", d.printStyle === "fashion" ? "NO · fashion hit" : sc?.under ? "Yes" : "No"]];
  const inkRows = d.method === "dtf" ? [] : inks.length ? inks : Array.from({ length: d.colors >= FULL_COLOR ? 0 : Math.max(1, d.colors || 1) }, () => "");
  return (
    <section className="sheet">
      <div className="p2h"><div className="t disp">{o.nickname} · #{o.number}</div><div className="r">Print {di + 1} of {n} · {qty} pcs{colors ? ` · ${colors}` : ""}{groups.length > 1 ? ` · ${groups[gi].name || `Group ${gi + 1}`}` : ""}</div></div>
      <div className="loc"><div className="n disp">{(d.location || "Print").toUpperCase()}</div><div className="m">{METHODS[d.method] || d.method} · {colorsLabel(d)} · {dropLabel(d)}</div></div>
      <div className={"art" + (isDark(hex) ? " dark" : "")} style={{ background: hex }}>
        {max && s > 0 && <div className="area" style={{ top: `${top}in`, width: `${max.w * s}in`, height: `${max.h * s}in` }}><span>max {max.w}&quot; × {max.h}&quot;{max.on ? ` on the ${max.on}` : ""}</span></div>}
        {pic ? <ArtPic d={d} des={des} pic={pic} style={{ top: `${top}in`, width: `${aw}in`, height: `${ah}in` }} /> : <div className="none">No art picked for this print</div>}
        {pic && sz.w > 0 && <div className="dimw" style={{ top: `${top + ah + 0.06}in`, width: `${aw}in` }}>{sz.w.toFixed(2)}&quot;</div>}
        {pic && sz.h > 0 && <div className="dimh" style={{ top: `${top}in`, height: `${ah}in`, left: `calc(50% + ${aw / 2 + 0.14}in)` }}>{sz.h.toFixed(2)}&quot;</div>}
      </div>
      <div className="specs">
        {specs.map(([k, v]) => <div className="sp" key={k}><div className="lbl">{k}</div><div className="v">{v}</div></div>)}
        {fills.map((k) => <div className="sp" key={k}><div className="lbl">{k}</div><div className="v fill" /></div>)}
      </div>
      {d.method === "embroidery" ? (
        <table className="ink">
          <thead><tr><th style={{ width: ".4in" }}>#</th><th>Thread</th><th className="w">Needle</th><th style={{ width: ".7in" }}>Done</th></tr></thead>
          <tbody>{inkRows.map((k, i) => <tr key={i}><td><b>{i + 1}</b></td><td>{k ? <><Swatch c={colorHex(k) || "#ccc"} /><b>{k}</b></> : null}</td><td /><td><span className="cb" /></td></tr>)}</tbody>
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
      {(d.confirm?.size || d.confirm?.ink) && <div className="n2 warn">CONFIRM {[d.confirm.size && "SIZE", d.confirm.ink && "INK"].filter(Boolean).join(" & ")} BEFORE PRINTING{d.confirm.why ? `: ${d.confirm.why}` : ""}</div>}
      {d.notes && <div className="n2"><b>Notes:</b> {d.notes}</div>}
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
    for (let i = 0; i < mk.length; i++) extra.push([mk[i]]);
    return { mk, extra, prints: g.imprints.length };
  });
  const total = plan.reduce((a, x) => a + 1 + x.extra.length + x.prints, 0);
  let page = 0;
  const foot = () => { page++; return <div className="foot"><span>Art proof{p.version ? ` v${p.version}` : ""} · #{o.number} {o.nickname}{who ? ` · ${who}` : ""}</span><span>Page {page} of {total}</span></div>; };
  const approved = o.approved_at ? `${o.approved_name || "Approved"}, ${new Date(o.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}` : "";
  return (
    <>
      {groups.map((g, gi) => {
        const { mk, extra } = plan[gi];
        const hex = p.hexes[gi] || "#9aa1ab";
        const shown = g.lines.filter((l) => l.style || l.color);
        const lines = shown.filter((l) => lineQty(l) > 0 || shown.length === 1);
        // each mockup picture is one garment (in the order they were saved)
        const capOf = (i: number) => { const l = shown[i]; return l ? [[l.brand, l.style].filter(Boolean).join(" "), l.color].filter(Boolean).join(" · ") : ""; };
        const gname = groups.length > 1 ? (g.name?.trim() || `Group ${gi + 1}`) : "";
        return (
          <div key={g.id}>
            <section className="sheet pf">
              <div className="top">
                <div className="brand"><img src={sh.logoUrl || "/brand/fbs-logo.svg"} alt={sh.name} />
                  {(sh.phone || sh.email) && <div className="sub">{[fmtPhone(sh.phone), sh.email].filter(Boolean).join(" · ")}</div>}</div>
                <div className="doc"><div className="k disp">Art Proof</div><div className="n">#{o.number}{p.version ? ` · Version ${p.version}` : ""}{gname ? ` · ${gname}` : ""}</div><div className="meta">Prepared {p.printed}</div>
                  {approved && <div className="stamp">APPROVED</div>}</div>
              </div>
              <div className="pf-who">
                <div><div className="lbl">For</div><b>{cust.company || cust.name || "—"}</b>{cust.company && cust.name && cust.name !== cust.company && <div className="faint">{cust.name}</div>}{cust.email && <div className="faint">{cust.email}</div>}</div>
                <div><div className="lbl">Job</div><b>{o.nickname || "—"}</b>{o.po_number && <div className="faint">PO {o.po_number}</div>}</div>
                <div><div className="lbl">In hands</div><b>{due || "To be set"}</b><div className="faint">{DELIVERY[o.delivery_method] || "Pickup"}</div></div>
              </div>
              {/* the prints at a glance on the shirt color; the mockups follow, full size */}
              <div className={"pf-tiles" + (g.imprints.length > 2 ? " many" : "")}>
                {g.imprints.map((d) => {
                  const des = d.design_id ? p.designs[d.design_id] : null, pic = des ? p.designUrls[des.id] : "", sz = printSize(d, des);
                  return (
                    <div className="pf-tile" key={d.id}>
                      <div className={"pf-tile-art" + (isDark(hex) ? " dark" : "")} style={{ background: hex }}>
                        {pic ? <PaintedArt src={pic} inkMap={d.inkMap} designId={d.design_id} alt={des ? `D-${des.number}` : ""} /> : <span>Art coming</span>}
                      </div>
                      <div className="pf-tile-l"><b>{d.location}</b>{sz.label ? ` · ${sz.label}` : ""}</div>
                    </div>
                  );
                })}
                {g.imprints.length === 0 && (mk[0] ? <div className="pf-tile"><div className="pf-tile-art"><img src={mk[0]} alt="Mockup" /></div></div> : <div className="pf-tile"><div className="pf-tile-art" style={{ background: hex }}><span>Mockup coming</span></div></div>)}
              </div>
              {mk.length > 0 && <div className="pf-next">Mockups on the next page{mk.length > 1 ? "s" : ""}, one garment per page · each print up close after that</div>}
              <div className="pf-sum">
                <div>
                  <div className="lbl">Prints</div>
                  {g.imprints.length === 0 && <div className="pf-pr">No prints on this group.</div>}
                  {g.imprints.map((d) => {
                    const des = d.design_id ? p.designs[d.design_id] : null, sz = printSize(d, des), ink = inkNames(d.inks);
                    return (
                      <div className="pf-pr" key={d.id}>
                        <b>{d.location}</b> · {printHow(d)}{sz.label ? <> · <b>{sz.label}</b></> : null}
                        {ink.length > 0 && <div className="pf-inks">{ink.map((k) => <span key={k}><Swatch c={colorHex(k) || "#ccc"} />{k}</span>)}</div>}
                      </div>
                    );
                  })}
                </div>
                <div>
                  <div className="lbl">Garments</div>
                  {lines.map((l) => <div className="pf-pr" key={l.id}><Swatch c={colorHex(l.color) || guessHex(l.color) || hex} /><b>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}{l.garment ? <div className="faint">{l.garment}</div> : null}</div>)}
                </div>
              </div>
              <div className="pf-ok">
                <div className="t">Please check everything before you approve</div>
                <div className="s">Spelling, art, ink colors, print sizes and placement. Ink colors are matched to the names listed (PMS or stock ink); colors on a screen or a home printer are close but not exact. Sizes are the printed size on the garment. We start production once this proof is approved.</div>
                <div className="pf-boxes"><span><i className="cb" /> Approved as shown</span><span><i className="cb" /> Approved with the changes noted</span><span><i className="cb" /> Changes needed, send a new proof</span></div>
                <div className="pf-sign"><div>Signature</div><div>Name</div><div>Date</div></div>
                {approved && <div className="s ok">Approved online: {approved}</div>}
              </div>
              {foot()}
            </section>
            {extra.map((pair, xi) => (
              <section className="sheet pf" key={"m" + xi}>
                <div className="p2h"><div className="t disp">{capOf(xi) || "Mockup"}{gname ? ` · ${gname}` : ""}</div><div className="r">#{o.number} · {o.nickname}</div></div>
                {pair.map((u, ui) => { const i = xi + ui; return <div className={"pf-mk" + (pair.length === 1 ? " one" : "")} key={u}><img src={u} alt="Mockup" /></div>; })}
                {foot()}
              </section>
            ))}
            {g.imprints.map((d, di) => <ProofPrint key={d.id} d={d} di={di} n={g.imprints.length} p={p} gi={gi} gname={gname} foot={foot()} />)}
          </div>
        );
      })}
    </>
  );
}

function ProofPrint({ d, di, n, p, gi, gname, foot }: { d: Imprint; di: number; n: number; p: DocData; gi: number; gname: string; foot: ReactNode }) {
  const { o } = p;
  const des = d.design_id ? p.designs[d.design_id] : null, pic = des ? p.designUrls[des.id] : "";
  const sz = printSize(d, des), max = p.maxes[gi]?.[di] || null;
  const hex = p.hexes[gi] || "#9aa1ab";
  // the art as big as the panel takes (7.6" × 5.9"), its real measurements drawn on
  const PW = 6.6, PH = 5.7;
  const s = sz.w && sz.h ? Math.min(PW / sz.w, PH / sz.h) : sz.w ? PW / sz.w : 0;
  const aw = s ? sz.w * s : PW, ah = s && sz.h ? sz.h * s : PH, top = 0.45;
  const inks = inkNames(d.inks);
  const specs: [string, string][] = [
    ["Location", d.location || "—"], ["Print size", sz.label || "—"], ["Placement", d.drop ? `${d.drop}" below the collar` : "Standard"],
    ["Print", printHow(d)],
  ];
  return (
    <section className="sheet pf">
      <div className="p2h"><div className="t disp">{(d.location || "Print")}</div><div className="r">Print {di + 1} of {n}{gname ? ` · ${gname}` : ""} · #{o.number}</div></div>
      <div className={"art pf-art" + (isDark(hex) ? " dark" : "")} style={{ background: hex }}>
        {max && s > 0 && max.w * s < 7.4 && <div className="area" style={{ top: `${top}in`, width: `${max.w * s}in`, height: `${max.h * s}in` }}><span>largest print area {max.w}&quot; × {max.h}&quot;</span></div>}
        {pic ? <ArtPic d={d} des={des} pic={pic} style={{ top: `${top}in`, width: `${aw}in`, height: `${ah}in` }} /> : <div className="none">Art coming</div>}
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
      {d.notes && <div className="n2"><b>Notes:</b> {d.notes}</div>}
      {foot}
    </section>
  );
}

// ───────────────────────────── invoice / quote ─────────────────────────────
const SETUP_LABEL = (k: string, q: number) => ({
  screens: `Setup: ${q} screen${q === 1 ? "" : "s"}`, remake: `Screen remake: ${q} screen${q === 1 ? "" : "s"}`, digitize: "Digitizing",
  pms: `PMS color match${q > 1 ? ` × ${q}` : ""}`, inkchange: `Ink changes${q > 1 ? ` × ${q}` : ""}`, min: "Minimum order charge",
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
            {pic ? <img className="pic" src={pic} alt="Mockup" /> : <div className="pic none">Mockup coming</div>}
            <div>
              <table className="it">
                <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Each</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {lines.map(({ l, lc }, i) => (
                    <tr key={l.id}>
                      <td>
                        <b>{[l.brand, l.style, l.garment].filter(Boolean).join(" ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}{gc.wholesale && <span className="faint"> (your garments)</span>}
                        <div className="chips">{SIZES.filter((z) => l.sizes?.[z]).map((z) => <span className="chip" key={z}>{sizeLabel(z)} <b>{l.sizes[z]}</b></span>)}</div>
                        {i === lines.length - 1 && g.imprints.map((d) => {
                          const sz = printSize(d, d.design_id ? p.designs[d.design_id] : null), ink = inkNames(d.inks);
                          const how = printHow(d);
                          // the print on one line, its inks as small swatches under it (Oct 16, Nick: the ink names wrapped
                          // across the line and looked messy)
                          return (
                            <div className="prl" key={d.id}>
                              <div><b>{d.location}</b> · {how}{sz.label ? ` · ${sz.label}` : ""}</div>
                              {ink.length > 0 && <div className="prl-inks">{ink.map((n) => { const hx = colorHex(n); return <span className="prl-ink" key={n}><i style={{ background: hx || "transparent" }} />{n}</span>; })}</div>}
                            </div>
                          );
                        })}
                        {i === lines.length - 1 && gc.finishing.length > 0 && <div className="prl">Finishing: {gc.finishing.map((f) => f.name).join(", ")}</div>}
                      </td>
                      <td className="r">{lc.qty}</td><td className="r">{money(lc.each)}</td><td className="r"><b>{money(lc.sub)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(gc.setupItems.length > 0 || gc.materials > 0) && (
                <table className="extra"><tbody>
                  {gc.setupItems.map((s, i) => <tr key={i}><td>{SETUP_LABEL(s.kind, s.qty)}</td><td className="r">{money(s.amount)}</td></tr>)}
                  {gc.materials > 0 && <tr><td>2XL+ materials</td><td className="r">{money(gc.materials)}</td></tr>}
                </tbody></table>
              )}
            </div>
          </div>
        );
      })}
      {o.fees.some((f) => +f.amount || (f as { free?: boolean }).free) && (
        <div className="others"><table className="extra"><tbody>
          {o.fees.filter((f) => +f.amount || (f as { free?: boolean }).free).map((f, i) => <tr key={i}><td>{f.label || "Fee"}</td><td className="r">{(f as { free?: boolean }).free ? "Free" : money(+f.amount)}</td></tr>)}
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
          <div className="r big"><span>Total</span><span>{money(c.total)}</span></div>
          {c.paid > 0 && <div className="r"><span>Paid</span><span>−{money(c.paid)}</span></div>}
          {!isQ && <div className="r bal2"><span>Balance due</span><span>{money(Math.max(0, c.balance))}</span></div>}
        </div>
      </div>
      <div className="ifoot"><div className="fade" /><div><span>Thank you for printing with {sh.name}!</span><span>{kind} #{o.number}</span></div></div>
    </section>
  );
}
