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
  const [view, setView] = useState<"cards" | "list">("cards");
  useEffect(() => { try { const v = localStorage.getItem("dp:recipes-view"); if (v === "list" || v === "cards") setView(v); } catch { /* fine */ } }, []);
  const pickView = (v: "cards" | "list") => { setView(v); try { localStorage.setItem("dp:recipes-view", v); } catch { /* fine */ } };
  return (
    <>
      <div className="dp-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="dp-h1" style={{ margin: 0 }}>Recipes</h1>
        <div className="dp-row" style={{ alignItems: "center" }}>
          <Link href="/draftpunk/import" className="dp-btn">Import</Link>
          <Link href="/draftpunk/r/new" className="dp-btn dp-go">+ New recipe</Link>
        </div>
      </div>
      <div className="dp-row" style={{ alignItems: "center", marginBottom: 16 }}>
        <input style={{ flex: "1 1 260px", maxWidth: 420 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or style" aria-label="Search recipes" />
        <span className="dp-seg"><button className={view === "cards" ? "on" : ""} onClick={() => pickView("cards")}>Cards</button><button className={view === "list" ? "on" : ""} onClick={() => pickView("list")}>List</button></span>
        {rows && <span className="dp-dim" style={{ fontSize: 13 }}>{shown.length} of {rows.length}</span>}
      </div>
      {!rows ? <p className="dp-dim">Loading…</p> : !rows.length ? (
        <section className="dp-card dp-empty">
          <h2 className="dp-card-t">No recipes yet</h2>
          <p className="dp-dim">Start one from scratch, or bring your BeerSmith recipes over.</p>
          <div className="dp-row"><Link href="/draftpunk/r/new" className="dp-btn dp-go">+ New recipe</Link><Link href="/draftpunk/import" className="dp-btn">Import from BeerSmith</Link></div>
        </section>
      ) : view === "cards" ? (
        <div className="dp-cards">
          {shown.map((r) => (
            <article key={r.id} className="dp-card dp-rcard" style={{ ["--dp-beer" as string]: r.calc?.color || "#e58500" }} onClick={() => router.push(`/draftpunk/r/${r.id}`)}>
              <div className="dp-glass dp-glass-sm" aria-hidden="true"><i /></div>
              <div style={{ minWidth: 0 }}>
                <h3>{r.name}</h3>
                <div className="dp-dim" style={{ fontSize: 13 }}>{styleById(r.style_id || "")?.name || "No style"}{r.visibility === "club" ? " · shared" : ""}</div>
                <div className="dp-rnums">
                  <span><b>{r.calc?.og?.toFixed(3) || "–"}</b>OG</span>
                  <span><b>{r.calc?.ibu ?? "–"}</b>IBU</span>
                  <span><b>{r.calc?.abv != null ? `${r.calc.abv}%` : "–"}</b>ABV</span>
                  <span><b>{r.calc?.srm ?? "–"}</b>SRM</span>
                </div>
              </div>
              <div className="dp-rfoot" onClick={(e) => e.stopPropagation()}>
                <span className="dp-dim">{fmtDate(r.updated_at)}</span>
                <span><button className="dp-btn dp-sm dp-x" onClick={() => copy(r.id)}>Copy</button><button className="dp-btn dp-sm dp-x" onClick={() => remove(r)}>Delete</button></span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="dp-card">
          <table className="dp-tbl" data-nofit>
            <thead><tr><th>Name</th><th>Style</th><th className="dp-num">OG</th><th className="dp-num">IBU</th><th className="dp-num">ABV</th><th className="dp-num">SRM</th><th>Saved</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="dp-pick" onClick={() => router.push(`/draftpunk/r/${r.id}`)}>
                  <td><b>{r.name}</b>{r.visibility === "club" && <span className="dp-dim"> · shared</span>}</td>
                  <td>{styleById(r.style_id || "")?.name || <span className="dp-dim">–</span>}</td>
                  <td className="dp-num">{r.calc?.og?.toFixed(3) || "–"}</td>
                  <td className="dp-num">{r.calc?.ibu ?? "–"}</td>
                  <td className="dp-num">{r.calc?.abv != null ? `${r.calc.abv}%` : "–"}</td>
                  <td className="dp-num">{r.calc?.srm ?? "–"}<span className="dp-swatch" style={{ background: r.calc?.color || "transparent" }} /></td>
                  <td>{fmtDate(r.updated_at)}</td>
                  <td className="dp-num" onClick={(e) => e.stopPropagation()}><button className="dp-btn dp-sm dp-x" onClick={() => copy(r.id)}>Copy</button><button className="dp-btn dp-sm dp-x" onClick={() => remove(r)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
