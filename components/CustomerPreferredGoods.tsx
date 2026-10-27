"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { kindOf, rankWord, type PreferredGood } from "@/lib/preferredGoods";

/**
 * Brand standards → Preferred goods (Oct 26, Nick: "Peticolas… always use the Next Level 6210 or the Bella Canvas 3001
 * CVC; they prefer the 6210 over the 3001 CVC"). The blanks a customer orders, ranked for each kind ("Tees": 1st
 * choice 6210, 2nd choice 3001CVC), with the colors they usually take. Used only when an email doesn't name the style:
 * Create order asks "use their preferred tee?"; nothing is filled in on its own. Saved as it's changed.
 */
const uid = () => Math.random().toString(36).slice(2, 10);

export default function CustomerPreferredGoods({ customerId }: { customerId: string }) {
  const sb = useMemo(() => createClient(), []);
  const [list, setList] = useState<PreferredGood[] | null>(null);
  const [state, setState] = useState(""), [finding, setFinding] = useState("");
  useEffect(() => {
    sb.from("customers").select("preferred_goods").eq("id", customerId).maybeSingle().then(({ data }) => setList((((data as { preferred_goods?: PreferredGood[] } | null)?.preferred_goods) || []).filter(Boolean)));
  }, [sb, customerId]);
  if (!list) return null;

  // each kind's rows ranked 1, 2, 3… in the order they're listed
  const tidy = (xs: PreferredGood[]) => {
    const n = new Map<string, number>();
    return xs.map((x) => { const k = x.kind.trim().toLowerCase(); const r = (n.get(k) || 0) + 1; n.set(k, r); return { ...x, rank: r }; });
  };
  const save = async (next: PreferredGood[]) => {
    const t = tidy(next);
    setList(t);
    const clean = t.filter((x) => x.style.trim() || x.kind.trim()).map((x) => ({ ...x, kind: x.kind.trim(), style: x.style.trim().toUpperCase(), brand: x.brand.trim(), name: x.name.trim(), colors: x.colors.map((c) => c.trim()).filter(Boolean), notes: x.notes.trim() }));
    const { error } = await sb.from("customers").update({ preferred_goods: clean }).eq("id", customerId);
    setState(error ? "Couldn't save: " + error.message : "Saved");
  };
  const setAt = (id: string, p: Partial<PreferredGood>) => save(list.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const move = (id: string, dir: -1 | 1) => {
    const i = list.findIndex((x) => x.id === id), k = list[i].kind.trim().toLowerCase();
    let j = i + dir;
    while (j >= 0 && j < list.length && list[j].kind.trim().toLowerCase() !== k) j += dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; void save(next);
  };
  async function find(x: PreferredGood, raw: string) {
    const st = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (!st || st === x.style) return;
    setFinding(x.id);
    try {
      const { data } = await sb.from("garments").select("style, brand, description").ilike("style", st).limit(1);
      let g = (data || [])[0] as { style: string; brand: string; description: string } | undefined;
      if (!g) {
        const r = await fetch(`/api/ss/lookup?style=${encodeURIComponent(st)}`);
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.garment) g = j.garment;
      }
      await setAt(x.id, { style: g?.style || st, brand: g?.brand || x.brand, name: g?.description || x.name });
      if (!g) setState(`Couldn't find ${st} at S&S or SanMar: saved as typed`);
    } finally { setFinding(""); }
  }
  const kinds = [...new Set(list.map((x) => x.kind.trim().toLowerCase()))];
  const add = (kind = "") => save([...list, { id: uid(), kind, rank: 1, style: "", brand: "", name: "", colors: [], notes: "" }]);

  return (
    <section className="nl-sec pg-sec">
      <div className="nl-sec-h">
        <div><b>Preferred goods</b><span className="faint"> · the blanks they order, best first. Only used when an email doesn&apos;t name the style, and you&apos;re always asked first.</span></div>
        <button type="button" className="btn sm" onClick={() => add()}>+ Add a blank</button>
      </div>
      {!list.length ? <p className="faint pg-none">None yet. Add the tee, hoodie or hat they usually order (&quot;Tees&quot;: Next Level 6210 first, Bella+Canvas 3001CVC second).</p> : (
        <div className="tbl-wrap"><table className="tbl pg-tbl">
          <thead><tr><th>For</th><th>Choice</th><th>Blank (model number)</th><th>Their usual colors</th><th>Notes</th><th aria-label="Move or remove" /></tr></thead>
          <tbody>{kinds.flatMap((k) => list.filter((x) => x.kind.trim().toLowerCase() === k)).map((x) => {
            const same = list.filter((y) => y.kind.trim().toLowerCase() === x.kind.trim().toLowerCase());
            return (
              <tr key={x.id}>
                <td><input className="pg-kind" defaultValue={x.kind} placeholder="Tees" aria-label="What it's for" onBlur={(e) => { if (e.target.value.trim() !== x.kind) void setAt(x.id, { kind: e.target.value }); }} />{x.kind && !kindOf(x.kind) ? <div className="sub">also matched by this word</div> : null}</td>
                <td><span className={"pg-rank" + (x.rank === 1 ? " first" : "")}>{rankWord(x.rank)}</span></td>
                <td><input className="pg-style" defaultValue={x.style} placeholder="6210" aria-label="Model number" onBlur={(e) => void find(x, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                  <div className="sub">{finding === x.id ? "Finding…" : [x.brand, x.name].filter(Boolean).join(" · ")}</div></td>
                <td><input defaultValue={x.colors.join(", ")} placeholder="Black, Heather Gray" aria-label="Their usual colors" onBlur={(e) => { const c = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); if (c.join("|") !== x.colors.join("|")) void setAt(x.id, { colors: c }); }} /></td>
                <td><input defaultValue={x.notes} placeholder="Optional" aria-label="Notes" onBlur={(e) => { if (e.target.value !== x.notes) void setAt(x.id, { notes: e.target.value }); }} /></td>
                <td className="pg-acts">
                  <button type="button" className="btn sm ghost" disabled={same[0]?.id === x.id} onClick={() => move(x.id, -1)} aria-label="Move up" title="Make it a higher choice">▲</button>
                  <button type="button" className="btn sm ghost" disabled={same[same.length - 1]?.id === x.id} onClick={() => move(x.id, 1)} aria-label="Move down" title="Make it a lower choice">▼</button>
                  <button type="button" className="btn sm ghost" onClick={() => void save(list.filter((y) => y.id !== x.id))} aria-label="Remove" title="Remove">×</button>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {list.length > 0 && <div className="pg-foot">{kinds.filter(Boolean).map((k) => <button key={k} type="button" className="linkbtn" onClick={() => add(list.find((x) => x.kind.trim().toLowerCase() === k)?.kind || k)}>+ Another choice for {list.find((x) => x.kind.trim().toLowerCase() === k)?.kind || k}</button>)}{state && <span className="faint">{state}</span>}</div>}
    </section>
  );
}
