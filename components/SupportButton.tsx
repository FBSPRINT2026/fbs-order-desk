"use client";
/**
 * "Report an issue" (shop menu, everyone on staff): a screenshot of the page as it is right now, plus what went wrong,
 * typed or dictated, saved for the owner's Support page (Nick, Oct 7 2026). The screenshot comes from the browser's own
 * tab capture (Chrome / Edge ask once: "Share this tab"), so it shows exactly what was on screen, canvases and all;
 * if that's turned down, a picture can be pasted or attached instead.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MicButton } from "@/components/SearchInput";
import { useRole } from "@/components/RoleContext";
import { customerSupport, supportUploadUrl } from "@/app/portal/support-actions";

async function grabTab(): Promise<Blob | null> {
  const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (o: object) => Promise<MediaStream> };
  if (!md?.getDisplayMedia) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await md.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" });
    const v = document.createElement("video"); v.srcObject = stream; v.muted = true; await v.play();
    // the first frame can be blank: give it a moment
    await new Promise((r) => setTimeout(r, 350));
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    return await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
  } catch { return null; } finally { stream?.getTracks().forEach((t) => t.stop()); }
}

/**
 * Phones and Safari (no tab capture, Oct 12: Amanda's report came in with no screenshot): the menu closes, then the page
 * is drawn into a picture right in the browser (html-to-image, loaded on first use). Emails shown inside a frame come
 * out blank; a screenshot from Photos can be attached instead.
 */
async function drawPage(): Promise<Blob | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const load = (src: string) => new Promise<void>((res, rej) => { const sc = document.createElement("script"); sc.src = src; sc.onload = () => res(); sc.onerror = () => rej(new Error(src)); document.head.appendChild(sc); });
  const x = window.scrollX, y = window.scrollY, W = window.innerWidth, Ht = window.innerHeight;
  const bg = getComputedStyle(document.body).backgroundColor || "#fff";
  const skip = (n: HTMLElement) => !(n.classList && (n.classList.contains("sup-back") || n.classList.contains("ch-fx")));
  const style = { transform: `translate(${-x}px, ${-y}px)`, transformOrigin: "top left" };
  // html-to-image first, dom-to-image-more if that one can't load
  try {
    if (!w.htmlToImage) await load("https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js");
    if (w.htmlToImage?.toBlob) return await w.htmlToImage.toBlob(document.body, { width: W, height: Ht, pixelRatio: Math.min(2, window.devicePixelRatio || 1), backgroundColor: bg, style, filter: skip });
  } catch { /* try the other */ }
  try {
    if (!w.domtoimage) await load("https://cdn.jsdelivr.net/npm/dom-to-image-more@3.4.0/dist/dom-to-image-more.min.js");
    if (w.domtoimage?.toBlob) return await w.domtoimage.toBlob(document.body, { width: W, height: Ht, bgcolor: bg, style, filter: skip });
  } catch { /* no picture */ }
  return null;
}

/** `portal`: a customer's "Get help" in their portal (Oct 24): saved for them by the server, under Customers on Support */
export default function SupportButton({ email, portal = false }: { email: string; portal?: boolean }) {
  const sb = useMemo(() => createClient(), []);
  const { role, viewAs } = useRole();
  const [open, setOpen] = useState(false), [shot, setShot] = useState<Blob | null>(null), [url, setUrl] = useState("");
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState(""), [done, setDone] = useState(false);
  const page = useRef({ href: "", title: "" });
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!shot) { setUrl(""); return; } const u = URL.createObjectURL(shot); setUrl(u); return () => URL.revokeObjectURL(u); }, [shot]);

  async function start() {
    page.current = { href: location.href, title: document.title };
    setErr(""); setDone(false); setText(""); setShot(null); setBusy("Taking a screenshot…");
    // the screenshot first (the box isn't open yet, so it shows the page as it is). Phones: the menu closes first,
    // then the page is drawn into a picture
    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: unknown };
    let b: Blob | null = null;
    if (md?.getDisplayMedia && !window.matchMedia("(pointer: coarse)").matches) b = await grabTab();
    else { window.dispatchEvent(new Event("fbs:close-menu")); await new Promise((r) => setTimeout(r, 450)); b = await drawPage(); }
    setShot(b); setBusy(""); setOpen(true);
  }
  // a picture pasted in (Win+Shift+S, then Ctrl+V) instead
  function onPaste(e: React.ClipboardEvent) {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); setShot(f); }
  }
  async function send() {
    if (!text.trim() && !shot) return;
    setBusy("Sending…"); setErr("");
    try {
      let path: string | null = null;
      if (portal) {
        if (shot) {
          const t = await supportUploadUrl(shot.type === "image/png");
          if (!t.ok) throw new Error(t.error);
          const u = await sb.storage.from("proofs").uploadToSignedUrl(t.path, t.token, shot, { contentType: shot.type || "image/jpeg" });
          if (u.error) throw new Error(u.error.message);
          path = t.path;
        }
        const r = await customerSupport({ message: text, page: page.current.href, title: page.current.title, screenshot: path, context: { browser: navigator.userAgent, screen: `${innerWidth}×${innerHeight}` } });
        if (!r.ok) throw new Error(r.error);
        setDone(true);
        setTimeout(() => setOpen(false), 2200);
        setBusy("");
        return;
      }
      if (shot) {
        path = `support/${Date.now()}-${email.replace(/[^\w.-]+/g, "_")}.${shot.type === "image/png" ? "png" : "jpg"}`;
        const u = await sb.storage.from("proofs").upload(path, shot, { contentType: shot.type || "image/jpeg", upsert: false });
        if (u.error) throw new Error(u.error.message);
      }
      const r = await sb.from("support_issues").insert({
        by: email, page: page.current.href, page_title: page.current.title, message: text.trim(), screenshot: path,
        context: { role, viewAs: viewAs || null, browser: navigator.userAgent, screen: `${innerWidth}×${innerHeight}` },
      });
      if (r.error) throw new Error(/support_issues/.test(r.error.message) ? "Support isn't set up in the database yet (ask Nick to add the support table)." : r.error.message);
      setDone(true);
      setTimeout(() => setOpen(false), 1600);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }

  return (
    <>
      {portal ? (
        <button type="button" className="btn sm p-help" onClick={start} disabled={!!busy && !open} aria-label="Get help: send us a screenshot and what's wrong">
          <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" /></svg>
          {busy && !open ? busy : "Get help"}
        </button>
      ) : (
      <button type="button" className="nav-support" onClick={start} disabled={!!busy && !open} data-tip="Report an issue" aria-label="Report an issue: send a screenshot and what happened">
        <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" /></svg>
        <span className="lbl-t">{busy && !open ? busy : "Report an issue"}</span>
      </button>
      )}
      {open && (
        <div className="sup-back" role="dialog" aria-modal="true" aria-label="Report an issue" onPaste={onPaste}>
          <div className="sup-box">
            <h3>{portal ? "Get help" : "Report an issue"}</h3>
            {done ? <p className="sep-ok">{portal ? "Sent. We'll take a look and get back to you in Messages. Thanks!" : "Sent. Nick will see it on the Support page. Thanks!"}</p> : <>
              {url ? <img className="sup-shot" src={url} alt="Screenshot of the page" /> : <div className="sup-noshot faint">No screenshot. <label className="linkbtn">Attach one from your Photos<input type="file" accept="image/*" hidden onChange={(e) => setShot(e.target.files?.[0] || null)} /></label>, paste one here (Windows: Win+Shift+S, then Ctrl+V), or <button type="button" className="linkbtn" onClick={async () => { setOpen(false); await new Promise((r) => setTimeout(r, 300)); const b = (await drawPage()) || (await grabTab()); setShot(b); setOpen(true); }}>try again</button>.</div>}
              {url && <label className="linkbtn" style={{ fontSize: 12 }}>Use a screenshot from Photos instead<input type="file" accept="image/*" hidden onChange={(e) => setShot(e.target.files?.[0] || null)} /></label>}
              {url && <div className="faint" style={{ fontSize: 12 }}>Wrong picture? <button type="button" className="linkbtn" onClick={() => setShot(null)}>Remove it</button></div>}
              <div className="sc-in">
                <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus placeholder={portal ? "What's going wrong? e.g. the Mockup Creator won't save my shirt (click the mic to talk)" : "What happened? What did you expect? (click the mic to talk)"} aria-label="What happened" />
                <MicButton target={() => ta.current} append keepListening label="Say what happened (microphone)" className="sc-mic" />
              </div>
              <div className="faint" style={{ fontSize: 12 }} data-notranslate>{page.current.title || page.current.href}</div>
              {err && <div className="pv-err">{err}</div>}
              <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="btn primary" disabled={!!busy || (!text.trim() && !shot)} onClick={send}>{busy || "Send"}</button>
              </div>
            </>}
          </div>
        </div>
      )}
    </>
  );
}
