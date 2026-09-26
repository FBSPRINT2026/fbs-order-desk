"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GroupEditor from "@/components/GroupEditor";
import { createClient } from "@/lib/supabase/client";
import { calcOrder, newGroup, priceList, requestProblems, uid, PREVIEWABLE_TYPES, type Design, type Garment, type Group, type Message, type Order, type Settings } from "@/lib/pricing";
import { discardRequest, logoUploadUrl, ownMockupUploadUrl, saveMyLogo, saveOwnMockup, saveRequest, submitRequest } from "@/app/portal/request-actions";
import { customerMessage } from "@/app/portal/actions";

function imageSize(f: File): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { res({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 }); URL.revokeObjectURL(url); };
    img.onerror = () => { res(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/** The customer's order builder: garments, sizes, print locations and logos, no prices. */
export default function RequestEditor({ initial, settings, catalog: cat0, designs: d0, designUrls: u0, messages: m0, savedMockups, mockupUrls: mu0, mockupHref, preview, backHref }: {
  initial: Order; settings: Settings; catalog: Garment[]; designs: Design[]; designUrls: Record<string, string>; messages: Message[];
  savedMockups: { path: string; name: string }[]; mockupUrls: Record<string, string>; mockupHref: string; preview: boolean; backHref: string;
}) {
  const [mUrls, setMUrls] = useState(mu0);
  const [upBusy, setUpBusy] = useState("");
  const router = useRouter();
  const [o, setO] = useState<Order>(initial);
  const [catalog, setCatalog] = useState(cat0);
  const [designs, setDesigns] = useState(d0);
  const [urls, setUrls] = useState(u0);
  const [msgs, setMsgs] = useState(m0);
  const [armed, setArmed] = useState("");
  const [lookingUp, setLookingUp] = useState("");
  const [state, setState] = useState("");
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(o);
  const calc = useMemo(() => calcOrder(o, settings, []), [o, settings]);
  const prices = priceList(settings, o.price_type);
  const arm = (k: string) => { setArmed(k); setTimeout(() => setArmed((a) => (a === k ? "" : a)), 3500); };

  async function flush() {
    if (preview) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const x = latest.current;
    setState("Saving…");
    const r = await saveRequest(x.id, { groups: x.groups, nickname: x.nickname, due_date: x.due_date, notes: x.notes });
    setState(r.ok ? "Saved" : "");
    if (!r.ok) setErr(r.error || "Couldn't save.");
  }
  function patch(fn: (d: Order) => void) {
    setO((prev) => { const n = structuredClone(prev); fn(n); latest.current = n; return n; });
    setState("Editing…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }
  useEffect(() => () => { if (timer.current) flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function lookupStyle(style: string, styleID?: number): Promise<Garment | null> {
    const key = style.trim().toUpperCase();
    if (!key || lookingUp === key) return null;
    setLookingUp(key);
    try {
      const r = await fetch(`/api/ss/lookup?${styleID ? `styleid=${styleID}` : `style=${encodeURIComponent(key)}`}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.garment) { setErr(j.error || "Couldn't find that style."); return null; }
      const g = j.garment as Garment;
      setCatalog((c) => [...c.filter((x) => x.id !== g.id), g].sort((a, b) => a.style.localeCompare(b.style)));
      return g;
    } finally { setLookingUp(""); }
  }

  async function uploadLogo(f: File, name: string): Promise<Design | null> {
    if (preview) return null;
    setErr("");
    const u = await logoUploadUrl(f.name);
    if (!u.ok || !u.path || !u.token) { setErr(u.error || "Upload failed."); return null; }
    const up = await createClient().storage.from("proofs").uploadToSignedUrl(u.path, u.token, f, { contentType: f.type || undefined });
    if (up.error) { setErr(up.error.message); return null; }
    const pv = PREVIEWABLE_TYPES.test(f.type);
    const dims = pv ? await imageSize(f) : null;
    const r = await saveMyLogo({ path: u.path, fileName: f.name, fileType: f.type, name, previewable: pv, w: dims?.w, h: dims?.h });
    if (!r.ok) { setErr(r.error || "Upload failed."); return null; }
    const d = r.design as Design;
    setDesigns((x) => [d, ...x]);
    if (r.url) setUrls((x) => ({ ...x, [d.id]: r.url }));
    return d;
  }

  /** A mockup the customer made in their own software (picture or PDF). */
  async function uploadOwnMockup(gi: number, f: File) {
    if (preview) return;
    setErr(""); setUpBusy(o.groups[gi].id);
    try {
      const t = await ownMockupUploadUrl(f.name);
      if (!t.ok) throw new Error(t.error);
      const up = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
      if (up.error) throw new Error(up.error.message);
      const r = await saveOwnMockup({ path: t.path, name: f.name.replace(/\.[^.]+$/, ""), isImage: /^image\//.test(f.type) });
      if (!r.ok) throw new Error(r.error);
      if (r.url) setMUrls((u) => ({ ...u, [t.path]: r.url }));
      patch((d) => { const g = d.groups[gi]; g.customerMockups = [...(g.customerMockups || []), { path: t.path, name: f.name }]; });
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); }
    setUpBusy("");
  }
  const problems = requestProblems(o.groups);

  async function send() {
    setBusy(true); setErr("");
    await flush();
    const r = await submitRequest(o.id);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't send it in.");
    router.push(`/portal/orders/${o.id}?sent=1`);
  }
  async function ask() {
    if (!q.trim()) return;
    const r = await customerMessage(o.id, q);
    if (!r.ok) return setErr(r.error || "Couldn't send your question.");
    setMsgs((m) => [...m, { id: uid(), order_id: o.id, author_type: "customer", author_email: "", author_name: "You", body: q.trim(), read_at: null, created_at: new Date().toISOString() } as Message]);
    setQ("");
  }

  return (
    <main className="p-main rq">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Link href={backHref} className="back">← Dashboard</Link>
          <div className="eyebrow" style={{ marginTop: 6 }}>Order request #{o.number}</div>
          <h1 style={{ margin: 0 }}>Build your order</h1>
        </div>
        <div className="row"><span className="save-state">{state}</span>
          <button type="button" className={"btn ghost danger" + (armed === "discard" ? " armed" : "")} disabled={preview} onClick={async () => { if (armed !== "discard") return arm("discard"); const r = await discardRequest(o.id); if (r.ok) router.push(backHref); else setErr(r.error || ""); }}>{armed === "discard" ? "Delete this order?" : "Delete"}</button>
          <button type="button" className="btn primary" disabled={preview || busy || !calc.qty} onClick={send}>{busy ? "Sending…" : "Send to FBS for pricing"}</button>
        </div>
      </div>
      <div className="rq-note">Add your garments, sizes and where each logo goes. <b>You won&apos;t see prices yet:</b> we&apos;ll check everything, price it and send it back for your final OK.</div>
      {err && <div className="banner" role="alert">{err}</div>}

      <section className="panel"><div className="panel-b grid g3">
        <div className="field"><label htmlFor="rq-name">Order name</label><input id="rq-name" type="text" placeholder="e.g. Team shirts" value={o.nickname || ""} disabled={preview} onChange={(e) => patch((d) => { d.nickname = e.target.value; })} /></div>
        <div className="field"><label htmlFor="rq-date">Need it by (in-hands date)</label><input id="rq-date" type="date" value={o.due_date || ""} disabled={preview} onChange={(e) => patch((d) => { d.due_date = e.target.value || null; })} /></div>
        <div className="field"><label htmlFor="rq-notes">Notes for us</label><input id="rq-notes" type="text" placeholder="Anything we should know" value={o.notes || ""} disabled={preview} onChange={(e) => patch((d) => { d.notes = e.target.value; })} /></div>
      </div></section>

      <fieldset disabled={preview} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
        {o.groups.map((g, gi) => (
          <GroupEditor key={g.id} gi={gi} g={g} gc={calc.groups[gi]} settings={settings} prices={prices} catalog={catalog} canRemove={o.groups.length > 1}
            armed={armed} arm={arm} hidePrices update={(fn) => patch((d) => fn(d.groups[gi]))}
            onSaveToCatalog={() => {}} onLookup={lookupStyle} lookingUp={lookingUp}
            designs={designs} designUrls={urls} onUploadDesign={uploadLogo}
            onDuplicate={() => patch((d) => { const s = d.groups[gi]; d.groups.splice(gi + 1, 0, { ...structuredClone(s), id: uid(), lines: s.lines.map((l) => ({ ...l, id: uid() })), imprints: s.imprints.map((x) => ({ ...x, id: uid() })) } as Group); })}
            onRemove={() => patch((d) => { d.groups.splice(gi, 1); })} />
        )).flatMap((ed, gi) => [ed, (
          <section key={"mk" + o.groups[gi].id} className="panel rq-mock">
            <div className="panel-h"><h2>Mockup for {o.groups[gi].name || `Group ${gi + 1}`}</h2><span className="faint" style={{ fontSize: 12 }}>Optional. Make one in our builder, or upload one from your own software. We still need each logo uploaded above.</span></div>
            <div className="panel-b">
              <div className="rq-mocks">
                {(o.groups[gi].customerMockups || []).map((m, mi) => {
                  const url = mUrls[m.path], isPdf = /\.pdf$/i.test(m.path);
                  return (
                    <div key={m.path} className="rq-mk">
                      <a href={url} target="_blank" rel="noreferrer">{url && !isPdf ? <img src={url} alt={m.name} /> : <span className="rq-file">{isPdf ? "PDF" : "FILE"}</span>}</a>
                      <span className="rq-mk-n" title={m.name}>{m.name}</span>
                      <button type="button" className="btn icon ghost" aria-label="Remove this mockup" onClick={() => patch((d) => { d.groups[gi].customerMockups = (d.groups[gi].customerMockups || []).filter((_, j) => j !== mi); })}>✕</button>
                    </div>
                  );
                })}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <label className="btn sm" style={{ cursor: "pointer" }}>{upBusy === o.groups[gi].id ? "Uploading…" : "Upload your own mockup"}
                  <input type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadOwnMockup(gi, f); }} />
                </label>
                {savedMockups.length > 0 && (
                  <select aria-label="Attach one of your saved mockups" value="" style={{ width: "auto" }} onChange={(e) => { const m = savedMockups.find((x) => x.path === e.target.value); if (m) patch((d) => { const g = d.groups[gi]; if (!(g.customerMockups || []).some((x) => x.path === m.path)) g.customerMockups = [...(g.customerMockups || []), m]; }); }}>
                    <option value="">Attach a saved mockup…</option>
                    {savedMockups.map((m) => <option key={m.path} value={m.path}>{m.name}</option>)}
                  </select>
                )}
                <a className="btn sm ghost" href={mockupHref} target="_blank" rel="noreferrer">Make one in our builder ↗</a>
              </div>
            </div>
          </section>
        )])}
        <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => patch((d) => { d.groups.push(newGroup()); })}>+ Add another group</button>
      </fieldset>

      <section className="panel">
        <div className="panel-h"><h2>Questions for us</h2><span className="faint" style={{ fontSize: 12 }}>Not sure a logo will print well? Ask here. We&apos;ll answer on this order.</span></div>
        <div className="panel-b stack">
          {msgs.map((m) => <div key={m.id} className={"aa-msg " + (m.author_type === "staff" ? "shop" : "cust")}><div className="aa-msg-h"><b>{m.author_name}</b><span className="faint">{new Date(m.created_at).toLocaleString()}</span></div><div className="aa-msg-b">{m.body}</div></div>)}
          <textarea rows={2} placeholder="Type a question…" value={q} disabled={preview} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn" style={{ alignSelf: "flex-end" }} disabled={preview || !q.trim()} onClick={ask}>Send question</button>
        </div>
      </section>

      {calc.qty > 0 && problems.length > 0 && (
        <div className="rq-check">
          <b>Before you send it in:</b>
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          <span className="faint">A mockup is optional, but every print location needs its logo, where it goes, its size and ink colors.</span>
        </div>
      )}
      <div className="rq-foot">
        <span><b>{calc.qty}</b> pieces</span><span className="spacer" />
        <button type="button" className="btn primary" disabled={preview || busy || !calc.qty || problems.length > 0} onClick={send}>{busy ? "Sending…" : "Send to FBS for pricing"}</button>
      </div>
    </main>
  );
}
