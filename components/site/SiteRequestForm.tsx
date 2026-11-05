"use client";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendSiteRequest, siteUploadUrl, type SiteReq } from "@/app/site/actions";
import { NEEDS } from "@/lib/siteContent";

/** The website's request form (app/site/actions.ts does the rest): it lands in the order desk as a customer request. */
type F = { path: string; name: string; mime: string; size: number };

export default function SiteRequestForm({ loginHref }: { loginHref: string }) {
  const t0 = useRef(Date.now());
  const [v, setV] = useState({ name: "", company: "", email: "", phone: "", qty: "", by: "", details: "", website: "" });
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
      <p>Your request{done ? ` #${done}` : ""} is with our order desk. We'll email {v.email.trim()} with a quote and a proof, usually the same business day.</p>
      <p className="fws-faint">Ordered with us before? <a href={loginHref}>Log in to your portal</a> to see it there.</p>
    </div>
  );
  return (
    <form className="fws-form" onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate>
      <div className="fws-grid">
        <label className="fws-f"><span>Name</span><input value={v.name} onChange={set("name")} autoComplete="name" placeholder="Jordan Lee" /></label>
        <label className="fws-f"><span>Company or group</span><input value={v.company} onChange={set("company")} autoComplete="organization" placeholder="Acme Brewing" /></label>
        <label className="fws-f"><span>Email</span><input type="email" value={v.email} onChange={set("email")} autoComplete="email" placeholder="jordan@acme.com" /></label>
        <label className="fws-f"><span>Phone</span><input type="tel" value={v.phone} onChange={set("phone")} autoComplete="tel" placeholder="(214) 555-0100" /></label>
      </div>
      <div className="fws-f"><span id="fws-need">What is it?</span>
        <div className="fws-chips" role="group" aria-labelledby="fws-need">{NEEDS.map((n) => {
          const on = needs.includes(n);
          return <button type="button" key={n} className={`fws-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setNeeds((x) => (on ? x.filter((y) => y !== n) : [...x, n]))}>{n}</button>;
        })}</div>
      </div>
      <div className="fws-grid">
        <label className="fws-f"><span>About how many</span><input inputMode="numeric" value={v.qty} onChange={set("qty")} placeholder="150" /></label>
        <label className="fws-f"><span>Need it by</span><input type="date" value={v.by} onChange={set("by")} /></label>
        <label className="fws-f fws-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files); }}>
          <span>Your logo or art</span>
          <span className="fws-dropbox">{busy.startsWith("Uploading") ? busy : files.length ? `${files.length} file${files.length === 1 ? "" : "s"} added · add more` : "Drop files or choose"}</span>
          <input type="file" multiple onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {files.length > 0 && <ul className="fws-files">{files.map((f) => <li key={f.path}>{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))}>×</button></li>)}</ul>}
      <label className="fws-f"><span>Details</span><textarea rows={4} value={v.details} onChange={set("details")} placeholder="Left chest logo and a full back, two colors on heather gray tees. Sizes S–2XL." /></label>
      {/* bots fill this in; people never see it */}
      <label className="fws-hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={set("website")} /></label>
      {err && <div className="fws-err" role="alert">{err}</div>}
      <div className="fws-send">
        <span className="fws-faint">Have an account? <a href={loginHref}>Log in</a> and order in your portal instead.</span>
        <button type="submit" className="fws-btn p" disabled={!!busy}>{busy === "Sending…" ? "Sending…" : "Send my request"}</button>
      </div>
    </form>
  );
}
