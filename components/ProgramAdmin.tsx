"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { LOCATIONS } from "@/lib/pricing";
import { PROGRAM_SIZES, type Program, type ProgramImprint, type ProgramItem } from "@/lib/programs";

const blankItem = (programId: string, position: number): Omit<ProgramItem, "id"> => ({ program_id: programId, name: "", style: "", brand: "", garment: "", colors: [], sizes: ["S", "M", "L", "XL", "2XL"], price: 0, min_qty: 0, imprints: [{ location: "Full Front", method: "screen", colors: 1, inks: "", size: "", notes: "" }], design_id: null, image_path: "", notes: "", active: true, position });

/**
 * Staff: a customer's program pricing. Items they order often, each with a flat price per piece (any quantity),
 * the garment, colors, sizes, print details, their logo and a picture. These make up the customer's program order form.
 */
export default function ProgramAdmin({ customerId }: { customerId: string }) {
  const sb = createClient();
  const [program, setProgram] = useState<Program | null>(null);
  const [items, setItems] = useState<ProgramItem[]>([]);
  const [designs, setDesigns] = useState<{ id: string; name: string }[]>([]);
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState("");
  const load = useCallback(async () => {
    const [{ data: ps }, { data: ds }] = await Promise.all([
      sb.from("programs").select("*").eq("customer_id", customerId).order("created_at").limit(1),
      sb.from("designs").select("id, name").eq("customer_id", customerId).is("archived_at", null).order("number", { ascending: false }),
    ]);
    const p = ((ps || [])[0] || null) as Program | null;
    setProgram(p); setDesigns((ds || []) as never);
    if (p) {
      const { data: its } = await sb.from("program_items").select("*").eq("program_id", p.id).order("position");
      const list = (its || []) as ProgramItem[];
      setItems(list);
      const paths = list.filter((i) => i.image_path).map((i) => i.image_path);
      if (paths.length) { const { data: sg } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); setImgs(Object.fromEntries(paths.map((pth, i) => [pth, sg?.[i]?.signedUrl || ""]))); }
    }
    setLoaded(true);
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const saveProgram = async (patch: Partial<Program>) => { if (!program) return; setProgram({ ...program, ...patch }); await sb.from("programs").update(patch).eq("id", program.id); setState("Saved"); };
  const saveItem = async (id: string, patch: Partial<ProgramItem>) => { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x))); const { error } = await sb.from("program_items").update(patch).eq("id", id); setState(error ? "Couldn't save: " + error.message : "Saved"); };

  if (!loaded) return <div className="gb-empty">Loading…</div>;
  if (!program) return (
    <div className="pg-none">
      <div className="pg-none-ic" aria-hidden="true">★</div>
      <h3>No program yet</h3>
      <p>Set up program pricing for this customer: the items they order often, each at a flat price per piece. They&apos;ll get a quick order form in their portal.</p>
      <button type="button" className="btn primary" onClick={async () => { await sb.from("programs").insert({ customer_id: customerId, name: "Program", active: true }); load(); }}>Set up program pricing</button>
    </div>
  );
  return (
    <div className="pga">
      <div className="aa-bar"><div className="aa-bar-l"><h2>Program pricing</h2><span className="aa-sum">{items.filter((i) => i.active).length} active item{items.length === 1 ? "" : "s"} · {state || "Saves as you type"}</span></div>
        <label className="check"><input type="checkbox" checked={program.active} onChange={(e) => saveProgram({ active: e.target.checked })} /> Show in their portal</label>
      </div>
      <div className="pga-head">
        <label>Program name<input type="text" value={program.name} onChange={(e) => saveProgram({ name: e.target.value })} placeholder="e.g. Two Men Moving: crew apparel" /></label>
        <label className="wide">Note shown to the customer<input type="text" value={program.notes} onChange={(e) => saveProgram({ notes: e.target.value })} placeholder="e.g. Prices include one-color front and back. Ships in 7 business days." /></label>
      </div>
      <div className="pga-items">
        {items.map((it) => (
          <article key={it.id} className={"pga-item" + (it.active ? "" : " off")}>
            <div className="pga-img">
              {it.image_path && imgs[it.image_path] ? <img src={imgs[it.image_path]} alt="" /> : <span>👕</span>}
              <label className="btn sm">Picture<input type="file" hidden accept="image/*" onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
                const path = `programs/${customerId}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
                const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
                if (up.error) { setState(up.error.message); return; }
                const { data: sg } = await sb.storage.from("proofs").createSignedUrl(path, 3600);
                setImgs((x) => ({ ...x, [path]: sg?.signedUrl || "" }));
                saveItem(it.id, { image_path: path });
              }} /></label>
            </div>
            <div className="pga-fields">
              <div className="pga-row">
                <label className="grow">Item name<input type="text" value={it.name} onChange={(e) => saveItem(it.id, { name: e.target.value })} placeholder="Crew tee" /></label>
                <label>Flat price / piece<div className="qp-amt-in"><span>$</span><input type="text" inputMode="decimal" defaultValue={it.price ? String(it.price) : ""} onBlur={(e) => saveItem(it.id, { price: Math.round((+e.target.value.replace(/[^\d.]/g, "") || 0) * 100) / 100 })} placeholder="0.00" /></div></label>
                <label>Minimum<input type="number" min={0} value={it.min_qty || ""} onChange={(e) => saveItem(it.id, { min_qty: +e.target.value || 0 })} placeholder="none" /></label>
              </div>
              <div className="pga-row">
                <label>Brand<input type="text" value={it.brand} onChange={(e) => saveItem(it.id, { brand: e.target.value })} placeholder="Gildan" /></label>
                <label>Style #<input type="text" value={it.style} onChange={(e) => saveItem(it.id, { style: e.target.value })} placeholder="5000" /></label>
                <label className="grow">Garment<input type="text" value={it.garment} onChange={(e) => saveItem(it.id, { garment: e.target.value })} placeholder="Heavy Cotton T-Shirt" /></label>
              </div>
              <div className="pga-row">
                <label className="grow">Colors they can pick (comma between)<input type="text" defaultValue={it.colors.join(", ")} onBlur={(e) => saveItem(it.id, { colors: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Black, Navy" /></label>
                <label className="grow">Their logo<select value={it.design_id || ""} onChange={(e) => saveItem(it.id, { design_id: e.target.value || null })}><option value="">None</option>{designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              </div>
              <div className="pga-sizes"><span>Sizes</span>{PROGRAM_SIZES.map((z) => <button key={z} type="button" className={it.sizes.includes(z) ? "on" : ""} onClick={() => saveItem(it.id, { sizes: it.sizes.includes(z) ? it.sizes.filter((x) => x !== z) : PROGRAM_SIZES.filter((x) => x === z || it.sizes.includes(x)) })}>{z}</button>)}</div>
              <div className="pga-imps">
                <span>Print</span>
                {it.imprints.map((im, k) => {
                  const setIm = (patch: Partial<ProgramImprint>) => saveItem(it.id, { imprints: it.imprints.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                  return (
                    <div key={k} className="pga-imp">
                      <select value={im.location} onChange={(e) => setIm({ location: e.target.value })}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select>
                      <select value={im.method} onChange={(e) => setIm({ method: e.target.value as ProgramImprint["method"] })}><option value="screen">Screen print</option><option value="embroidery">Embroidery</option><option value="dtf">DTF</option></select>
                      <input type="text" value={im.inks} onChange={(e) => setIm({ inks: e.target.value })} placeholder="Ink colors" />
                      <input type="text" value={im.size} onChange={(e) => setIm({ size: e.target.value })} placeholder='Size (e.g. 11" wide)' />
                      <button type="button" className="btn icon ghost sm" aria-label="Remove print" onClick={() => saveItem(it.id, { imprints: it.imprints.filter((_, j) => j !== k) })}>✕</button>
                    </div>
                  );
                })}
                <button type="button" className="btn sm" onClick={() => saveItem(it.id, { imprints: [...it.imprints, { location: "Full Back", method: "screen", colors: 1, inks: "", size: "", notes: "" }] })}>+ Print location</button>
              </div>
              <div className="pga-row">
                <label className="grow">Note for the customer<input type="text" value={it.notes} onChange={(e) => saveItem(it.id, { notes: e.target.value })} placeholder="e.g. Includes name drop on back" /></label>
                <label className="check"><input type="checkbox" checked={it.active} onChange={(e) => saveItem(it.id, { active: e.target.checked })} /> Active</label>
                <span className="pga-price">{it.price ? `${money(it.price)} / pc` : ""}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
      <button type="button" className="btn primary" onClick={async () => { const { error } = await sb.from("program_items").insert(blankItem(program.id, items.length)); if (error) setState(error.message); load(); }}>+ Add program item</button>
    </div>
  );
}
