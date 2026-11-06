"use client";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendSiteRequest, siteUploadUrl, type SiteReq } from "@/app/site/actions";
import { CLIENT_KINDS, MONTHLY, NEEDS } from "@/lib/siteContent";

/**
 * The website's inquiry form (app/site/actions.ts does the rest): it lands in the Job Center's Leads → Website submissions. It starts by
 * asking why they're here, a quote for an order they have ready or a new account (Nov 5, Nick: "there are two types of
 * people that reach out on the site"), and asks only what that one needs, with dropdowns in place of rows of bubbles.
 */
type F = { path: string; name: string; mime: string; size: number };

export default function SiteRequestForm({ loginHref }: { loginHref: string }) {
  const t0 = useRef(Date.now());
  const [v, setV] = useState({ name: "", company: "", email: "", phone: "", site: "", kind: "", need: "", garment: "", monthly: "", qty: "", by: "", details: "", website: "" });
  const [intent, setIntent] = useState<"quote" | "account">("quote");
  const [files, setFiles] = useState<F[]>([]);
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
    if (intent === "quote" && !v.need && !v.details.trim()) return setErr("Pick what you need, or tell us about the order.");
    if (intent === "account" && !v.kind && !v.details.trim()) return setErr("Tell us what kind of business you are.");
    setBusy("Sending…"); setErr("");
    const quote = intent === "quote";
    const r = await sendSiteRequest({ ...v, intent, kind: quote ? "" : v.kind, site: quote ? "" : v.site, monthly: quote ? "" : v.monthly, garment: quote ? v.garment : "", qty: quote ? v.qty : "", by: quote ? v.by : "",
      needs: quote && v.need ? [v.need] : [], files: quote ? files : [], t0: t0.current } as SiteReq);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    setDone(r.number);
  };
  if (done !== null) return (
    <div className="fws-done" role="status">
      <b className="fws-d">Got it, thanks{v.name.trim() ? `, ${v.name.trim().split(/\s+/)[0]}` : ""}.</b>
      <p>Your {intent === "quote" ? "quote request" : "inquiry"}{done ? ` #${done}` : ""} is with our team. Someone will reach out to {v.email.trim()}, usually the same business day, {intent === "quote" ? "with your quote" : "to get your account set up"}.</p>
      <p className="fws-faint">Ordered with us before? <a href={loginHref}>Log in to your portal</a> to see it there.</p>
    </div>
  );
  return (
    <form className="fws-form" onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate>
      <div className="fws-f"><span id="fws-why">What brings you here?</span>
        <div className="fws-why" role="radiogroup" aria-labelledby="fws-why">
          {([["quote", "Get a quote", "I have an order ready to price"], ["account", "Set up an account", "Wholesale, reseller, brand or school"]] as const).map(([k, t, d]) => (
            <button type="button" key={k} role="radio" aria-checked={intent === k} className={intent === k ? "on" : ""} onClick={() => { setErr(""); setIntent(k); }}><b>{t}</b><span>{d}</span></button>
          ))}
        </div>
      </div>
      <h3 className="fws-step fws-d"><span>1</span>About you</h3>
      <div className="fws-grid">
        <label className="fws-f"><span>Name</span><input value={v.name} onChange={set("name")} autoComplete="name" placeholder="Jordan Lee" /></label>
        <label className="fws-f"><span>Email</span><input type="email" value={v.email} onChange={set("email")} autoComplete="email" placeholder="jordan@acme.com" /></label>
        <label className="fws-f"><span>Phone</span><input type="tel" value={v.phone} onChange={set("phone")} autoComplete="tel" placeholder="(214) 555-0100" /></label>
        <label className="fws-f"><span>Company</span><input value={v.company} onChange={set("company")} autoComplete="organization" placeholder="Acme Apparel Co." /></label>
      </div>
      {intent === "quote" ? <>
        <h3 className="fws-step fws-d"><span>2</span>Your order</h3>
        <div className="fws-grid">
          <label className="fws-f"><span>What you need</span><select value={v.need} onChange={set("need")}><option value="">Choose one</option>{NEEDS.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label className="fws-f"><span>How many</span><input value={v.qty} onChange={set("qty")} inputMode="numeric" placeholder="144" /></label>
          <label className="fws-f"><span>Needed by</span><input type="date" value={v.by} onChange={set("by")} /></label>
        </div>
        <div className="fws-grid">
          <label className="fws-f"><span>Garment</span><input value={v.garment} onChange={set("garment")} placeholder="Black tees, Comfort Colors 1717" /></label>
          <label className="fws-f fws-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files); }}>
            <span>Your logo or art</span>
            <span className="fws-dropbox">{busy.startsWith("Uploading") ? busy : files.length ? `${files.length} file${files.length === 1 ? "" : "s"} added · add more` : "Drop files or choose"}</span>
            <input type="file" multiple onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {files.length > 0 && <ul className="fws-files">{files.map((f) => <li key={f.path}>{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))}>×</button></li>)}</ul>}
      </> : <>
        <h3 className="fws-step fws-d"><span>2</span>Your business</h3>
        <div className="fws-grid">
          <label className="fws-f"><span>You are a…</span><select value={v.kind} onChange={set("kind")}><option value="">Choose one</option>{CLIENT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="fws-f"><span>Website or Instagram</span><input value={v.site} onChange={set("site")} autoComplete="url" placeholder="acmeapparel.com" /></label>
          <label className="fws-f"><span>About how many a month</span><select value={v.monthly} onChange={set("monthly")}><option value="">Choose one</option>{MONTHLY.map((m) => <option key={m}>{m}</option>)}</select></label>
        </div>
      </>}
      <label className="fws-f"><span>{intent === "quote" ? "Print locations and details" : "Tell us about your business"}</span><textarea rows={4} value={v.details} onChange={set("details")} placeholder={intent === "quote" ? "Front left chest 1 color, full back 3 colors…" : "We sell to corporate clients and need a blind-ship contract printer…"} /></label>
      {/* bots fill this in; people never see it */}
      <label className="fws-hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={set("website")} /></label>
      {err && <div className="fws-err" role="alert">{err}</div>}
      <div className="fws-send">
        <span className="fws-faint">Already a client? <a href={loginHref}>Log in to your portal</a> to order.</span>
        <button type="submit" className="fws-btn p" disabled={!!busy}>{busy === "Sending…" ? "Sending…" : intent === "quote" ? "Get my quote" : "Start my account"}</button>
      </div>
    </form>
  );
}
