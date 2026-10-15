import { colorHex, WILFLEX_HEX } from "@/lib/inkColors";
import { calcOrder, designOther, inkNames, isLightColor, isPmsInk, lineQty, needsUnderbase, sizeLabel, FULL_COLOR, METHODS, SIZES, type Customer, type Design, type Group, type Imprint, type Order, type Payment, type Settings } from "@/lib/pricing";
import { money, parseDate } from "@/lib/format";
import { qrSvg } from "@/lib/qr";
import { jobLink } from "@/lib/zpl";
import { spotFor } from "@/lib/mockup";

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
const fmtIn = (n: number) => (n ? `${+n.toFixed(2)}"` : `?"`);

/** the print's size in inches: the size typed ("8\" wide") and the other side from the art's proportions */
export function printSize(d: Imprint, des?: Design | null) {
  const m = (d.size || "").match(/^([\d.]+)\D*(wide|tall)?/i);
  const val = m ? +m[1] : 0, given: "W" | "H" = m && /tall/i.test(m[2] || "") ? "H" : "W";
  const other = des && val ? designOther(des, val, given) : 0;
  const w = given === "W" ? val : other, h = given === "W" ? other : val;
  return { w, h, label: val ? `${fmtIn(w)} × ${fmtIn(h)}` : d.size || "" };
}
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
                        {inkNames(d.inks).length > 0 && <div className="s">{inkNames(d.inks).map((k, i) => <span key={k}>{i > 0 ? ", " : ""}<Swatch c={colorHex(k) || "#ccc"} /><b>{k}</b></span>)}</div>}
                        <div className="s">{sz.label && <><b>{sz.label}</b> · </>}{dropLabel(d)}</div>
                        {sc && <div className="s">{sc.n ? `${sc.n} screen${sc.n === 1 ? "" : "s"}` : "Screens: see separations"} · {sc.under ? "underbase" : "no underbase"}</div>}
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
      : [["Print size", sz.label || "—"], ["Drop", d.drop ? `${d.drop}"` : "Standard"], ["Screens", sc?.n ? String(sc.n) : "—"], ["Underbase", sc?.under ? "Yes" : "No"]];
  const inkRows = d.method === "dtf" ? [] : inks.length ? inks : Array.from({ length: d.colors >= FULL_COLOR ? 0 : Math.max(1, d.colors || 1) }, () => "");
  return (
    <section className="sheet">
      <div className="p2h"><div className="t disp">{o.nickname} · #{o.number}</div><div className="r">Print {di + 1} of {n} · {qty} pcs{colors ? ` · ${colors}` : ""}{groups.length > 1 ? ` · ${groups[gi].name || `Group ${gi + 1}`}` : ""}</div></div>
      <div className="loc"><div className="n disp">{(d.location || "Print").toUpperCase()}</div><div className="m">{METHODS[d.method] || d.method} · {colorsLabel(d)} · {dropLabel(d)}</div></div>
      <div className={"art" + (isDark(hex) ? " dark" : "")} style={{ background: hex }}>
        {max && s > 0 && <div className="area" style={{ top: `${top}in`, width: `${max.w * s}in`, height: `${max.h * s}in` }}><span>max {max.w}&quot; × {max.h}&quot;{max.on ? ` on the ${max.on}` : ""}</span></div>}
        {pic ? <img className="pic" src={pic} alt={des ? `D-${des.number}` : ""} style={{ top: `${top}in`, width: `${aw}in`, height: `${ah}in` }} /> : <div className="none">No art picked for this print</div>}
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
            {inkRows.map((k, i) => <tr key={i}><td><b>{i + 1}</b></td><td>{k ? <><Swatch c={colorHex(k) || "#ccc"} /><b>{k}</b>{inkLine(k) && <small>{inkLine(k)}</small>}</> : null}</td><td /><td /><td /><td><span className="cb" /></td></tr>)}
          </tbody>
        </table>
      ) : null}
      {(d.confirm?.size || d.confirm?.ink) && <div className="n2 warn">CONFIRM {[d.confirm.size && "SIZE", d.confirm.ink && "INK"].filter(Boolean).join(" & ")} BEFORE PRINTING{d.confirm.why ? `: ${d.confirm.why}` : ""}</div>}
      {d.notes && <div className="n2"><b>Notes:</b> {d.notes}</div>}
      <div className="foot"><span>{footL}</span><span>Page {page} of {total}</span></div>
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
          {(sh.address || sh.phone || sh.email) && <div className="sub">{[sh.address, [sh.phone, sh.email].filter(Boolean).join(" · ")].filter(Boolean).join("\n")}</div>}
        </div>
        <div className="doc">
          <div className="k disp">{kind}</div>
          <div className="n">#{o.number}</div>
          <div className="meta">Issued {issued}{o.po_number ? ` · PO ${o.po_number}` : ""}{due && <><br />In hands {due} · {DELIVERY[o.delivery_method] || "Pickup"}</>}</div>
          {paidUp && <div className="stamp">PAID</div>}
        </div>
      </div>
      <div className="parties">
        <div><div className="lbl">Bill to</div><b>{cust.company || cust.name || "—"}</b>{contact && `\n${contact}`}{cust.email && <><br /><span className="faint">{cust.email}</span></>}{cust.phone && <><br /><span className="faint">{cust.phone}</span></>}</div>
        <div><div className="lbl">Job</div><b>{o.nickname}</b>{`\n${c.qty} piece${c.qty === 1 ? "" : "s"} · ${prints} print${prints === 1 ? "" : "s"}`}{o.approved_at && <><br /><span className="faint">Approved by {o.approved_name}, {new Date(o.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}</span></>}</div>
        {o.delivery_method === "pickup"
          ? <div><div className="lbl">Pickup</div>Pickup at {sh.name}{due && <><br /><span className="faint">{due}</span></>}</div>
          : <div><div className="lbl">{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}</div>{o.ship_to || "—"}{o.ship_method && <><br /><span className="faint">{o.ship_method}</span></>}</div>}
      </div>
      {groups.map((g, gi) => {
        const gc = c.groups[gi];
        if (!gc) return null;
        const lines = g.lines.map((l, li) => ({ l, lc: gc.lines[li] })).filter((x) => x.lc && (x.lc.qty > 0 || g.lines.length === 1));
        const pic = p.mockups[gi]?.[0];
        return (
          <div className="job" key={g.id}>
            {pic ? <img className="pic" src={pic} alt="Mockup" /> : <div className="pic none">Mockup coming</div>}
            <div>
              <div className="t disp">{g.name?.trim() || (groups.length > 1 ? `Group ${gi + 1}` : o.nickname)}</div>
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
                          const how = d.method === "screen" ? (d.colors >= FULL_COLOR ? "full color screen print" : `${d.colors || 1}-color screen print`) : d.method === "embroidery" ? "embroidery" : "full color DTF transfer";
                          return <div className="prl" key={d.id}>Print: {d.location}, {how}{ink.length ? ` (${ink.join(", ")})` : ""}{sz.label ? `, ${sz.label}` : ""}</div>;
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
      {o.fees.some((f) => +f.amount) && (
        <div className="others"><table className="extra"><tbody>
          {o.fees.filter((f) => +f.amount).map((f, i) => <tr key={i}><td>{f.label || "Fee"}</td><td className="r">{money(+f.amount)}</td></tr>)}
        </tbody></table></div>
      )}
      <div className="sumw">
        <div className="pay">
          {pays.length > 0 && <p><b>Payments</b>{pays.slice().sort((a, b) => (a.paid_on || "").localeCompare(b.paid_on || "")).map((x) => `\n${day(x.paid_on, { month: "short", day: "numeric" })} · ${x.method} · ${money(x.amount)}`).join("")}</p>}
          {o.notes && <p><b>Notes</b>{`\n${o.notes}`}</p>}
          {sh.terms && <p><b>Terms</b>{`\n${sh.terms}`}</p>}
        </div>
        <div className="tot">
          <div className="r"><span>Subtotal</span><span>{money(c.items + c.setup + c.materials + c.fees)}</span></div>
          {c.discount ? <div className="r"><span>Discount{o.discount_type !== "amt" && o.discount_pct ? ` (${o.discount_pct}%)` : ""}</span><span>−{money(c.discount)}</span></div> : null}
          <div className="r"><span>Tax{o.tax_exempt ? "" : ` (${c.rate}%)`}</span><span>{o.tax_exempt ? "Exempt" : money(c.tax)}</span></div>
          <div className="r big"><span>Total</span><span>{money(c.total)}</span></div>
          {c.paid > 0 && <div className="r"><span>Paid</span><span>−{money(c.paid)}</span></div>}
          {!isQ && <div className={"bal" + (c.balance > 0.005 ? " due" : "")}><span>Balance due</span><span>{money(Math.max(0, c.balance))}</span></div>}
        </div>
      </div>
      <div className="ifoot"><div className="fade" /><div><span>Thank you for printing with {sh.name}!</span><span>{kind} #{o.number}</span></div></div>
    </section>
  );
}
