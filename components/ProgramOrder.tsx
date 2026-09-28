"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { PROGRAM_SIZES, type Program, type ProgramItem } from "@/lib/programs";
import { placeProgramOrder } from "@/app/portal/program-actions";

type Line = { color: string; sizes: Record<string, number> };

/**
 * The customer's program: their items at flat prices, as a quick order form.
 * Pick a color, type quantities by size, and send it in; it arrives at the shop with the program prices set.
 */
export default function ProgramOrder({ program, items, images, projects, canAct, qs }: {
  program: Program | null; items: ProgramItem[]; images: Record<string, string>; projects: { id: string; name: string }[]; canAct: boolean; qs: string;
}) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [due, setDue] = useState(""), [po, setPo] = useState(""), [notes, setNotes] = useState(""), [proj, setProj] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  if (!program || !items.length) return (
    <div className="pg-none">
      <div className="pg-none-ic" aria-hidden="true">★</div>
      <h3>Program pricing</h3>
      <p>Order the same items often? With a program, you get a <b>flat price per piece</b> on your regular items (any quantity) and a quick order form right here.</p>
      <a className="btn primary" href={`/portal${qs}${qs ? "&" : "?"}area=messages`}>Ask us about program pricing</a>
    </div>
  );
  const line = (id: string): Line => cart[id] || { color: items.find((i) => i.id === id)?.colors[0] || "", sizes: {} };
  const qty = (id: string) => Object.values(line(id).sizes).reduce((a, b) => a + (+b || 0), 0);
  const set = (id: string, patch: Partial<Line>) => setCart((c) => ({ ...c, [id]: { ...line(id), ...patch } }));
  const chosen = items.filter((i) => qty(i.id) > 0);
  const total = chosen.reduce((a, i) => a + qty(i.id) * +i.price, 0), pcs = chosen.reduce((a, i) => a + qty(i.id), 0);
  const short = chosen.filter((i) => i.min_qty && qty(i.id) < i.min_qty);

  async function send() {
    setBusy(true); setMsg(null);
    const r = await placeProgramOrder({ lines: chosen.map((i) => ({ itemId: i.id, color: line(i.id).color, sizes: line(i.id).sizes })), due_date: due || null, po, notes, projectId: proj || null });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error || "Couldn't send it." });
    setCart({}); setNotes(""); setPo("");
    setMsg({ ok: true, text: `Order #${r.number} is in. We'll confirm it and let you know when it's scheduled.`, id: r.id });
    router.refresh();
  }

  return (
    <div className="pg">
      <div className="aa-bar"><div className="aa-bar-l"><h2>{program.name || "Your program"}</h2><span className="aa-sum">Flat prices on your regular items, any quantity. Type quantities and send it in.</span></div></div>
      {program.notes && <div className="pg-notes">{program.notes}</div>}
      <div className="pg-wrap">
        <div className="pg-items">
          {items.map((it) => {
            const l = line(it.id), q = qty(it.id);
            const sizes = it.sizes.length ? it.sizes : ["S", "M", "L", "XL", "2XL"];
            return (
              <article key={it.id} className={"pg-item" + (q ? " on" : "")}>
                <div className="pg-img">{images[it.id] ? <img src={images[it.id]} alt={it.name} /> : <span>👕</span>}</div>
                <div className="pg-body">
                  <div className="pg-top"><b>{it.name}</b><span className="pg-price">{money(+it.price)}<small>/ piece</small></span></div>
                  <div className="pg-sub">{[it.brand, it.style, it.garment].filter(Boolean).join(" ")}{it.imprints.length ? ` · ${it.imprints.map((im) => im.location).join(" + ")}` : ""}{it.min_qty ? ` · min ${it.min_qty}` : ""}</div>
                  {it.notes && <div className="pg-sub">{it.notes}</div>}
                  {it.colors.length > 1 && (
                    <div className="pg-colors">{it.colors.map((c) => <button key={c} type="button" className={l.color === c ? "on" : ""} onClick={() => set(it.id, { color: c })}>{c}</button>)}</div>
                  )}
                  {it.colors.length === 1 && <div className="pg-sub">Color: <b>{it.colors[0]}</b></div>}
                  <div className="pg-sizes">
                    {sizes.filter((z) => PROGRAM_SIZES.includes(z)).map((z) => (
                      <label key={z}><span>{z === "OS" ? "Qty" : z}</span><input type="number" min={0} inputMode="numeric" value={l.sizes[z] || ""} onChange={(e) => set(it.id, { sizes: { ...l.sizes, [z]: Math.max(0, Math.round(+e.target.value || 0)) } })} placeholder="0" /></label>
                    ))}
                  </div>
                  {q > 0 && <div className="pg-line">{q} pcs · <b>{money(q * +it.price)}</b>{it.min_qty && q < it.min_qty ? <span className="bad"> · minimum {it.min_qty}</span> : null}</div>}
                </div>
              </article>
            );
          })}
        </div>
        <aside className="pg-cart">
          <h3>Your order</h3>
          {chosen.length ? <div className="pg-cart-list">{chosen.map((i) => <div key={i.id}><span>{qty(i.id)} × {i.name}{line(i.id).color ? ` (${line(i.id).color})` : ""}</span><b>{money(qty(i.id) * +i.price)}</b></div>)}</div>
            : <div className="faint" style={{ fontSize: 13 }}>Type quantities on the items to add them.</div>}
          <div className="pg-total"><span>{pcs} pcs</span><b>{money(total)}</b></div>
          <div className="faint" style={{ fontSize: 12 }}>Program prices, no setup fees. Tax and shipping, if any, are added on the invoice.</div>
          <label>Need it by<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <label>PO number (optional)<input type="text" value={po} onChange={(e) => setPo(e.target.value)} /></label>
          {projects.length > 0 && <label>Project (optional)<select value={proj} onChange={(e) => setProj(e.target.value)}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
          <label>Notes (optional)<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ship-to, names, anything special" /></label>
          {msg && <div className={msg.ok ? "okmsg" : "banner"}>{msg.text}{msg.ok && msg.id && <> <a href={`/portal/orders/${msg.id}${qs}`}>View order</a></>}</div>}
          <button type="button" className="btn primary pp-go" disabled={!canAct || busy || !chosen.length || short.length > 0} onClick={send}>{busy ? "Sending…" : chosen.length ? `Send order · ${money(total)}` : "Send order"}</button>
          {!canAct && <div className="faint" style={{ fontSize: 12 }}>Turned off in the preview.</div>}
        </aside>
      </div>
    </div>
  );
}
