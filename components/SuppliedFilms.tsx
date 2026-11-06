"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Their own separations (Nov 6, Nick: "he gives us the artwork separations… all we have to do is just print directly
 * from his files… a dumb print… literally just sending it to the film printer"). On the order's Art & production tab:
 * upload the separation files the customer sent, then Send to film printer puts each one, exactly as it is, into
 * Dropbox's FILM DIRECT TO PRINT (app/api/films/dropbox), the same hot folder the Separation Studio prints to. Nothing is
 * separated, resized or converted.
 *
 * For any customer who sends films. The files are the order's Production files labeled "Film / separations" (art_files,
 * category film), so they show there too. A customer who has sent films before gets this panel open on every new order
 * (learned from their past orders); for everyone else it waits behind a link.
 */
type F = { id: string; name: string; file_path: string; file_type: string | null; created_at: string };
const PRINTABLE = /\.(pdf|png|tiff?|jpe?g|eps|ai)$/i;

export default function SuppliedFilms({ orderId, orderNumber, customerId, onChanged }: { orderId: string; orderNumber: number; customerId: string | null; onChanged?: () => void }) {
  const sb = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<F[] | null>(null);
  const [usual, setUsual] = useState(false); // this customer has sent their own films before
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const [sent, setSent] = useState<Record<string, string>>({});
  const pick = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const { data } = await sb.from("art_files").select("id, name, file_path, file_type, created_at").eq("order_id", orderId).eq("category", "film").order("name");
    setFiles((data || []) as F[]);
  };
  useEffect(() => { void load(); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!customerId) return;
    void (async () => {
      const { data: os } = await sb.from("orders").select("id").eq("customer_id", customerId).neq("id", orderId).order("created_at", { ascending: false }).limit(60);
      const ids = (os || []).map((x) => x.id as string);
      if (!ids.length) return;
      const { count } = await sb.from("art_files").select("id", { count: "exact", head: true }).in("order_id", ids).eq("category", "film");
      setUsual((count || 0) > 0);
    })();
  }, [customerId, orderId, sb]);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setErr(""); setMsg("");
    for (const f of Array.from(list)) {
      if (!PRINTABLE.test(f.name)) { setErr(`${f.name}: send a PDF, PNG, TIFF, JPG, EPS or AI file.`); continue; }
      setBusy(`Uploading ${f.name}…`);
      const path = `art/${orderId}/films-${crypto.randomUUID().slice(0, 8)}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { setErr(`${f.name} didn't upload: ${up.error.message}`); continue; }
      const { error } = await sb.from("art_files").insert({ order_id: orderId, name: f.name, file_path: path, file_type: f.type || null, category: "film" });
      if (error) setErr(`${f.name}: ${error.message}`);
    }
    setBusy(""); await load(); onChanged?.();
  }

  /** each file to the film printer as it is, in the order listed */
  async function send(only?: F) {
    const list = only ? [only] : files || [];
    if (!list.length) return;
    setErr(""); setMsg("");
    let ok = 0;
    for (const f of list) {
      setBusy(`Sending ${f.name} to the film printer…`);
      try {
        const r = await fetch("/api/films/dropbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: f.file_path, name: `${orderNumber} - ${f.name}` }) });
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(j.error || `the film printer folder said ${r.status}`);
        ok++; setSent((s) => ({ ...s, [f.id]: new Date().toISOString() }));
      } catch (e) { setErr(`${f.name} didn't send: ${e instanceof Error ? e.message : String(e)}`); break; }
    }
    setBusy("");
    if (ok) {
      setMsg(`${ok} film${ok === 1 ? "" : "s"} sent to the film printer.`);
      await sb.from("order_events").insert({ order_id: orderId, kind: "note", detail: `Their separations sent to the film printer: ${list.slice(0, ok).map((f) => f.name).join(", ")}` });
    }
  }
  async function remove(f: F) {
    if (f.file_path.startsWith(`art/${orderId}/`)) await sb.storage.from("proofs").remove([f.file_path]);
    await sb.from("art_files").delete().eq("id", f.id);
    await load(); onChanged?.();
  }

  const has = !!files?.length, show = open || has || usual;
  if (files === null) return null;
  if (!show) return (
    <div className="panel sfl"><div className="panel-b sfl-ask">
      <span className="faint">Customer sent their own separations?</span>
      <button type="button" className="linkbtn" onClick={() => setOpen(true)}>Upload their films</button>
    </div></div>
  );
  return (
    <section className="panel sfl">
      <div className="panel-h"><h2>Their separations</h2><span className="faint">Printed exactly as sent</span></div>
      <div className="panel-b">
        {!has && <p className="faint sfl-p">Upload the separation files the customer sent, one file per screen or one PDF with a page per screen. They go to the film printer as they are: nothing is separated or changed.</p>}
        {has && <ol className="sfl-list">{files!.map((f) => (
          <li key={f.id}>
            <span className="sfl-n" title={f.name}>{f.name}</span>
            {sent[f.id] && <span className="sfl-ok">Sent</span>}
            <button type="button" className="linkbtn" disabled={!!busy} onClick={() => void send(f)}>{sent[f.id] ? "Reprint" : "Print"}</button>
            <button type="button" className="linkbtn sfl-x" disabled={!!busy} aria-label={`Remove ${f.name}`} onClick={() => void remove(f)}>Remove</button>
          </li>
        ))}</ol>}
        <div className="sfl-acts">
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => pick.current?.click()}>{has ? "Add files" : "Upload separations"}</button>
          {has && <button type="button" className="btn primary sm" disabled={!!busy} onClick={() => void send()}>Send {files!.length > 1 ? `all ${files!.length}` : ""} to film printer</button>}
          <input ref={pick} type="file" multiple hidden accept=".pdf,.png,.tif,.tiff,.jpg,.jpeg,.eps,.ai,application/pdf,image/*" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        </div>
        {busy && <div className="faint sfl-p">{busy}</div>}
        {msg && <div className="sfl-msg">{msg}</div>}
        {err && <div className="err">{err}</div>}
        <p className="faint sfl-p">Goes to Dropbox FILM DIRECT TO PRINT, the same folder the Separation Studio prints to, in the order listed. Name the files 1, 2, 3… to set the print order.</p>
      </div>
    </section>
  );
}
