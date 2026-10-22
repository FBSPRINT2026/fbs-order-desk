"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MicButton } from "@/components/SearchInput";
import { renderMockup } from "@/lib/mockupRender";
import { METHODS, FULL_COLOR, sizeLabel } from "@/lib/pricing";
import { createQuote, getChat, listChats, mockupTargets, saveMockups, searchCustomers, uploadTarget, type ChatRow } from "@/app/shop/ai/actions";
import { isArtDoc, isArtPicture, type WBCard, type WBEvent, type WBFile, type WBMockItem, type WBMsg } from "@/lib/ai/workbenchShared";

/**
 * AI Workbench (Oct 13, Nick: "upload two logos and say make me mockups in these different colors, or here's a
 * spreadsheet, input this as an order… just an AI tool where you can knock stuff out"). A chat with the AI: drop in
 * files, ask, and it answers, looks things up, draws mockups and puts orders together as cards. Nothing is created
 * until someone clicks a card's button.
 */
type Up = WBFile & { busy?: boolean; err?: string; local?: string; note?: string };
/** files that aren't pictures but are art (or photos the AI can't open): a PNG of them is made in the browser */
const needsPicture = (f: File) => !isArtPicture({ type: f.type, name: f.name || "" }) && (isArtDoc({ type: f.type, name: f.name || "" }) || /heic|heif|tiff|bmp/i.test(f.type) || /\.(heic|heif|tiff?|bmp)$/i.test(f.name));
/** an .ai / EPS / PDF already in the chat with no picture yet: one made now, once per file */
const docPics = new Map<string, Promise<string>>();
function docPicture(url: string, name: string) {
  const key = url.split("?")[0];
  if (!docPics.has(key)) docPics.set(key, (async () => {
    const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error("Couldn't open the art"))));
    const pv = await pictureOf(new File([blob], name, { type: blob.type }));
    if (!pv) throw new Error("No picture could be made of the art");
    return URL.createObjectURL(pv);
  })());
  return docPics.get(key)!;
}
async function pictureOf(f: File): Promise<File | null> {
  const { makePreview } = await import("@/lib/artPrep");
  // .ai files are PDFs inside when saved "PDF compatible" (Illustrator's default); older ones are PostScript like EPS
  const pv = await makePreview(/\.ai$/i.test(f.name) ? new File([f], f.name, { type: "application/pdf" }) : f).catch(() => null);
  if (pv || !/\.ai$/i.test(f.name)) return pv;
  return makePreview(new File([f], f.name.replace(/\.ai$/i, ".eps"), { type: "application/postscript" })).catch(() => null);
}
const STARTERS = [
  "Make mockups of this logo on a Gildan 5000 in black, navy, red and sport grey",
  "Here's a spreadsheet: put it in as an order for ",
  "What did this customer order last time? ",
  "Look up the PMS colors for ",
];
const when = (t: string) => { const d = new Date(t); const today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const plain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,4}\s+/gm, "");

export default function AiWorkbench({ name }: { name: string }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [chatId, setChatId] = useState(""), [msgs, setMsgs] = useState<WBMsg[]>([]);
  const [text, setText] = useState(""), [files, setFiles] = useState<Up[]>([]);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [live, setLive] = useState<{ text: string[]; cards: WBCard[] } | null>(null);
  const [err, setErr] = useState(""), [drag, setDrag] = useState(false), [showList, setShowList] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null), pick = useRef<HTMLInputElement>(null), end = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => { const r = await listChats(); if (r.ok) setChats(r.chats); else setErr(r.error); }, []);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length, live?.text.length, live?.cards.length, status]);

  const open = async (id: string) => {
    setErr(""); setShowList(false);
    const r = await getChat(id);
    if (!r.ok) { setErr(r.error); return; }
    setChatId(r.id); setMsgs(r.messages); setLive(null);
  };
  const fresh = () => { setChatId(""); setMsgs([]); setLive(null); setErr(""); setShowList(false); setTimeout(() => box.current?.focus(), 0); };

  async function addFiles(list: FileList | File[]) {
    const arr = Array.from(list).slice(0, 12);
    const set = (id: string, ch: Partial<Up>) => setFiles((x) => x.map((y) => (y.id === id ? { ...y, ...ch } : y)));
    for (const f of arr) {
      const tmp: Up = { id: Math.random().toString(36).slice(2), path: "", name: f.name || "pasted.png", type: f.type, size: f.size, busy: true, local: isArtPicture({ type: f.type, name: f.name || "" }) ? URL.createObjectURL(f) : "" };
      setFiles((x) => [...x, tmp]);
      const t = await uploadTarget(tmp.name, f.size);
      if (!t.ok) { set(tmp.id, { busy: false, err: t.error }); continue; }
      const up = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
      if (up.error) { set(tmp.id, { busy: false, err: up.error.message }); continue; }
      set(tmp.id, { path: t.path, note: needsPicture(f) ? "Reading the art…" : "" });
      // Illustrator / EPS / PDF art, iPhone photos, TIFFs: a PNG picture of it, made here, so the AI can see it and
      // mockups can be drawn with it (Oct 13: ".ai files can't be read"). The original stays for production.
      if (needsPicture(f)) {
        const pv = await pictureOf(f);
        if (pv) {
          const t2 = await uploadTarget(pv.name, pv.size);
          const up2 = t2.ok ? await createClient().storage.from("proofs").uploadToSignedUrl(t2.path, t2.token, pv, { contentType: "image/png" }) : null;
          if (t2.ok && up2 && !up2.error) { set(tmp.id, { busy: false, note: "", local: URL.createObjectURL(pv), preview: { path: t2.path } }); continue; }
        }
        set(tmp.id, { busy: false, note: /\.(ai|eps)$/i.test(f.name) ? "No picture: save it PDF-compatible or send a PNG" : "" });
        continue;
      }
      set(tmp.id, { busy: false });
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim(), ready = files.filter((f) => f.path && !f.err);
    if (busy || (!t && !ready.length) || files.some((f) => f.busy)) return;
    setErr(""); setBusy(true); setStatus("Thinking…"); setLive({ text: [], cards: [] });
    const mine: WBMsg = { role: "user", text: t, files: ready.map((f) => ({ ...f, url: f.local || f.url, preview: f.preview ? { ...f.preview, url: f.local } : undefined })), at: new Date().toISOString() };
    setMsgs((m) => [...m, mine]); setText(""); setFiles([]);
    try {
      const res = await fetch("/api/ai/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: chatId || undefined, text: t, files: ready.map(({ path, name, type, size, preview }) => ({ path, name, type, size, preview })) }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Error ${res.status}`); }
      const rd = res.body.getReader(), dec = new TextDecoder();
      let buf = "", done: WBMsg | null = null;
      for (;;) {
        const { value, done: fin } = await rd.read();
        if (value) buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let ev: WBEvent; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === "chat") setChatId(ev.id);
          else if (ev.t === "status") setStatus(ev.text);
          else if (ev.t === "text") { setStatus(""); setLive((l) => (l ? { ...l, text: [...l.text, ev.text] } : l)); }
          else if (ev.t === "card") setLive((l) => (l ? { ...l, cards: [...l.cards, ev.card] } : l));
          else if (ev.t === "done") done = ev.msg;
          else if (ev.t === "error") throw new Error(ev.error);
        }
        if (fin) break;
      }
      if (!done) throw new Error("The answer was cut off. Open the chat again to see what was saved.");
      setMsgs((m) => [...m, done!]);
      void loadList();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Something went wrong.");
    } finally { setBusy(false); setStatus(""); setLive(null); }
  }

  const changeCard = (c: WBCard) => setMsgs((m) => m.map((x) => (x.cards?.some((y) => y.id === c.id) ? { ...x, cards: x.cards.map((y) => (y.id === c.id ? c : y)) } : x)));
  const empty = !msgs.length && !busy;

  return (
    <div className={"wb" + (showList ? " list-open" : "")}>
      <aside className="wb-side" aria-label="Your chats">
        <button type="button" className="btn primary wb-new" onClick={fresh}>New chat</button>
        <div className="wb-chats">
          {chats.length === 0 && <p className="wb-none">Your chats show up here.</p>}
          {chats.map((c) => (
            <button key={c.id} type="button" className={"wb-chat" + (c.id === chatId ? " on" : "")} onClick={() => open(c.id)}>
              <span className="wb-chat-t">{c.title || "Untitled"}</span><span className="wb-chat-d">{when(c.updated_at)}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="wb-main"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}>
        <button type="button" className="btn ghost sm wb-listbtn" onClick={() => setShowList((x) => !x)}>{showList ? "Hide chats" : "Your chats"}</button>
        <div className="wb-scroll">
          {empty && (
            <div className="wb-hello">
              <h2>What can I knock out for you{name ? `, ${name}` : ""}?</h2>
              <p>Drop in logos, spreadsheets, PDFs or order forms and say what you need. I can make mockups, put an order together as a quote for you to check, look up customers, past jobs, garments and colors, or answer a question. Nothing gets created, sent or ordered until you click.</p>
              <div className="wb-starters">
                {STARTERS.map((s) => <button key={s} type="button" onClick={() => { setText(s); box.current?.focus(); }}>{s.trim()}{s.endsWith(" ") ? "…" : ""}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => <Msg key={i} m={m} chatId={chatId} onCard={changeCard} />)}
          {busy && live && (
            <div className="wb-msg ai">
              {live.text.map((t, i) => <div key={i} className="wb-text">{plain(t)}</div>)}
              {live.cards.map((c) => <Card key={c.id} card={c} chatId={chatId} onCard={() => { /* saved once the answer is done */ }} pending />)}
              {status && <div className="wb-status"><span className="wb-dots" aria-hidden><i /><i /><i /></span>{status}</div>}
            </div>
          )}
          {err && <div className="wb-err" role="alert">{err}</div>}
          <div ref={end} />
        </div>
        <form className={"wb-compose" + (drag ? " drag" : "")} onSubmit={send}>
          {files.length > 0 && (
            <div className="wb-files">
              {files.map((f) => (
                <span key={f.id} className={"wb-file" + (f.err ? " bad" : "")} title={f.err || f.name}>
                  {f.local ? <img src={f.local} alt="" /> : <span className="wb-ext">{(f.name.split(".").pop() || "file").slice(0, 4)}</span>}
                  <span className="wb-fn">{f.name}</span>
                  <span className="wb-fs">{f.err ? "Didn't upload" : f.note ? f.note : f.busy ? "Uploading…" : `${kb(f.size)}${f.preview ? " · picture made" : ""}`}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="wb-row">
            <button type="button" className="wb-attach" onClick={() => pick.current?.click()} aria-label="Add files" title="Add files (or drop them anywhere here, or paste a picture)">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
            </button>
            <input ref={pick} type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
            <textarea ref={box} value={text} rows={1} placeholder={drag ? "Drop the files here" : "Ask, or drop in files and say what you need…"} aria-label="Message the AI"
              onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(220, e.target.scrollHeight) + "px"; }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
              onPaste={(e) => { const fs = Array.from(e.clipboardData.files || []) as File[]; if (fs.length) { e.preventDefault(); void addFiles(fs); } }} />
            <MicButton target={() => box.current} append keepListening label="Talk instead of typing" className="wb-mic" />
            <button type="submit" className="btn primary wb-send" disabled={busy || files.some((f) => f.busy) || (!text.trim() && !files.some((f) => f.path))}>{busy ? "Working…" : "Send"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Msg({ m, chatId, onCard }: { m: WBMsg; chatId: string; onCard: (c: WBCard) => void }) {
  return (
    <div className={"wb-msg " + (m.role === "user" ? "me" : "ai") + (m.error ? " err" : "")}>
      {m.files?.length ? (
        <div className="wb-mfiles">
          {m.files.map((f) => f.url && (isArtPicture(f) || f.preview?.url)
            ? <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="wb-mpic" title={`${f.id}: ${f.name}`}><img src={isArtPicture(f) ? f.url : f.preview!.url} alt={f.name} />{!isArtPicture(f) && <span className="wb-mext">{(f.name.split(".").pop() || "").slice(0, 4)}</span>}</a>
            : <a key={f.id} href={f.url || undefined} target="_blank" rel="noreferrer" className="wb-mdoc" title={f.id}>{f.name}</a>)}
        </div>
      ) : null}
      {m.text && <div className="wb-text">{m.seed ? "Started from an email in the Inbox (its text and attachments)." : plain(m.text)}</div>}
      {m.cards?.map((c) => <Card key={c.id} card={c} chatId={chatId} onCard={onCard} />)}
    </div>
  );
}

export function Card({ card, chatId, onCard, pending }: { card: WBCard; chatId: string; onCard: (c: WBCard) => void; pending?: boolean }) {
  return card.kind === "mockups" ? <Mockups card={card} chatId={chatId} onCard={onCard} pending={pending} /> : <OrderCard card={card} chatId={chatId} onCard={onCard} pending={pending} />;
}

/** the mockups, drawn here (garment photo + the art where it prints), then kept with the chat */
function Mockups({ card, chatId, onCard, pending }: { card: Extract<WBCard, { kind: "mockups" }>; chatId: string; onCard: (c: WBCard) => void; pending?: boolean }) {
  const [pics, setPics] = useState<(string | null)[]>(() => card.items.map((it) => it.savedUrl || null));
  const [bad, setBad] = useState<string[]>([]);
  const [big, setBig] = useState<number | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const blobs: { i: number; blob: Blob }[] = [];
      for (let i = 0; i < card.items.length; i++) {
        const it = card.items[i];
        if (it.savedUrl) continue;
        try {
          let photo = it.photo, blob: Blob | null = null;
          for (const p of it.prints) {
            if (!p.art) throw new Error("no art link");
            const art = p.doc ? await docPicture(p.art, p.doc) : p.art;
            blob = await renderMockup({ photo, art, location: p.location, widthIn: p.widthIn, youth: it.youth, size: 1000 });
            photo = URL.createObjectURL(blob);
          }
          if (blob) { blobs.push({ i, blob }); setPics((x) => x.map((v, j) => (j === i ? photo : v))); }
        } catch { setBad((b) => [...b, `${it.color} ${it.view}`]); }
      }
      // keep them with the chat (saved once the answer is in, so the card is on file)
      if (!blobs.length || pending) return;
      const t = await mockupTargets(chatId, card.id, blobs.length);
      if (!t.ok) return;
      const sb = createClient(), saved: { i: number; path: string }[] = [];
      for (let k = 0; k < blobs.length && k < t.targets.length; k++) {
        const up = await sb.storage.from("proofs").uploadToSignedUrl(t.targets[k].path, t.targets[k].token, blobs[k].blob, { contentType: "image/png" });
        if (!up.error) saved.push({ i: blobs[k].i, path: t.targets[k].path });
      }
      if (saved.length) { await saveMockups(chatId, card.id, saved); onCard({ ...card, items: card.items.map((it, j) => { const s = saved.find((x) => x.i === j); return s ? { ...it, saved: s.path } : it; }) }); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fileName = (it: WBMockItem) => `${card.garment.split(" ").slice(0, 2).join("-")}-${it.color}-${it.view}.png`.replace(/[^\w.-]+/g, "-");
  const downloadAll = async () => {
    for (let i = 0; i < card.items.length; i++) {
      const u = pics[i]; if (!u) continue;
      const blob = await fetch(u).then((r) => r.blob()).catch(() => null); if (!blob) continue;
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fileName(card.items[i]); a.click();
      await new Promise((r) => setTimeout(r, 350));
    }
  };
  return (
    <div className="wb-card">
      <div className="wb-card-h">
        <div><b>Mockups</b><span>{card.garment} · {card.items.length} picture{card.items.length === 1 ? "" : "s"}</span></div>
        {pics.some(Boolean) && <button type="button" className="btn ghost sm" onClick={downloadAll}>Download all</button>}
      </div>
      <div className="wb-mocks">
        {card.items.map((it, i) => (
          <figure key={i} className="wb-mock">
            {pics[i] ? <button type="button" className="wb-mock-img" onClick={() => setBig(i)} aria-label={`Bigger: ${it.color} ${it.view}`}><img src={pics[i]!} alt={`${it.color} ${it.view} mockup`} /></button>
              : <div className="wb-mock-wait">{bad.includes(`${it.color} ${it.view}`) ? "Couldn't draw this one" : "Drawing…"}</div>}
            <figcaption><span>{it.color}{it.view === "back" ? " · back" : ""}</span>{pics[i] && <a href={pics[i]!} download={fileName(it)}>Download</a>}</figcaption>
          </figure>
        ))}
      </div>
      {card.missing.length > 0 && <p className="wb-note">Not made in this style: {card.missing.join(", ")}.</p>}
      {big !== null && pics[big] && (
        <div className="wb-big" role="dialog" aria-label="Mockup" onClick={() => setBig(null)}>
          <img src={pics[big]!} alt="" />
          <span>{card.items[big].color}{card.items[big].view === "back" ? " · back" : ""} — click anywhere to close</span>
        </div>
      )}
    </div>
  );
}

/** an order the AI put together: check it, pick the customer, Create quote */
function OrderCard({ card, chatId, onCard, pending }: { card: Extract<WBCard, { kind: "order" }>; chatId: string; onCard: (c: WBCard) => void; pending?: boolean }) {
  const d = card.draft;
  const [cust, setCust] = useState(card.customer?.id || ""), [label, setLabel] = useState(card.customer?.label || "");
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; label: string }[]>(card.choices || []);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => { if (q.trim().length < 2) return; const t = setTimeout(async () => { const r = await searchCustomers(q); if (r.ok) setHits(r.list); }, 250); return () => clearTimeout(t); }, [q]);
  const pcs = d.groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, b) => a + (+b || 0), 0), 0), 0);
  const create = async () => {
    setErr(""); setBusy(true);
    const r = await createQuote(chatId, card.id, cust);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onCard({ ...card, customer: { id: cust, label }, created: { id: r.id, number: r.number } });
  };
  return (
    <div className="wb-card">
      <div className="wb-card-h">
        <div><b>{d.nickname || "Order"}</b><span>{pcs} pcs{d.due_date ? ` · in hands ${new Date(d.due_date + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}` : ""}{d.po_number ? ` · PO ${d.po_number}` : ""}</span></div>
        {card.created && <Link className="btn primary sm" href={`/shop/orders/${card.created.id}`}>Open quote #{card.created.number}</Link>}
      </div>
      {d.summary && <p className="wb-note">{d.summary}</p>}
      {d.groups.map((g, gi) => (
        <div key={g.id} className="wb-og">
          {(d.groups.length > 1 || g.name) && <div className="wb-og-h">{g.name || `Group ${gi + 1}`}</div>}
          <table className="wb-tbl"><tbody>
            {g.lines.map((l) => (
              <tr key={l.id}>
                <td>{[l.brand, l.style].filter(Boolean).join(" ") || l.garment || "Garment"}{l.color ? <span className="wb-dim"> · {l.color}</span> : null}</td>
                <td className="wb-sz">{Object.entries(l.sizes || {}).filter(([, n]) => n).map(([z, n]) => `${sizeLabel(z)} ${n}`).join(", ") || "no sizes"}</td>
              </tr>
            ))}
          </tbody></table>
          {g.imprints.length > 0 && <div className="wb-prints">{g.imprints.map((im) => `${METHODS[im.method] || im.method} ${im.location}${im.method === "screen" ? `, ${im.colors >= FULL_COLOR ? "full color" : `${im.colors} color${im.colors === 1 ? "" : "s"}`}` : ""}${im.inks ? ` (${im.inks})` : ""}${d.art[im.id] ? " (art attached)" : ""}`).join(" · ")}</div>}
        </div>
      ))}
      {d.questions.length > 0 && <div className="wb-q"><b>Still to sort out</b><ul>{d.questions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      {!card.created && !pending && (
        <div className="wb-make">
          {cust ? (
            <div className="wb-cust">For <b>{label}</b> <button type="button" className="wb-link" onClick={() => { setCust(""); setLabel(""); }}>change</button></div>
          ) : (
            <div className="wb-pick">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which customer? Type a name" aria-label="Customer" />
              {hits.length > 0 && <div className="wb-hits">{hits.map((h) => <button key={h.id} type="button" onClick={() => { setCust(h.id); setLabel(h.label); setQ(""); }}>{h.label}</button>)}</div>}
            </div>
          )}
          <button type="button" className="btn primary" disabled={!cust || busy} onClick={create}>{busy ? "Creating…" : "Create quote"}</button>
          <span className="wb-dim">Prices are worked out in the quote, like any other.</span>
          {err && <div className="wb-err">{err}</div>}
        </div>
      )}
    </div>
  );
}
