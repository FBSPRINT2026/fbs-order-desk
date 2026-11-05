"use client";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendSiteRequest, siteUploadUrl, type SiteReq } from "@/app/site/actions";
import { CLIENT_KINDS, NEEDS } from "@/lib/siteContent";

/** The website's request form (app/site/actions.ts does the rest): it lands in the order desk as a customer request. */
type F = { path: string; name: string; mime: string; size: number };

export default function SiteRequestForm({ loginHref }: { loginHref: string }) {
  const t0 = useRef(Date.now());
  const [v, setV] = useState({ name: "", company: "", email: "", phone: "", site: "", kind: "", qty: "", by: "", details: "", website: "" });
  const [needs, setNeeds] = useState<string[]>([]), [files, setFiles] = useState<F[]>([]);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [done, setDone] = useState<number | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setErr(""); setV((x) => ({ ...x, [k]: e.target.value })); };
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setErr("");
    for (const f of Array.from(list).slice(0, 10 - files.length)) {
      setBusy(`Uploading ${f.name}…`);
      const u = await siteUploadUrl(f.name, f.size);
      if (!u.ok) { setErr(u.error); break; }
      const up = await createClient().storage.from("proofs").uploadToSignedUrl(u.path, u.token, f, { contentType: f.type || undefined });
      if (up.error) { setErr(`${f.name} didn't upload. Try again, or send without it.`); break; }
      setFiles((x) => [...x, { path: u.path, name: f.name, mime: f.type, size: f.size }]);
    }
    setBusy("");
  };
  const send = async () => {
    if (!v.name.trim()) return setErr("Enter your name.");
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v.email.trim())) return setErr("Enter an email we can reply to.");
    if (!needs.length && !v.details.trim()) return setErr("Tell us a little about what you need.");
    setBusy("Sending…"); setErr("");
    const r = await sendSiteRequest({ ...v, needs, files, t0: t0.current } as SiteReq);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    setDone(r.number);
  };
  if (done !== null) return (
    <div className="fws-done" role="status">
      <b className="fws-d">Got it, thanks{v.name.trim() ? `, ${v.name.trim().split(/\s+/)[0]}` : ""}.</b>
      <p>Your inquiry{done ? ` #${done}` : ""} is with our team. Someone will reach out to {v.email.trim()}, usually the same business day, with pricing and next steps.</p>
      <p className="fws-faint">Ordered with us before? <a href={loginHref}>Log in to your portal</a> to see it there.</p>
    </div>
  );
  return (
    <form className="fws-form" onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate>
      <h3 className="fws-step fws-d"><span>1</span>About you</h3>
      <div className="fws-grid">
        <label className="fws-f"><span>Name</span><input value={v.name} onChange={set("name")} autoComplete="name" placeholder="Jordan Lee" /></label>
        <label className="fws-f"><span>Email</span><input type="email" value={v.email} onChange={set("email")} autoComplete="email" placeholder="jordan@acme.com" /></label>
        <label className="fws-f"><span>Phone</span><input type="tel" value={v.phone} onChange={set("phone")} autoComplete="tel" placeholder="(214) 555-0100" /></label>
      </div>
      <h3 className="fws-step fws-d"><span>2</span>Your company</h3>
      <div className="fws-grid">
        <label className="fws-f"><span>Company</span><input value={v.company} onChange={set("company")} autoComplete="organization" placeholder="Acme Apparel Co." /></label>
        <label className="fws-f"><span>Website or Instagram</span><input value={v.site} onChange={set("site")} autoComplete="url" placeholder="acmeapparel.com" /></label>
      </div>
      <div className="fws-f"><span id="fws-kind">You are a…</span>
        <div className="fws-chips" role="radiogroup" aria-labelledby="fws-kind">{CLIENT_KINDS.map((k) => {
          const on = v.kind === k;
          return <button type="button" key={k} role="radio" aria-checked={on} className={`fws-chip${on ? " on" : ""}`} onClick={() => setV((x) => ({ ...x, kind: on ? "" : k }))}>{k}</button>;
        })}</div>
      </div>
      <h3 className="fws-step fws-d"><span>3</span>What you need</h3>
      <div className="fws-f"><span id="fws-need">Services</span>
        <div className="fws-chips" role="group" aria-labelledby="fws-need">{NEEDS.map((n) => {
          const on = needs.includes(n);
          return <button type="button" key={n} className={`fws-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setNeeds((x) => (on ? x.filter((y) => y !== n) : [...x, n]))}>{n}</button>;
        })}</div>
      </div>
      <div className="fws-grid">
        <label className="fws-f"><span>About how many</span><input value={v.qty} onChange={set("qty")} placeholder="500 / month" /></label>
        <label className="fws-f"><span>First order by</span><input type="date" value={v.by} onChange={set("by")} /></label>
        <label className="fws-f fws-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files); }}>
          <span>Your logo or art</span>
          <span className="fws-dropbox">{busy.startsWith("Uploading") ? busy : files.length ? `${files.length} file${files.length === 1 ? "" : "s"} added · add more` : "Drop files or choose"}</span>
          <input type="file" multiple onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {files.length > 0 && <ul className="fws-files">{files.map((f) => <li key={f.path}>{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))}>×</button></li>)}</ul>}
      <label className="fws-f"><span>Tell us more</span><textarea rows={4} value={v.details} onChange={set("details")} placeholder="We're launching a line and need blanks sourced and printed monthly…" /></label>
      {/* bots fill this in; people never see it */}
      <label className="fws-hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={set("website")} /></label>
      {err && <div className="fws-err" role="alert">{err}</div>}
      <div className="fws-send">
        <span className="fws-faint">Already a client? <a href={loginHref}>Log in to your portal</a> to order.</span>
        <button type="submit" className="fws-btn p" disabled={!!busy}>{busy === "Sending…" ? "Sending…" : "Send my inquiry"}</button>
      </div>
    </form>
  );
}
