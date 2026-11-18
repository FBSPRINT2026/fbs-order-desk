import { normSize } from "@/lib/ai/normalize";
import { mergeProduction, needsForPrintavo } from "@/lib/production";
import { LOCATIONS, newGLine, newImprint, uid, type GLine, type Group, type Imprint } from "@/lib/pricing";

/**
 * A Printavo job's garments, sizes and prints in our order format: one reading of Printavo's groups, used by every way
 * an old job comes over (a reorder, a portal reorder, editing it here: lib/printavoEdit.ts). Each line keeps Printavo's
 * price (pvPrice, $0 included).
 */
export type PvRow = { id: string; visual_id: string | number | null; nickname: string | null; qty: number | null; status_name: string; order_date: string | null; files: Record<string, string> | null;
  data: { files?: { full?: string; mime?: string; name?: string }[] | null; groups?: { lines?: { itemNumber?: string; brand?: string; color?: string; description?: string; items?: number | null; category?: string | null; sizes?: Record<string, number>; mockups?: { full?: string; mime?: string; thumb?: string }[]; price?: number | null }[] | null; imprints?: { column?: string; details?: string; typeOfWork?: string }[] | null }[] } | null };

/** a Printavo invoice's groups in the portal's order format: garments, sizes, print locations and colors, mockups */
export function groupsFromPrintavo(row: PvRow, prodData: unknown): Group[] {
  const ps = mergeProduction(prodData);
  const out: Group[] = [];
  for (const g of row.data?.groups || []) {
    const lines: GLine[] = [];
    const mockups: { path: string; name: string }[] = [], pdfs: { path: string; name: string }[] = [];
    for (const pl of g.lines || []) {
      const l = newGLine();
      l.style = (pl.itemNumber || "").trim().slice(0, 40);
      l.brand = (pl.brand || "").trim().slice(0, 40);
      l.color = (pl.color || "").trim().slice(0, 60);
      l.garment = (pl.description || "").split(/\r?\n/)[0].replace(new RegExp(`^${(pl.brand || "").replace(/[^\w ]/g, ".")}\\s*-?\\s*`, "i"), "").trim().slice(0, 120);
      // older Printavo jobs often have the garment only in the description ("Next level 6210 - Forest Green")
      if (!l.style || !l.color) {
        for (const ln of (pl.description || "").split(/\r?\n/).slice(1, 6)) {
          const m = ln.trim().match(/^(.*?)\b([A-Za-z]{0,4}\d{3,5}[A-Za-z]{0,4})\s*[-–:]\s*(.+)$/);
          if (!m) continue;
          if (!l.style) l.style = m[2].slice(0, 40);
          if (!l.brand && m[1].trim()) l.brand = m[1].trim().slice(0, 40);
          if (!l.color) l.color = m[3].trim().slice(0, 60);
          break;
        }
      }
      for (const [k, q] of Object.entries(pl.sizes || {})) { const z = normSize(k); const n = Math.floor(+q || 0); if (z && n > 0) l.sizes[z] = (l.sizes[z] || 0) + n; }
      if (!Object.keys(l.sizes).length && !(pl.items || 0)) continue;
      if (!Object.keys(l.sizes).length && pl.items) { l.sizes.OS = Math.floor(+pl.items); l.oneSize = true; }
      // last time's price, for a reorder that keeps it (Nov 1, Nick: "if I just copy this in Printavo exactly the way it is")
      if (pl.price != null && !isNaN(+pl.price)) (l as GLine & { pvPrice?: number }).pvPrice = +pl.price;
      lines.push(l);
      for (const m of pl.mockups || []) {
        const p = m.full ? row.files?.[m.full] : "";
        // our own old mockups (not the customer's): kept for reference, never stamped "customer supplied"
        if (p && /\.(png|jpe?g|gif|webp)$/i.test(p)) mockups.push({ path: p, name: `Printavo #${row.visual_id} mockup${p.match(/\.[a-z]+$/i)?.[0] || ".png"}` });
        // our old Illustrator mockup sheets: the art is pulled out of them when the reorder is made
        else if (p && /\.pdf$/i.test(p)) pdfs.push({ path: p, name: `Printavo #${row.visual_id} mockup.pdf` });
      }
    }
    if (!lines.length) continue;
    const steps = needsForPrintavo(ps, { qty: row.qty, status_name: row.status_name || "", nickname: row.nickname || "", data: { groups: [g as never] } }).flatMap((n) => n.steps);
    const imprints: Imprint[] = steps.map((st) => {
      // Printavo's sides ("Front", "Back") as our locations: the art pulled from the mockup refines them
      const loc = /^front$/i.test(st.location || "") ? "Full Front" : /^back$/i.test(st.location || "") ? "Full Back" : st.location || "Full Front";
      const im = newImprint(LOCATIONS.includes(loc) ? loc : "Full Front");
      im.method = st.method === "embroidery" ? "embroidery" : st.method === "heat" ? "dtf" : "screen";
      im.colors = Math.max(1, st.colors || 1);
      im.notes = `From Printavo #${row.visual_id}${st.note ? ` (${st.note})` : ""}`;
      // Printavo didn't keep the print size or ink: production confirms them before printing
      im.confirm = { size: true, ink: true, why: `Reorder of Printavo #${row.visual_id}, which has no size or ink on file` };
      return im;
    });
    // the job's own files (not on a line): the first group, and any group with none of its own (Nov 1: Count Joy's
    // mockups "Count It All Joy Pull - Adult.png" were job files, and its line "mockups" were S&S paperwork)
    if (!out.length || (!mockups.length && !pdfs.length)) {
      for (const f of row.data?.files || []) {
        const p = f.full ? row.files?.[f.full] : "";
        const nm = String(f.name || "").trim();
        if (p && /\.(png|jpe?g|gif|webp)$/i.test(p)) mockups.push({ path: p, name: nm || `Printavo #${row.visual_id} file${p.match(/\.[a-z]+$/i)?.[0] || ".png"}` });
        else if (p && /\.pdf$/i.test(p)) pdfs.push({ path: p, name: nm || `Printavo #${row.visual_id} file.pdf` });
      }
    }
    out.push({ id: uid(), lines, imprints, ...(mockups.length ? { pvRef: [...new Map(mockups.map((x) => [x.path, x])).values()].slice(0, 6) } : {}), ...(pdfs.length ? { pvArt: [...new Map(pdfs.map((x) => [x.path, x])).values()].slice(0, 5) } : {}) });
  }
  return out;
}

