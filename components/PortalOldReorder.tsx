"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { discardRequest, readOldReorderSizes, requestFileUrl, sendOldReorder, startOldReorder, type OldReorderKind, type OldReorderRow, type OldReorderStart, type RqFile } from "@/app/portal/request-actions";
import Overlay from "@/components/Overlay";

/**
 * Reorder an order from our old system, in the customer portal (Nov 1, Nick: "we notice you're trying to make a reorder
 * from our old system. Here's our simple reorder form… new sizes… what changes… just the same art, upload new art… a
 * note section… you can't have the bubbles… a single easy fill-in thing… the grid view… small, medium, large, the same
 * thing like we have on our order form… something that denotes youth"). The sizes: a file or pasted text read into the
 * grid, or typed; a row per style, a column per size, adult and youth each under their own sizes. Price is TBD: we set it
 * and send it back. Server: app/portal/request-actions.ts (startOldReorder, readOldReorderSizes, sendOldReorder).
 */
const KIND_LABEL: Record<OldReorderKind, string> = { adult: "Adult", youth: "Youth", toddler: "Toddler", baby: "Infant", waist: "Waist", one: "One size" };
const KIND_ORDER: OldReorderKind[] = ["adult", "youth", "toddler", "baby", "waist", "one"];
const sk = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const ck = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameColor = (a: string, b: string) => { const x = ck(a), y = ck(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
const sizeHead = (z: string) => (z === "OS" ? "Qty" : /^\d+$/.test(z) ? `${z}"` : z);

export function OldReorderButton({ archivedId, disabled, as, primary = true, small }: { archivedId: string; disabled?: boolean; /** a small button (the dashboard's job rows) */ small?: boolean; /** the page's one blue button (not when Pay is there) */ primary?: boolean; /** staff previewing: the customer, to show the form (nothing saved) */ as?: string }) {
  const [start, setStart] = useState<OldReorderStart | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const open = async () => {
    setBusy(true); setErr("");
    const r = await startOldReorder(archivedId, as).catch(() => null);
    setBusy(false);
    if (!r?.ok || !r.start) { setErr(r?.error || "Couldn't start the reorder."); return; }
    setStart(r.start);
  };
  return (
    <>
      <button type="button" className={"btn" + (primary ? " primary" : "") + (small ? " sm" : "")} disabled={disabled || busy} title={disabled ? "Turned off" : "Reorder this: tell us the sizes and anything that's changed"} onClick={() => void open()}>{busy ? "Opening…" : "Reorder"}</button>
      {err && <span className="err">{err}</span>}
      {start && <OldReorderForm s={start} onClose={() => { if (start.id) void discardRequest(start.id); setStart(null); }} />}
    </>
  );
}

function OldReorderForm({ s, onClose }: { s: OldReorderStart; onClose: () => void }) {
  const router = useRouter();
  const [sizes, setSizes] = useState<Record<number, Record<string, string>>>({});
  const [off, setOff] = useState<Record<number, boolean>>({});
  const [art, setArt] = useState<"same" | "new">("same");
  // their order type, required when they have them (Nov 2, Nick: Cedar Bulk / Cart, Nine18 Sam / Mike)
  const [otype, setOtype] = useState("");
  const [files, setFiles] = useState<RqFile[]>([]);
  const [changes, setChanges] = useState(""), [notes, setNotes] = useState(""), [due, setDue] = useState("");
  const [paste, setPaste] = useState(""), [reading, setReading] = useState(""), [readMsg, setReadMsg] = useState("");
  const [over, setOver] = useState<"" | "sizes" | "art">(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const artIn = useRef<HTMLInputElement>(null), sizeIn = useRef<HTMLInputElement>(null);
  // the grid: one section per kind of size (adult, youth…), its own size headings
  const sections = useMemo(() => KIND_ORDER.map((k) => {
    const rows = s.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === k);
    const cols = [...new Set(rows.flatMap(({ r }) => r.run))];
    return { k, rows, cols };
  }).filter((x) => x.rows.length), [s.rows]);
  const maxCols = Math.max(...sections.map((x) => x.cols.length), 1);
  const qtyOf = (i: number) => Object.values(sizes[i] || {}).reduce((a, v) => a + (Math.max(0, Math.round(+v || 0))), 0);
  const total = s.rows.reduce((a, _r, i) => a + (off[i] ? 0 : qtyOf(i)), 0);
  const styles = s.rows.filter((_r, i) => !off[i]).length;
  const setCell = (i: number, z: string, v: string) => setSizes((m) => ({ ...m, [i]: { ...(m[i] || {}), [z]: v.replace(/[^\d]/g, "").slice(0, 6) } }));
  const sameAsLast = () => setSizes(Object.fromEntries(s.rows.map((r, i) => [i, Object.fromEntries(Object.entries(r.last).map(([z, n]) => [z, String(n)]))])));

  const preview = !s.id;
  async function upload(f: File, kind: RqFile["kind"]): Promise<RqFile | null> {
    if (preview) { setErr("This is a preview: customers drop their files from their own login."); return null; }
    const t = await requestFileUrl(s.id, f.name).catch(() => null);
    if (!t?.ok || !t.path || !t.token) { setErr(t?.error || "Upload isn't available right now."); return null; }
    const up = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
    if (up.error) { setErr(up.error.message); return null; }
    return { path: t.path, name: f.name, type: f.type, size: f.size, kind };
  }
  /** the sizes read off a file or pasted text, put in the grid by style and color */
  async function readSizes(input: { files?: File[]; text?: string }) {
    setErr(""); setReadMsg("");
    if (preview) { setReadMsg("This is a preview: the customer's file or pasted sizes are read here."); return; }
    const fs: RqFile[] = [];
    for (const f of input.files || []) { setReading(`Uploading ${f.name}…`); const u = await upload(f, "po"); if (u) fs.push(u); }
    if (fs.length) setFiles((x) => [...x, ...fs]);
    if (!fs.length && !(input.text || "").trim()) { setReading(""); return; }
    setReading(fs.length ? `Reading ${fs[0].name}…` : "Reading your sizes…");
    const r = await readOldReorderSizes(s.id, { files: fs, text: input.text }).catch(() => null);
    setReading("");
    if (!r?.ok || !r.lines) { setReadMsg(r?.error || "We couldn't read that here. Type the sizes in the grid."); return; }
    const used = new Set<number>(); let hit = 0;
    const next: Record<number, Record<string, string>> = { ...sizes };
    s.rows.forEach((row: OldReorderRow, i) => {
      let k = r.lines!.findIndex((x, j) => !used.has(j) && sk(x.style) === sk(row.style) && sameColor(x.color, row.color));
      if (k < 0) k = r.lines!.findIndex((x, j) => !used.has(j) && sk(x.style) === sk(row.style));
      if (k < 0 && s.rows.length === 1 && r.lines!.length === 1) k = 0;
      if (k < 0) return;
      used.add(k); hit++;
      next[i] = Object.fromEntries(Object.entries(r.lines![k].sizes).map(([z, n]) => [z, String(n)]));
    });
    setSizes(next);
    const extra = r.lines.length - used.size;
    setReadMsg(hit ? `Filled in ${hit} of ${s.rows.length} style${s.rows.length === 1 ? "" : "s"}. Check the numbers below.${extra > 0 ? ` ${extra} line${extra === 1 ? "" : "s"} on it didn't match a style here: tell us about ${extra === 1 ? "it" : "them"} in the notes.` : ""}` : "We read it, but it didn't match the styles below. Type the sizes, or tell us in the notes.");
  }
  async function addArt(list: File[]) {
    setErr("");
    for (const f of list) { setReading(`Uploading ${f.name}…`); const u = await upload(f, "art"); if (u) setFiles((x) => [...x, u]); }
    setReading("");
  }
  const drop = (e: React.DragEvent, k: "sizes" | "art") => { e.preventDefault(); setOver(""); const fs = [...e.dataTransfer.files]; if (!fs.length) { const t = e.dataTransfer.getData("text/plain"); if (k === "sizes" && t) { setPaste(t); void readSizes({ text: t }); } return; } if (k === "sizes") void readSizes({ files: fs }); else void addArt(fs); };
  async function send() {
    setBusy(true); setErr("");
    const r = await sendOldReorder(s.id, {
      rows: s.rows.map((row, i) => ({ gi: row.gi, li: row.li, off: !!off[i], sizes: Object.fromEntries(Object.entries(sizes[i] || {}).filter(([, v]) => +v > 0).map(([z, v]) => [z, +v])) })),
      art, files, changes, notes, due: due || null, type: otype,
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || "Couldn't send it. Try again."); return; }
    setDone(r.number || 0);
  }
  const close = () => { if (done != null) { router.push(`/portal/orders/${s.id}`); return; } onClose(); };

  return (
    <Overlay>
      <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="por-t" onKeyDown={(e) => { if (e.key === "Escape" && !busy) close(); }}>
        <div className="por">
          <div className="por-head">
            <div><h2 id="por-t">Reorder #{s.number}</h2><span className="faint">{[s.name, s.date && new Date(`${s.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" })].filter(Boolean).join(" · ")}</span></div>
            <button type="button" className="por-x" aria-label="Close" onClick={close} disabled={busy}>×</button>
          </div>
          {done != null ? (
            <div className="por-done">
              <b>Thanks, your reorder is in</b>
              <p className="faint">We&apos;ll check it, set the price and send it back for your OK.</p>
              <div className="por-done-row"><span>#{done || ""} Reorder of #{s.number}</span><span className="pill" style={{ ["--sc" as string]: "var(--warn)" }}><span className="pill-t">Reorder pending approval</span></span></div>
              <div className="por-foot"><button type="button" className="btn primary" onClick={close}>See the order</button></div>
            </div>
          ) : <>
            <p className="por-note">{s.own ? "Tell us your sizes and anything that's changed. We'll set it up and send you the price to OK." : <>This order is from our old system. Tell us your sizes and anything that&apos;s changed. We&apos;ll set it up and send you the price to OK.</>}</p>

            <section className="por-sec">
              <div className="por-lbl">Sizes</div>
              <div className={"por-drop" + (over === "sizes" ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver("sizes"); }} onDragLeave={() => setOver("")} onDrop={(e) => drop(e, "sizes")}
                onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); void readSizes({ files: fs }); } }}>
                <span>Drop a file with your sizes here (a spreadsheet, PDF, screenshot or email), or paste them below. We&apos;ll fill in the grid.</span>
                <span className="por-drop-row">
                  <textarea rows={2} value={paste} placeholder="S 6, M 12, L 14, XL 8…" aria-label="Paste your sizes" onChange={(e) => setPaste(e.target.value)} />
                  <span className="por-drop-btns">
                    <button type="button" className="btn sm" disabled={!!reading || !paste.trim()} onClick={() => void readSizes({ text: paste })}>Fill in</button>
                    <button type="button" className="btn sm" disabled={!!reading} onClick={() => sizeIn.current?.click()}>Choose a file</button>
                  </span>
                </span>
                <input ref={sizeIn} type="file" hidden accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.heic,.txt,.msg,.eml" onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) void readSizes({ files: fs }); }} />
                {reading && <span className="faint">{reading}</span>}
                {readMsg && <span className="por-read">{readMsg}</span>}
              </div>
              <div className="por-sub"><span className="faint">Or type them · untick a style you&apos;re not reordering · gray is last time</span><button type="button" className="por-link" onClick={sameAsLast}>Same as last time</button></div>
              <div className="tbl-wrap por-grid-wrap">
                <table className="tbl por-grid">
                  <colgroup><col className="por-c-chk" /><col />{Array.from({ length: maxCols }, (_, i) => <col key={i} className="por-c-z" />)}<col className="por-c-q" /></colgroup>
                  {sections.map((sec) => (
                    <tbody key={sec.k}>
                      <tr className="por-kind"><th /><th className="por-kind-n">{KIND_LABEL[sec.k]}</th>{Array.from({ length: maxCols }, (_, c) => <th key={c}>{sec.cols[c] ? sizeHead(sec.cols[c]) : ""}</th>)}<th>Qty</th></tr>
                      {sec.rows.map(({ r, i }) => (
                        <tr key={i} className={off[i] ? "off" : ""}>
                          <td><input type="checkbox" checked={!off[i]} aria-label={`Reorder ${r.style} ${r.color}`} onChange={(e) => setOff((m) => ({ ...m, [i]: !e.target.checked }))} /></td>
                          <td className="por-style"><span className="por-st">{[r.brand, r.style].filter(Boolean).join(" ") || r.garment || "Garment"}</span><span className="sub">{r.color}</span></td>
                          {Array.from({ length: maxCols }, (_, c) => { const z = sec.cols[c]; const ok = !!z && r.run.includes(z); return (
                            <td key={c}>{ok ? <input type="text" inputMode="numeric" className="por-n" value={sizes[i]?.[z] ?? ""} placeholder={r.last[z] ? String(r.last[z]) : ""} aria-label={`${r.style} ${z}`} disabled={!!off[i]} onChange={(e) => setCell(i, z, e.target.value)} /> : null}</td>
                          ); })}
                          <td className="por-q">{off[i] ? "" : qtyOf(i)}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
              <div className="por-tot">{styles} style{styles === 1 ? "" : "s"} · {total.toLocaleString("en-US")} pcs</div>
            </section>

            <section className="por-sec">
              <div className="por-lbl">Art</div>
              <div className="chips por-seg" role="radiogroup" aria-label="Art">
                <button type="button" role="radio" aria-checked={art === "same"} className={"chip" + (art === "same" ? " on" : "")} onClick={() => setArt("same")}>Same art as last time</button>
                <button type="button" role="radio" aria-checked={art === "new"} className={"chip" + (art === "new" ? " on" : "")} onClick={() => setArt("new")}>I have new art</button>
              </div>
              {art === "same" ? (s.prints.length > 0 && <div className="faint por-prints">{s.prints.join(" · ")}</div>) : (
                <div className={"por-drop" + (over === "art" ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver("art"); }} onDragLeave={() => setOver("")} onDrop={(e) => drop(e, "art")}>
                  <span>Drop your new art here and tell us below where it goes.</span>
                  <button type="button" className="btn sm" onClick={() => artIn.current?.click()}>Choose files</button>
                  <input ref={artIn} type="file" hidden multiple onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) void addArt(fs); }} />
                </div>
              )}
              {files.length > 0 && <ul className="por-files">{files.map((f) => <li key={f.path}><span>{f.name}</span><span className="faint">{f.kind === "art" ? "art" : "sizes"}</span><button type="button" className="por-link" onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))}>Remove</button></li>)}</ul>}
            </section>

            <section className="por-sec por-two">
              <div className="field"><label htmlFor="por-ch">Any changes?</label><textarea id="por-ch" rows={2} value={changes} placeholder="New shirt color, change the year on the back, leave off the back…" onChange={(e) => setChanges(e.target.value)} /></div>
              <div className="field"><label htmlFor="por-nt">Notes for us</label><textarea id="por-nt" rows={2} value={notes} placeholder="Ship to the field house, call Jen when ready…" onChange={(e) => setNotes(e.target.value)} /></div>
              <div className="field por-due"><label htmlFor="por-due">Need it by</label><input id="por-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
              {(s.types || []).length > 0 && <div className="field"><label>{s.typeLabel || "Order type"}</label>
                <div className="so-seg rq-otype" role="radiogroup" aria-label={s.typeLabel || "Order type"} style={{ gridTemplateColumns: `repeat(${(s.types || []).length},minmax(0,1fr))` }}>
                  {(s.types || []).map((k) => <button key={k} type="button" role="radio" aria-checked={otype === k} className={otype === k ? "on" : ""} onClick={() => setOtype(k)}>{k}</button>)}
                </div></div>}
            </section>

            <div className="por-price"><span>Price</span><span><b>TBD</b> <span className="faint">· we&apos;ll confirm it and send it back for your OK</span></span></div>
            {err && <div className="err">{err}</div>}
            {preview && <div className="faint">Preview of the customer&apos;s reorder form: nothing is saved or sent.</div>}
            <div className="por-foot">
              <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
              <button type="button" className="btn primary" disabled={busy || !!reading || preview || ((s.types || []).length > 0 && !otype)} title={(s.types || []).length > 0 && !otype ? `Pick ${(s.types || []).join(" or ")}` : undefined} onClick={() => void send()}>{busy ? "Sending…" : "Send reorder"}</button>
            </div>
          </>}
        </div>
      </div>
    </Overlay>
  );
}
