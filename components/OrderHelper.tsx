"use client";
import { useEffect, useRef, useState } from "react";
import type { HelperAction, HelperMsg, HelperOrder } from "@/lib/orderHelperShared";

/**
 * "Ask AI" on the order page (Oct 21, Nick: "you'd click it and it would create a pop-up… what can I help you with?…
 * fill all these in, do this, here's a snip… and it gives you a little status, like the reorder entry"). A window where
 * staff type what to do or paste a snip; the helper (/api/orders/[id]/helper) reads it against the order as it is on
 * screen, asks what it can't tell, and the page makes the changes (with Undo). The conversation stays while the order
 * is open.
 */
type Pic = { media_type: "image/jpeg"; data: string; url: string };
type Step = { label: string; state: "wait" | "doing" | "done" | "error" };
type Msg = HelperMsg & { pics?: string[]; steps?: Step[]; undo?: boolean; error?: boolean };

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

export default function OrderHelper({ orderId, snapshot, apply, undo, onChat }: {
  orderId: string;
  /** the Order chat on the right (components/tools/OrderReview.tsx), in this menu (Oct 23, Nick picked "Order chat inside Ask AI") */ onChat?: () => void;
  /** the order as it is on screen */ snapshot: () => HelperOrder | null;
  /** make the changes; returns what was done, line by line */ apply: (a: HelperAction[]) => Promise<string[]>;
  /** put the order back the way it was before the last changes */ undo: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pics, setPics] = useState<Pic[]>([]);
  const [busy, setBusy] = useState(false);
  const lastPics = useRef<Pic[]>([]);
  const box = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) setTimeout(() => box.current?.focus(), 30); }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open, busy]);

  async function addFiles(fs: (File | Blob)[]) {
    const out: Pic[] = [];
    for (const f of fs.filter((x) => /^image\//.test(x.type)).slice(0, 4)) { const p = await shrink(f); if (p) out.push(p); }
    if (out.length) setPics((ps) => [...ps, ...out].slice(0, 4));
  }
  const setLast = (fn: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));
  const stepTo = (n: number, state: Step["state"] = "doing") => setLast((m) => ({ ...m, steps: m.steps?.map((s, i) => ({ ...s, state: i < n ? "done" : i === n ? state : "wait" })) }));

  async function send() {
    const message = text.trim();
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
    setMsgs((ms) => [...ms.map((m) => ({ ...m, undo: false })), { role: "staff", text: message, images: sent.length || undefined, pics: sent.map((p) => p.url) }, { role: "ai", text: "", steps }]);
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
            <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; onChat(); }} title="The chat on the right: did I get everything right? Say what to change (the order or the art); it stays open while you look around, and it's kept with the order">Order chat</button>
            <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setOpen(true); }} title="Tell the AI what to do with this order, or paste a snip of the customer's email">Quick ask (or paste an email)</button>
            {/* Order goods (Oct 23, Nick: "on the order screen where it says Ask AI, you need to add the order goods tool… it's
                all detailed out perfectly in the order itself"): the one Order Goods tool, filled from this order's garments */}
            <a href={`/shop/order-goods?order=${orderId}`} title="Buy this order's garments from S&S: styles, colors and sizes filled in from the order and checked with S&S; you place it">Order goods</a>
            {/* Create DTF gang sheet (Oct 26, Nick; first "Order DTF transfers"): the one Gang sheet builder, filled from this order's heat press prints */}
            <a href={`/shop/gang-sheet/builder?order=${orderId}`} title="Opens the Gang sheet builder with this order's heat press prints: their art (background off), sizes and how many, saved with the order (or this order's sheet if it already has one); you order it from DTF Dallas">Create DTF gang sheet</a>
          </div>
        </details>
      ) : <button type="button" className="btn oh-btn" onClick={() => setOpen(true)} title="Tell the AI what to do with this order, or paste a snip of the customer's email">✦ Ask AI</button>}
      {open && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Order helper" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
          <div className="dla oh" onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); void addFiles(fs); } }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles([...e.dataTransfer.files]); }}>
            <div className="oh-h"><b>✦ What can I help you with?</b><span className="oh-sp" />
              {msgs.length > 0 && !busy && <button type="button" className="linkbtn" onClick={() => { setMsgs([]); lastPics.current = []; }}>Start over</button>}
              <button type="button" className="qo-x oh-x" onClick={() => setOpen(false)} disabled={busy} aria-label="Close">×</button></div>
            <div className="oh-thread">
              {!msgs.length && <div className="oh-hint">
                Paste a snip (Ctrl+V), drop a screenshot, or tell me what to do:
                <ul>{["Fill in the sizes from this snip", "Make this order: here's what they want", "Make all the 2XLs $2 more and the 3XLs $2.50", "Set the 1717s to $14 each", "Add a $25 rush fee", "Change the red to cardinal"].map((x) => <li key={x}><button type="button" className="linkbtn" onClick={() => { setText(x); box.current?.focus(); }}>{x}</button></li>)}</ul>
              </div>}
              {msgs.map((m, i) => m.role === "staff" ? (
                <div key={i} className="oh-me">{m.text}{m.pics?.length ? <div className="oh-pics">{m.pics.map((u, k) => <img key={k} src={u} alt="Snip" />)}</div> : null}</div>
              ) : (
                <div key={i} className={"oh-ai" + (m.error ? " err" : "")}>
                  {m.steps && !m.text && <ol className="qo-steps oh-steps">{m.steps.map((s, k) => <li key={k} className={s.state}><i aria-hidden>{s.state === "done" ? "✓" : s.state === "error" ? "!" : ""}</i><span>{s.label}</span></li>)}</ol>}
                  {m.text && <div className="oh-text">{m.text}</div>}
                  {m.done && m.done.length > 0 && <ul className="oh-done">{m.done.map((d, k) => <li key={k}>{d}</li>)}</ul>}
                  {m.undo && <div className="oh-acts"><button type="button" className="btn sm" onClick={() => { if (undo()) setMsgs((ms) => ms.map((x, k) => (k === i ? { ...x, undo: false, done: [...(x.done || []), "Undone: the order is back the way it was"] } : x))); }}>Undo</button></div>}
                </div>
              ))}
              <div ref={end} />
            </div>
            {pics.length > 0 && <div className="oh-pics oh-pend">{pics.map((p, k) => <span key={k}><img src={p.url} alt="Snip to send" /><button type="button" aria-label="Remove" onClick={() => setPics((ps) => ps.filter((_, x) => x !== k))}>×</button></span>)}</div>}
            <div className="oh-box">
              <textarea ref={box} rows={2} value={text} placeholder="Tell me what to do, or paste a snip…" aria-label="Tell the helper what to do"
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles([...(e.target.files || [])]); e.target.value = ""; }} />
              <button type="button" className="btn icon ghost" title="Add a picture" aria-label="Add a picture" onClick={() => file.current?.click()}>🖼</button>
              <button type="button" className="btn primary" disabled={busy || (!text.trim() && !pics.length)} onClick={() => void send()}>{busy ? "Working…" : "Go"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
