"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAll } from "@/lib/readAll";
import { fmtDate } from "@/lib/draftpunk/defaults";
import { styleById } from "@/lib/draftpunk/styles";

type Row = { id: string; name: string; folder: string; brewed_on: string | null; brought_to: string | null; calc: { og?: number; ibu?: number; abv?: number; srm?: number; color?: string }; style?: string; equip?: string; gal?: number };
type SortBy = "name" | "style" | "og" | "ibu" | "gal" | "brewed";

/**
 * From BeerSmith (Nick, Nov 24 2026: "I just want to see them the way they were in BeerSmith"): every imported recipe on
 * its own, in its BeerSmith folder, with its own name and date, nothing grouped. Open one to look at it or brew from
 * it, and bring it into DraftPunk as a new recipe or as a version of one.
 */
export default function BeerSmithList({ userId }: { userId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [folder, setFolder] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ by: SortBy; desc: boolean }>({ by: "brewed", desc: true });
  useEffect(() => {
    try { const f = localStorage.getItem("dp:bs-folder"); if (f) setFolder(f); const s = JSON.parse(localStorage.getItem("dp:bs-sort") || "null"); if (s?.by) setSort(s); } catch { /* fine */ }
    readAll<Row>((a, b) => createClient().from("dp_archive").select("id, name, folder, brewed_on, brought_to, calc, style:data->>styleId, equip:data->equipment->>name, gal:data->equipment->batchGal").eq("owner_id", userId).order("id").range(a, b)).then(setRows).catch(() => setRows([]));
  }, [userId]);
  const pickFolder = (f: string) => { setFolder(f); try { localStorage.setItem("dp:bs-folder", f); } catch { /* fine */ } };
  const sortBy = (by: SortBy) => setSort((s) => { const n = { by, desc: s.by === by ? !s.desc : by === "brewed" || by === "og" || by === "ibu" || by === "gal" }; try { localStorage.setItem("dp:bs-sort", JSON.stringify(n)); } catch { /* fine */ } return n; });
  // BeerSmith's folders, as a tree read top to bottom (a folder's subfolders right under it)
  const folders = useMemo(() => { const m = new Map<string, number>(); for (const r of rows || []) m.set(r.folder, (m.get(r.folder) || 0) + 1); return [...m].sort((a, b) => a[0].localeCompare(b[0])); }, [rows]);
  const shown = useMemo(() => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = (rows || []).filter((r) => (!folder || r.folder === folder || r.folder.startsWith(`${folder} › `)) && w.every((x) => `${r.name} ${styleById(r.style)?.name || ""} ${r.equip || ""}`.toLowerCase().includes(x)));
    const val = (r: Row): string | number => sort.by === "name" ? r.name.toLowerCase() : sort.by === "style" ? (styleById(r.style)?.name || "~").toLowerCase() : sort.by === "brewed" ? r.brewed_on || "" : sort.by === "gal" ? Number(r.gal) || 0 : Number(r.calc?.[sort.by]) || 0;
    return [...list].sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return sort.desc ? -c : c; });
  }, [rows, folder, q, sort]);
  const th = (by: SortBy, label: string, num = false) => <th className={num ? "dp-num" : undefined} aria-sort={sort.by === by ? (sort.desc ? "descending" : "ascending") : "none"}><button type="button" className="dp-sortbtn" onClick={() => sortBy(by)}>{label}{sort.by === by ? (sort.desc ? " ↓" : " ↑") : ""}</button></th>;

  if (!rows) return <p className="dp-dim">Loading…</p>;
  if (!rows.length) return (
    <section className="dp-card dp-empty"><h2 className="dp-card-t">Nothing from BeerSmith yet</h2><p className="dp-dim">Bring your BeerSmith backup in on Import; every recipe shows here just as it was.</p><Link href="/draftpunk/import" className="dp-btn dp-go">Import</Link></section>
  );
  return (
    <>
      <div className="dp-row" style={{ alignItems: "flex-end", marginBottom: 14 }}>
        <label className="dp-f" style={{ flex: "1 1 240px" }}><span>Folder</span>
          <select value={folder} onChange={(e) => pickFolder(e.target.value)}>
            <option value="">All folders ({rows.length})</option>
            {folders.map(([f, n]) => <option key={f} value={f}>{f} ({n})</option>)}
          </select>
        </label>
        <label className="dp-f" style={{ flex: "2 1 260px" }}><span>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, style or equipment" /></label>
        <span className="dp-dim" style={{ fontSize: 13 }}>{shown.length} of {rows.length}</span>
      </div>
      <div className="dp-card">
        <table className="dp-tbl">
          <thead><tr>{th("name", "Name")}{th("style", "Style")}{th("og", "OG", true)}{th("ibu", "IBU", true)}{th("gal", "Batch", true)}{th("brewed", "Date")}</tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="dp-pick" onClick={() => router.push(`/draftpunk/archive/${r.id}`)}>
                <td><div className="dp-namecell"><b>{r.name}</b><span className="dp-sub">{[folder && r.folder === folder ? "" : r.folder, r.brought_to ? "In DraftPunk" : ""].filter(Boolean).join(" · ")}</span></div></td>
                <td>{styleById(r.style)?.name || <span className="dp-dim">–</span>}</td>
                <td className="dp-num">{r.calc?.og?.toFixed(3) || "–"}</td>
                <td className="dp-num">{r.calc?.ibu ?? "–"}</td>
                <td className="dp-num"><div className="dp-namecell" style={{ alignItems: "flex-end" }}>{r.gal ? `${Math.round(Number(r.gal) * 100) / 100} gal` : "–"}<span className="dp-sub">{r.equip}</span></div></td>
                <td>{r.brewed_on ? fmtDate(r.brewed_on) : <span className="dp-dim">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
