"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MAX_ATTACH, type Attachment, type HubMsg, type HubOrder } from "@/lib/messages";
import SearchInput from "@/components/SearchInput";

type Convo = { key: string; orderId: string | null; projectId?: string | null; topic: string; title: string; sub: string; order?: HubOrder; msgs: HubMsg[]; last: HubMsg | null; unread: number };
type Pending = { id: string; name: string; size: number; mime: string; done?: Attachment; error?: string };

const isImg = (m: string) => /^image\/(png|jpe?g|gif|webp|svg\+xml|heic)$/i.test(m);
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (iso: string) => {
  const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 86400000);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
};
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "now"; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
};
const Ico = ({ d, s = 18 }: { d: string; s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const CLIP = "M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7L10.2 17.7a1.7 1.7 0 0 1-2.4-2.4L15.5 7.6";
const SEND = "M4 12 20 4l-6 16-3-7z M11 13l9-9";
const BACK = "M15 18l-6-6 6-6";

/**
 * The conversation center: a list of conversations (General, plus one per order) and the open thread,
 * with files and photos. Used as the customer's dashboard centerpiece and on the shop's customer page.
 */
export default function MessageHub({ mode, initial, orders, projects = [], only, load, send, upload, markRead, canAct = true, shopName, customerName, start, height = 620 }: {
  mode: "portal" | "shop";
  initial: HubMsg[];
  /** orders a conversation can be about (newest first) */
  orders: HubOrder[];
  /** projects with their own conversation */
  projects?: { id: string; name: string; href?: string }[];
  /** show just this one conversation (e.g. "p:<project id>" on a project page) */
  only?: string;
  load: () => Promise<HubMsg[] | null>;
  send: (orderId: string | null, body: string, files: Attachment[], topic: string, projectId?: string | null) => Promise<{ ok: boolean; error?: string }>;
  upload: (f: File) => Promise<Attachment>;
  markRead: (orderId: string | null, topic: string, projectId?: string | null) => Promise<unknown>;
  canAct?: boolean;
  shopName: string;
  customerName?: string;
  /** conversation to open first: "general" or an order id */
  start?: string | null;
  height?: number;
}) {
  const [msgs, setMsgs] = useState<HubMsg[]>(initial);
  const mine = (m: HubMsg) => (mode === "portal" ? m.author_type === "customer" : m.author_type === "staff");
  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const convos = useMemo(() => {
    const by = new Map<string, HubMsg[]>();
    for (const m of msgs) { const k = m.order_id ? m.order_id + (m.topic === "goods" ? ":goods" : "") : m.project_id ? `p:${m.project_id}` : "general"; if (!by.has(k)) by.set(k, []); by.get(k)!.push(m); }
    const list: Convo[] = [];
    const mk = (key: string): Convo => {
      const ms = by.get(key) || [];
      if (key.startsWith("p:")) {
        const pr = projects.find((p) => p.id === key.slice(2));
        return { key, orderId: null, projectId: key.slice(2), topic: "", msgs: ms, last: ms[ms.length - 1] || null, unread: ms.filter((m) => !mine(m) && !m.read_at).length,
          title: pr ? `Project · ${pr.name}` : "Project", sub: "Project conversation", order: pr?.href ? { id: pr.id, number: 0, nickname: pr.name, href: pr.href } : undefined };
      }
      const [oid, topic = ""] = key === "general" ? [null, ""] : key.split(":");
      const o = oid ? ordersById.get(oid) : undefined;
      return { key, orderId: oid, topic, order: o, msgs: ms, last: ms[ms.length - 1] || null,
        unread: ms.filter((m) => !mine(m) && !m.read_at).length,
        title: key === "general" ? (mode === "portal" ? `Chat with ${shopName}` : "General") : o ? `#${o.number}${topic === "goods" ? " · Goods" : o.nickname ? ` · ${o.nickname}` : ""}` : topic === "goods" ? "Goods" : "An order",
        sub: key === "general" ? "Questions, ideas, files" : topic === "goods" ? "Customer supplied goods" : "About this order" };
    };
    if (only) return [mk(only)];
    list.push(mk("general"));
    for (const k of by.keys()) if (k !== "general") list.push(mk(k));
    return list.sort((a, b) => (b.last?.created_at || (b.key === "general" ? "0" : "")).localeCompare(a.last?.created_at || (a.key === "general" ? "0" : "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, ordersById, mode, shopName, only, projects]);

  const valid = (k?: string | null) => !!k && (k === "general" || k.startsWith("p:") || ordersById.has(k.split(":")[0]));
  const [open, setOpen] = useState<string>(valid(start) ? start! : "");
  const [showThread, setShowThread] = useState(valid(start));
  const blank = (k: string): Convo | null => {
    const [oid, topic = ""] = k.split(":"); const o = ordersById.get(oid);
    return o ? { key: k, orderId: oid, topic, order: o, msgs: [], last: null, unread: 0, title: `#${o.number}${topic === "goods" ? " · Goods" : o.nickname ? ` · ${o.nickname}` : ""}`, sub: topic === "goods" ? "Customer supplied goods" : "About this order" } : null;
  };
  const cur = convos.find((c) => c.key === open) || (open && open !== "general" && !open.startsWith("p:") ? blank(open) : null) || convos[0];
  // other parts of the page can open a conversation (e.g. "Message us about goods")
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: Event) => { const k = (e as CustomEvent<string>).detail; if (valid(k)) { setOpen(k); setShowThread(true); root.current?.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => ta.current?.focus(), 350); } };
    window.addEventListener("mh:open", h);
    return () => window.removeEventListener("mh:open", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersById]);
  const [q, setQ] = useState("");
  const shown = q.trim() ? convos.filter((c) => [c.title, ...c.msgs.map((m) => m.body + " " + m.files.map((f) => f.name).join(" "))].join(" ").toLowerCase().includes(q.trim().toLowerCase())) : convos;
  const noConvo = orders.filter((o) => !convos.some((c) => c.key === o.id));

  const refresh = useCallback(async () => { const m = await load(); if (m) setMsgs(m); }, [load]);
  // new messages show up without reloading the page
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 20000);
    const v = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [refresh]);
  // opening a conversation marks the other side's messages read
  useEffect(() => {
    if (!cur || !cur.unread || !canAct) return;
    const k = cur.orderId, tp = cur.topic, pj = cur.projectId || null;
    markRead(k, tp, pj);
    setMsgs((ms) => ms.map((m) => ((m.order_id || null) === k && (m.project_id || null) === pj && (m.topic || "") === tp && !mine(m) && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.key, cur?.unread]);

  // composer
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // stay at the newest message (also once pictures finish loading), unless they scrolled up to read
  const stick = useRef(true);
  const toBottom = () => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; };
  useEffect(() => { stick.current = true; toBottom(); }, [cur?.key, cur?.msgs.length]);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(160, el.scrollHeight) + "px"; }, [text]);

  async function addFiles(list: FileList | File[]) {
    setErr("");
    for (const f of Array.from(list).slice(0, 10)) {
      const id = crypto.randomUUID();
      if (f.size > MAX_ATTACH) { setErr(`${f.name} is over 25 MB.`); continue; }
      setFiles((x) => [...x, { id, name: f.name, size: f.size, mime: f.type || "application/octet-stream" }]);
      try { const a = await upload(f); setFiles((x) => x.map((p) => (p.id === id ? { ...p, done: a } : p))); }
      catch (e) { setFiles((x) => x.map((p) => (p.id === id ? { ...p, error: e instanceof Error ? e.message : "Upload failed" } : p))); }
    }
  }
  const uploading = files.some((f) => !f.done && !f.error);
  async function doSend() {
    const ready = files.filter((f) => f.done).map((f) => f.done!);
    if (!canAct || busy || uploading || (!text.trim() && !ready.length) || !cur) return;
    setBusy(true); setErr("");
    const r = await send(cur.orderId, text, ready, cur.topic, cur.projectId || null);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Couldn't send."); return; }
    setText(""); setFiles([]);
    // show it right away, then sync with the server
    setMsgs((ms) => [...ms, { id: "tmp-" + Date.now(), order_id: cur.orderId, project_id: cur.projectId || null, topic: cur.topic, author_type: mode === "portal" ? "customer" : "staff", author_name: "You", body: text.trim(), created_at: new Date().toISOString(), read_at: null, files: ready.map((a) => ({ name: a.name, mime: a.mime, size: a.size, url: "" })) }]);
    refresh();
  }

  const openConvo = (k: string) => { setOpen(k); setShowThread(true); setErr(""); };
  const other = mode === "portal" ? shopName : customerName || "Customer";
  const totalUnread = convos.reduce((a, c) => a + c.unread, 0);

  return (
    <div className="mh-box" ref={root}>
    <section className={"mh" + (showThread || only ? " thread-open" : "") + (only ? " single" : "")} style={{ ["--mh-h" as string]: `${height}px` }} aria-label="Messages">
      <div className="mh-list">
        <div className="mh-list-h">
          <h2>Messages{totalUnread ? <span className="mh-badge">{totalUnread}</span> : null}</h2>
          <SearchInput placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search messages" />
        </div>
        <div className="mh-convos">
          {shown.map((c) => (
            <button key={c.key} type="button" className={"mh-c" + (cur?.key === c.key ? " on" : "") + (c.unread ? " is-unread" : "")} onClick={() => openConvo(c.key)}>
              <span className={"mh-av" + (c.key === "general" ? " gen" : c.topic === "goods" ? " goods" : c.projectId ? " proj" : "")}>{c.key === "general" ? "💬" : c.topic === "goods" ? "📦" : c.projectId ? "📁" : "#"}</span>
              <span className="mh-c-main">
                <span className="mh-c-top"><b>{c.title}</b>{c.last && <span className="mh-c-t">{ago(c.last.created_at)}</span>}</span>
                <span className="mh-c-sub">{c.last ? `${mine(c.last) ? "You: " : ""}${c.last.body || (c.last.files.length ? `📎 ${c.last.files[0].name}` : "")}` : c.sub}</span>
              </span>
              {c.unread > 0 && <span className="mh-dot" aria-label={`${c.unread} unread`}>{c.unread}</span>}
            </button>
          ))}
          {!shown.length && <div className="mh-none">No messages match “{q}”.</div>}
        </div>
        {noConvo.length > 0 && (
          <label className="mh-new">
            <span>Message about an order</span>
            <select value="" onChange={(e) => e.target.value && openConvo(e.target.value)} aria-label="Start a conversation about an order">
              <option value="">Choose an order…</option>
              {noConvo.slice(0, 60).map((o) => <option key={o.id} value={o.id}>#{o.number}{o.nickname ? ` · ${o.nickname}` : ""}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className={"mh-thread" + (over ? " over" : "")}
        onDragOver={(e) => { if (canAct && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (canAct && e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}>
        {cur && <>
          <div className="mh-th">
            <button type="button" className="mh-back" onClick={() => setShowThread(false)} aria-label="All conversations"><Ico d={BACK} /></button>
            <div className="mh-th-t"><b>{cur.title}</b><span>{cur.orderId ? (cur.topic === "goods" ? "The garments you send us for this job: tracking, counts, issues" : cur.order?.status ? cur.order.status : "Order conversation") : mode === "portal" ? "We read every message. Send questions, ideas and files here." : "General conversation with this customer"}</span></div>
            {cur.order && !only && <Link className="btn sm" href={cur.order.href}>{cur.projectId ? "Open project" : "Open order"}</Link>}
          </div>
          <div className="mh-scroll" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
            {!cur.msgs.length && (
              <div className="mh-empty">
                <b>{cur.orderId ? "No messages about this order yet" : mode === "portal" ? `Say hi to ${shopName}` : "No general messages yet"}</b>
                <span>{mode === "portal" ? "Ask a question, send a logo or a photo, or tell us about your next idea. You'll get an email when we reply." : "Messages you send here show in their portal, and they get an email."}</span>
              </div>
            )}
            {cur.msgs.map((m, i) => {
              const newDay = i === 0 || day(cur.msgs[i - 1].created_at) !== day(m.created_at);
              const me = mine(m);
              return (
                <div key={m.id}>
                  {newDay && <div className="mh-day"><span>{day(m.created_at)}</span></div>}
                  <div className={"mh-m" + (me ? " me" : "")}>
                    {!me && <span className="mh-who">{m.author_type === "staff" ? (mode === "portal" ? shopName : m.author_name) : m.author_name || other}</span>}
                    <div className="mh-b">
                      {m.body && <div className="mh-text">{m.body}</div>}
                      {m.files.length > 0 && (
                        <div className="mh-files">
                          {m.files.map((f, k) => isImg(f.mime) && f.url
                            ? <a key={k} className="mh-img" href={f.url} target="_blank" rel="noreferrer" title={f.name}><img src={f.url} alt={f.name} onLoad={toBottom} /></a>
                            : <a key={k} className="mh-file" href={f.url || undefined} target="_blank" rel="noreferrer" download={f.name}><span className="ext">{(f.name.split(".").pop() || "file").slice(0, 4).toUpperCase()}</span><span className="nm">{f.name}<small>{kb(f.size)}</small></span></a>)}
                        </div>
                      )}
                    </div>
                    <span className="mh-time">{time(m.created_at)}{me && mode === "portal" && m.read_at ? " · Seen" : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mh-compose">
            {files.length > 0 && (
              <div className="mh-pending">
                {files.map((f) => (
                  <span key={f.id} className={"mh-pf" + (f.error ? " bad" : f.done ? "" : " up")}>
                    {f.name}<small>{f.error ? f.error : f.done ? kb(f.size) : "uploading…"}</small>
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((p) => p.id !== f.id))}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className="mh-row">
              <button type="button" className="mh-att" onClick={() => fileInput.current?.click()} disabled={!canAct} aria-label="Attach files" title="Attach photos or files"><Ico d={CLIP} s={20} /></button>
              <textarea ref={ta} rows={1} value={text} disabled={!canAct} placeholder={!canAct ? "Sending is turned off in the preview." : `Message ${cur.orderId ? `about ${cur.title.split(" · ")[0]}` : other}…`}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); doSend(); } }}
                onPaste={(e) => { if (e.clipboardData.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }} aria-label="Message" />
              <button type="button" className="mh-send" onClick={doSend} disabled={!canAct || busy || uploading || (!text.trim() && !files.some((f) => f.done))} aria-label="Send"><Ico d={SEND} s={18} /><span>{busy ? "Sending…" : "Send"}</span></button>
            </div>
            <div className="mh-hint">{err ? <span className="bad">{err}</span> : <>Enter to send · Shift+Enter for a new line · Drop or paste files</>}</div>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
          </div>
          {over && <div className="mh-drop">Drop files to attach</div>}
        </>}
      </div>
    </section>
    </div>
  );
}
