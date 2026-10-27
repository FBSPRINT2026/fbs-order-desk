"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { makePreview } from "@/lib/artPrep";
import { ALL_LOCATIONS, METHODS, SIZES, newGLine, newImprint, sizeLabel, type GLine, type Group, type Method } from "@/lib/pricing";
import { SUPPLIERS } from "@/lib/goods";
import CarryNotes from "@/components/CarryNotes";
import { isPicture, ROLE_LABEL, type EODraft, type EOFile, type EOPart, type PastJob } from "@/lib/emailOrderShared";
import { createClient } from "@/lib/supabase/client";
import { stampOrderMockups } from "@/lib/mockupStamp";
import { attachFilms, pullReorderArt } from "@/lib/reorderArt";
import ColorCheck, { applyColors, checkColors, type ColorRow } from "@/components/ColorCheck";
import { aiLookUp, forgetOrderMemory, orderMemories, rememberOrderNote } from "@/app/shop/ai-actions";
import { NotMovedBanner, needsMove } from "@/components/CustomerMove";
import dynamic from "next/dynamic";
import type { WhenDates } from "@/components/MachineSchedule";

// the Production calendar, hidden: answers "when can we print it?" from the live schedule for the order being made
const WhenCalc = dynamic(() => import("@/components/MachineSchedule"), { ssr: false });

/**
 * Inbox → Create order: the AI's suggested order from the email and its attachments, for staff to check and fix
 * before it becomes an order. New orders are built from the email (garments and sizes, prints with the art, the
 * customer's mockup, their goods); reorders copy a past job with the new quantities, and the job can be swapped.
 */
type Fin = { id: string; name: string; price: number };
type Loaded = { fees?: { screen: number | null; remake: number | null }; draft: EODraft | null; files: EOFile[]; past: PastJob[]; created: string | null; finishing: Fin[]; ai: boolean; aiReason: string; customer: { id: string; company: string | null; name: string | null; price_type: string; moved_at?: string | null; is_test?: boolean } | null };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const qtyOf = (l: GLine) => Object.values(l.sizes || {}).reduce((a, v) => a + (+(v || 0) || 0), 0);
const uidish = () => Math.random().toString(36).slice(2, 10);

export default function EmailOrderPanel({ activityId, onClose, onCreated, start, part }: { activityId: string; onClose: () => void; onCreated: (id: string, number: number, opened?: boolean) => void;
  /** opened from the Inbox chat: what to tell the AI, and the past job it's a reorder of */ start?: { told?: string; job?: string };
  /** one of several orders in the email (its design, files and past job): read and saved on its own */ part?: EOPart }) {
  /** the AI's order is shown as a summary to approve; Edit details opens the full form */
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState("");
  const [when, setWhen] = useState<WhenDates | null | undefined>(undefined);
  const [data, setData] = useState<Loaded | null>(null);
  const [d, setD] = useState<EODraft | null>(null);
  const [busy, setBusy] = useState<"" | "read" | "create">(""), [err, setErr] = useState("");
  const [status, setStatus] = useState<"quote" | "approved">("quote");

  // what staff tell the AI before it reads the email ("it's a reorder of 31174, the art is on the old job")
  const [told0, setTold] = useState(start?.told || ""), [tellOpen, setTellOpen] = useState(false);
  const told = told0;
  // what the AI remembers about this customer's orders, and "remember this" on what staff tell it (Oct 20, Nick)
  const [mem, setMem] = useState<{ customer: string; memories: { id: string; text: string; at: string }[] } | null>(null);
  const [remember, setRemember] = useState(false);
  const [feeAsked, setFeeAsked] = useState(false);
  const loadMem = () => { void orderMemories(activityId).then((r) => { if (r.ok) setMem({ customer: r.customer, memories: r.memories }); }).catch(() => null); };
  useEffect(loadMem, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = () => { if (remember && told.trim()) void rememberOrderNote(activityId, told).then((r) => { if (r.ok) loadMem(); }); setRemember(false); };
  const rememberBox = mem?.customer ? <label className="eo-remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember this for {mem.customer}&apos;s next emails</label> : null;
  // a reorder: "I found this job, place a reorder?" → "Anything I should know?"
  const [askStep, setAskStep] = useState(false), [lookStep, setLookStep] = useState("");
  async function read(o: { job?: string | null; reorderOk?: boolean; told?: string } = {}) {
    setBusy("read"); setErr("");
    const told = o.told ?? told0;
    // what the note points to that has to be looked up online (team PMS colors…), shown while the email is read
    let lookedUp: EODraft["lookedUp"] | null = null;
    if (told.trim()) {
      setLookStep("Checking your note for anything to look up online…");
      const lu = await aiLookUp(told, { activityId }).catch(() => null);
      lookedUp = lu?.ok ? lu.lookedUp : null;
      setLookStep(lookedUp ? `Looked up: ${lookedUp.text}` : "");
    }
    const r = await fetch("/api/inbox/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, told, job: o.job || null, reorderOk: !!o.reorderOk, lookedUp, ...(part ? { part: part.key } : {}) }) }).catch(() => null);
    setLookStep("");
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy("");
    if (!r?.ok || !j.draft) return setErr(j.error || "The AI couldn't read this email. Try again.");
    setData((x) => (x ? { ...x, draft: j.draft, files: j.files, past: j.past } : x));
    setD(j.draft);
  }
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/inbox/order?activity=${encodeURIComponent(activityId)}${part ? `&part=${encodeURIComponent(part.key)}` : ""}`).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      if (!live) return;
      if (!r?.ok || !j) return setErr(j?.error || "Couldn't load the email.");
      setData(j);
      // opened from the Inbox chat with what to know: read it with that
      if (start?.told || start?.job) { if (j.ai) void read({ told: start.told || "", job: start.job || null, reorderOk: !!start.job }); else if (j.draft) setD(j.draft); }
      else if (j.draft) { setD(j.draft); if (j.draft.told) setTold(j.draft.told); }
      else if (j.ai) void read();
    })();
    return () => { live = false; };
  }, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const files = d?.files || data?.files || [];
  const pics = files.filter((f) => isPicture(f) && f.role !== "signature");
  const urlOf = (p: string) => files.find((f) => f.path === p)?.url || "";
  const whenKey = useMemo(() => JSON.stringify((d?.groups || []).map((g) => [g.lines.map((l) => [l.style, l.color, l.sizes]), g.imprints.map((im) => [im.method, im.location, im.colors, im.inks])])), [d]);
  useEffect(() => { setWhen(undefined); }, [whenKey]);
  const total = useMemo(() => (d?.groups || []).reduce((a, g) => a + g.lines.reduce((b, l) => b + qtyOf(l), 0), 0), [d]);
  const patch = (fn: (x: EODraft) => void) => setD((x) => { if (!x) return x; const y = clone(x); fn(y); return y; });
  const patchG = (gi: number, fn: (g: Group) => void) => patch((x) => fn(x.groups[gi]));

  function pickJob(ref: string) {
    const j = data?.past.find((p) => p.ref === ref);
    patch((x) => {
      if (!j) { x.kind = "new"; x.reorderOf = null; return; }
      x.kind = "reorder"; x.reorderOf = j.ref; x.groups = clone(j.groups).map((g) => ({ ...g, id: uidish() }));
      if (!x.nickname) x.nickname = j.label.replace(/^#\d+\s*/, "").replace(/\s*\(Printavo\)$/, "");
    });
  }

  /**
   * Create order: the order (garments, sizes, prints with the art as designs, the customer's documents in Production
   * files), then the customer's mockup stamped "CUSTOMER SUPPLIED MOCKUP" into Production files, then our own mockup
   * built in the Mockup Creator (auto), which opens the order when it's saved.
   */
  const [colorAsk, setColorAsk] = useState<{ rows: ColorRow[]; done: (r: ColorRow[] | null) => void } | null>(null);
  async function create(mode: "new" | "edit" = "new") {
    if (!d) return;
    // Create order: a tab opened now (while it's still a click) so the browser doesn't block it later.
    // Edit details: the same order, opened here in the full order screen, with "Save & back to email".
    const w = mode === "new" ? window.open("", "_blank") : null;
    setBusy("create"); setErr("");
    let dd = d, films: { id: string; name: string }[] = [];
    // the shirt colors checked against the style's real colors first ("Forest Green" → "Heather Forest Green"), so
    // the mockup shows the real shirt; anything not an exact match is asked
    setStep("Checking the shirt colors…");
    const cc = await checkColors(dd.groups).catch(() => ({ rows: [] as ColorRow[], ask: [] as ColorRow[] }));
    let rows = cc.rows;
    if (cc.ask.length) {
      const picked = await new Promise<ColorRow[] | null>((done) => setColorAsk({ rows: cc.rows, done }));
      setColorAsk(null);
      if (!picked) { setBusy(""); setStep(""); w?.close(); return; }
      rows = picked;
    }
    if (rows.length) { dd = { ...dd, groups: applyColors(dd.groups, rows) }; setD(dd); }
    if (d.kind === "reorder" && d.reorderOf && data?.customer?.id && d.groups.some((g) => g.imprints.some((im) => !im.design_id))) {
      const job = data.past.find((p) => p.ref === d.reorderOf);
      // from dd (the colors just checked), not d
      try { const r = await pullReorderArt(dd, { customerId: data.customer.id, jobLabel: job?.label, jobDate: job?.date, onStep: setStep }); dd = r.draft; films = r.films; setD(dd); } catch (e) { setErr("Couldn't pull the art from the old mockup (" + (e instanceof Error ? e.message : String(e)) + "). The order is made without it."); }
    }
    setStep("Creating the order…");
    const r = await fetch("/api/inbox/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, draft: dd, status }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!r?.ok || !j.id) { setBusy(""); setStep(""); w?.close(); return setErr(j.error || "Couldn't create the order."); }
    let url = `/shop/orders/${j.id}`;
    await attachFilms(j.id, films);
    try {
      const sb = createClient();
      const { data: o } = await sb.from("orders").select("groups").eq("id", j.id).maybeSingle();
      const gs = ((o?.groups || []) as Group[]);
      if (gs.some((g) => (g.customerMockups || []).length)) { setStep("Saving the customer's mockup to Production files…"); await Promise.race([stampOrderMockups(sb, j.id, gs), new Promise((res) => setTimeout(res, 25_000))]); }
      // our mockup only when a group with art has none yet: a reorder of a portal order brings its mockups along
      const first = gs.find((g) => g.imprints.some((x) => x.design_id) && !(g.mockupThumbs || []).some(Boolean));
      if (first) url = `/shop/artwork/mockup?order=${j.id}&group=${first.id}&auto=1`;
    } catch { /* the order page stamps them when it opens */ }
    url = `${url}${url.includes("?") ? "&" : "?"}email=${activityId}&chat=${j.id}`;
    if (mode === "edit") { setStep("Opening the order…"); location.assign(url); return; }
    setBusy(""); setStep("");
    if (w) w.location.href = url; else window.open(url, "_blank");
    onCreated(j.id, j.number, true);
  }

  if (!data) return <section className="eo"><div className="eo-h"><b>Create order</b><span className="spacer" /><button type="button" className="btn sm ghost" onClick={onClose}>Close</button></div>{err ? <div className="err">{err}</div> : <p className="faint">Loading…</p>}</section>;
  if (data.created) return (
    <section className="eo"><div className="eo-h"><b>Create order</b><span className="spacer" /><button type="button" className="btn sm ghost" onClick={onClose}>Close</button></div>
      <p>An order was already made from this email. <a href={`/shop/orders/${data.created}`} target="_blank" rel="noreferrer">Open it</a>, or <button type="button" className="eo-link" onClick={() => setData({ ...data, created: null })}>make another</button>.</p>
    </section>
  );
  const job = d?.reorderOf ? data.past.find((p) => p.ref === d.reorderOf) : null;
  // moving off Printavo: a customer's first order here waits for their move checklist
  const mustMove = needsMove(data.customer as unknown as Record<string, unknown>);

  return (
    <section className="eo" aria-label="Suggested order">
      <div className="eo-h">
        <b>{d ? (d.kind === "reorder" ? "Reorder" : "New order") : "Create order"}</b>
        {d && <span className={"eo-conf " + d.confidence}>{d.confidence === "high" ? "AI is confident" : d.confidence === "medium" ? "Check the details" : "AI wasn't sure: check everything"}</span>}
        <span className="spacer" />
        {data.ai && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => read({ job: d?.reorderOf, reorderOk: d?.reorderOk })}>{busy === "read" ? "Reading…" : d ? "Read it again" : "Read the email"}</button>}
        <button type="button" className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
      {!data.ai && !d && <div className="warn">{data.aiReason || "AI is off."} You can still enter the order by hand from the order page.</div>}
      {part && (() => {
        // one of several orders in the email: which, from which past order, what's new, and do the pieces add up
        const pcs = d ? d.groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + qtyOf(l), 0), 0) : 0;
        const off = !!(d && part.pieces && pcs !== part.pieces);
        return (
          <div className="eo-part">
            <b>{part.label}</b>
            <span>{part.kind === "reorder" ? (part.jobLabel ? `Reorder of ${part.jobLabel}` : "Reorder") : "New order"}{" · "}{part.changes ? <>New: {part.changes}</> : "Exact reprint"}</span>
            <span className="faint">{part.names?.length ? `From ${part.names.join(", ")}` : ""}</span>
            {part.pieces ? <span className={off ? "eo-part-off" : "eo-part-ok"}>{d ? (off ? `This order has ${pcs.toLocaleString("en-US")} pcs; the sheets say ${part.pieces.toLocaleString("en-US")}: check the sizes` : `${pcs.toLocaleString("en-US")} pcs, matches the sheets`) : `The sheets say ${part.pieces.toLocaleString("en-US")} pcs`}</span> : null}
          </div>
        );
      })()}
      {busy === "read" && <p className="eo-reading">Reading the whole conversation{(data as { emails?: number } | null)?.emails && (data as { emails?: number }).emails! > 1 ? ` (${(data as { emails?: number }).emails} emails)` : ""}{files.length ? ` and ${files.length} attachment${files.length === 1 ? "" : "s"}` : ""}: garments, the latest sizes, art, mockups, and whether it's a reorder. This takes 15 to 40 seconds.</p>}
      {err && <div className="err">{err}</div>}
      {busy === "read" && lookStep && <p className="eo-reading">{lookStep}</p>}
      {data.ai && busy !== "read" && d && (d.kind === "reorder" || d.looksReorder) && !d.reorderOk && !askStep && (
        // 1. "I found this job: place a reorder?"
        <div className="eo-tell ask">
          {job ? (
            <>
              <label>I found a past job that matches: <b>{job.label}</b>{job.date ? `, ${job.date}` : ""}, {job.qty} pcs
                {job.groups.flatMap((g) => g.lines).slice(0, 3).map((l, i) => <span key={i} className="eo-tell-line">{[l.brand, l.style, l.color].filter(Boolean).join(" ")}</span>)}
                <br />Would you like me to place a reorder of it?</label>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn sm primary" onClick={() => setAskStep(true)}>Yes, reorder it</button>
                <select aria-label="A different job" value="" onChange={(e) => { if (e.target.value) { pickJob(e.target.value); setAskStep(true); } }}>
                  <option value="">A different job…</option>
                  {data.past.filter((p) => p.ref !== job.ref).map((p) => <option key={p.ref} value={p.ref}>{p.label}, {p.date}, {p.qty} pcs</option>)}
                </select>
                <button type="button" className="btn sm ghost" onClick={() => { pickJob(""); patch((x) => { x.looksReorder = false; }); }}>No, it&apos;s a new order</button>
              </div>
            </>
          ) : (
            <>
              <label>This looks like a reorder, but I couldn&apos;t tell which job. Pick it, or tell me the job number below.</label>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <select aria-label="Past job" value="" onChange={(e) => { if (e.target.value) { pickJob(e.target.value); setAskStep(true); } }}>
                  <option value="">Pick the job…</option>
                  {data.past.map((p) => <option key={p.ref} value={p.ref}>{p.label}, {p.date}, {p.qty} pcs</option>)}
                </select>
                <button type="button" className="btn sm ghost" onClick={() => patch((x) => { x.looksReorder = false; })}>It&apos;s a new order</button>
              </div>
              <textarea rows={2} value={told} onChange={(e) => setTold(e.target.value)} placeholder='e.g. "Reorder of 31174"' aria-label="The job number" />
              <div><button type="button" className="btn sm primary" disabled={!told.trim()} onClick={() => void read()}>Find it</button></div>
            </>
          )}
        </div>
      )}
      {data.ai && busy !== "read" && d && askStep && !d.reorderOk && (
        // 2. "Anything I should know?"
        <div className="eo-tell ask">
          <label htmlFor={`tell-${activityId}`}>Reorder of <b>{job?.label || "the past job"}</b>. Anything I should know?</label>
          <div className="eo-chips">
            {["Exactly the same as last time", "The art and mockup are on the old job", "The customer wants changes: ", "We used the ___ PMS colors, look them up"].map((c) => (
              <button key={c} type="button" className="eo-chip" onClick={() => setTold((t) => (t.trim() ? `${t.trim()}. ${c}` : c))}>{c.replace(/: $/, "…")}</button>
            ))}
          </div>
          <textarea id={`tell-${activityId}`} rows={3} value={told} onChange={(e) => setTold(e.target.value)}
            placeholder='e.g. "Same as last time but add 10 more 12M" · "We used the LA Lakers PMS colors, look them up"' />
          {rememberBox}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="btn sm primary" disabled={!told.trim()} onClick={() => { keep(); setAskStep(false); void read({ job: d.reorderOf, reorderOk: true }); }}>Build the reorder with this</button>
            <button type="button" className="btn sm ghost" onClick={() => { setAskStep(false); patch((x) => { x.reorderOk = true; }); }}>Nothing else, build it</button>
          </div>
        </div>
      )}
      {d?.lookedUp && (
        <div className="eo-found">
          <b>Looked up online:</b> {d.lookedUp.text}
          {d.lookedUp.sources.length > 0 && <span className="faint"> ({d.lookedUp.sources.map((x, i) => <a key={i} href={x.url} target="_blank" rel="noreferrer">{i ? ", " : ""}{x.title || "source"}</a>)})</span>}
        </div>
      )}
      {/* what doesn't add up, asked before the order is made (Oct 22, Nick): the same questions Create order stops on */}
      {d?.check && d.check.length > 0 && (
        <div className="eo-q eo-check">
          <div className="eo-sub">Check with you first</div>
          <ul>{d.check.map((c, i) => <li key={i}>{c.q}{c.guess && <span className="faint"> My guess: {c.guess}</span>} <button type="button" className="eo-link" onClick={() => { setTold((t) => `${t.trim() ? `${t.trim()}\n` : ""}${c.q} → `); setTellOpen(true); }}>Answer</button></li>)}</ul>
          <small className="faint">Answer in the box below and read it again, or leave them and it goes with its guesses.</small>
        </div>
      )}
      {data.ai && busy !== "read" && !(d && (d.kind === "reorder" || d.looksReorder) && !d.reorderOk) && (() => {
        // any other email: tell the AI something before it reads it (again)
        if (!tellOpen && !d?.told) return <button type="button" className="eo-link eo-tell-link" onClick={() => setTellOpen(true)}>✦ Tell the AI something about this email</button>;
        return (
          <div className="eo-tell">
            <label htmlFor={`tell2-${activityId}`}>{d?.told ? "What you told the AI" : "Anything the AI should know first?"}</label>
            <textarea id={`tell2-${activityId}`} rows={2} value={told} onChange={(e) => setTold(e.target.value)}
              placeholder='e.g. "Reorder of 31174" · "Same as last time but navy" · "We used the LA Lakers PMS colors, look them up"' />
            {rememberBox}
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm primary" disabled={!told.trim()} onClick={() => { keep(); setTellOpen(false); void read({ job: d?.reorderOf, reorderOk: d?.reorderOk }); }}>{d ? "Read it again with this" : "Read the email with this"}</button>
              {!d?.told && <button type="button" className="btn sm ghost" onClick={() => setTellOpen(false)}>Cancel</button>}
            </div>
          </div>
        );
      })()}
      {d && d.kind === "reorder" && data.customer?.price_type === "wholesale" && data.fees?.remake != null && data.fees.screen != null && data.fees.remake < data.fees.screen && (() => {
        // a wholesale reorder still priced as new screens: offer the reprint fee; once taken it stays on this design's
        // prints, so later reorders copy it (Oct 20, Nick: "$20 is the new screen fee… change this to a reprint screen
        // fee at $15? And then moving forward it would stay that way on any reorders")
        const ims = d.groups.flatMap((g) => g.imprints.filter((im) => im.method === "screen" && !(im.remake ?? g.remake)));
        if (!ims.length || feeAsked) return null;
        const n = [...new Map(ims.map((im) => [`${im.design_id || ""}|${im.location}|${im.colors}`, im])).values()].reduce((a, im) => a + Math.max(1, +im.colors || 1), 0);
        return (
          <div className="eo-fee">
            <span>These prints are priced as <b>new screens</b> ({n} screen{n === 1 ? "" : "s"} at ${data.fees!.screen}). It&apos;s a reorder: charge the <b>reprint fee, ${data.fees!.remake} a screen</b>? It stays that way on this design&apos;s reorders from now on.</span>
            <button type="button" className="btn sm primary" onClick={() => { patch((x) => { for (const g of x.groups) for (const im of g.imprints) if (im.method === "screen") im.remake = true; }); setFeeAsked(true); }}>Yes, reprint fee ${data.fees!.remake}</button>
            <button type="button" className="btn sm ghost" onClick={() => setFeeAsked(true)}>No, keep ${data.fees!.screen}</button>
          </div>
        );
      })()}
      {mem && mem.memories.length > 0 && (
        <details className="eo-mem">
          <summary>✦ The AI remembers {mem.memories.length} thing{mem.memories.length === 1 ? "" : "s"} about {mem.customer}&apos;s orders</summary>
          <ul>{mem.memories.map((m) => <li key={m.id}><span>{m.text}</span><span className="faint">{m.at.slice(0, 10)}</span><button type="button" className="eo-link" onClick={() => void forgetOrderMemory(m.id).then(loadMem)}>Forget</button></li>)}</ul>
        </details>
      )}
      {d && total > 0 && <div hidden><WhenCalc key={whenKey} when={{ groups: d.groups, onDates: setWhen }} /></div>}
      {d && mustMove && data.customer && <NotMovedBanner customerId={data.customer.id} name={data.customer.company || data.customer.name || ""} what="an order for them"
        onMoved={() => setData((x) => (x && x.customer ? { ...x, customer: { ...x.customer, moved_at: new Date().toISOString() } } : x))} />}
      {d && !editing && <WhenLine when={when} due={d.due_date} onUse={(day) => patch((x) => { x.due_date = day; })} />}
      {d && !editing && <Review d={d} files={files} urlOf={urlOf} custName={data.customer ? data.customer.company || data.customer.name || "" : ""} job={d.reorderOf ? data.past.find((p) => p.ref === d.reorderOf)?.label || "" : ""} finishing={data.finishing} />}
      {colorAsk && <ColorCheck rows={colorAsk.rows} onDone={(r) => colorAsk.done(r)} onCancel={() => colorAsk.done(null)} />}
      {d && !editing && <>
        <div className="eo-foot">
          <b>{total} pcs</b>
          <span className="spacer" />
          {step && <span className="faint">{step}</span>}
          <label>Save as<select value={status} onChange={(e) => setStatus(e.target.value as "quote" | "approved")}><option value="quote">Quote (price it, send for approval)</option><option value="approved">Approved order</option></select></label>
          <button type="button" className="btn" disabled={!!busy || !total || !data.customer || mustMove} title="Make the order and open it in the full order screen to change anything; Save & back to email brings you back here" onClick={() => create("edit")}>Edit details</button>
          <button type="button" className="btn primary" disabled={!!busy || !total || !data.customer || mustMove} onClick={() => create()}>{busy === "create" ? "Creating…" : "Create order"}</button>
        </div>
        <div className="eo-quick"><button type="button" className="eo-link" disabled={!!busy} onClick={() => setEditing(true)}>Fix what the AI read before creating (files, sizes, prints)</button></div>
        {!data.customer && <div className="warn">Make the sender a customer first (the yellow box above), then create the order.</div>}
      </>}
      {d && editing && <>
        {d.summary && <p className="eo-sum">✦ {d.summary}</p>}

        {files.length > 0 && <div className="eo-files">
          {files.map((f, i) => (
            <div key={f.path} className="eo-file">
              {isPicture(f) && f.url ? <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt="" /></a> : /\.(pdf|ai)$/i.test(f.name) && f.url ? <a href={f.url} target="_blank" rel="noreferrer"><Thumb url={f.url} name={f.name} /></a> : <a className="eo-doc" href={f.url || undefined} target="_blank" rel="noreferrer">{(f.name.split(".").pop() || "file").toUpperCase()}</a>}
              <span className="eo-fname" title={f.name}>{f.name}</span>
              <select aria-label={`What ${f.name} is`} value={f.role} onChange={(e) => patch((x) => { x.files[i].role = e.target.value as EOFile["role"]; })}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {f.what && <small>{f.what}</small>}
            </div>
          ))}
        </div>}

        <div className="eo-grid">
          <label>Order type
            <select value={d.reorderOf || ""} onChange={(e) => pickJob(e.target.value)}>
              <option value="">New order (from scratch)</option>
              {data.past.map((p) => <option key={p.ref} value={p.ref}>Reorder of {p.label} · {p.date} · {p.qty} pcs</option>)}
            </select>
          </label>
          <label>Job name<input value={d.nickname} onChange={(e) => patch((x) => { x.nickname = e.target.value; })} /></label>
          <label>In-hands date<input type="date" value={d.due_date || ""} onChange={(e) => patch((x) => { x.due_date = e.target.value || null; })} /></label>
          <label>Delivery<select value={d.delivery} onChange={(e) => patch((x) => { x.delivery = e.target.value as EODraft["delivery"]; })}><option value="pickup">Pickup</option><option value="ship">Ship</option><option value="deliver">We deliver</option></select></label>
          <label>PO #<input value={d.po_number} onChange={(e) => patch((x) => { x.po_number = e.target.value; })} /></label>
        </div>
        {job?.note && <p className="faint eo-note">{job.note}</p>}
        <CarryNotes job={job} carry={d.carry} onChange={(c) => patch((x) => { x.carry = c; })} />

        <div className="eo-goods">
          <label className="eo-check"><input type="checkbox" checked={d.goods.supplied} onChange={(e) => patch((x) => { x.goods.supplied = e.target.checked; })} /> The customer sends the garments</label>
          {d.goods.supplied && <>
            <label>From<select value={SUPPLIERS[d.goods.supplier] ? d.goods.supplier : d.goods.supplier ? "other" : ""} onChange={(e) => patch((x) => { x.goods.supplier = e.target.value === "other" ? x.goods.supplier && !SUPPLIERS[x.goods.supplier] ? x.goods.supplier : "Other" : e.target.value; })}>
              <option value="">Not known yet</option>{Object.entries(SUPPLIERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="other">Somewhere else</option>
            </select></label>
            {d.goods.supplier && !SUPPLIERS[d.goods.supplier] && <label>Supplier<input value={d.goods.supplier} onChange={(e) => patch((x) => { x.goods.supplier = e.target.value; })} /></label>}
            <label className="grow">Expected<input value={d.goods.expected} placeholder="e.g. End of this week (Fri Oct 9)" onChange={(e) => patch((x) => { x.goods.expected = e.target.value; })} /></label>
          </>}
        </div>

        {d.groups.map((g, gi) => (
          <div key={g.id} className="eo-group">
            <div className="eo-gh"><input className="eo-gname" aria-label="Group name" placeholder={`Group ${gi + 1}`} value={g.name || ""} onChange={(e) => patchG(gi, (x) => { x.name = e.target.value; })} />
              {d.groups.length > 1 && <button type="button" className="btn sm ghost" onClick={() => patch((x) => { x.groups.splice(gi, 1); })}>Remove group</button>}</div>
            <div className="eo-lines">
              {g.lines.map((l, li) => {
                const used = SIZES.filter((z) => l.sizes?.[z] !== undefined);
                return (
                  <div key={l.id} className="eo-line">
                    <div className="eo-lf">
                      <input aria-label="Style" placeholder="Style #" value={l.style} onChange={(e) => patchG(gi, (x) => { x.lines[li].style = e.target.value; })} />
                      <input aria-label="Brand" placeholder="Brand" value={l.brand} onChange={(e) => patchG(gi, (x) => { x.lines[li].brand = e.target.value; })} />
                      <input aria-label="Color" placeholder="Color" value={l.color} onChange={(e) => patchG(gi, (x) => { x.lines[li].color = e.target.value; })} />
                      <input aria-label="Description" className="grow" placeholder="Description" value={l.garment} onChange={(e) => patchG(gi, (x) => { x.lines[li].garment = e.target.value; })} />
                      <button type="button" className="eo-x" aria-label="Remove garment" onClick={() => patchG(gi, (x) => { x.lines.splice(li, 1); if (!x.lines.length) x.lines.push(newGLine()); })}>×</button>
                    </div>
                    <div className="eo-sizes">
                      {used.map((z) => (
                        <label key={z} className="eo-sz"><span>{sizeLabel(z)}</span><input inputMode="numeric" value={l.sizes[z] ?? ""} onChange={(e) => patchG(gi, (x) => { const n = Math.max(0, Math.floor(+e.target.value.replace(/\D/g, "") || 0)); x.lines[li].sizes[z] = n; })} onBlur={() => patchG(gi, (x) => { if (!x.lines[li].sizes[z]) delete x.lines[li].sizes[z]; })} /></label>
                      ))}
                      <select aria-label="Add a size" value="" onChange={(e) => { const z = e.target.value as keyof GLine["sizes"]; if (z) patchG(gi, (x) => { x.lines[li].sizes[z] = x.lines[li].sizes[z] || 0; }); }}>
                        <option value="">+ size</option>{SIZES.filter((z) => l.sizes?.[z] === undefined).map((z) => <option key={z} value={z}>{sizeLabel(z)}</option>)}
                      </select>
                      <b className="eo-qty">{qtyOf(l)} pcs</b>
                    </div>
                  </div>
                );
              })}
              <button type="button" className="eo-link" onClick={() => patchG(gi, (x) => { x.lines.push(newGLine()); })}>+ Add garment</button>
            </div>

            <div className="eo-sub">Prints</div>
            {g.imprints.map((im, ii) => {
              const art = d.art[im.id] || "";
              return (
                <div key={im.id} className="eo-print">
                  {im.design_id ? <span className="eo-art on" title="Uses the design from the past job">Design</span>
                    : art && urlOf(art) ? <Thumb className="eo-art" url={urlOf(art)} name={art} /> : <span className="eo-art">No art</span>}
                  <input list="eo-locs" aria-label="Location" value={im.location} onChange={(e) => patchG(gi, (x) => { x.imprints[ii].location = e.target.value; })} />
                  <select aria-label="Method" value={im.method} onChange={(e) => patchG(gi, (x) => { x.imprints[ii].method = e.target.value as Method; })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  {im.method !== "dtf" && <label className="eo-n">Colors<input inputMode="numeric" value={im.colors} onChange={(e) => patchG(gi, (x) => { x.imprints[ii].colors = Math.max(1, Math.min(15, +e.target.value.replace(/\D/g, "") || 1)); })} /></label>}
                  <input aria-label="Inks" placeholder="Inks" value={im.inks} onChange={(e) => patchG(gi, (x) => { x.imprints[ii].inks = e.target.value; })} />
                  <input aria-label="Print size" className="eo-short" placeholder="Size" value={im.size} onChange={(e) => patchG(gi, (x) => { x.imprints[ii].size = e.target.value; })} />
                  {!im.design_id && <select aria-label="Art file" value={art} onChange={(e) => patch((x) => { if (e.target.value) x.art[im.id] = e.target.value; else delete x.art[im.id]; })}>
                    <option value="">No art file</option>{files.map((f) => <option key={f.path} value={f.path}>{f.name}</option>)}
                  </select>}
                  <button type="button" className="eo-x" aria-label="Remove print" onClick={() => patchG(gi, (x) => { x.imprints.splice(ii, 1); })}>×</button>
                </div>
              );
            })}
            <button type="button" className="eo-link" onClick={() => patchG(gi, (x) => { x.imprints.push(newImprint(x.imprints.length ? "Full Back" : "Full Front")); })}>+ Add print</button>

            {(pics.length > 0 || (g.customerMockups || []).length > 0) && <>
              <div className="eo-sub">Customer&apos;s mockup</div>
              <div className="eo-mocks">
                {(g.customerMockups || []).map((m) => <span key={m.path} className="eo-mock on" title={m.name}>{m.name}</span>)}
                {pics.map((f) => {
                  const on = (d.mockups[g.id] || []).includes(f.path);
                  return <label key={f.path} className={"eo-mock" + (on ? " on" : "")}><input type="checkbox" checked={on} onChange={() => patch((x) => { const cur = x.mockups[g.id] || []; x.mockups[g.id] = on ? cur.filter((p) => p !== f.path) : [...cur, f.path]; })} />{f.url && <Thumb url={f.url} name={f.name} />}<span>{f.name}</span></label>;
                })}
              </div>
            </>}

            {data.finishing.length > 0 && <div className="eo-fin">
              <span className="eo-sub">Finishing</span>
              {data.finishing.map((f) => <label key={f.id} className="eo-check"><input type="checkbox" checked={(g.finishing || []).includes(f.id)} onChange={(e) => patchG(gi, (x) => { x.finishing = e.target.checked ? [...(x.finishing || []), f.id] : (x.finishing || []).filter((y) => y !== f.id); })} />{f.name}</label>)}
            </div>}
          </div>
        ))}
        <datalist id="eo-locs">{ALL_LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist>
        <button type="button" className="eo-link" onClick={() => patch((x) => { x.groups.push({ id: uidish(), lines: [newGLine()], imprints: [newImprint()] }); })}>+ Add a group (garments with different prints)</button>

        <label className="eo-notes">Notes for the shop (internal, not on the quote)<textarea rows={2} value={d.notes} onChange={(e) => patch((x) => { x.notes = e.target.value; })} /></label>
        {d.questions.length > 0 && <div className="eo-q">
          <div className="eo-sub">Still to ask the customer <button type="button" className="eo-link" onClick={() => navigator.clipboard?.writeText(d.questions.map((q) => `- ${q}`).join("\n"))}>Copy</button></div>
          <ul>{d.questions.map((q, i) => <li key={i}>{q}<button type="button" className="eo-x" aria-label="Drop this question" onClick={() => patch((x) => { x.questions.splice(i, 1); })}>×</button></li>)}</ul>
          <small className="faint">These go in the order&apos;s production notes.</small>
        </div>}

        <div className="eo-foot">
          <b>{total} pcs</b>
          <span className="spacer" />
          <label>Save as<select value={status} onChange={(e) => setStatus(e.target.value as "quote" | "approved")}><option value="quote">Quote (price it, send for approval)</option><option value="approved">Approved order</option></select></label>
          {step && <span className="faint">{step}</span>}
          <button type="button" className="btn" disabled={!!busy} onClick={() => setEditing(false)}>Back to summary</button>
          <button type="button" className="btn primary" disabled={!!busy || !total || !data.customer || mustMove} onClick={() => create()}>{busy === "create" ? "Creating…" : "Create order"}</button>
        </div>
        {!data.customer && <div className="warn">Make the sender a customer first (the yellow box above), then create the order.</div>}
      </>}
    </section>
  );
}

/** The AI's order as a short summary to approve: what will be made when Create order is pressed. */
function Review({ d, files, urlOf, custName, job, finishing }: { d: EODraft; files: EOFile[]; urlOf: (p: string) => string; custName: string; job: string; finishing: Fin[] }) {
  const docs = files.filter((f) => f.role === "sheet" || (f.role === "other" && !isPicture(f)));
  const mocks = [...new Set(Object.values(d.mockups).flat())].map((p) => files.find((f) => f.path === p)).filter(Boolean) as EOFile[];
  const sig = files.filter((f) => f.role === "signature");
  return (
    <div className="eo-rev">
      {d.summary && <p className="eo-sum">✦ {d.summary}</p>}
      <dl className="eo-rev-dl">
        <dt>Order</dt><dd>{d.kind === "reorder" ? `Reorder of ${job || "a past job"}` : "New order"}{d.nickname ? `: ${d.nickname}` : ""}{custName ? ` for ${custName}` : ""}{d.due_date ? `, in hands ${d.due_date}` : ""}{d.po_number ? `, PO ${d.po_number}` : ""}</dd>
        {d.goods.supplied && <><dt>Goods</dt><dd>Customer supplied{d.goods.supplier ? `, from ${SUPPLIERS[d.goods.supplier] || d.goods.supplier}` : ""}{d.goods.expected ? `, expected ${d.goods.expected}` : ""}</dd></>}
        {d.groups.map((g, gi) => (
          <Fragment key={g.id}>
            <dt>{d.groups.length > 1 ? g.name || `Group ${gi + 1}` : "Garments"}</dt>
            <dd>{g.lines.map((l) => <div key={l.id}>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"} {l.color && `· ${l.color}`}: {SIZES.filter((z) => +(l.sizes?.[z] || 0) > 0).map((z) => `${sizeLabel(z)} ${l.sizes[z]}`).join(", ") || "no sizes"} <b>({qtyOf(l)} pcs)</b></div>)}</dd>
            <dt>Prints</dt>
            <dd>{g.imprints.length ? g.imprints.map((im) => {
              const art = d.art[im.id] || "";
              return <div key={im.id} className="eo-rev-print">{art && urlOf(art) ? <Thumb url={urlOf(art)} name={art} /> : im.design_id ? <span className="eo-art on">Design</span> : <span className="eo-art">No art</span>}<span>{im.location}, {METHODS[im.method] || im.method}{im.method !== "dtf" ? `, ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}{im.inks ? ` (${im.inks})` : ""}{im.size ? `, ${im.size}` : ""}{im.drop ? `, ${im.drop}" down` : ""}</span></div>;
            }) : "None"}</dd>
            {(g.finishing || []).length > 0 && <><dt>Finishing</dt><dd>{(g.finishing || []).map((id) => finishing.find((f) => f.id === id)?.name || id).join(", ")}</dd></>}
          </Fragment>
        ))}
        <dt>Mockup</dt>
        <dd>{d.groups.some((g) => g.imprints.some((im) => d.art[im.id] || im.design_id)) ? "We build our own in the Mockup Creator from the art, at the size and spot above, then open the order." : "No art yet: make the mockup on the order."}
          {mocks.length > 0 && <div className="eo-rev-files">{mocks.map((f) => <span key={f.path}>{f.url && <Thumb url={f.url} name={f.name} />}{f.name}</span>)}<small>Their mockup goes in Production files, stamped &quot;Customer supplied mockup&quot;.</small></div>}</dd>
        {docs.length > 0 && <><dt>Production files</dt><dd>{docs.map((f) => f.name).join(", ")}</dd></>}
        {d.notes && <><dt>Notes</dt><dd>{d.notes}</dd></>}
        {d.questions.length > 0 && <><dt>To ask</dt><dd><ul>{d.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></dd></>}
        {sig.length > 0 && <><dt>Ignored</dt><dd className="faint">{sig.map((f) => f.name).join(", ")} (email signature)</dd></>}
      </dl>
    </div>
  );
}

const dLbl = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
/** "When can we print it?" for this order, from the live Production schedule, with the in-hands date checked against it */
function WhenLine({ when, due, onUse }: { when: WhenDates | null | undefined; due: string | null; onUse: (day: string) => void }) {
  if (when === undefined) return <div className="eo-when faint">Checking the production schedule for when we can print it…</div>;
  if (!when) return null;
  if (when.noMachine) return <div className="eo-when warn">No press or machine can run these prints as they are. Check the prints.</div>;
  const opts: [string, string | null, string][] = [["Regular turn", when.regular, "fits the schedule as it is"], ["Aggressive", when.aggressive, "jump the line, nobody late"], ["Soonest", when.soonest, "with overtime"]];
  const makes = (d: string | null) => (d && due ? d <= due : null);
  return (
    <div className="eo-when">
      <div className="eo-when-h"><b>When we can print it</b><span className="faint">{when.press ? `${when.press} · ` : ""}from the Production schedule</span></div>
      <div className="eo-when-opts">{opts.map(([name, d, why]) => (
        <span key={name} className={"eo-when-o" + (makes(d) === false ? " miss" : makes(d) ? " ok" : "")} title={why}>
          <small>{name}</small><b>{d ? dLbl(d) : "?"}</b>{due && d ? <em>{makes(d) ? "✓ makes it" : "✗ misses it"}</em> : null}
        </span>
      ))}</div>
      {due ? <div className="faint" style={{ fontSize: 12.5 }}>They asked for {dLbl(due)}.</div>
        : when.regular ? <button type="button" className="eo-link" onClick={() => onUse(when.regular!)}>No date asked: use {dLbl(when.regular)} (regular turn) as the in-hands date</button> : null}
    </div>
  );
}

/**
 * A file's thumbnail: a picture as it is; a PDF or AI file's first page drawn small (an <img> of a PDF shows a broken,
 * grayed-out box). Anything else, or while it's drawing, a small tile with its type.
 */
const thumbCache = new Map<string, string>();
function Thumb({ url, name, className }: { url: string; name: string; className?: string }) {
  const doc = /\.(pdf|ai)$/i.test(name.split("?")[0]);
  const [src, setSrc] = useState(doc ? thumbCache.get(url) || "" : url);
  useEffect(() => {
    if (!doc || thumbCache.has(url)) return;
    let live = true;
    (async () => {
      const r = await fetch(url).catch(() => null);
      if (!r?.ok) return;
      const pv = await makePreview(new File([await r.blob()], name.split("/").pop() || "file.pdf", { type: "application/pdf" }), 320).catch(() => null);
      if (!pv || !live) return;
      const u = URL.createObjectURL(pv);
      thumbCache.set(url, u); setSrc(u);
    })();
    return () => { live = false; };
  }, [url, doc, name]);
  return src ? <img className={className} src={src} alt="" /> : <span className={"eo-doc" + (className ? " " + className : "")}>{(name.split(".").pop() || "file").toUpperCase().slice(0, 4)}</span>;
}
