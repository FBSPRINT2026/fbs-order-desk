"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WILFLEX_HEX, colorHex } from "@/lib/inkColors";
import type { BrandColor } from "@/lib/pricing";

/**
 * The customer's brand colors (Oct 16, Nick: Aubrey ISD's red is always PMS 199 C). Each is what they call it and the
 * exact ink; the Mockup Creator lists them first in every ink dropdown for this customer (ours and their portal), has a
 * "Use their colors" button, and snaps a new logo's colors to the nearest one.
 */
export default function CustomerBrandColors({ customerId }: { customerId: string }) {
  const sb = createClient();
  const [list, setList] = useState<BrandColor[] | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    sb.from("customers").select("brand_colors").eq("id", customerId).maybeSingle().then(({ data }) => setList(((data?.brand_colors as BrandColor[] | null) || []).filter(Boolean)));
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next: BrandColor[]) => {
    setList(next);
    const clean = next.map((b) => ({ name: b.name.trim(), ink: b.ink.trim() })).filter((b) => b.name || b.ink);
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
  return (
    <div className="cc bc">
      <div className="cc-h"><span className="lbl">Brand colors ({list.length})</span><span className="faint" style={{ fontSize: 12 }}>{state || "First in the Mockup Creator's ink list for this customer"}</span></div>
      {list.map((b, i) => {
        const hex = colorHex(b.ink);
        return (
          <div key={i} className="bc-row">
            <span className="bc-sw" style={{ background: hex || "transparent" }} title={hex ? b.ink : "Not a color we know: check the PMS number"} />
            <input type="text" aria-label="Color name" placeholder="Red" value={b.name} onChange={(e) => save(list.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
            <input type="text" aria-label="Ink" placeholder="PMS 199 C" value={b.ink} onChange={(e) => save(list.map((x, k) => (k === i ? { ...x, ink: e.target.value } : x)))}
              onBlur={(e) => { const t = tidy(e.target.value); if (t !== e.target.value) save(list.map((x, k) => (k === i ? { ...x, ink: t } : x))); }} />
            <button type="button" className="btn icon ghost sm" aria-label="Remove color" title="Remove color" onClick={() => save(list.filter((_, k) => k !== i))}>✕</button>
          </div>
        );
      })}
      <button type="button" className="btn sm" onClick={() => setList([...list, { name: "", ink: "" }])}>+ Add color</button>
    </div>
  );
}
