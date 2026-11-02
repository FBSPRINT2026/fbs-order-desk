"use client";
import MenuItem from "@/components/MenuItem";
import { openOrderGoodsForOrder } from "@/components/tools/OrderGoodsTool";
import { useEffect, useRef, useState } from "react";
import type { HelperAction, HelperMsg, HelperOrder } from "@/lib/orderHelperShared";
import { startListening } from "@/components/VoiceDraft";

/**
 * "Ask AI" on the order page (Oct 21, Nick: "you'd click it and it would create a pop-up… what can I help you with?…
 * fill all these in, do this, here's a snip… and it gives you a little status, like the reorder entry"). A window where
 * staff type what to do or paste a snip; the helper (/api/orders/[id]/helper) reads it against the order as it is on
 * screen, asks what it can't tell, and the page makes the changes (with Undo). The conversation stays while the order
 * is open.
 */
type Pic = { media_type: "image/jpeg"; data: string; url: string };
type Step = { label: string; state: "wait" | "doing" | "done" | "error" };
type Msg = HelperMsg & { pics?: string[]; steps?: Step[]; undo?: boolean; error?: boolean; /** shown instead of text (a dropped email's whole text is sent, its subject shown) */ show?: string };

/** a PDF's first pages as pictures to send (an S&S / SanMar confirmation, a PO, a size sheet) */
async function pdfPics(f: Blob): Promise<Pic[]> {
  try {
    const { pdfPictures } = await import("@/lib/printavoArt");
    return (await pdfPictures(await f.arrayBuffer(), 1800, 3)).map((c) => { const d = c.toDataURL("image/jpeg", 0.85); return { media_type: "image/jpeg" as const, data: d.split(",")[1], url: d }; });
  } catch { return []; }
}

/** a picture made small enough to send (longest side 2000px, JPEG) */
async function shrink(f: Blob): Promise<Pic | null> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("bad image")); i.src = url; });
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    const d = c.toDataURL("image/jpeg", 0.88);
    return { media_type: "image/jpeg", data: d.split(",")[1], url: d };
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

export default function OrderHelper({ orderId, snapshot, apply, undo, onChat, onDigitize }: {
  orderId: string;
  /** the Digitizer (components/tools/DigitizerTool.tsx), when the order has embroidery (Oct 27, Nick: "under the AI tools… send for digitizing") */ onDigitize?: () => void;
  /** the Order chat on the right (components/tools/OrderReview.tsx), in this menu (Oct 23, Nick picked "Order chat inside Ask AI") */ onChat?: () => void;
  /** the order as it is on screen */ snapshot: () => HelperOrder | null;
  /** make the changes; returns what was done, line by line */ apply: (a: HelperAction[]) => Promise<string[]>;
  /** put the order back the way it was before the last changes */ undo: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pics0, setPics] = useState<Pic[]>([]);
  const [busy, setBusy] = useState(false);
  const lastPics = useRef<Pic[]>([]);
  const box = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null);
  // the microphone (Nov 1, Nick: "make that something you can talk to"): on until you tap it off; what it hears goes in the box
  const [mic, setMic] = useState<{ on: boolean; err: string }>({ on: false, err: "" });
  const listener = useRef<ReturnType<typeof startListening>>(null);
  const micOn = () => { const l = startListening(text); listener.current = l; if (!l) { setMic({ on: false, err: "" }); return; } l.sub = () => { setText(l.text); setMic({ on: l.on, err: l.err }); }; setMic({ on: true, err: "" }); };
  const micOff = () => { listener.current?.stop(); listener.current = null; setMic({ on: false, err: "" }); };
  const [over, setOver] = useState(false);
  // open on the right like Create order: the left menu folds to icons while it's open
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: true } }));
    return () => { window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: false } })); listener.current?.stop(); };
  }, [open]);
  useEffect(() => { if (open) setTimeout(() => box.current?.focus(), 30); }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open, busy]);

  // pictures and PDFs (Nov 1, Nick: "take a PDF or a snip… just drop it in… if you read a SanMar order confirmation, an
  // S&S order confirmation… you should just immediately ask, do you want me to add these sizes"): a file dropped with
  // nothing typed is sent straight away, and the helper says what it is and asks before changing anything
  async function addFiles(fs: (File | Blob)[]) {
    const out: Pic[] = [], names: string[] = [];
    // an email dragged out of Outlook (a .msg; Nov 1, Nick: "drag in an email from Outlook… tell it like, hey, I read the
    // email. What do you want me to do?"): its words and its attachments, sent straight away; it says what it sees and asks
    const msgFile = fs.find((f) => /\.msg$/i.test((f as File).name || "") || /ms-outlook/i.test(f.type));
    if (msgFile) {
      try {
        const { readMsg } = await import("@/lib/outlookMsg");
        const m = readMsg(await msgFile.arrayBuffer());
        const other: string[] = [];
        for (const a of m.attachments.slice(0, 6)) {
          const b = new Blob([a.data as BlobPart], { type: a.type || (/\.pdf$/i.test(a.name) ? "application/pdf" : "") });
          if (/pdf/i.test(b.type) || /\.pdf$/i.test(a.name)) out.push(...(await pdfPics(b)).slice(0, 3));
          else if (/^image\//.test(b.type) || /\.(png|jpe?g|gif|webp)$/i.test(a.name)) { if (a.data.length < 15_000 && /image0\d+|outlook|logo/i.test(a.name)) continue; const p = await shrink(b); if (p) out.push(p); }
          else other.push(a.name);
        }
        const text = [`Dropped an email from Outlook.`, `From: ${m.from}${m.fromEmail ? ` <${m.fromEmail}>` : ""}`, m.to ? `To: ${m.to}` : "", m.cc ? `Cc: ${m.cc}` : "", `Subject: ${m.subject}`, "", m.body.slice(0, 5000),
          m.attachments.length ? `\nAttachments: ${m.attachments.map((a) => a.name).join(", ")}${other.length ? ` (${other.join(", ")} can't be shown here)` : ""}` : "\nNo attachments."].filter((x) => x !== "").join("\n");
        if (!busy) void send({ pics: out.slice(0, 6), message: text, label: `Dropped an email: ${m.subject || "(no subject)"}${m.attachments.length ? ` · ${m.attachments.length} attachment${m.attachments.length === 1 ? "" : "s"}` : ""}` });
      } catch (e) { setMsgs((ms) => [...ms, { role: "ai", text: e instanceof Error ? e.message : "Couldn't read that email.", error: true }]); }
      return;
    }
    for (const f of fs.slice(0, 4)) {
      const nm = (f as File).name || "";
      if (/pdf/i.test(f.type) || /\.pdf$/i.test(nm)) { const ps = await pdfPics(f); if (ps.length) { out.push(...ps); names.push(nm || "PDF"); } }
      else if (/^image\//.test(f.type)) { const p = await shrink(f); if (p) { out.push(p); names.push(nm || "Snip"); } }
    }
    if (!out.length) return;
    if (!text.trim() && !busy) { void send({ pics: out.slice(0, 6), message: `Dropped: ${names.join(", ")}` }); return; }
    setPics((ps) => [...ps, ...out].slice(0, 6));
  }
  const setLast = (fn: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));
  const stepTo = (n: number, state: Step["state"] = "doing") => setLast((m) => ({ ...m, steps: m.steps?.map((s, i) => ({ ...s, state: i < n ? "done" : i === n ? state : "wait" })) }));

  async function send(o?: { pics?: Pic[]; message?: string; /** what the bubble shows instead of the whole message (a dropped email) */ label?: string }) {
    micOff();
    const message = (o?.message ?? text).trim();
    const pics = o?.pics ?? pics0;
    if ((!message && !pics.length) || busy) return;
    const order = snapshot();
    if (!order) return;
    const thread: HelperMsg[] = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text, images: m.images, done: m.done }));
    const sent = pics;
    // no new picture: the snip from earlier in the conversation goes again, so the helper can still read it
    const again = !sent.length ? lastPics.current : [];
    const steps: Step[] = [
      { label: sent.length || again.length ? "Reading the snip" : "Reading what you asked", state: "doing" },
      { label: "Checking it against the order", state: "wait" },
      { label: "Making the changes", state: "wait" },
      { label: "Checking the totals", state: "wait" },
    ];
    setMsgs((ms) => [...ms.map((m) => ({ ...m, undo: false })), { role: "staff", text: message, show: o?.label, images: sent.length || undefined, pics: sent.map((p) => p.url) }, { role: "ai", text: "", steps }]);
    if (sent.length) lastPics.current = sent;
    setText(""); setPics([]); setBusy(true);
    const t = setTimeout(() => stepTo(1), sent.length ? 7000 : 3500);
    let j: { reply?: string; actions?: HelperAction[]; error?: string } = {};
    try {
      const r = await fetch(`/api/orders/${orderId}/helper`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, images: (sent.length ? sent : again).map((p) => ({ media_type: p.media_type, data: p.data })), picsEarlier: !sent.length && again.length > 0, thread, order }) });
      j = await r.json().catch(() => ({ error: "The helper didn't answer. Try again." }));
      if (!r.ok && !j.error) j.error = "The helper didn't answer. Try again.";
    } catch { j = { error: "Couldn't reach the helper. Check the connection and try again." }; }
    clearTimeout(t);
    if (j.error) { setLast((m) => ({ ...m, text: j.error!, error: true, steps: m.steps?.map((s) => (s.state === "doing" ? { ...s, state: "error" } : s)) })); setBusy(false); return; }
    const acts = j.actions || [];
    if (!acts.length) { setLast((m) => ({ ...m, text: j.reply || "", steps: undefined })); setBusy(false); return; }
    stepTo(2);
    let done: string[] = [];
    try { done = await apply(acts); } catch (e) { setLast((m) => ({ ...m, text: `Couldn't make the changes: ${e instanceof Error ? e.message : String(e)}`, error: true })); setBusy(false); return; }
    stepTo(3);
    await new Promise((r) => setTimeout(r, 350));
    setLast((m) => ({ ...m, text: j.reply || "Done.", done, undo: done.length > 0, steps: m.steps?.map((s) => ({ ...s, state: "done" })) }));
    setBusy(false);
  }

  return (
    <>
      {onChat ? (
        <details className="ot-more" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.open = false; }}>
          <summary className="btn oh-btn">✦ Ask AI ▾</summary>
          <div className="ot-menu">
            <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; onChat(); }} title="The chat on the right: did I get everything right? Say what to change (the order or the art); it stays open while you look around, and it's kept with the order"><MenuItem icon="chat" tone="blue" title="Order chat" sub="Check the order, say what to change" /></button>
            <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setOpen(true); }} title="Tell the AI what to do with this order, or paste a snip of the customer's email"><MenuItem icon="bolt" tone="salmon" title="Quick ask" sub="Paste an email or tell it what to do" /></button>
            {/* Order goods (Oct 23, Nick: "on the order screen where it says Ask AI, you need to add the order goods tool… it's
                all detailed out perfectly in the order itself"): the one Order Goods tool, filled from this order's garments */}
            <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; openOrderGoodsForOrder(orderId); }} title="Buy this order's garments: the Order goods panel on the right, S&S and SanMar side by side; you place it"><MenuItem icon="shirt" tone="orange" title="Order goods" sub="S&amp;S and SanMar side by side" /></button>
            {/* Create DTF gang sheet (Oct 26, Nick; first "Order DTF transfers"): the one Gang sheet builder, filled from this order's heat press prints */}
            {onDigitize && <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; onDigitize(); }} title="Send an embroidered logo to Volikes to be digitized: the email, the digitizing sheet and the original art; you press Send"><MenuItem icon="needle" tone="violet" title="Send for digitizing" sub="Email the logo to Volikes" /></button>}
            <a href={`/shop/gang-sheet/builder?order=${orderId}`} title="Opens the Gang sheet builder with this order's heat press prints: their art (background off), sizes and how many, saved with the order (or this order's sheet if it already has one); you order it from DTF Dallas"><MenuItem icon="grid" tone="green" title="Create DTF gang sheet" sub="The heat press prints on one sheet" /></a>
          </div>
        </details>
      ) : <button type="button" className="btn oh-btn" onClick={() => setOpen(true)} title="Tell the AI what to do with this order, or paste a snip of the customer's email">✦ Ask AI</button>}
      {open && (
        <div className="dla-bg dock" role="dialog" aria-label="Quick ask">
          <div className={"dla oh oh-dock" + (over ? " oh-over" : "")} onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); void addFiles(fs); } }}
            onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
            onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles([...e.dataTransfer.files]); }}>
            <div className="oh-h"><b>✦ Quick ask</b><span className="oh-sp" />
              {msgs.length > 0 && !busy && <button type="button" className="linkbtn" onClick={() => { setMsgs([]); lastPics.current = []; }}>Start over</button>}
              <button type="button" className="qo-x oh-x" onClick={() => setOpen(false)} disabled={busy} aria-label="Close">×</button></div>
            <div className="oh-thread">
              {!msgs.length && <div className="oh-hint">
                <button type="button" className="oh-drop" onClick={() => file.current?.click()}><b>Drop a PDF, a snip, a picture or an email from Outlook</b><span>S&amp;S or SanMar confirmations, POs, size sheets, their email: I&apos;ll say what I see and ask before adding anything</span></button>
                Or talk, paste (Ctrl+V) or type what to do:
                <ul>{["Fill in the sizes from this snip", "Make this order: here's what they want", "Make all the 2XLs $2 more and the 3XLs $2.50", "Set the 1717s to $14 each", "Add a $25 rush fee", "Change the red to cardinal"].map((x) => <li key={x}><button type="button" className="linkbtn" onClick={() => { setText(x); box.current?.focus(); }}>{x}</button></li>)}</ul>
              </div>}
              {msgs.map((m, i) => m.role === "staff" ? (
                <div key={i} className="oh-me">{m.show || m.text}{m.pics?.length ? <div className="oh-pics">{m.pics.map((u, k) => <img key={k} src={u} alt="Snip" />)}</div> : null}</div>
              ) : (
                <div key={i} className={"oh-ai" + (m.error ? " err" : "")}>
                  {m.steps && !m.text && <ol className="qo-steps oh-steps">{m.steps.map((s, k) => <li key={k} className={s.state}><i aria-hidden>{s.state === "done" ? "✓" : s.state === "error" ? "!" : ""}</i><span>{s.label}</span></li>)}</ol>}
                  {m.text && <div className="oh-text">{m.text}</div>}
                  {m.done && m.done.length > 0 && <ul className="oh-done">{m.done.map((d, k) => <li key={k}>{d}</li>)}</ul>}
                  {/* a question: one tap to answer it (yes, or which group) */}
                  {i === msgs.length - 1 && !busy && !m.error && !m.done?.length && /\?/.test(m.text || "") && (() => { const o = snapshot(); const gs = (o?.groups || []).filter((g) => g.lines.length).map((g, k) => g.name || `Group ${k + 1}`); return (
                    <div className="oh-quick">{["Yes, do it", ...gs.map((g) => `Put them on ${g}`), gs.length ? "Make a new group" : "All in one new group", ...(gs.length ? [] : ["A group for each"])].map((q) => <button key={q} type="button" className="chip" onClick={() => void send({ message: q, pics: [] })}>{q}</button>)}</div>); })()}
                  {m.undo && <div className="oh-acts"><button type="button" className="btn sm" onClick={() => { if (undo()) setMsgs((ms) => ms.map((x, k) => (k === i ? { ...x, undo: false, done: [...(x.done || []), "Undone: the order is back the way it was"] } : x))); }}>Undo</button></div>}
                </div>
              ))}
              <div ref={end} />
            </div>
            {pics0.length > 0 && <div className="oh-pics oh-pend">{pics0.map((p, k) => <span key={k}><img src={p.url} alt="Snip to send" /><button type="button" aria-label="Remove" onClick={() => setPics((ps) => ps.filter((_, x) => x !== k))}>×</button></span>)}</div>}
            <div className="oh-box">
              <textarea ref={box} rows={2} value={text} placeholder="Tell me what to do, or paste a snip…" aria-label="Tell the helper what to do"
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              <input ref={file} type="file" accept="image/*,application/pdf,.pdf,.msg" multiple hidden onChange={(e) => { void addFiles([...(e.target.files || [])]); e.target.value = ""; }} />
              <button type="button" className="btn icon ghost" title="Add a PDF or a picture" aria-label="Add a PDF or a picture" onClick={() => file.current?.click()}>📎</button>
              <button type="button" className={"btn icon oh-mic" + (mic.on ? " on" : "")} title={mic.on ? "Stop listening" : "Talk: tap, say what to do, tap again"} aria-label={mic.on ? "Stop listening" : "Talk"} aria-pressed={mic.on} onClick={() => (mic.on ? micOff() : micOn())}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
              </button>
              <button type="button" className="btn primary" disabled={busy || (!text.trim() && !pics0.length)} onClick={() => void send()}>{busy ? "Working…" : "Go"}</button>
            </div>
            {(mic.on || mic.err) && <div className={"oh-listen" + (mic.err ? " err" : "")}>{mic.err || "Listening… tap the mic when you're done, then Go"}</div>}
          </div>
        </div>
      )}
    </>
  );
}
