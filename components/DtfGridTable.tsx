"use client";
import { DTF_GRID, type DtfGrid } from "@/lib/dtfGrid";

/**
 * The DTF transfer grid (lib/dtfGrid.ts), one table everywhere it shows: the customer's price list (pressed price each,
 * by print size and pieces) and Settings → Pricing / Wholesale (the transfer price, editable). Nov 4, Nick.
 */
const m = (n: number) => (n < 1 ? `$${n.toFixed(2).replace(/^0/, "")}` : `$${n.toFixed(2)}`);
const rng = (q: number[], i: number) => (i < q.length - 1 ? `${q[i].toLocaleString()}–${(q[i + 1] - 1).toLocaleString()}` : `${q[i].toLocaleString()}+`);
const EX = ["4×4", "8×10", "12×12", "12×18"];
const sizeNote = (g: DtfGrid, i: number) => `up to ${g.sizes[i].max} sq in${EX[i] ? `, like ${EX[i]}` : ""}`;

export default function DtfGridTable({ grid, press, onChange }: { grid?: DtfGrid; /** added to each price shown (the customer's list) */ press?: number; onChange?: (g: DtfGrid) => void }) {
  const g = grid || DTF_GRID;
  const set = (i: number, k: number, v: number) => { const next: DtfGrid = { ...g, price: g.price.map((r, a) => r.map((x, b) => (a === i && b === k ? v : x))) }; onChange?.(next); };
  return (
    <table className="tbl dfg" data-nofit>
      <thead><tr><th>Print size</th>{g.qty.map((_, k) => <th key={k} className="dfg-n">{rng(g.qty, k)}</th>)}</tr></thead>
      <tbody>{g.sizes.map((z, i) => (
        <tr key={z.name}>
          <th scope="row">{z.name}<div className="sub">{sizeNote(g, i)}</div></th>
          {g.qty.map((_, k) => (
            <td key={k} className="dfg-n">{onChange
              ? <input type="number" step="0.05" min="0" aria-label={`${z.name}, ${rng(g.qty, k)} pieces`} value={g.price[i]?.[k] ?? 0} onChange={(e) => set(i, k, +e.target.value || 0)} />
              : m((g.price[i]?.[k] ?? 0) + (press || 0))}</td>
          ))}
        </tr>
      ))}</tbody>
    </table>
  );
}
