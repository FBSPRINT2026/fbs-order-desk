"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Group, Imprint } from "@/lib/pricing";
import { BACKINGS, TOPPINGS } from "@/lib/embroidery";
import type { DetailsInput } from "@/lib/productionDetails";
import { latestSpecs, type DesignSpecs, type SpecEntry } from "@/lib/designSpecs";
import { digitizingHref, embSpecsOf } from "@/lib/digitizeStatus";
import { confirmDetails, attachStitchFile } from "@/app/shop/details-actions";
import DigitizedFinder from "@/components/DigitizedFinder";
import { useSticky } from "@/lib/useSticky";

/**
 * Reorder Details for embroidery, one row per logo and spot (Nov 9, Nick: "did we just go in and make every MEI cart order
 * confirm details? So you've got 10 jobs in there for asking about the same thing… a section… just for digitizing and
 * embroidery. Like, can we upload these files? Help me find it. Can't find it. Request digitizing"). The same art at the
 * same spot on every waiting order is one row (a store cart's logo is a new logo record each time, so it's matched by its
 * art): confirm its threads and size once for the orders ticked, and bring in its stitch file once for all of them.
 * What's confirmed is kept with the logo, so the next order with it comes in confirmed (lib/designSpecs.ts bySameArt).
 */
export type EdgRow = { id: string; number: number; nickname: string; customer_id: string | null; due_date: string | null; groups: Group[] };
type Des = { id: string; number: number; name: string; art_hash: string | null; preview_path: string | null; specs: Record<string, unknown> | null };
type Item = { order: EdgRow; ims: Imprint[]; lead: Imprint };
type Logo = { key: string; des: Des | null; loc: string; customer: string; items: Item[]; hasFile: boolean; last: SpecEntry | null };
type Filter = "all" | "nofile" | "threads";
const lc = (s: string) => (s || "").trim().toLowerCase();
const blank = (id: string): DetailsInput => ({ id, size: "", inks: "", colors: 1, underbase: "", drop: "", screensOnFile: false, notes: "", stitches: "", backing: "", topping: "" });

export default function EmbDetails({ rows, sets, custs, canConfirm, onChanged }: {
  rows: EdgRow[];
  /** an order's waiting embroidered prints, the same print on several groups as one (the page's printSets) */
  sets: (r: EdgRow) => { lead: Imprint; ims: Imprint[] }[];
  custs: Record<string, string>; canConfirm: boolean; onChanged: () => Promise<void> | void;
}) {
  const sb = useMemo(() => createClient(), []);
  const [des, setDes] = useState<Record<string, Des>>({}), [sameArt, setSameArt] = useState<Des[]>([]), [pv, setPv] = useState<Record<string, string>>({});
  const [filter, setFilter] = useSticky<Filter>("details.emb.filter", "all");
  const [open, setOpen] = useState(""), [f, setF] = useState<DetailsInput>(blank("")), [pick, setPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ key: string; text: string; bad?: boolean } | null>(null);
  const [finder, setFinder] = useState<Logo | null>(null);

  const items = useMemo(() => rows.flatMap((r) => sets(r).filter((s) => s.lead.method === "embroidery").map((s) => ({ order: r, ims: s.ims, lead: s.lead }))), [rows, sets]);
  const ids = useMemo(() => [...new Set(items.map((x) => x.lead.design_id).filter(Boolean))] as string[], [items]);
  useEffect(() => {
    if (!ids.length) return;
    void (async () => {
      const { data } = await sb.from("designs").select("id, number, name, art_hash, preview_path, specs").in("id", ids);
      const ds = (data || []) as Des[];
      setDes(Object.fromEntries(ds.map((d) => [d.id, d])));
      // the same art on other logo records: what production confirmed for it before, and its stitch files
      const hs = [...new Set(ds.map((d) => d.art_hash).filter(Boolean))] as string[];
      if (hs.length) { const { data: more } = await sb.from("designs").select("id, number, name, art_hash, preview_path, specs").in("art_hash", hs).limit(500); setSameArt((more || []) as Des[]); }
      const withPv = ds.filter((d) => d.preview_path);
      if (withPv.length) {
        const { data: su } = await sb.storage.from("proofs").createSignedUrls(withPv.map((d) => d.preview_path!), 3600);
        setPv(Object.fromEntries(withPv.map((d, i) => [d.id, su?.[i]?.signedUrl || ""]).filter(([, u]) => u)));
      }
    })();
  }, [ids.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const logos = useMemo(() => {
    const m = new Map<string, Logo>();
    for (const it of items) {
      const d = it.lead.design_id ? des[it.lead.design_id] || null : null;
      const art = d?.art_hash || d?.id || `none:${it.order.id}:${it.lead.id}`;
      const key = `${art}|${lc(it.lead.location)}`;
      let L = m.get(key);
      if (!L) {
        const kin = d ? [d, ...sameArt.filter((x) => x.id !== d.id && d.art_hash && x.art_hash === d.art_hash)] : [];
        const last = kin.flatMap((x) => latestSpecs((x.specs || {}) as DesignSpecs)).filter((e) => lc(e.location) === lc(it.lead.location) && (!e.method || e.method === "embroidery")).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
        L = { key, des: d, loc: it.lead.location || "Print", customer: custs[it.order.customer_id || ""] || "", items: [], hasFile: kin.some((x) => (embSpecsOf(x).files || []).length > 0), last };
        m.set(key, L);
      }
      L.items.push(it);
      if (it.lead.emb?.file || it.lead.digitized) L.hasFile = true;
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length || a.customer.localeCompare(b.customer));
  }, [items, des, sameArt, custs]);
  const shown = logos.filter((L) => filter === "all" || (filter === "nofile" ? !L.hasFile : L.hasFile));
  const nNo = logos.filter((L) => !L.hasFile).length;

  function openLogo(L: Logo) {
    if (open === L.key) { setOpen(""); return; }
    setOpen(L.key); setMsg(null);
    setPick(Object.fromEntries(L.items.map((it) => [it.order.id + it.lead.id, true])));
    // blank, our guess greyed in each box; what production confirmed before for this logo and spot, a click away
    setF(blank(L.items[0].lead.id));
  }
  async function confirm(L: Logo) {
    const chosen = L.items.filter((it) => pick[it.order.id + it.lead.id]);
    if (!chosen.length) { setMsg({ key: L.key, text: "Tick at least one order.", bad: true }); return; }
    setBusy(L.key); setMsg(null);
    const byOrder = new Map<string, Item[]>();
    for (const it of chosen) byOrder.set(it.order.id, [...(byOrder.get(it.order.id) || []), it]);
    const bad: string[] = [];
    for (const [oid, its] of byOrder) {
      const r = await confirmDetails(oid, its.flatMap((it) => it.ims.map((im) => ({ ...f, id: im.id }))));
      if (!r.ok) bad.push(`#${its[0].order.number}: ${r.error}`);
    }
    setBusy("");
    if (bad.length) { setMsg({ key: L.key, text: bad.join(" "), bad: true }); return; }
    setMsg({ key: L.key, text: `Confirmed on ${byOrder.size} order${byOrder.size === 1 ? "" : "s"}. Kept with the logo, so the next order with it at the ${L.loc.toLowerCase()} comes in confirmed.` });
    setOpen("");
    await onChanged();
  }

  const guess = (L: Logo) => [...new Set(L.items.map((it) => it.lead.inks).filter(Boolean))];
  return (
    <>
      <div className="toolbar edg-bar">
        <div className="chips">
          {([["all", `All ${logos.length}`], ["nofile", `No stitch file ${nNo}`], ["threads", `File on hand ${logos.length - nNo}`]] as const).map(([k, t]) => <button key={k} type="button" className={"chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{t}</button>)}
        </div>
        <span className="faint edg-note">{items.length} print{items.length === 1 ? "" : "s"} on {new Set(items.map((x) => x.order.id)).size} orders, as {logos.length} logo{logos.length === 1 ? "" : "s"}</span>
      </div>
      {msg && !msg.bad && !open && <div className="banner pdd-ok" role="status">{msg.text}</div>}
      {!shown.length ? <div className="empty">{filter === "nofile" ? "Every waiting logo has its stitch file." : "Nothing waiting on embroidery details."}</div> : (
        <div className="edg-list">
          {shown.map((L) => {
            const isOpen = open === L.key, orders = [...new Map(L.items.map((it) => [it.order.id, it.order])).values()];
            const n = L.items.reduce((a, it) => a + it.ims.length, 0), g = guess(L);
            const first = L.items[0];
            return (
              <section key={L.key} className={"panel edg-card" + (isOpen ? " open" : "")}>
                <button type="button" className="edg-head" aria-expanded={isOpen} onClick={() => openLogo(L)}>
                  <span className="edg-art">{L.des && pv[L.des.id] ? <img src={pv[L.des.id]} alt="" /> : <span className="faint">No art</span>}</span>
                  <span className="edg-main"><b>{L.des ? L.des.name || `D-${L.des.number}` : "No logo on the print"} · {L.loc}</b>
                    <span className="faint">{L.customer || "—"} · {orders.length} order{orders.length === 1 ? "" : "s"}, {n} print{n === 1 ? "" : "s"} · {orders.map((o) => `#${o.number}`).join(", ")}</span></span>
                  <span className="edg-thr faint">{g.length ? g.join(" | ") : "No threads yet"}</span>
                  <span className={"edg-file" + (L.hasFile ? " ok" : " no")}>{L.hasFile ? "Stitch file on hand" : "Do we have the file?"}</span>
                </button>
                {!L.hasFile && (
                  <div className="edg-files">
                    <span className="faint">No stitch file for this logo yet.</span>
                    <button type="button" className="btn sm primary" onClick={() => setFinder(L)}>Find or upload the files</button>
                    <Link className="btn sm" href={digitizingHref(first.order.id, first.lead.id)}>Can&apos;t find it: ask the digitizer</Link>
                    {busy === L.key && <span className="faint">Putting the file on the prints…</span>}
                    {msg?.bad && msg.key === L.key && !isOpen && <span className="err">{msg.text}</span>}
                  </div>
                )}
                {isOpen && (
                  <div className="edg-body">
                    {L.last && <div className="pdd-why faint">Confirmed before on #{L.last.order_number}: {[L.last.size, L.last.inks].filter(Boolean).join(", ")}. <button type="button" className="linkbtn" onClick={() => setF({ ...f, size: L.last!.size || "", inks: L.last!.inks || "", colors: L.last!.colors || f.colors })}>Use the same</button></div>}
                    <div className="pdd-grid">
                      <label className="field"><span>Size</span><input type="text" value={f.size} placeholder={first.lead.size ? `Guess: ${first.lead.size}` : '3.5" wide'} onChange={(e) => setF({ ...f, size: e.target.value })} /></label>
                      <label className="field pdd-wide"><span>Threads (by number)</span><input type="text" value={f.inks} placeholder={g[0] ? `Guess: ${g[0]}` : "Madeira 1843, Isacord 0015"} onChange={(e) => setF({ ...f, inks: e.target.value })} /></label>
                      <label className="field"><span>Thread colors</span><input type="number" min={1} max={15} value={f.colors} onChange={(e) => setF({ ...f, colors: +e.target.value || 1 })} /></label>
                      <label className="field"><span>Stitches</span><input type="text" inputMode="numeric" value={f.stitches || ""} placeholder={first.lead.stitches ? `Guess: ${first.lead.stitches.toLocaleString()}` : "From the DST"} onChange={(e) => setF({ ...f, stitches: e.target.value })} /></label>
                      <label className="field"><span>Backing</span><select value={f.backing || ""} onChange={(e) => setF({ ...f, backing: e.target.value })}><option value="">Not sure</option>{BACKINGS.map((b) => <option key={b}>{b}</option>)}</select></label>
                      <label className="field"><span>Topping</span><select value={f.topping || ""} onChange={(e) => setF({ ...f, topping: e.target.value })}><option value="">Not sure</option>{TOPPINGS.map((b) => <option key={b}>{b}</option>)}</select></label>
                      <label className="field pdd-full"><span>Sew notes (optional)</span><input type="text" value={f.notes} placeholder="Machine, hoop, needle, speed, anything for next time" onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
                    </div>
                    <div className="edg-to"><span className="faint">Confirm it for</span>
                      {L.items.map((it) => {
                        const k = it.order.id + it.lead.id, gar = [...new Set(it.order.groups.filter((gg) => gg.imprints.some((im) => it.ims.includes(im))).flatMap((gg) => gg.lines.map((l) => l.color).filter(Boolean)))].join(", ");
                        return <label key={k} className="check edg-o"><input type="checkbox" checked={!!pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} /><b>#{it.order.number}</b><span className="faint">{gar || it.order.nickname}{it.lead.inks && g.length > 1 ? ` · ${it.lead.inks}` : ""}</span><Link href={`/shop/orders/${it.order.id}?view=admin`} className="linkbtn" onClick={(e) => e.stopPropagation()}>Open</Link></label>;
                      })}
                    </div>
                    {msg?.bad && msg.key === L.key && <div className="err">{msg.text}</div>}
                    <div className="pdd-foot">
                      <span className="faint">Untick an order that sews differently (other threads on other garments) and confirm it on its own.</span>
                      <span className="spacer" />
                      {canConfirm ? <button type="button" className="btn primary" disabled={busy === L.key} onClick={() => void confirm(L)}>{busy === L.key ? "Saving…" : `Confirm for ${new Set(L.items.filter((it) => pick[it.order.id + it.lead.id]).map((it) => it.order.id)).size} order${new Set(L.items.filter((it) => pick[it.order.id + it.lead.id]).map((it) => it.order.id)).size === 1 ? "" : "s"}`}</button>
                        : <span className="faint">Embroidery confirms these.</span>}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {finder && <DigitizedFinder designId={finder.des?.id || null}
        where={[finder.loc, finder.des ? finder.des.name || `D-${finder.des.number}` : "", finder.customer].filter(Boolean).join(" · ")}
        hint={(finder.des?.name || finder.items[0].order.nickname || "").replace(/\b(mockup|front|back|left|right|chest|logo|final|copy|cart|store)\b/gi, " ").replace(/#?\d{5,}/g, " ").replace(/\s+/g, " ").trim()}
        onClose={() => setFinder(null)}
        onDone={(set, _info, sewout) => {
          const L = finder; setFinder(null); setBusy(L.key);
          void attachStitchFile(L.items.flatMap((it) => it.ims.map((im) => ({ orderId: it.order.id, imprintId: im.id }))), set, sewout).then(async (r) => {
            setBusy("");
            setMsg(r.ok ? { key: L.key, text: `${set.name} is on ${r.n} print${r.n === 1 ? "" : "s"}${sewout ? ": they go to Needs sew-out on the Digitizing page" : ", ready to sew"}.` } : { key: L.key, text: r.error, bad: true });
            await onChanged();
          });
        }} />}
    </>
  );
}
