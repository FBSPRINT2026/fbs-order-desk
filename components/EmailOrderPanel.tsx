"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { LOCATIONS, METHODS, SIZES, newGLine, newImprint, sizeLabel, type GLine, type Group, type Method } from "@/lib/pricing";
import { SUPPLIERS } from "@/lib/goods";
import { isPicture, ROLE_LABEL, type EODraft, type EOFile, type PastJob } from "@/lib/emailOrderShared";
import { createClient } from "@/lib/supabase/client";
import { stampOrderMockups } from "@/lib/mockupStamp";
import { attachFilms, pullReorderArt } from "@/lib/reorderArt";
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
type Loaded = { draft: EODraft | null; files: EOFile[]; past: PastJob[]; created: string | null; finishing: Fin[]; ai: boolean; aiReason: string; customer: { id: string; company: string | null; name: string | null; price_type: string; moved_at?: string | null; is_test?: boolean } | null };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const qtyOf = (l: GLine) => Object.values(l.sizes || {}).reduce((a, v) => a + (+(v || 0) || 0), 0);
const uidish = () => Math.random().toString(36).slice(2, 10);

export default function EmailOrderPanel({ activityId, onClose, onCreated }: { activityId: string; onClose: () => void; onCreated: (id: string, number: number, opened?: boolean) => void }) {
  /** the AI's order is shown as a summary to approve; Edit details opens the full form */
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState("");
  const [when, setWhen] = useState<WhenDates | null | undefined>(undefined);
  const [data, setData] = useState<Loaded | null>(null);
  const [d, setD] = useState<EODraft | null>(null);
  const [busy, setBusy] = useState<"" | "read" | "create">(""), [err, setErr] = useState("");
  const [status, setStatus] = useState<"quote" | "approved">("quote");

  // what staff tell the AI before it reads the email ("it's a reorder of 31174, the art is on the old job")
  const [told, setTold] = useState(""), [tellOpen, setTellOpen] = useState(false);
  async function read() {
    setBusy("read"); setErr("");
    const r = await fetch("/api/inbox/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, told }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy("");
    if (!r?.ok || !j.draft) return setErr(j.error || "The AI couldn't read this email. Try again.");
    setData((x) => (x ? { ...x, draft: j.draft, files: j.files, past: j.past } : x));
    setD(j.draft);
  }
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/inbox/order?activity=${encodeURIComponent(activityId)}`).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      if (!live) return;
      if (!r?.ok || !j) return setErr(j?.error || "Couldn't load the email.");
      setData(j);
      if (j.draft) { setD(j.draft); if (j.draft.told) setTold(j.draft.told); }
      else if (j.ai) read();
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
  async function create(mode: "new" | "edit" = "new") {
    if (!d) return;
    // Create order: a tab opened now (while it's still a click) so the browser doesn't block it later.
    // Edit details: the same order, opened here in the full order screen, with "Save & back to email".
    const w = mode === "new" ? window.open("", "_blank") : null;
    setBusy("create"); setErr("");
    let dd = d, films: { id: string; name: string }[] = [];
    if (d.kind === "reorder" && d.reorderOf && data?.customer?.id && d.groups.some((g) => g.imprints.some((im) => !im.design_id))) {
      const job = data.past.find((p) => p.ref === d.reorderOf);
      try { const r = await pullReorderArt(d, { customerId: data.customer.id, jobLabel: job?.label, jobDate: job?.date, onStep: setStep }); dd = r.draft; films = r.films; setD(dd); } catch (e) { setErr("Couldn't pull the art from the old mockup (" + (e instanceof Error ? e.message : String(e)) + "). The order is made without it."); }
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
      const first = gs.find((g) => g.imprints.some((x) => x.design_id));
      if (first) url = `/shop/artwork/mockup?order=${j.id}&group=${first.id}&auto=1`;
    } catch { /* the order page stamps them when it opens */ }
    url = `${url}${url.includes("?") ? "&" : "?"}email=${activityId}`;
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
        {data.ai && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={read}>{busy === "read" ? "Reading…" : d ? "Read it again" : "Read the email"}</button>}
        <button type="button" className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
      {!data.ai && !d && <div className="warn">{data.aiReason || "AI is off."} You can still enter the order by hand from the order page.</div>}
      {busy === "read" && <p className="eo-reading">Reading the email{files.length ? ` and ${files.length} attachment${files.length === 1 ? "" : "s"}` : ""}: garments, sizes, art, mockups, and whether it's a reorder. This takes 15 to 40 seconds.</p>}
      {err && <div className="err">{err}</div>}
      {data.ai && busy !== "read" && (() => {
        // a reorder (or what looks like one): ask what staff know before pricing it
        const ask = !!d && (d.kind === "reorder" || !!d.looksReorder) && !d.told;
        if (!ask && !tellOpen && !d?.told) return <button type="button" className="eo-link eo-tell-link" onClick={() => setTellOpen(true)}>✦ Tell the AI something about this email</button>;
        return (
          <div className={"eo-tell" + (ask ? " ask" : "")}>
            <label htmlFor={`tell-${activityId}`}>
              {ask ? (job ? <>This looks like a reorder of <b>{job.label}</b>. Anything I should know?</> : <>This looks like a reorder, but I couldn&apos;t tell which job. Anything I should know?</>)
                : d?.told ? "What you told the AI" : "Anything the AI should know first?"}
            </label>
            <textarea id={`tell-${activityId}`} rows={2} value={told} onChange={(e) => setTold(e.target.value)}
              placeholder='e.g. "Reorder of 31174, art and mockup are on that job" · "Same as last time but navy instead of black" · "We used the LA Lakers PMS colors"' />
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm primary" disabled={!told.trim()} onClick={() => { setTellOpen(false); void read(); }}>{d ? "Read it again with this" : "Read the email with this"}</button>
              {!ask && !d?.told && <button type="button" className="btn sm ghost" onClick={() => setTellOpen(false)}>Cancel</button>}
            </div>
          </div>
        );
      })()}
      {d && total > 0 && <div hidden><WhenCalc key={whenKey} when={{ groups: d.groups, onDates: setWhen }} /></div>}
      {d && mustMove && data.customer && <NotMovedBanner customerId={data.customer.id} name={data.customer.company || data.customer.name || ""} what="an order for them"
        onMoved={() => setData((x) => (x && x.customer ? { ...x, customer: { ...x.customer, moved_at: new Date().toISOString() } } : x))} />}
      {d && !editing && <WhenLine when={when} due={d.due_date} onUse={(day) => patch((x) => { x.due_date = day; })} />}
      {d && !editing && <Review d={d} files={files} urlOf={urlOf} custName={data.customer ? data.customer.company || data.customer.name || "" : ""} job={d.reorderOf ? data.past.find((p) => p.ref === d.reorderOf)?.label || "" : ""} finishing={data.finishing} />}
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
              {isPicture(f) && f.url ? <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt="" /></a> : <a className="eo-doc" href={f.url || undefined} target="_blank" rel="noreferrer">{(f.name.split(".").pop() || "file").toUpperCase()}</a>}
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
                    : art && urlOf(art) ? <img className="eo-art" src={urlOf(art)} alt="" /> : <span className="eo-art">No art</span>}
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
                  return <label key={f.path} className={"eo-mock" + (on ? " on" : "")}><input type="checkbox" checked={on} onChange={() => patch((x) => { const cur = x.mockups[g.id] || []; x.mockups[g.id] = on ? cur.filter((p) => p !== f.path) : [...cur, f.path]; })} />{f.url && <img src={f.url} alt="" />}<span>{f.name}</span></label>;
                })}
              </div>
            </>}

            {data.finishing.length > 0 && <div className="eo-fin">
              <span className="eo-sub">Finishing</span>
              {data.finishing.map((f) => <label key={f.id} className="eo-check"><input type="checkbox" checked={(g.finishing || []).includes(f.id)} onChange={(e) => patchG(gi, (x) => { x.finishing = e.target.checked ? [...(x.finishing || []), f.id] : (x.finishing || []).filter((y) => y !== f.id); })} />{f.name}</label>)}
            </div>}
          </div>
        ))}
        <datalist id="eo-locs">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist>
        <button type="button" className="eo-link" onClick={() => patch((x) => { x.groups.push({ id: uidish(), lines: [newGLine()], imprints: [newImprint()] }); })}>+ Add a group (garments with different prints)</button>

        <label className="eo-notes">Notes on the order<textarea rows={2} value={d.notes} onChange={(e) => patch((x) => { x.notes = e.target.value; })} /></label>
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
              return <div key={im.id} className="eo-rev-print">{art && urlOf(art) ? <img src={urlOf(art)} alt="" /> : im.design_id ? <span className="eo-art on">Design</span> : <span className="eo-art">No art</span>}<span>{im.location}, {METHODS[im.method] || im.method}{im.method !== "dtf" ? `, ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}{im.inks ? ` (${im.inks})` : ""}{im.size ? `, ${im.size}` : ""}{im.drop ? `, ${im.drop}" down` : ""}</span></div>;
            }) : "None"}</dd>
            {(g.finishing || []).length > 0 && <><dt>Finishing</dt><dd>{(g.finishing || []).map((id) => finishing.find((f) => f.id === id)?.name || id).join(", ")}</dd></>}
          </Fragment>
        ))}
        <dt>Mockup</dt>
        <dd>{d.groups.some((g) => g.imprints.some((im) => d.art[im.id] || im.design_id)) ? "We build our own in the Mockup Creator from the art, at the size and spot above, then open the order." : "No art yet: make the mockup on the order."}
          {mocks.length > 0 && <div className="eo-rev-files">{mocks.map((f) => <span key={f.path}>{f.url && <img src={f.url} alt="" />}{f.name}</span>)}<small>Their mockup goes in Production files, stamped &quot;Customer supplied mockup&quot;.</small></div>}</dd>
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
