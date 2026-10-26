"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import GangReorder from "@/components/GangReorder";

/**
 * A customer's DTF gang sheets, under Artwork on their page, staff only (Oct 26, Nick: "just like we save mockups, we
 * should have gang sheets be there so that we can see them by customer… here was a gang sheet for this client. And
 * that's only viewable by staff"). Each opens in the Gang sheet builder, and Reorder sheet asks which logos and how many,
 * done the same way as last time, then opens the new sheet (Oct 26, Nick).
 */
type Row = { id: string; name: string; owner: string; status: string; updated_at: string; supplier_order: string | null; data: { logos?: { vers: { qty: number }[] }[]; jobs?: { job: string }[] } };
export default function CustomerGangSheets({ customerId }: { customerId: string }) {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reorder, setReorder] = useState("");
  useEffect(() => {
    void sb.from("gang_sheets").select("id, name, owner, status, updated_at, supplier_order, data").eq("customer_id", customerId).is("archived_at", null).order("updated_at", { ascending: false }).limit(30)
      .then(({ data }) => setRows((data || []) as Row[]));
  }, [sb, customerId]);
  if (!rows || !rows.length) return null;
  const who = (e: string) => { const n = (e || "").split("@")[0]; return n ? n[0].toUpperCase() + n.slice(1) : ""; };
  const pcs = (r: Row) => (r.data?.logos || []).reduce((a, l) => a + l.vers.reduce((b, v) => b + (+v.qty || 0), 0), 0);
  return (
    <div className="aa-gang">
      <div className="aa-sec-h"><h3>Gang sheets</h3><span className="faint">DTF transfers, staff only</span></div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Sheet</th><th>Jobs</th><th className="r">Pieces</th><th>By</th><th>Updated</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td><a href={`/shop/gang-sheet?sheet=${r.id}`} data-notranslate>{r.name || "Gang sheet"}</a></td>
            <td className="num">{[...new Set((r.data?.jobs || []).map((j) => j.job).filter(Boolean))].map((j) => `#${j}`).join(", ") || <span className="faint">—</span>}</td>
            <td className="r num">{pcs(r)}</td>
            <td>{who(r.owner)}</td>
            <td className="num">{new Date(r.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
            <td>{r.status === "ordered" ? `Ordered${r.supplier_order ? ` #${r.supplier_order}` : ""}` : "Open"}</td>
            <td className="r">{(r.data?.logos || []).length > 0 && <button type="button" className="btn sm" onClick={() => setReorder(r.id)}>Reorder sheet</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {reorder && <GangReorder sheetId={reorder} customerId={customerId} onClose={() => setReorder("")} />}
    </div>
  );
}
