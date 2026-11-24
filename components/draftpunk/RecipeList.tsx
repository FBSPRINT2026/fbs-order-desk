"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { styleById } from "@/lib/draftpunk/styles";
import { fmtDate } from "@/lib/draftpunk/defaults";

type Row = { id: string; name: string; style_id: string | null; visibility: string; calc: { og?: number; fg?: number; abv?: number; ibu?: number; srm?: number; color?: string }; updated_at: string; data: { type?: string; equipment?: { batchGal?: number } } };

/** the brewer's recipes: search, open, copy, share with the club */
export default function RecipeList({ userId }: { userId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const load = async () => {
    const { data } = await createClient().from("dp_recipes").select("id, name, style_id, visibility, calc, updated_at, data->type, data->equipment").eq("owner_id", userId).order("updated_at", { ascending: false });
    setRows(((data || []) as unknown as (Row & { type?: string; equipment?: { batchGal?: number } })[]).map((r) => ({ ...r, data: { type: r.type, equipment: r.equipment } })));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const shown = useMemo(() => (rows || []).filter((r) => !q || `${r.name} ${styleById(r.style_id || "")?.name || ""}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const copy = async (id: string) => {
    const sb = createClient();
    const { data } = await sb.from("dp_recipes").select("name, style_id, data, calc").eq("id", id).single();
    if (!data) return;
    const { data: made } = await sb.from("dp_recipes").insert({ owner_id: userId, name: `${data.name} (copy)`, style_id: data.style_id, data: { ...data.data, name: `${data.name} (copy)` }, calc: data.calc, copied_from: id }).select("id").single();
    if (made) router.push(`/draftpunk/r/${made.id}`);
  };
  const remove = async (r: Row) => {
    if (!confirm(`Delete "${r.name}"? Its brew logs stay.`)) return;
    await createClient().from("dp_recipes").delete().eq("id", r.id);
    load();
  };
  return (
    <>
      <h1 className="dp-h1">My recipes</h1>
      <div className="dp-row">
        <label className="dp-f" style={{ flex: "1 1 260px" }}><span>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or style" /></label>
        <Link href="/draftpunk/r/new" className="dp-btn dp-go">New recipe</Link>
        <Link href="/draftpunk/import" className="dp-btn">Import</Link>
      </div>
      <div className="dp-win">
        <span className="dp-wt">My recipes {rows ? `(${rows.length})` : ""}</span>
        {!rows ? <p>Loading...</p> : !rows.length ? (
          <p>No recipes yet. Press <b>F3</b> To start one, or <Link href="/draftpunk/import">Import from BeerSmith</Link>.</p>
        ) : (
          <table className="dp-tbl" data-nofit>
            <thead><tr><th>Name</th><th>Style</th><th className="dp-num">OG</th><th className="dp-num">IBU</th><th className="dp-num">ABV</th><th className="dp-num">SRM</th><th>Saved</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="dp-pick" onClick={() => router.push(`/draftpunk/r/${r.id}`)}>
                  <td>{r.name}{r.visibility === "club" && <span className="dp-dim"> [Club]</span>}</td>
                  <td>{styleById(r.style_id || "")?.name || <span className="dp-dim">-</span>}</td>
                  <td className="dp-num">{r.calc?.og?.toFixed(3) || "-"}</td>
                  <td className="dp-num">{r.calc?.ibu ?? "-"}</td>
                  <td className="dp-num">{r.calc?.abv != null ? `${r.calc.abv}%` : "-"}</td>
                  <td className="dp-num">{r.calc?.srm ?? "-"}<span className="dp-swatch" style={{ background: r.calc?.color || "transparent" }} /></td>
                  <td>{fmtDate(r.updated_at)}</td>
                  <td className="dp-num" onClick={(e) => e.stopPropagation()}>
                    <button className="dp-btn dp-sm" onClick={() => copy(r.id)}>Copy</button>{" "}
                    <button className="dp-btn dp-sm dp-x" title="Delete" onClick={() => remove(r)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
