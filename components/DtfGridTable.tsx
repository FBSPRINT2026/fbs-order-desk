"use client";
import { DTF_GRID, type DtfGrid } from "@/lib/dtfGrid";

/**
 * The DTF grid (lib/dtfGrid.ts), one table everywhere it shows: the customer's price list (pressed price each, by print
 * size and pieces, with the pressing row for their own transfers) and Settings → Pricing / Wholesale (the transfer and
 * pressing prices, editable). Nov 4, Nick.
 */
const m = (n: number) => (n < 1 ? `$${n.toFixed(2).replace(/^0/, "")}` : `$${n.toFixed(2)}`);
const rng = (q: number[], i: number) => (i < q.length - 1 ? `${q[i].toLocaleString()}–${(q[i + 1] - 1).toLocaleString()}` : `${q[i].toLocaleString()}+`);
const EX = ["4×4", "8×10", "12×12", "12×18"];
const sizeNote = (g: DtfGrid, i: number) => `up to ${g.sizes[i].max} sq in${EX[i] ? `, like ${EX[i]}` : ""}`;

export default function DtfGridTable({ grid, onChange }: { grid?: DtfGrid; onChange?: (g: DtfGrid) => void }) {
  const g = grid || DTF_GRID;
  const press = g.press || DTF_GRID.press!;
  const set = (i: number, k: number, v: number) => onChange?.({ ...g, price: g.price.map((r, a) => r.map((x, b) => (a === i && b === k ? v : x))) });
  const setPress = (k: number, v: number) => onChange?.({ ...g, press: press.map((x, b) => (b === k ? v : x)) });
  const cell = (label: string, v: number, put: (v: number) => void) => onChange
    ? <input type="number" step="0.05" min="0" aria-label={label} value={v} onChange={(e) => put(+e.target.value || 0)} />
    : m(v);
  return (
    <table className="tbl dfg" data-nofit>
      <thead><tr><th>{onChange ? "Transfer each" : "We order and press"}</th>{g.qty.map((_, k) => <th key={k} className="dfg-n">{rng(g.qty, k)}</th>)}</tr></thead>
      <tbody>
        {g.sizes.map((z, i) => (
          <tr key={z.name}>
            <th scope="row">{z.name}<div className="sub">{sizeNote(g, i)}</div></th>
            {g.qty.map((_, k) => <td key={k} className="dfg-n">{cell(`${z.name}, ${rng(g.qty, k)} pieces`, onChange ? g.price[i]?.[k] ?? 0 : (g.price[i]?.[k] ?? 0) + (press[k] ?? 0), (v) => set(i, k, v))}</td>)}
          </tr>
        ))}
        <tr className="dfg-press">
          <th scope="row">{onChange ? "Pressing" : "Your own transfers"}<div className="sub">{onChange ? "per location, added to the transfer; also their own transfers" : "we press them, per location"}</div></th>
          {g.qty.map((_, k) => <td key={k} className="dfg-n">{cell(`Pressing, ${rng(g.qty, k)} pieces`, press[k] ?? 0, (v) => setPress(k, v))}</td>)}
        </tr>
      </tbody>
    </table>
  );
}
