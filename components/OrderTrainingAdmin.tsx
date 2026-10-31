"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import CustomerPick from "@/components/CustomerPick";
import { useSticky } from "@/lib/useSticky";
import { fmtStamp } from "@/lib/format";
import type { TrainFile, TrainMsg } from "@/lib/ai/trainingChat";

/**
 * Settings → Assistant & AI → Order training (Oct 30, Nick: "where are the trainings at now?… put them under settings…
 * how do we access the trainings?"). Every customer Create order has been taught: their training (the rules it follows
 * for their jobs, customer_private.order_training), when it's used ("Use it when the job says"), the worked examples it
 * learned from finished orders (lib/ai/orderExamples.ts) and their brands' standard mockups. The same fields are on the
 * customer's Details; this is the one place to see and change them all.
 * Beside each training, a chat with Claude (Oct 30, Nick: "a package… we can talk to back and forth and make little
 * edits to"): say a change or attach a PO, Claude shows the training with each change marked, Apply saves it.
 */
type Row = { customer_id: string; company: string; training: string; name: string; when: string };
type Example = { id: string; order_id: string; title: string; confirmed_by: string; confirmed_at: string; order_text: string; active: boolean };
type BrandRow = { id: string; name: string; customer_id: string; rules: { mockup?: string; mockups?: number[] } | null };

export default function OrderTrainingAdmin() {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [openId, setOpenId] = useSticky<string>("training.open", "");
  const [adding, setAdding] = useState<{ id: string; label: string } | null>(null);
  const load = useCallback(async () => {
    const { data: ps } = await sb.from("customer_private").select("customer_id, order_training, order_training_name, order_training_when").neq("order_training", "");
    const cj = await fetch("/api/ai/examples?customerId=all").then((r) => r.json()).catch(() => ({ counts: {} }));
    const n = (cj.counts || {}) as Record<string, number>;
    const ids = [...new Set([...((ps || []) as { customer_id: string }[]).map((p) => p.customer_id), ...Object.keys(n), ...(adding ? [adding.id] : [])])];
    const [{ data: cs }, { data: bs }] = ids.length ? await Promise.all([
      sb.from("customers").select("id, company, name").in("id", ids),
      sb.from("brands").select("id, name, customer_id, rules").in("customer_id", ids).is("archived_at", null),
    ]) : [{ data: [] }, { data: [] }];
    const byId = new Map(((cs || []) as { id: string; company: string | null; name: string | null }[]).map((c) => [c.id, c.company || c.name || "Customer"]));
    const priv = new Map(((ps || []) as { customer_id: string; order_training: string; order_training_name: string; order_training_when: string }[]).map((p) => [p.customer_id, p]));
    setCounts(n); setBrands((bs || []) as BrandRow[]);
    setRows(ids.map((id) => ({ customer_id: id, company: byId.get(id) || "Customer", training: priv.get(id)?.order_training || "", name: priv.get(id)?.order_training_name || "", when: priv.get(id)?.order_training_when || "" })).sort((a, b) => a.company.localeCompare(b.company)));
  }, [sb, adding]);
  useEffect(() => { void load(); }, [load]);

  const trained = (rows || []).filter((r) => r.training.trim()).length;
  const examples = Object.values(counts).reduce((a, b) => a + b, 0);
  const stdMocks = brands.reduce((a, b) => a + (b.rules?.mockups?.length || 0), 0);

  return (
    <>
      <div className="stats">
        <button type="button" className="stat"><span className="v">{trained}</span><span className="k">Customers trained</span></button>
        <button type="button" className="stat"><span className="v">{examples}</span><span className="k">Worked examples</span></button>
        <button type="button" className="stat"><span className="v">{stdMocks}</span><span className="k">Standard mockups</span></button>
      </div>
      <section className="panel">
        <div className="panel-h"><h2>Customers</h2><span className="faint">Create order reads a customer&apos;s training for every one of their jobs, and offers &ldquo;Make it with the rules&rdquo; when the job says one of its words</span></div>
        <div className="panel-b stack">
          <div className="otr-add">
            <CustomerPick value={adding?.id || null} label={adding?.label} field onPick={(id, label) => { if (id) { setAdding({ id, label }); setOpenId(id); } else setAdding(null); }} placeholder="Train another customer: type one" />
          </div>
          {rows === null ? <p className="faint">Loading…</p> : !rows.length ? <p className="faint">No customer has training yet.</p> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Customer</th><th>Training</th><th>Used when the job says</th><th>Examples</th><th>Standard mockups</th></tr></thead>
              <tbody>{rows.map((r) => {
                const mk = brands.filter((b) => b.customer_id === r.customer_id && (b.rules?.mockups || []).length);
                return [
                  <tr key={r.customer_id} className={"otr-row" + (openId === r.customer_id ? " on" : "")} onClick={() => setOpenId(openId === r.customer_id ? "" : r.customer_id)} style={{ cursor: "pointer" }}>
                    <td><b>{r.company}</b></td>
                    <td>{r.training.trim() ? <>{r.name || "Trained"}<div className="sub">{r.training.trim().length.toLocaleString()} characters</div></> : <span className="faint">None yet</span>}</td>
                    <td>{r.when || <span className="faint">every job of theirs</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{counts[r.customer_id] || 0}</td>
                    <td>{mk.length ? mk.map((b) => <div key={b.id}>{b.name}: {(b.rules?.mockups || []).map((n) => `M-${n}`).join(", ")}</div>) : <span className="faint">—</span>}</td>
                  </tr>,
                  openId === r.customer_id ? <tr key={r.customer_id + "-e"} className="otr-ed"><td colSpan={5}><TrainingEditor row={r} brands={brands.filter((b) => b.customer_id === r.customer_id)} onSaved={load} /></td></tr> : null,
                ];
              })}</tbody>
            </table></div>
          )}
        </div>
      </section>
    </>
  );
}

function TrainingEditor({ row, brands, onSaved }: { row: Row; brands: BrandRow[]; onSaved: () => void }) {
  const sb = useMemo(() => createClient(), []);
  const [t, setT] = useState(row.training), [name, setName] = useState(row.name), [when, setWhen] = useState(row.when);
  const [state, setState] = useState("");
  const [ex, setEx] = useState<Example[] | null>(null);
  const loadEx = useCallback(() => { fetch(`/api/ai/examples?customerId=${row.customer_id}`).then((r) => r.json()).then((j) => setEx(j.examples || [])).catch(() => setEx([])); }, [row.customer_id]);
  useEffect(loadEx, [loadEx]);
  const changed = t !== row.training || name !== row.name || when !== row.when;
  const save = async () => {
    setState("Saving…");
    const { error } = await sb.from("customer_private").upsert({ customer_id: row.customer_id, order_training: t.trim(), order_training_name: name.trim(), order_training_when: when.trim() }, { onConflict: "customer_id" });
    setState(error ? "Couldn't save: " + error.message : "Saved");
    if (!error) onSaved();
  };
  const toggle = async (e: Example) => {
    const r = await fetch("/api/ai/examples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, active: !e.active }) });
    if (r.ok) setEx((xs) => (xs || []).map((x) => (x.id === e.id ? { ...x, active: !e.active } : x)));
  };
  return (
    <div className="otr-cols">
    <div className="otr-box">
      <div className="otr-two">
        <div className="field"><label htmlFor={`otn-${row.customer_id}`}>Training name</label><input id={`otn-${row.customer_id}`} type="text" value={name} placeholder="All My Sons" onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor={`otw-${row.customer_id}`}>Use it when the job says</label><input id={`otw-${row.customer_id}`} type="text" value={when} placeholder="AMS, All My Sons" onChange={(e) => setWhen(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor={`ott-${row.customer_id}`}>The rules Create order follows for these jobs</label><textarea id={`ott-${row.customer_id}`} rows={14} value={t} placeholder="How their orders are made: the groups, which logo goes on what, personalization, pricing, shipping…" onChange={(e) => setT(e.target.value)} /></div>
      <div className="row"><button type="button" className="btn primary" disabled={!changed} onClick={() => void save()}>Save training</button><span className="faint">{state}</span><span className="spacer" /><Link className="linkbtn" href={`/shop/customers/${row.customer_id}?area=artwork`}>Their brands &amp; standard mockups</Link></div>
      {brands.some((b) => (b.rules?.mockups || []).length || b.rules?.mockup) && (
        <div className="otr-sub"><b>Mockups on new orders</b>{brands.map((b) => <div key={b.id} className="faint">{b.name}: {(b.rules?.mockups || []).length ? `standard ${(b.rules?.mockups || []).map((n) => `M-${n}`).join(", ")} (the same logos at the same spots get it)` : "no standard mockups"}{b.rules?.mockup === "logo" ? "; any other group gets a logo mockup made" : ""}</div>)}</div>
      )}
      <div className="otr-sub"><b>Worked examples</b><span className="faint"> · saved when an order is marked right in the Order chat or sent to the customer; the closest two are read with each new job</span>
        {ex === null ? <p className="faint">Loading…</p> : !ex.length ? <p className="faint">None yet: the next order of theirs marked right is the first.</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Order</th><th>Saved</th><th>What it made</th><th></th></tr></thead>
            <tbody>{ex.map((e) => (
              <tr key={e.id} className={e.active ? "" : "off"}>
                <td><Link href={`/shop/orders/${e.order_id}`}><b>{e.title}</b></Link></td>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(e.confirmed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}<div className="sub">{e.confirmed_by.split("@")[0]}</div></td>
                <td><div className="otr-ord">{e.order_text}</div></td>
                <td style={{ whiteSpace: "nowrap" }}><button type="button" className="linkbtn" onClick={() => void toggle(e)}>{e.active ? "Stop using" : "Use again"}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
    <TrainingChat customerId={row.customer_id} customerName={row.company} base={{ training: t, name, when }} onApplied={(v) => { setT(v.training); setName(v.name); setWhen(v.when); setState("Saved from the chat"); onSaved(); }} />
    </div>
  );
}

const post = async (body: Record<string, unknown>) => {
  const r = await fetch("/api/ai/training", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: "No answer from the server." }))) as { ok: boolean; error?: string; messages?: TrainMsg[]; saved?: { training: string; name: string; when: string } };
};
const OP = { "+": "add", "~": "chg", "-": "del" } as const;

/** the Messages-style chat (the same look as Brand standards' AI): blue for us, gray for Claude, the changes as a card */
function TrainingChat({ customerId, customerName, base, onApplied }: { customerId: string; customerName: string; base: { training: string; name: string; when: string }; onApplied: (v: { training: string; name: string; when: string }) => void }) {
  const [msgs, setMsgs] = useState<TrainMsg[] | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { post({ customerId, action: "thread" }).then((r) => (r.ok ? setMsgs(r.messages || []) : setErr(r.error || "Couldn't load the conversation."))); }, [customerId]);
  // keep the newest message in view inside the chat (never scroll the page)
  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; }, [msgs, busy]);

  async function send() {
    if (busy || (!text.trim() && !files.length)) return;
    setErr("");
    const up: TrainFile[] = [];
    if (files.length) {
      setBusy("Uploading…");
      const sb = createClient();
      for (const f of files) {
        const path = `brand-guides/${customerId}/training/${Date.now().toString(36)}-${f.name.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
        const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
        if (error) { setBusy(""); return setErr(`${f.name}: ${error.message}`); }
        up.push({ path, name: f.name, type: f.type });
      }
    }
    const said = text;
    setMsgs((m) => [...(m || []), { role: "staff", text: said, at: new Date().toISOString(), files: up.length ? up : undefined }]);
    setText(""); setFiles([]);
    setBusy(up.length ? "Reading the files… (can take a minute)" : "Thinking…");
    const r = await post({ customerId, action: "chat", text: said, files: up, base });
    setBusy("");
    if (!r.ok) { setErr(r.error || "Something went wrong."); setMsgs((m) => (m || []).slice(0, -1)); setText(said); return; }
    setMsgs(r.messages || []);
  }
  async function decide(i: number, action: "apply" | "dismiss") {
    setBusy(action === "apply" ? "Applying…" : ""); setErr("");
    const r = await post({ customerId, action, index: i });
    setBusy("");
    if (!r.ok) return setErr(r.error || "Couldn't do that.");
    setMsgs(r.messages || []);
    if (action === "apply" && r.saved) onApplied(r.saved);
  }
  const showTime = (k: number) => { const l = msgs || []; return k === 0 || new Date(l[k].at).getTime() - new Date(l[k - 1].at).getTime() > 30 * 60_000; };
  return (
    <section className="im otr-chat" aria-label="Change the training with Claude">
      <div className="im-h">
        <span className="im-av" aria-hidden="true">✦</span>
        <span className="im-who"><b>Training with Claude</b><small>{customerName}</small></span>
      </div>
      <div className="im-msgs" ref={box}>
        {msgs && !msgs.length && (
          <div className="im-row them"><div className="im-b them">{base.training.trim()
            ? "Tell me what to change the way you'd say it (\"beanies go on the cuff now\", \"Pittsburgh ships UPS\"), or tap + to attach a PO and the order we made from it. I'll show the training with each change marked, and nothing is saved until you Apply."
            : "Tell me how their orders go, or tap + to attach one of their POs. I'll write the training from that and from the orders we've already checked right, and nothing is saved until you Apply."}</div></div>
        )}
        {!msgs && !err && <div className="im-time">Loading…</div>}
        {(msgs || []).map((m, i) => (
          <div key={i} className="im-grp">
            {showTime(i) && <div className="im-time">{fmtStamp(m.at)}</div>}
            {m.role === "staff" ? (
              <>
                {m.files?.map((f) => <div key={f.path} className="im-row me"><div className="im-file">📄 <span>{f.name}</span></div></div>)}
                {m.text && <div className="im-row me"><div className="im-b me">{m.text}</div></div>}
                {m.by && <div className="im-by me">{m.by.split("@")[0]}</div>}
              </>
            ) : (
              <>
                {m.text && <div className="im-row them"><div className="im-b them">{m.text}</div></div>}
                {m.lines?.length ? (
                  <div className="im-row them">
                    <div className={"im-card " + (m.status || "")}>
                      <div className="im-card-h">{m.status === "applied" ? "✓ Applied" : m.status === "dismissed" ? "Not applied" : `Changes to the training (${m.lines.length})`}</div>
                      {m.lines.map((l, k) => (
                        <div key={k} className="im-line otr-line"><span className={"op " + OP[l.op]}>{l.op === "-" ? "−" : l.op}</span><span className="txt">{l.parts ? <span>{l.parts.map((p, q) => <span key={q} className={"otr-w " + p.k}>{p.t}</span>)}</span> : l.op === "-" ? <s>{l.text}</s> : l.text}</span></div>
                      ))}
                      {m.status === "open" ? (
                        <div className="im-acts"><button type="button" className="im-apply" disabled={!!busy} onClick={() => void decide(i, "apply")}>{busy === "Applying…" ? "Applying…" : "Apply"}</button><button type="button" className="im-later" disabled={!!busy} onClick={() => void decide(i, "dismiss")}>Discard</button></div>
                      ) : m.done_at ? <div className="im-card-f">{m.status === "applied" ? "Applied" : "Set aside"} by {(m.done_by || "").split("@")[0]} · {fmtStamp(m.done_at)}</div> : null}
                    </div>
                  </div>
                ) : null}
                {m.question && <div className="im-row them"><div className="im-b them">{m.question}</div></div>}
              </>
            )}
          </div>
        ))}
        {busy && busy !== "Applying…" && (
          <div className="im-row them"><div className="im-b them typing" title={busy} aria-label={busy}><i /><i /><i /></div>{/files/i.test(busy) && <span className="im-note">{busy}</span>}</div>
        )}
      </div>
      {err && <div className="im-err">{err}</div>}
      {files.length > 0 && <div className="im-staged">{files.map((f, i) => <span key={i}>📄 {f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>✕</button></span>)}</div>}
      <div className="im-in">
        <label className="im-plus" title="Attach a PO, an order sheet or a picture" aria-label="Attach files">+<input type="file" hidden multiple accept="application/pdf,image/png,image/jpeg,image/webp,.xlsx,.xlsm,.docx,.csv,.txt" onChange={(e) => { const l = Array.from(e.target.files || []); e.target.value = ""; setFiles((x) => [...x, ...l].slice(0, 4)); }} /></label>
        <div className="im-field">
          <textarea rows={1} value={text} placeholder="Message" aria-label="Message" onChange={(e) => { setText(e.target.value); const t = e.target; t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight) + "px"; }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button type="button" className="im-send" aria-label="Send" disabled={!!busy || (!text.trim() && !files.length)} onClick={() => void send()}>↑</button>
        </div>
      </div>
    </section>
  );
}
