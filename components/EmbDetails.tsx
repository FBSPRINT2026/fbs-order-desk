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
/** one spot of a logo (left chest, cuff…): its prints on every order, what was confirmed for it before, its stitch file */
type Spot = { key: string; loc: string; items: Item[]; hasFile: boolean; last: SpecEntry | null };
type Logo = { key: string; des: Des | null; customer: string; spots: Spot[]; items: Item[]; hasFile: boolean };
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
  const [open, setOpen] = useState(""), [f, setF] = useState<DetailsInput>(blank("")), [sizes, setSizes] = useState<Record<string, string>>({}), [pick, setPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ key: string; text: string; bad?: boolean } | null>(null);
  const [finder, setFinder] = useState<{ L: Logo; S: Spot } | null>(null);

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

  // one row per logo (the same art, whatever its record), its spots inside
  const logos = useMemo(() => {
    const m = new Map<string, Logo>();
    for (const it of items) {
      const d = it.lead.design_id ? des[it.lead.design_id] || null : null;
      const key = d?.art_hash || d?.id || `none:${it.order.id}:${it.lead.id}`;
      let L = m.get(key);
      if (!L) { L = { key, des: d, customer: custs[it.order.customer_id || ""] || "", spots: [], items: [], hasFile: true }; m.set(key, L); }
      L.items.push(it);
      let S = L.spots.find((x) => x.key === lc(it.lead.location));
      if (!S) {
        const kin = d ? [d, ...sameArt.filter((x) => x.id !== d.id && d.art_hash && x.art_hash === d.art_hash)] : [];
        const last = kin.flatMap((x) => latestSpecs((x.specs || {}) as DesignSpecs)).filter((e) => lc(e.location) === lc(it.lead.location) && (!e.method || e.method === "embroidery")).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
        S = { key: lc(it.lead.location), loc: it.lead.location || "Print", items: [], hasFile: kin.some((x) => (embSpecsOf(x).files || []).length > 0), last };
        L.spots.push(S);
      }
      S.items.push(it);
      if (it.lead.emb?.file || it.lead.digitized) S.hasFile = true;
    }
    for (const L of m.values()) L.hasFile = L.spots.every((S) => S.hasFile);
    return [...m.values()].sort((a, b) => b.items.length - a.items.length || a.customer.localeCompare(b.customer));
  }, [items, des, sameArt, custs]);
  const shown = logos.filter((L) => filter === "all" || (filter === "nofile" ? !L.hasFile : L.hasFile));
  const nNo = logos.filter((L) => !L.hasFile).length;
  const pk = (it: Item) => it.order.id + it.lead.id;

  function openLogo(L: Logo) {
    if (open === L.key) { setOpen(""); return; }
    setOpen(L.key); setMsg(null);
    setPick(Object.fromEntries(L.items.map((it) => [pk(it), true])));
    // blank, our guess greyed in each box; what production confirmed before for this logo, a click away
    setF(blank(L.items[0].lead.id)); setSizes({});
  }
  async function confirm(L: Logo) {
    const chosen = L.items.filter((it) => pick[pk(it)]);
    if (!chosen.length) { setMsg({ key: L.key, text: "Tick at least one order.", bad: true }); return; }
    setBusy(L.key); setMsg(null);
    const byOrder = new Map<string, Item[]>();
    for (const it of chosen) byOrder.set(it.order.id, [...(byOrder.get(it.order.id) || []), it]);
    const bad: string[] = [];
    for (const [oid, its] of byOrder) {
      // the threads once for the logo; each spot its own size
      const r = await confirmDetails(oid, its.flatMap((it) => it.ims.map((im) => ({ ...f, size: sizes[lc(it.lead.location)] || "", id: im.id }))));
      if (!r.ok) bad.push(`#${its[0].order.number}: ${r.error}`);
    }
    setBusy("");
    if (bad.length) { setMsg({ key: L.key, text: bad.join(" "), bad: true }); return; }
    setMsg({ key: L.key, text: `Confirmed on ${byOrder.size} order${byOrder.size === 1 ? "" : "s"}. Kept with the logo, so the next order with it comes in confirmed.` });
    setOpen("");
    await onChanged();
  }
  function fillLast(L: Logo) {
    const lasts = L.spots.map((S) => S.last).filter(Boolean) as SpecEntry[];
    if (!lasts.length) return;
    const top = [...lasts].sort((a, b) => b.at.localeCompare(a.at))[0];
    setF({ ...f, inks: top.inks || f.inks, colors: top.colors || f.colors });
    setSizes(Object.fromEntries(L.spots.filter((S) => S.last?.size).map((S) => [S.key, S.last!.size])));
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
            const isOpen = open === L.key, orders = [...new Map<string, EdgRow>(L.items.map((it) => [it.order.id, it.order])).values()];
            const n = L.items.reduce((a, it) => a + it.ims.length, 0), g = guess(L);
            const first = L.items[0], noFile = L.spots.filter((S) => !S.hasFile);
            const nPick = new Set(L.items.filter((it) => pick[pk(it)]).map((it) => it.order.id)).size;
            const fileBtns = (S: Spot) => <>
              <button type="button" className="btn sm primary" onClick={() => setFinder({ L, S })}>Find or upload the files</button>
              <Link className="btn sm" href={digitizingHref(S.items[0].order.id, S.items[0].lead.id)}>Can&apos;t find it: ask the digitizer</Link>
            </>;
            return (
              <section key={L.key} className={"panel edg-card" + (isOpen ? " open" : "")}>
                <button type="button" className="edg-head" aria-expanded={isOpen} onClick={() => openLogo(L)}>
                  <span className="edg-art">{L.des && pv[L.des.id] ? <img src={pv[L.des.id]} alt="" /> : <span className="faint">No art</span>}</span>
                  <span className="edg-main"><b>{L.des ? L.des.name || `D-${L.des.number}` : "No logo on the print"}</b>
                    <span className="faint">{L.spots.map((S) => S.loc).join(", ")} · {L.customer || "—"} · {orders.length} order{orders.length === 1 ? "" : "s"}, {n} print{n === 1 ? "" : "s"} · {orders.map((o) => `#${o.number}`).join(", ")}</span></span>
                  <span className="edg-thr faint">{g.length ? g.join(" | ") : "No threads yet"}</span>
                  <span className={"edg-file" + (L.hasFile ? " ok" : " no")}>{L.hasFile ? "Stitch file on hand" : L.spots.length > 1 && noFile.length < L.spots.length ? `${noFile.length} spot${noFile.length === 1 ? "" : "s"} without a file` : "Do we have the file?"}</span>
                </button>
                {!L.hasFile && !isOpen && (
                  <div className="edg-files">
                    {L.spots.length === 1 ? <><span className="faint">No stitch file for this logo yet.</span>{fileBtns(L.spots[0])}</>
                      : <span className="faint">No stitch file yet for {noFile.map((S) => S.loc).join(", ")}. Open it to find, upload or ask for each.</span>}
                    {busy === L.key && <span className="faint">Putting the file on the prints…</span>}
                    {msg?.bad && msg.key === L.key && <span className="err">{msg.text}</span>}
                  </div>
                )}
                {isOpen && (
                  <div className="edg-body">
                    {L.spots.some((S) => S.last) && <div className="pdd-why faint">Confirmed before: {L.spots.filter((S) => S.last).map((S) => `${S.loc} on #${S.last!.order_number}: ${[S.last!.size, S.last!.inks].filter(Boolean).join(", ")}`).join("; ")}. <button type="button" className="linkbtn" onClick={() => fillLast(L)}>Use the same</button></div>}
                    <div className="pdd-grid">
                      <label className="field pdd-wide"><span>Threads (by number)</span><input type="text" value={f.inks} placeholder={g[0] ? `Guess: ${g[0]}` : "Madeira 1843, Isacord 0015"} onChange={(e) => setF({ ...f, inks: e.target.value })} /></label>
                      <label className="field"><span>Thread colors</span><input type="number" min={1} max={15} value={f.colors} onChange={(e) => setF({ ...f, colors: +e.target.value || 1 })} /></label>
                      <label className="field"><span>Backing</span><select value={f.backing || ""} onChange={(e) => setF({ ...f, backing: e.target.value })}><option value="">Not sure</option>{BACKINGS.map((b) => <option key={b}>{b}</option>)}</select></label>
                      <label className="field"><span>Topping</span><select value={f.topping || ""} onChange={(e) => setF({ ...f, topping: e.target.value })}><option value="">Not sure</option>{TOPPINGS.map((b) => <option key={b}>{b}</option>)}</select></label>
                      <label className="field pdd-full"><span>Sew notes (optional)</span><input type="text" value={f.notes} placeholder="Machine, hoop, needle, speed, anything for next time" onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
                    </div>
                    {/* each spot: its size, its stitch file, and the orders it's on */}
                    {L.spots.map((S) => (
                      <div key={S.key} className="edg-spot">
                        <div className="edg-sh"><b>{S.loc}</b>
                          <label className="field edg-sz"><span>Size</span><input type="text" value={sizes[S.key] || ""} placeholder={S.items[0].lead.size ? `Guess: ${S.items[0].lead.size}` : '3.5" wide'} onChange={(e) => setSizes({ ...sizes, [S.key]: e.target.value })} /></label>
                          <span className={"edg-file" + (S.hasFile ? " ok" : " no")}>{S.hasFile ? "Stitch file on hand" : "No stitch file"}</span>
                          {!S.hasFile && fileBtns(S)}
                        </div>
                        <div className="edg-to">
                          {S.items.map((it) => {
                            const k = pk(it), gar = [...new Set(it.order.groups.filter((gg) => gg.imprints.some((im) => it.ims.includes(im))).flatMap((gg) => gg.lines.map((l) => l.color).filter(Boolean)))].join(", ");
                            return <label key={k} className="check edg-o"><input type="checkbox" checked={!!pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} /><b>#{it.order.number}</b><span className="faint">{gar || it.order.nickname}{it.lead.inks && g.length > 1 ? ` · ${it.lead.inks}` : ""}</span><Link href={`/shop/orders/${it.order.id}?view=admin`} className="linkbtn" onClick={(e) => e.stopPropagation()}>Open</Link></label>;
                          })}
                        </div>
                      </div>
                    ))}
                    {busy === L.key && <span className="faint">Working…</span>}
                    {msg?.key === L.key && <div className={msg.bad ? "err" : "faint"}>{msg.text}</div>}
                    <div className="pdd-foot">
                      <span className="faint">Untick an order that sews differently (other threads on other garments) and confirm it on its own.</span>
                      <span className="spacer" />
                      {canConfirm ? <button type="button" className="btn primary" disabled={busy === L.key} onClick={() => void confirm(L)}>{busy === L.key ? "Saving…" : `Confirm for ${nPick} order${nPick === 1 ? "" : "s"}`}</button>
                        : <span className="faint">Embroidery confirms these.</span>}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {finder && <DigitizedFinder designId={finder.L.des?.id || null}
        where={[finder.S.loc, finder.L.des ? finder.L.des.name || `D-${finder.L.des.number}` : "", finder.L.customer].filter(Boolean).join(" · ")}
        hint={(finder.L.des?.name || finder.S.items[0].order.nickname || "").replace(/\b(mockup|front|back|left|right|chest|logo|final|copy|cart|store)\b/gi, " ").replace(/#?\d{5,}/g, " ").replace(/\s+/g, " ").trim()}
        onClose={() => setFinder(null)}
        onDone={(set, _info, sewout) => {
          const { L, S } = finder; setFinder(null); setBusy(L.key);
          void attachStitchFile(S.items.flatMap((it) => it.ims.map((im) => ({ orderId: it.order.id, imprintId: im.id }))), set, sewout).then(async (r) => {
            setBusy("");
            setMsg(r.ok ? { key: L.key, text: `${set.name} is on ${r.n} ${S.loc.toLowerCase()} print${r.n === 1 ? "" : "s"}${sewout ? ": they go to Needs sew-out on the Digitizing page" : ", ready to sew"}.` } : { key: L.key, text: r.error, bad: true });
            await onChanged();
          });
        }} />}
    </>
  );
}
