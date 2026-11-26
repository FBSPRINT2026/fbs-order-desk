"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MoneyField from "@/components/MoneyField";
import { ONE_SIZE, type GLine, type Group } from "@/lib/pricing";
import { newSimpleGroup, qtyOf, specText, type SimpleSpec } from "@/lib/simpleOrders";

/**
 * A generic invoice's items (Nick, Nov 25 2026: "item number, description, quantity, rate, and then an attachment…
 * very similar to how Printavo used to be"): one table, a row per item. Item # is the line's name (`garment`), the
 * description its note (`spec.desc`), the rate its typed price (`priceOverride`), the quantity its one size. Files are
 * kept on the line (`spec.files`, in the proofs bucket) for the shop only; the customer's invoice never shows them.
 * Every item sits in the order's one group.
 */
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function GeneralLines({ orderId, groups, update, hidePrices }: {
  orderId: string; groups: Group[]; update: (fn: (groups: Group[]) => void) => void; hidePrices?: boolean;
}) {
  const sb = createClient();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const lines = groups.flatMap((g, gi) => g.lines.map((l, li) => ({ gi, l, li })));
  const total = lines.reduce((a, { l }) => a + qtyOf(l) * (+(l.priceOverride || 0) || 0), 0);

  const edit = (gi: number, li: number, fn: (l: GLine, s: SimpleSpec) => void) => update((gs) => {
    const l = gs[gi]?.lines[li]; if (!l) return;
    const s: SimpleSpec = { kind: "general", ...(l.spec || {}) } as SimpleSpec;
    fn(l, s);
    l.spec = s; l.note = specText(s);
  });
  const add = () => update((gs) => {
    const fresh = newSimpleGroup("general");
    if (gs[0]) gs[0].lines.push(fresh.lines[0]); else gs.push(fresh);
  });
  const attach = async (gi: number, li: number, list: FileList) => {
    const l = groups[gi]?.lines[li]; if (!l) return;
    setBusy(l.id); setErr("");
    const got: { path: string; name: string }[] = [];
    for (const f of Array.from(list)) {
      const path = `orders/${orderId}/items/${l.id}-file-${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
      const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || "application/octet-stream" });
      if (error) { setErr(`${f.name} didn't upload: ${error.message}`); continue; }
      got.push({ path, name: f.name });
    }
    setBusy("");
    if (got.length) edit(gi, li, (_x, s) => { s.files = [...(s.files || []), ...got]; });
  };
  const open = async (path: string) => {
    const w = window.open("", "_blank");
    const { data } = await sb.storage.from("proofs").createSignedUrl(path, 3600);
    if (data?.signedUrl && w) w.location.href = data.signedUrl; else w?.close();
  };

  return (
    <section className="panel gin">
      <div className="panel-h"><h2>Items</h2><span className="faint">A generic invoice: never on the production boards. Attachments stay with the shop.</span></div>
      <div className="panel-b">
        {err && <div className="err">{err}</div>}
        <div className="gin-t" data-nofit>
          <div className="gin-h"><span>Item #</span><span>Description</span><span>Qty</span>{!hidePrices && <><span>Rate</span><span className="gin-r">Amount</span></>}<span /></div>
          {!lines.length && <p className="faint gin-none">No items yet. Add the first one below.</p>}
          {lines.map(({ gi, l, li }) => {
            const s = (l.spec || {}) as SimpleSpec, q = qtyOf(l), files = s.files || [];
            return (
              <div key={l.id} className="gin-row">
                <input className="gin-no" aria-label="Item #" placeholder="Shipping" value={l.garment} onChange={(e) => edit(gi, li, (x) => { x.garment = e.target.value; })} />
                <div className="gin-desc">
                  <textarea aria-label="Description" rows={1} placeholder="What the customer reads" value={s.desc || ""}
                    onChange={(e) => { e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight + 2}px`; edit(gi, li, (_x, sp) => { sp.desc = e.target.value; }); }} />
                  {files.length > 0 && <div className="gin-files">{files.map((f, k) => (
                    <span key={f.path} className="gin-file">
                      <button type="button" className="linkbtn" title="Open" onClick={() => void open(f.path)}>{f.name}</button>
                      <button type="button" className="gin-x" aria-label={`Remove ${f.name}`} title="Remove from this item" onClick={() => edit(gi, li, (_x, sp) => { sp.files = (sp.files || []).filter((_, j) => j !== k); })}>×</button>
                    </span>))}</div>}
                </div>
                <input className="gin-q" aria-label="Qty" type="number" min="0" value={q || ""} onChange={(e) => edit(gi, li, (x) => { x.sizes = { [ONE_SIZE]: Math.max(0, Math.round(+e.target.value || 0)) }; })} />
                {!hidePrices && <>
                  <MoneyField className="gin-rate" aria-label="Rate" min="0" value={l.priceOverride ?? ""} onChange={(e) => edit(gi, li, (x) => { x.priceOverride = e.target.value === "" ? null : +e.target.value; })} />
                  <b className="gin-r gin-amt">{money(q * (+(l.priceOverride || 0) || 0))}</b>
                </>}
                <span className="gin-act">
                  <label className={"btn icon ghost gin-clip" + (files.length ? " has" : "")} title={busy === l.id ? "Uploading…" : "Attach a file (only the shop sees it)"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9" /></svg>
                    {files.length > 0 && <small>{files.length}</small>}
                    <input type="file" multiple hidden onChange={(e) => { const f = e.target.files; if (f?.length) void attach(gi, li, f); e.target.value = ""; }} />
                  </label>
                  <button type="button" className="btn icon ghost" aria-label="Remove this item" title="Remove" onClick={() => update((gs) => { gs[gi].lines.splice(li, 1); if (!gs[gi].lines.length) gs.splice(gi, 1); })}>×</button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="gin-foot">
          <button type="button" className="btn" onClick={add}>+ Add item</button>
          {!hidePrices && lines.length > 0 && <span className="gin-sum">Items <b>{money(total)}</b></span>}
        </div>
      </div>
    </section>
  );
}
