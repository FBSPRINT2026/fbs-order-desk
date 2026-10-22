"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CcField from "@/components/CcField";
import { sendNewEmail } from "@/app/shop/mail-actions";

/**
 * New email (Oct 22, Nick: "How do you send a new email in the email client?"): To (customers and their contacts are
 * suggested as you type), Cc, a subject, the message and files. It goes from your own mailbox with your signature
 * underneath (app/shop/mail-actions.ts sendNewEmail), so it's in your Outlook Sent Items too. Files are uploaded to
 * storage first (proofs/mail-out/…) and sent from there.
 */
type Hit = { email: string; label: string };
type Up = { path: string; name: string; type: string; size: number };

export default function NewEmail({ onClose, onSent, to: to0 = "" }: { onClose: () => void; onSent: (msg: string) => void; to?: string }) {
  const [to, setTo] = useState(to0);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Up[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // customers and their contacts that match what's being typed in To (the last address in the box)
  const last = to.split(/[,;]/).pop()?.trim() || "";
  useEffect(() => {
    if (last.length < 2 || /@.+\./.test(last)) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const sb = createClient(), like = `%${last.replace(/[%_,()]/g, "")}%`;
      const [{ data: cs }, { data: ct }] = await Promise.all([
        sb.from("customers").select("company, name, email").or(`email.ilike.${like},company.ilike.${like},name.ilike.${like}`).neq("email", "").limit(8),
        sb.from("customer_contacts").select("name, email, customers(company)").or(`email.ilike.${like},name.ilike.${like}`).neq("email", "").limit(8),
      ]);
      if (!live) return;
      const out: Hit[] = [];
      for (const c of (cs || []) as { company: string | null; name: string | null; email: string | null }[]) if (c.email) out.push({ email: c.email, label: [c.name, c.company].filter(Boolean).join(" · ") });
      for (const c of (ct || []) as unknown as { name: string | null; email: string | null; customers: { company: string | null } | null }[]) if (c.email) out.push({ email: c.email, label: [c.name, c.customers?.company].filter(Boolean).join(" · ") });
      setHits(out.filter((h, i) => out.findIndex((x) => x.email.toLowerCase() === h.email.toLowerCase()) === i).slice(0, 8));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [last]);
  const pickHit = (h: Hit) => {
    const parts = to.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    parts.pop();
    setTo([...parts, h.email].join(", ") + ", ");
    setHits([]);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const sb = createClient();
    for (const f of Array.from(list).slice(0, 15)) {
      if (f.size > 20_000_000) { setErr(`${f.name} is over 20 MB.`); continue; }
      setUploading((n) => n + 1);
      const path = `mail-out/${crypto.randomUUID()}/${f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file"}`;
      const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
      setUploading((n) => n - 1);
      if (error) setErr(`Couldn't attach ${f.name}: ${error.message}`);
      else setFiles((fs) => [...fs, { path, name: f.name, type: f.type || "", size: f.size }]);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    setBusy(true); setErr("");
    const r = await sendNewEmail({ to, cc: cc.join(", "), subject, body, files: files.map(({ path, name, type }) => ({ path, name, type })) });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onSent(`Sent to ${r.to.join(", ")}.`);
  };

  return (
    <div className="panel ne-panel" role="dialog" aria-label="New email">
      <div className="panel-h"><h2>New email</h2><span className="faint">From your mailbox, with your signature underneath</span></div>
      <div className="panel-b ibx2-compose open ne-box">
        <div className="ibx2-to ne-to">
          <span>To</span>
          <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="Name or email address" aria-label="To" autoComplete="off" />
          {hits.length > 0 && <div className="ne-hits" role="listbox">{hits.map((h) => <button key={h.email} type="button" role="option" aria-selected={false} onClick={() => pickHit(h)}><b>{h.email}</b>{h.label && <span className="faint"> · {h.label}</span>}</button>)}</div>}
        </div>
        <CcField value={cc} onChange={setCc} text={body} />
        <div className="ibx2-to"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What it's about" aria-label="Subject" /></div>
        <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your email" aria-label="Message" />
        {(files.length > 0 || uploading > 0) && <div className="ne-files">
          {files.map((f) => <span key={f.path} className="ne-file">{f.name} <span className="faint">{f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
            <button type="button" className="linkbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.path !== f.path))}>Remove</button></span>)}
          {uploading > 0 && <span className="faint">Attaching {uploading} file{uploading === 1 ? "" : "s"}…</span>}
        </div>}
        {err && <div className="pv-err">{err}</div>}
        <div className="ibx2-send">
          <button type="button" className="btn primary" disabled={busy || uploading > 0 || !to.trim() || !subject.trim()} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</button>
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>Attach files</button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
          <span className="spacer" />
          <button type="button" className="btn sm ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
