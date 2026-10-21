"use client";
import { useContext, useEffect, useState } from "react";
import { BrandEdit } from "@/components/BrandAssistant";
import { createClient } from "@/lib/supabase/client";
import { LOCATIONS, uid, type BrandPrint, type BrandSize } from "@/lib/pricing";

/**
 * Brand standards beyond colors (Oct 16, Nick): the customer's standard print sizes ("Peticolas' circle logo: 10.5" on
 * the front, 3" on the nape") and how their prints are made on dark shirts (a fashion hit: no underbase, print-flash-print
 * through one screen; soft hand additive). Saved on customers.brand_print; the Mockup Creator applies the sizes on its
 * own and starts each new print with this way of printing.
 */
const WHICH: { v: BrandSize["which"]; label: string }[] = [
  { v: "round", label: "Round logos" }, { v: "wide", label: "Wide logos" }, { v: "tall", label: "Tall logos" }, { v: "any", label: "Any logo" }, { v: "design", label: "One logo…" },
];
const locLabel = (l: string) => (l === "Upper Back (Yoke)" ? "Upper Back / nape (Yoke)" : l);

export default function CustomerBrandPrint({ customerId }: { customerId: string }) {
  const sb = createClient();
  const [bp, setBp] = useState<BrandPrint | null>(null);
  const [logos, setLogos] = useState<{ id: string; name: string; number: number }[]>([]);
  const [state, setState] = useState("");
  const { editing } = useContext(BrandEdit);
  useEffect(() => {
    sb.from("customers").select("brand_print").eq("id", customerId).maybeSingle().then(({ data }) => setBp(((data?.brand_print || {}) as BrandPrint)));
    sb.from("designs").select("id, name, number").eq("customer_id", customerId).is("archived_at", null).eq("draft", false).order("number", { ascending: false }).limit(200)
      .then(({ data }) => setLogos((data || []) as { id: string; name: string; number: number }[]));
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bp) return null;

  const save = async (next: BrandPrint) => {
    setBp(next);
    const clean: BrandPrint = { ...next, sizes: (next.sizes || []).filter((r) => r.location && r.width > 0) };
    const { error } = await sb.from("customers").update({ brand_print: clean }).eq("id", customerId);
    setState(error ? "Couldn't save: " + error.message : "Saved");
  };
  const sizes = bp.sizes || [];
  const setRow = (id: string, patch: Partial<BrandSize>) => save({ ...bp, sizes: sizes.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const hit = bp.hit || "standard";
  // locked: only what's set, no help text (Oct 21, Nick: "cluttered")
  if (!editing) {
    const how = [bp.hit === "fashion" ? "Fashion hit (no underbase)" : bp.hit === "ask" ? "Ask each time" : bp.hit ? "Standard (underbase)" : "", bp.soft ? "soft hand additive" : "", bp.hit === "fashion" && bp.distressedOnly ? "only distressed logos" : ""].filter(Boolean);
    const rules = (bp.rules || []).filter(Boolean);
    const nameOf = (r: BrandSize) => (r.which === "design" ? (() => { const l = logos.find((x) => x.id === r.design_id); return l ? `D-${l.number} ${l.name}` : "One logo"; })() : WHICH.find((w) => w.v === r.which)?.label || "");
    return (
      <div className="bp bp-ro">
        {sizes.length > 0 && <div className="bp-ro-r"><span className="bp-ro-l">Print sizes</span><span>{sizes.map((r) => `${nameOf(r)}: ${r.width}" on the ${locLabel(r.location)}${r.note ? ` (${r.note})` : ""}`).join(" · ")}</span></div>}
        {how.length > 0 && <div className="bp-ro-r"><span className="bp-ro-l">On dark shirts</span><span>{how.join(", ")}</span></div>}
        {rules.length > 0 && <div className="bp-ro-r"><span className="bp-ro-l">Rules</span><span>{rules.join(" · ")}</span></div>}
      </div>
    );
  }

  return (
    <div className="bp">
      <div className="bp-sec">Print sizes</div>
      {sizes.length > 0 && (
        <div className="bp-table">
          <div className="bp-head"><span>Which logos</span><span>Where</span><span>Width</span><span>Note</span><span /></div>
          {sizes.map((r) => (
            <div className="bp-row" key={r.id}>
              <span className="bp-which">
                <select aria-label="Which logos" value={r.which} onChange={(e) => setRow(r.id, { which: e.target.value as BrandSize["which"] })}>{WHICH.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}</select>
                {r.which === "design" && <select aria-label="Logo" value={r.design_id || ""} onChange={(e) => setRow(r.id, { design_id: e.target.value || undefined })}><option value="">Pick a logo</option>{logos.map((l) => <option key={l.id} value={l.id}>D-{l.number} {l.name}</option>)}</select>}
              </span>
              <select aria-label="Where" value={r.location} onChange={(e) => setRow(r.id, { location: e.target.value })}>{LOCATIONS.map((l) => <option key={l} value={l}>{locLabel(l)}</option>)}</select>
              <span className="bp-w"><input type="number" step="0.25" min="0.5" max="20" aria-label="Width in inches" defaultValue={r.width || ""} onBlur={(e) => setRow(r.id, { width: Math.max(0, +e.target.value || 0) })} />&quot;</span>
              <input type="text" aria-label="Note" placeholder="their circle logo" defaultValue={r.note || ""} onBlur={(e) => setRow(r.id, { note: e.target.value.trim().slice(0, 80) || undefined })} />
              <button type="button" className="btn icon ghost sm" aria-label="Remove size" title="Remove" onClick={() => save({ ...bp, sizes: sizes.filter((x) => x.id !== r.id) })}>✕</button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn sm ghost bp-add" onClick={() => save({ ...bp, sizes: [...sizes, { id: uid(), which: "round", location: "Full Front", width: 10.5 }] })}>+ Add a size</button>
      <p className="faint bp-hint">Applied on their own in the Mockup Creator. &quot;Round&quot; = about as tall as wide. A rule for one logo wins over its shape, and its shape over &quot;Any logo&quot;.</p>

      <div className="bp-sec">How their prints are made on dark shirts</div>
      <div className="bp-seg" role="radiogroup" aria-label="How their prints are made">
        {([["standard", "Standard (underbase)"], ["fashion", "Fashion hit (no underbase)"], ["ask", "Ask each time"]] as const).map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={hit === v} className={hit === v ? "on" : ""} onClick={() => save({ ...bp, hit: v })}>{l}</button>
        ))}
      </div>
      <div className="bp-opts">
        <label className="check"><input type="checkbox" checked={!!bp.soft} onChange={(e) => save({ ...bp, soft: e.target.checked })} /> Soft hand additive</label>
        {hit === "fashion" && <label className="check"><input type="checkbox" checked={!!bp.distressedOnly} onChange={(e) => save({ ...bp, distressedOnly: e.target.checked })} /> Only for distressed logos <span className="faint">(marked on each logo)</span></label>}
      </div>
      <div className="bp-sec">Other rules</div>
      {(bp.rules || []).map((r, i) => (
        <div className="bp-rule" key={i + ":" + r}>
          <input type="text" aria-label="Rule" defaultValue={r} onBlur={(e) => { const v = e.target.value.trim(); if (v === r) return; save({ ...bp, rules: (bp.rules || []).map((x, j) => (j === i ? v : x)).filter(Boolean) }); }} />
          <button type="button" className="btn icon ghost sm" aria-label="Remove rule" title="Remove" onClick={() => save({ ...bp, rules: (bp.rules || []).filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <form className="bp-rule" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem("rule") as HTMLInputElement; const v = f.value.trim(); if (!v) return; save({ ...bp, rules: [...(bp.rules || []), v.slice(0, 240)] }); f.value = ""; }}>
        <input name="rule" type="text" placeholder="e.g. Never put the circle logo on red shirts" aria-label="New rule" />
        <button type="submit" className="btn sm ghost">Add</button>
      </form>
      <p className="faint bp-hint">Anything a box above doesn&apos;t cover. Shown in the Mockup Creator and on the work order.</p>

      <p className="faint bp-hint">Fashion hit: no white underbase; each color is printed, flashed and printed again through the same screen. Softer and more worn-in, less bright. Priced the same as with an underbase. {state}</p>
    </div>
  );
}
