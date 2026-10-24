"use client";
import { useEffect, useState } from "react";
import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";
import { POP_KINDS, POP_USES, type PopularPick } from "@/lib/popularGarments";
import { popularGarments, savePopularGarments } from "@/app/popular-garments-actions";

/** Settings → Garments → Popular garments: what "Need help picking garments?" shows in the Mockup Creator (Oct 24, Nick). */
export default function Page() {
  const [list, setList] = useState<PopularPick[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { popularGarments().then((r) => setList(r.list.map(({ style, brand, kind, tag, why, tier, uses }) => ({ style, brand, kind, tag, why, tier, uses })))); }, []);
  const up = (i: number, p: Partial<PopularPick>) => setList((l) => (l || []).map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setList((l) => { const a = [...(l || [])]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
  async function save() { if (!list) return; setBusy(true); setMsg(""); const r = await savePopularGarments(list); setBusy(false); setMsg(r.ok ? "Saved." : r.error || "Couldn't save."); }
  return (
    <>
      <SettingsHead title="Garments" note="What customers see under “Need help picking garments?” in the Mockup Creator. In order, by type. No prices: $ to $$$ only.">
        <button type="button" className="btn" onClick={() => setList((l) => [...(l || []), { style: "", brand: "", kind: "tees", tag: "", why: "", tier: 2, uses: [] }])}>+ Add a garment</button>
        <button type="button" className="btn primary" disabled={busy || !list} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </SettingsHead>
      <SettingsTabs />
      {msg && <div className={msg === "Saved." ? "ok-note" : "err"} style={{ marginBottom: 10 }}>{msg}</div>}
      <section className="panel">
        <div className="panel-h"><h2>Popular garments</h2><span className="faint">Style numbers from the garment catalog. The picture and colors come from there.</span></div>
        <div className="panel-b">
          {!list ? <div className="faint">Loading…</div> : (
            <div className="tbl-wrap"><table className="tbl pgs-tbl">
              <thead><tr><th>Style</th><th>Brand</th><th>Type</th><th>Tag</th><th>Why pick it</th><th>Price</th><th>Good for</th><th /></tr></thead>
              <tbody>{list.map((p, i) => (
                <tr key={i}>
                  <td><input type="text" value={p.style} placeholder="6210" onChange={(e) => up(i, { style: e.target.value })} /></td>
                  <td><input type="text" value={p.brand} placeholder="Next Level" onChange={(e) => up(i, { brand: e.target.value })} /></td>
                  <td><select value={p.kind} onChange={(e) => up(i, { kind: e.target.value as PopularPick["kind"] })}>{POP_KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}</select></td>
                  <td><input type="text" value={p.tag} placeholder="Best value" onChange={(e) => up(i, { tag: e.target.value })} /></td>
                  <td><input type="text" value={p.why} placeholder="Soft, modern fit" onChange={(e) => up(i, { why: e.target.value })} /></td>
                  <td><select value={p.tier} onChange={(e) => up(i, { tier: +e.target.value as 1 | 2 | 3 })}><option value={1}>$</option><option value={2}>$$</option><option value={3}>$$$</option></select></td>
                  <td className="pgs-uses">{POP_USES.map((u) => <label key={u.k} className="check"><input type="checkbox" checked={p.uses.includes(u.k)} onChange={(e) => up(i, { uses: e.target.checked ? [...p.uses, u.k] : p.uses.filter((x) => x !== u.k) })} />{u.label}</label>)}</td>
                  <td className="r" style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn icon ghost" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="btn icon ghost" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="btn icon ghost" aria-label="Take off the list" onClick={() => setList((l) => (l || []).filter((_, j) => j !== i))}>✕</button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </section>
    </>
  );
}
