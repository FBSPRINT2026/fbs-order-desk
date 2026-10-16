"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WILFLEX_HEX, colorHex } from "@/lib/inkColors";
import type { BrandColor } from "@/lib/pricing";

/**
 * Brand standards (Oct 16, Nick): a customer's exact inks ("Red" = PMS 199 C), in groups when needed. A wholesaler keeps
 * one group per client (Nine18 → "All My Sons"); the account's own colors have no group. The Mockup Creator lists each
 * group in its ink dropdown, uses the group named in the order (an "ALL MY SONS DALLAS" order gets All My Sons' colors)
 * and has a "Use … colors" button per group. Edited here, on the customer's Artwork tab; the portal shows them read-only.
 */
export default function CustomerBrandColors({ customerId, company }: { customerId: string; company?: string }) {
  const sb = createClient();
  const [list, setList] = useState<BrandColor[] | null>(null);
  const [extra, setExtra] = useState<string[]>([]); // groups added but with no color yet
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    sb.from("customers").select("brand_colors").eq("id", customerId).maybeSingle().then(({ data }) => setList(((data?.brand_colors as BrandColor[] | null) || []).filter(Boolean)));
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next: BrandColor[]) => {
    setList(next);
    const clean = next.map((b) => ({ name: (b.name || "").trim(), ink: (b.ink || "").trim(), ...(b.group?.trim() ? { group: b.group.trim() } : {}) })).filter((b) => b.name || b.ink);
    const { error } = await sb.from("customers").update({ brand_colors: clean }).eq("id", customerId);
    setState(error ? "Couldn't save: " + error.message : "Saved");
  };
  if (!list) return null;
  // "199c", "pms 289", "cool gray 5" become "PMS 199 C"…; "white" becomes the ink "White"
  const tidy = (ink: string) => {
    const t = ink.trim();
    if (!t || /^#/.test(t)) return t;
    const w = Object.keys(WILFLEX_HEX).find((k) => k.toLowerCase() === t.toLowerCase());
    if (w) return w;
    const m = t.replace(/^(pms|pantone)\s*/i, "").replace(/\s*c$/i, "").replace(/\b[a-z]/g, (c) => c.toUpperCase());
    return colorHex(`PMS ${m} C`) ? `PMS ${m} C` : t;
  };
  const groups = [...new Set(["", ...list.map((b) => b.group || ""), ...extra])];
  const setAt = (i: number, patch: Partial<BrandColor>) => save(list.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const renameGroup = (from: string, to: string) => { setExtra((e) => e.map((g) => (g === from ? to : g))); save(list.map((b) => ((b.group || "") === from ? { ...b, group: to } : b))); };
  const dropGroup = (g: string) => { setExtra((e) => e.filter((x) => x !== g)); save(list.filter((b) => (b.group || "") !== g)); };
  const addColor = (g: string) => setList([...list, { name: "", ink: "", ...(g ? { group: g } : {}) }]);

  return (
    <div className="bc">
      {groups.map((g) => {
        const rows = list.map((b, i) => ({ b, i })).filter((x) => (x.b.group || "") === g);
        if (g && !rows.length && !extra.includes(g)) return null;
        // the account's own (ungrouped) colors only show when used, or when there are no groups yet
        if (!g && !rows.length && groups.length > 1) return null;
        return (
          <div key={g || "_main"} className={"bc-group" + (g ? " sub" : "")}>
            <div className="bc-gh">
              {g ? <input type="text" className="bc-gname" aria-label="Group name" defaultValue={g} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g) renameGroup(g, v); }} />
                : <b>{company ? `${company}'s colors` : "Their colors"}</b>}
              <span className="faint">{g ? "a client of theirs, or a brand of their own" : rows.length ? "" : "none yet"}</span>
              {g && <button type="button" className="linkbtn bc-x" onClick={() => dropGroup(g)} title="Remove this group and its colors">Remove group</button>}
            </div>
            {rows.map(({ b, i }) => {
              const hex = colorHex(b.ink);
              return (
                <div key={i} className="bc-row">
                  <span className="bc-sw" style={{ background: hex || "transparent" }} title={hex ? b.ink : "Not a color we know: check the PMS number"} />
                  <input type="text" aria-label="Color name" placeholder="Red" value={b.name} onChange={(e) => setAt(i, { name: e.target.value })} />
                  <input type="text" aria-label="Ink" placeholder="PMS 199 C" value={b.ink} onChange={(e) => setAt(i, { ink: e.target.value })}
                    onBlur={(e) => { const t = tidy(e.target.value); if (t !== e.target.value) setAt(i, { ink: t }); }} />
                  <button type="button" className="btn icon ghost sm" aria-label="Remove color" title="Remove color" onClick={() => save(list.filter((_, k) => k !== i))}>✕</button>
                </div>
              );
            })}
            <button type="button" className="btn sm ghost bc-add" onClick={() => addColor(g)}>+ Add color</button>
          </div>
        );
      })}
      <div className="bc-foot">
        {newGroup === null
          ? <button type="button" className="btn sm" onClick={() => setNewGroup("")}>+ Add group</button>
          : <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const v = newGroup.trim(); if (v && !groups.includes(v)) { setExtra((x) => [...x, v]); setList([...list, { name: "", ink: "", group: v }]); } setNewGroup(null); }}>
              <input type="text" autoFocus placeholder="All My Sons" aria-label="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} style={{ width: 200 }} />
              <button type="submit" className="btn sm primary">Add</button>
              <button type="button" className="btn sm ghost" onClick={() => setNewGroup(null)}>Cancel</button>
            </form>}
        <span className="faint">{state || "Groups are for a wholesaler's clients (Nine18 → All My Sons) or a second brand. A mockup for an order with the group's name in it uses that group's colors."}</span>
      </div>
    </div>
  );
}
