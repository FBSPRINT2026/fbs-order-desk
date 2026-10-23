"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { METHODS, type Group, type Imprint } from "@/lib/pricing";
import { DETAILS_LABEL, needsDetails, ordersNeedingDetails, type DetailsInput } from "@/lib/productionDetails";
import { confirmDetails } from "../details-actions";

/**
 * Reorder Details (Production → Reorder Details): reorders of old Printavo jobs waiting on production to say
 * how we printed them before. Each print comes in with our best guess (off the film or the old mockup); Jose
 * confirms it, corrects it, or leaves a field blank. Confirmed details go on the order and the customer's design.
 */
type Row = { id: string; number: number; nickname: string; customer_id: string | null; due_date: string | null; status: string; groups: Group[] };
type Done = { id: number; order_id: string; detail: string; actor: string; created_at: string; number?: number; nickname?: string };
type ArtRef = { id: string; order_id: string; name: string; file_path: string };

/**
 * The same print on several garment groups (the same art at the same spot: Little Groupies' Bottles front on the onesies
 * and the tees) prints from one set of screens, so it's confirmed once (Oct 20, Nick: "everything's doubling"). The
 * first print of each set carries the form; confirming applies it to all of them.
 */
type Set1 = { lead: Imprint; ims: Imprint[]; gs: Group[] };
const printSets = (r: Row, which: (im: Imprint) => boolean = needsDetails): Set1[] => {
  const out: Set1[] = [], by = new Map<string, Set1>();
  for (const g of r.groups) for (const im of g.imprints.filter(which)) {
    const k = im.design_id ? `${im.design_id}|${(im.location || "").toLowerCase()}|${im.method}` : im.id;
    const s0 = by.get(k);
    if (s0) { s0.ims.push(im); if (!s0.gs.includes(g)) s0.gs.push(g); continue; }
    const s1 = { lead: im, ims: [im], gs: [g] }; by.set(k, s1); out.push(s1);
  }
  return out;
};
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "No date");
// blank, with our guesses shown greyed in each box (Oct 14, Nick: a guess must never become a fact by clicking through);
// "Copy in our guesses" fills them in on purpose
const formOf = (im: Imprint): DetailsInput => ({ id: im.id, size: "", inks: "", colors: im.colors || 1, underbase: "", drop: "", screensOnFile: !!im.remake, notes: "" });
const isDone = (im: Imprint) => !!im.confirmed && !needsDetails(im);
const guessOf = (im: Imprint): DetailsInput => ({ id: im.id, size: im.size || "", inks: im.inks || "", colors: im.colors || 1, underbase: im.underbase === true ? "yes" : im.underbase === false ? "no" : "", drop: im.drop || "", screensOnFile: !!im.remake, notes: "" });

export default function ProductionDetailsPage() {
  const sb = useMemo(() => createClient(), []);
  const { role, realRole } = useRole();
  // Nick and Jose: the production view (Oct 21)
  const prodView = realRole === "owner" || realRole === "production";
  const canConfirm = !role || ["owner", "admin", "production"].includes(role);
  const open0 = useSearchParams().get("order");
  const [tab, setTab] = useState<"waiting" | "done">("waiting");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [custs, setCusts] = useState<Record<string, string>>({});
  const [art, setArt] = useState<Record<string, { name: string; url: string }[]>>({});
  const [dUrl, setDUrl] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(open0);
  const [form, setForm] = useState<Record<string, DetailsInput>>({});
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ id: string; text: string; bad?: boolean } | null>(null);
  // a confirmed order opened again to correct it (Recently confirmed → Edit)
  const [editing, setEditing] = useState<Row | null>(null);
  async function openEdit(orderId: string) {
    if (editing?.id === orderId) { setEditing(null); return; }
    const { data } = await sb.from("orders").select("id, number, nickname, customer_id, due_date, status, groups").eq("id", orderId).maybeSingle();
    if (!data) return;
    const r = data as Row;
    const f: Record<string, DetailsInput> = { ...form };
    for (const g of r.groups) for (const im of g.imprints) if (isDone(im)) f[im.id] = { ...guessOf(im), notes: "" };
    setForm(f); setEditing(r); setMsg(null);
    const ds = [...new Set(r.groups.flatMap((g) => g.imprints.map((im) => im.design_id)).filter(Boolean))] as string[];
    if (ds.length) {
      const { data: dd } = await sb.from("designs").select("id, preview_path").in("id", ds);
      const withPv = ((dd || []) as { id: string; preview_path: string }[]).filter((d) => d.preview_path);
      const { data: su } = withPv.length ? await sb.storage.from("proofs").createSignedUrls(withPv.map((d) => d.preview_path), 3600) : { data: [] };
      const m: Record<string, string> = {};
      withPv.forEach((d, i) => { if (su?.[i]?.signedUrl) m[d.id] = su[i].signedUrl; });
      setDUrl((x) => ({ ...x, ...m }));
    }
  }

  async function load() {
    const list = (await ordersNeedingDetails<Row>(sb, "id, number, nickname, customer_id, due_date, status, groups"))
      .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || a.number - b.number);
    setRows(list);
    const { data: ev } = await sb.from("order_events").select("id, order_id, detail, actor, created_at").eq("kind", "details").order("created_at", { ascending: false }).limit(40);
    const evs = (ev || []) as Done[];
    const oids = [...new Set([...list.map((r) => r.id), ...evs.map((e) => e.order_id)])];
    const [{ data: os }, { data: af }] = await Promise.all([
      evs.length ? sb.from("orders").select("id, number, nickname").in("id", evs.map((e) => e.order_id)) : Promise.resolve({ data: [] }),
      oids.length ? sb.from("art_files").select("id, order_id, name, file_path").in("order_id", list.map((r) => r.id)) : Promise.resolve({ data: [] }),
    ]);
    const om = new Map(((os || []) as { id: string; number: number; nickname: string }[]).map((o) => [o.id, o]));
    setDone(evs.map((e) => ({ ...e, number: om.get(e.order_id)?.number, nickname: om.get(e.order_id)?.nickname })));
    const cids = [...new Set(list.map((r) => r.customer_id).filter(Boolean))] as string[];
    if (cids.length) {
      const { data: cs } = await sb.from("customers").select("id, company, name").in("id", cids);
      setCusts(Object.fromEntries(((cs || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, c.company || c.name])));
    }
    // the old job's mockups and films on each order, to check against
    const refs = (af || []) as ArtRef[];
    if (refs.length) {
      const { data: su } = await sb.storage.from("proofs").createSignedUrls(refs.map((r) => r.file_path), 3600);
      const m: Record<string, { name: string; url: string }[]> = {};
      refs.forEach((r, i) => { const u = su?.[i]?.signedUrl; if (u) (m[r.order_id] ||= []).push({ name: r.name, url: u }); });
      setArt(m);
    }
    // the art on each print
    const ds = [...new Set(list.flatMap((r) => r.groups.flatMap((g) => g.imprints.filter(needsDetails).map((im) => im.design_id))).filter(Boolean))] as string[];
    if (ds.length) {
      const { data: dd } = await sb.from("designs").select("id, preview_path").in("id", ds);
      const withPv = ((dd || []) as { id: string; preview_path: string }[]).filter((d) => d.preview_path);
      if (withPv.length) {
        const { data: su } = await sb.storage.from("proofs").createSignedUrls(withPv.map((d) => d.preview_path), 3600);
        const m: Record<string, string> = {};
        withPv.forEach((d, i) => { if (su?.[i]?.signedUrl) m[d.id] = su[i].signedUrl; });
        setDUrl(m);
      }
    }
  }
  useEffect(() => { load().catch(() => setRows([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openRow(r: Row) {
    if (open === r.id) { setOpen(null); return; }
    setOpen(r.id);
    const f: Record<string, DetailsInput> = { ...form };
    for (const g of r.groups) for (const im of g.imprints) if (needsDetails(im) && !f[im.id]) f[im.id] = formOf(im);
    setForm(f);
  }
  useEffect(() => {
    if (!rows || !open0) return;
    const r = rows.find((x) => x.id === open0);
    if (r) { setOpen(null); openRow(r); setTimeout(() => document.getElementById("pd-" + r.id)?.scrollIntoView({ block: "start", behavior: "smooth" }), 50); }
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (id: string, p: Partial<DetailsInput>) => setForm((f) => ({ ...f, [id]: { ...f[id], ...p } }));
  async function save(r: Row) {
    const prints = printSets(r).flatMap((x) => { const f = form[x.lead.id] || formOf(x.lead); return x.ims.map((im) => ({ ...f, id: im.id })); });
    setBusy(r.id); setMsg(null);
    const res = await confirmDetails(r.id, prints);
    setBusy("");
    if (!res.ok) { setMsg({ id: r.id, text: res.error, bad: true }); return; }
    setMsg({ id: r.id, text: `#${r.number} confirmed. It's on the order and the customer's design for next time. To fix a typo, open it here and click Edit.` });
    setOpen(null);
    await load();
    // it moves to Recently confirmed, where it can be opened again to correct (Oct 23, Nick)
    if (res.left === 0) setTab("done");
  }
  async function saveEdit(r: Row) {
    const prints = printSets(r, isDone).flatMap((x) => { const f = form[x.lead.id] || guessOf(x.lead); return x.ims.map((im) => ({ ...f, id: im.id })); });
    setBusy(r.id); setMsg(null);
    const res = await confirmDetails(r.id, prints, true);
    setBusy("");
    if (!res.ok) { setMsg({ id: r.id, text: res.error, bad: true }); return; }
    setMsg({ id: r.id, text: `#${r.number} corrected. The order and the customer's design have the new details.` });
    setEditing(null);
    await load();
  }

  /** each print's fields: our guess greyed (waiting), or what's confirmed filled in (editing) */
  const formFor = (prints: Set1[]) => prints.map(({ lead: im, gs, ims }) => {
      const f = form[im.id] || formOf(im);
      // a visual-only print: nothing guessed is shown (only what the old job says: its color count), so the
      // press sets what really ran (Oct 20, Nick)
      const vis = !!im.visualOnly, gs0 = vis ? { size: "", inks: "", drop: "" } : { size: im.size, inks: im.inks, drop: im.drop };
      const garment = [...new Set(gs.flatMap((g) => g.lines.map((l) => [l.style, l.color].filter(Boolean).join(" "))))].join(", ");
      return (
        <div key={im.id} className="pdd-print">
          <div className="pdd-art">{im.design_id && dUrl[im.design_id] ? <img src={dUrl[im.design_id]} alt="" /> : <span className="faint">No art</span>}</div>
          <div className="pdd-fields">
            <div className="pdd-ph"><b>{im.location || "Print"}</b><span className="faint">{METHODS[im.method] || im.method}{garment ? ` on ${garment}` : ""}{ims.length > 1 ? ` · the same print on ${gs.length} garment groups, one set of screens` : ""}</span></div>
            {vis && <div className="pdd-why faint">Visual mockup only: set what ran on press. The old job says {im.colors} color{im.colors === 1 ? "" : "s"}.</div>}
            {!vis && im.confirm?.why && <div className="pdd-why faint">Our guess: {im.confirm.why}.{(im.size || im.inks || im.drop) && !(f.size || f.inks || f.drop) && <> <button type="button" className="linkbtn" onClick={() => set(im.id, { ...guessOf(im), screensOnFile: f.screensOnFile, notes: f.notes })}>Copy in our guesses</button></>}</div>}
            <div className="pdd-grid">
              <label className="field"><span>Print size</span><input type="text" value={f.size} placeholder={gs0.size ? `Guess: ${gs0.size}` : 'e.g. 11" wide'} onChange={(e) => set(im.id, { size: e.target.value })} /></label>
              <label className="field pdd-wide"><span>Inks (by name)</span><input type="text" value={f.inks} placeholder={gs0.inks ? `Guess: ${gs0.inks}` : "e.g. White, PMS 186 C"} onChange={(e) => set(im.id, { inks: e.target.value })} /></label>
              <label className="field"><span>Colors</span><input type="number" min={1} max={20} value={f.colors} onChange={(e) => set(im.id, { colors: +e.target.value || 1 })} /></label>
              <label className="field"><span>Underbase</span><select value={f.underbase} onChange={(e) => set(im.id, { underbase: e.target.value as DetailsInput["underbase"] })}><option value="">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label>
              <label className="field"><span>Drop (in.)</span><input type="text" value={f.drop} placeholder={gs0.drop ? `Guess: ${gs0.drop}` : "Standard"} onChange={(e) => set(im.id, { drop: e.target.value })} /></label>
              <label className="check pdd-chk"><input type="checkbox" checked={f.screensOnFile} onChange={(e) => set(im.id, { screensOnFile: e.target.checked })} />Screens on file</label>
              <label className="field pdd-full"><span>Press notes (optional)</span><input type="text" value={f.notes} placeholder="Mesh, flash, ink order, anything for next time" onChange={(e) => set(im.id, { notes: e.target.value })} /></label>
            </div>
          </div>
        </div>
      );
    });
  const waiting = rows || [];
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Production</div><h1>Reorder Details</h1>
          <p className="muted pdd-intro">Reorders of old Printavo jobs. The print size and inks are our best guess from the old film or mockup. Check them against what we printed before, fix anything that&apos;s off, and confirm. Leave a field blank if nobody knows.</p></div>
      </div>
      <div className="aa-sub pd-tabs pdd-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "waiting"} className={tab === "waiting" ? "on" : ""} onClick={() => setTab("waiting")}>Waiting on details<span className="aa-n">{waiting.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "done"} className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>Recently confirmed<span className="aa-n">{done.length}</span></button>
      </div>
      {msg && !msg.bad && <div className="banner pdd-ok" role="status">{msg.text}</div>}
      {open0 && rows && !rows.some((r) => r.id === open0) && <div className="banner pdd-ok" role="status">This order&apos;s print specs are already confirmed (or it has nothing waiting). <Link href={`/shop/orders/${open0}`}>Open the order</Link></div>}

      {tab === "waiting" && (rows === null ? <div className="empty">Loading…</div> : !waiting.length ? <div className="empty">Nothing waiting. Reorders of old Printavo jobs show up here until their print details are confirmed.</div> : (
        <div className="pdd-list">
          {waiting.map((r) => {
            const prints = printSets(r);
            const isOpen = open === r.id;
            return (
              <section key={r.id} id={"pd-" + r.id} className={"panel pdd-card" + (isOpen ? " open" : "")}>
                <button type="button" className="pdd-head" aria-expanded={isOpen} onClick={() => openRow(r)}>
                  <span className="pdd-num">#{r.number}</span>
                  <span className="pdd-main"><b>{custs[r.customer_id || ""] || "—"}</b><span className="faint">{r.nickname || "Untitled Job"}</span></span>
                  <span className="pdd-tag">{DETAILS_LABEL}</span>
                  <span className="pdd-side faint">{prints.length} print{prints.length === 1 ? "" : "s"} · due {day(r.due_date)}</span>
                </button>
                {prodView && <div className="pdd-pv"><Link href={`/shop/orders/${r.id}/production`} className="btn primary sm">Open production mockup</Link><span className="faint">confirm the real size, placement, inks and screens, and see what we did last time</span></div>}
                {isOpen && (
                  <div className="pdd-body">
                    {(art[r.id] || []).length > 0 && <div className="pdd-refs"><span className="faint">From the old job:</span>{art[r.id].map((a, i) => <a key={i} href={a.url} target="_blank" rel="noreferrer">{a.name}</a>)}</div>}
                    {formFor(prints)}
                    {msg?.bad && msg.id === r.id && <div className="err">{msg.text}</div>}
                    <div className="pdd-foot">
                      <Link href={`/shop/orders/${r.id}?view=admin`} className="linkbtn">Open the order</Link>
                      {/* the whole job in one view: mockup, film, press setup, photos (Oct 21, Nick) */}
                      {prodView && <Link href={`/shop/orders/${r.id}/production`} className="btn">Open production mockup</Link>}
                      <span className="spacer" />
                      {canConfirm ? <button type="button" className="btn primary" disabled={busy === r.id} onClick={() => save(r)}>{busy === r.id ? "Saving…" : `Confirm details for #${r.number}`}</button>
                        : <span className="faint">Production confirms these.</span>}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ))}

      {tab === "done" && msg && msg.bad && <div className="err">{msg.text}</div>}
      {tab === "done" && editing && (() => {
        const r = editing, sets = printSets(r, isDone);
        return (
          <section className="panel pdd-card open">
            <div className="pdd-head"><span className="pdd-num">#{r.number}</span><span className="pdd-main"><b>{custs[r.customer_id || ""] || "Correct the confirmed details"}</b><span className="faint">{r.nickname || "Untitled Job"}</span></span><span className="pdd-tag">Editing</span></div>
            <div className="pdd-body">
              {sets.length ? formFor(sets) : <p className="faint">Nothing confirmed on this order yet.</p>}
              <div className="pdd-foot">
                <Link href={`/shop/orders/${r.id}?view=admin`} className="linkbtn">Open the order</Link>
                <span className="spacer" />
                <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                {sets.length > 0 && <button type="button" className="btn primary" disabled={busy === r.id} onClick={() => void saveEdit(r)}>{busy === r.id ? "Saving…" : `Save the corrections to #${r.number}`}</button>}
              </div>
            </div>
          </section>
        );
      })()}
      {tab === "done" && (!done.length ? <div className="empty">Nothing confirmed yet.</div> : (
        <section className="panel"><table className="rv-tbl pdd-done">
          <thead><tr><th>Order</th><th>What was confirmed</th><th>By</th><th className="r">When</th><th /></tr></thead>
          <tbody>{done.map((e) => (
            <tr key={e.id}><td><Link href={`/shop/orders/${e.order_id}`} className="db-num">#{e.number || "—"}</Link><div className="faint">{e.nickname}</div></td><td className="pdd-d">{e.detail.replace(/^Production details (confirmed|corrected): /, (m0, w) => (w === "corrected" ? "Corrected: " : ""))}</td><td>{e.actor}</td><td className="r faint">{new Date(e.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</td>
              <td className="r">{canConfirm && <button type="button" className="btn sm" onClick={() => void openEdit(e.order_id)}>{editing?.id === e.order_id ? "Close" : "Edit"}</button>}</td></tr>
          ))}</tbody>
        </table></section>
      ))}
    </>
  );
}
