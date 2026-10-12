"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Convo, Folder, FullMsg, MsgRow } from "@/lib/mail/folders";

/**
 * Email beyond the Inbox (Oct 12): the folder list, a folder's emails, reading / replying / moving any email, and
 * search shown as conversations (received and sent in order). All live from the mailbox (/api/mail/box).
 */
export type { Convo, Folder, FullMsg, MsgRow };

export async function box<T>(params: Record<string, string | number>): Promise<T> {
  const r = await fetch(`/api/mail/box?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({ error: "The mail server didn't answer." }));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j as T;
}
export async function boxPost<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/mail/box", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: "The mail server didn't answer." }));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j as T;
}

const ICON: Record<string, string> = { "\\Inbox": "📥", "\\Sent": "📤", "\\Drafts": "📝", "\\Archive": "🗄", "\\Trash": "🗑", "\\Junk": "⚠" };
export const folderLabel = (f: Pick<Folder, "name" | "special">) => (f.special === "\\Inbox" ? "Inbox" : f.special === "\\Sent" ? "Sent" : f.name.replace(/^@Sane/, "Sane "));

/** the folder list: Inbox, Sent, Archive and the usual ones first, then SaneBox, then the rest (as Outlook nests them) */
export function FolderRail({ folders, current, onPick, onSearch }: { folders: Folder[] | null; current: string; onPick: (path: string) => void; onSearch?: () => void }) {
  if (!folders) return <nav className="mf-rail" aria-label="Folders"><div className="mf-load">Loading folders…</div></nav>;
  const top = ["\\Inbox", "\\Sent", "\\Archive", "\\Drafts", "\\Trash", "\\Junk"];
  const main = top.map((s) => folders.find((f) => f.special === s)).filter(Boolean) as Folder[];
  const sane = folders.filter((f) => f.sane);
  const rest = folders.filter((f) => !main.includes(f) && !f.sane);
  const item = (f: Folder, depth = 0) => (
    <button key={f.path} type="button" className={"mf-f" + (current === f.path ? " on" : "")} style={{ paddingLeft: 10 + depth * 12 }} onClick={() => onPick(f.path)} title={f.path}>
      <span className="mf-ic" aria-hidden>{ICON[f.special] || (f.sane ? "◦" : "▸")}</span><span className="mf-nm">{folderLabel(f)}</span>{f.unseen > 0 && <b>{f.unseen}</b>}
    </button>
  );
  return (
    <nav className="mf-rail" aria-label="Folders">
      {onSearch && <button type="button" className="mf-f mf-searchbtn" onClick={onSearch}><span className="mf-ic" aria-hidden>⌕</span><span className="mf-nm">Search all mail</span></button>}
      {main.map((f) => item(f))}
      {sane.length > 0 && <div className="mf-h">SaneBox</div>}
      {sane.map((f) => item(f))}
      {rest.length > 0 && <div className="mf-h">Folders</div>}
      {rest.map((f) => item(f, Math.min(3, f.depth)))}
    </nav>
  );
}

/** Archive, Black Hole and Move to any folder: the same on every email */
export function MoveBar({ folders, busy, onMove, here }: { folders: Folder[] | null; busy?: boolean; onMove: (to: string, label: string) => void; here?: string }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const pick = (to: string, label: string) => { if (ref.current) ref.current.open = false; onMove(to, label); };
  const others = (folders || []).filter((f) => f.path !== here && !/\\(Drafts|Junk)/.test(f.special));
  return (
    <>
      <button type="button" className="btn sm primary" disabled={busy} onClick={() => onMove("archive", "Archived.")} title="Moves it to Archive, like Outlook's Archive button">Archive</button>
      <button type="button" className="btn sm ghost mf-bh" disabled={busy} onClick={() => onMove("blackhole", "Black Hole: SaneBox won't show you this sender again.")} title="SaneBox Black Hole: junk, and this sender is blocked from now on">Black Hole</button>
      <button type="button" className="btn sm ghost" disabled={busy} onClick={() => onMove("later", "Moved to Later.")} title="SaneBox Later: this sender's mail goes to Later from now on">Later</button>
      <details className="ibx2-more mf-move" ref={ref}>
        <summary className="btn sm ghost">Move to…</summary>
        <div className="ibx2-menu mf-menu">
          {others.map((f) => <button key={f.path} type="button" disabled={busy} onClick={() => pick(f.path, `Moved to ${folderLabel(f)}.`)} style={{ paddingLeft: 10 + Math.min(3, f.depth) * 10 }}>{folderLabel(f)}</button>)}
          {!others.length && <span className="faint" style={{ padding: 8 }}>Loading folders…</span>}
        </div>
      </details>
    </>
  );
}

const HEAD = `<base target="_blank"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; form-action 'none'"><style>html,body{margin:0;padding:10px 12px;font:14px/1.45 Calibri,Segoe UI,Arial,sans-serif;color:#222;background:#fff;overflow-x:auto}img{max-width:100%;height:auto}table img{max-width:none}table{max-width:100%}</style>`;
/** an email's body, the way Outlook shows it (sandboxed, links open in a new tab), or its text */
export function MailFrame({ html, text }: { html: string; text: string }) {
  const [h, setH] = useState(200), ref = useRef<HTMLIFrameElement | null>(null), [plain, setPlain] = useState(false);
  const doc = useMemo(() => {
    if (!html) return null;
    const x = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    return /<head[^>]*>/i.test(x) ? x.replace(/<head[^>]*>/i, (m) => m + HEAD) : HEAD + x;
  }, [html]);
  const fit = () => { const d = ref.current?.contentDocument; if (d?.body) setH(Math.min(20000, Math.max(80, d.documentElement.scrollHeight + 4))); };
  if (!doc || plain) return <div className="lm-text">{text || "(no text)"}{doc && <div><button type="button" className="btn sm ghost" onClick={() => setPlain(false)}>Show as in Outlook</button></div>}</div>;
  return (
    <div className="ibx-html">
      <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={() => { fit(); setTimeout(fit, 400); setTimeout(fit, 1500); }} />
      <button type="button" className="btn sm ghost" onClick={() => setPlain(true)}>Plain text</button>
    </div>
  );
}

export const attUrl = (path: string, uid: number, i: number) => `/api/mail/box?${new URLSearchParams({ do: "attachment", path, uid: String(uid), i: String(i) })}`;
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Attachments({ m }: { m: FullMsg }) {
  if (!m.attachments.length) return null;
  return <div className="mf-atts">{m.attachments.map((a) => <a key={a.i} href={attUrl(m.folder, m.uid, a.i)} target="_blank" rel="noreferrer" className="mf-att">📎 {a.name}<span>{kb(a.size)}</span></a>)}</div>;
}

/** reply / reply all box (to any email in any folder) */
export function ReplyBox({ m, all, onClose, onSent }: { m: FullMsg; all?: boolean; onClose: () => void; onSent: (to: string) => void }) {
  const [body, setBody] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [toAll, setToAll] = useState(!!all);
  return (
    <div className="ibx2-compose open mf-reply">
      <div className="ibx2-to"><span>{toAll ? "Reply all" : "Reply"} to {m.fromName || m.fromAddress}</span><label className="check" style={{ marginLeft: "auto" }}><input type="checkbox" checked={toAll} onChange={(e) => setToAll(e.target.checked)} />Everyone on it</label></div>
      <textarea rows={7} autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your reply" aria-label="Reply" />
      {err && <div className="pv-err">{err}</div>}
      <div className="ibx2-send">
        <button type="button" className="btn primary" disabled={busy || !body.trim()} onClick={async () => { setBusy(true); setErr(""); try { const r = await boxPost<{ to: string }>({ do: "reply", path: m.folder, uid: m.uid, body, all: toAll }); onSent(r.to); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(false); }}>{busy ? "Sending…" : "Send"}</button>
        <span className="faint">Your signature and their email go underneath.</span>
        <span className="spacer" />
        <button type="button" className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

const when = (d: string) => { const x = new Date(d), t = new Date(); return x.toDateString() === t.toDateString() ? x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : x.getFullYear() === t.getFullYear() ? x.toLocaleDateString([], { month: "short", day: "numeric" }) : x.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); };

/** a folder's emails (Sent shows who it went to) */
export function FolderList({ rows, sel, onPick, sentBox, more, onMore, loading }: { rows: MsgRow[] | null; sel: string; onPick: (r: MsgRow) => void; sentBox: boolean; more: boolean; onMore: () => void; loading: boolean }) {
  if (!rows) return <div className="ibx2-none">Loading…</div>;
  if (!rows.length) return <div className="ibx2-none">This folder is empty.</div>;
  return (
    <>
      {rows.map((r) => {
        const k = `${r.folder}:${r.uid}`;
        return (
          <button key={k} data-id={k} type="button" className={"ibx2-item ol" + (sel === k ? " on" : "") + (!r.seen && !r.sent ? " ol-unread" : "")} onClick={() => onPick(r)}>
            <span className="ibx2-item-1"><b>{sentBox || r.sent ? `To ${r.to[0] || ""}${r.to.length > 1 ? ` +${r.to.length - 1}` : ""}` : r.fromName || r.from}</b>{r.flagged && <span className="ibx2-flag">⚑</span>}<time>{when(r.date)}</time></span>
            <span className="ibx2-item-2">{r.subject || "(no subject)"}</span>
          </button>
        );
      })}
      {more && <button type="button" className="btn sm ghost mf-older" disabled={loading} onClick={onMore}>{loading ? "Loading…" : "Older emails"}</button>}
    </>
  );
}

/** one email from any folder: read it, reply, move it */
export function FolderMail({ row, folders, onGone, toggleList, listOpen, back, flash }: { row: MsgRow; folders: Folder[] | null; onGone: () => void; toggleList: () => void; listOpen: boolean; back: () => void; flash: (t: string) => void }) {
  const [m, setM] = useState<FullMsg | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [rep, setRep] = useState<"" | "one" | "all">("");
  useEffect(() => { let live = true; setM(null); setErr(""); box<FullMsg>({ do: "message", path: row.folder, uid: row.uid }).then((x) => live && setM(x), (e) => live && setErr(e.message)); return () => { live = false; }; }, [row.folder, row.uid]);
  const move = async (to: string, label: string) => { setBusy(true); try { await boxPost({ do: "move", path: row.folder, uid: row.uid, to }); flash(label); onGone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(false); };
  return (
    <div className="ibx2-work ibx2-solo">
      <section className="ibx2-mail" aria-label="Email">
        <header className="ibx2-mh">
          <div className="ibx2-sw"><button type="button" className="ibx2-back" onClick={back} aria-label="Back to the emails">←</button></div>
          <div className="ibx2-mh-1">
            <button type="button" className="ibx2-listbtn" onClick={toggleList} aria-label={listOpen ? "Hide the list" : "Show the list"}>{listOpen ? "⟨" : "☰"}</button>
            <span className="ibx2-who"><b>{row.fromName || row.from}</b>{row.fromName && <span> · {row.from}</span>}</span>
            <span className="ibx2-when">{new Date(row.date).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </div>
          <h2>{row.subject || "(no subject)"}</h2>
          <div className="ibx2-acts">
            <button type="button" className="btn sm" disabled={!m} onClick={() => setRep("one")}>Reply</button>
            <button type="button" className="btn sm ghost" disabled={!m} onClick={() => setRep("all")}>Reply all</button>
            <MoveBar folders={folders} busy={busy} onMove={move} here={row.folder} />
          </div>
          {err && <div className="pv-err">{err}</div>}
        </header>
        <div className="ibx2-read">
          {!m ? <div className="ibx2-none">{err ? "" : "Opening the email…"}</div> : <>
            <div className="lm-to faint">To {m.to}{m.cc ? ` · Cc ${m.cc}` : ""}</div>
            <MailFrame html={m.html} text={m.text} />
            <Attachments m={m} />
          </>}
        </div>
        {rep && m && <ReplyBox m={m} all={rep === "all"} onClose={() => setRep("")} onSent={(to) => { setRep(""); flash(`Sent to ${to}.`); }} />}
      </section>
    </div>
  );
}

/** search results as conversations */
export function ConvoList({ convos, sel, onPick, me }: { convos: Convo[]; sel: string; onPick: (c: Convo) => void; me: string }) {
  return (
    <>
      {convos.map((c) => (
        <button key={c.key} data-id={c.key} type="button" className={"ibx2-item ol" + (sel === c.key ? " on" : "") + (c.unread ? " ol-unread" : "")} onClick={() => onPick(c)}>
          <span className="ibx2-item-1"><b>{c.people.filter((p) => p !== me).join(", ") || "You"}</b>{c.count > 1 && <span className="mf-count">{c.count}</span>}<time>{when(c.last)}</time></span>
          <span className="ibx2-item-2">{c.subject}</span>
          <span className="ibx2-item-3">{c.msgs.some((m) => m.sent) && <span>You replied</span>}{[...new Set(c.msgs.map((m) => m.folder))].slice(0, 2).map((f) => <span key={f}>{f.split("/").pop()}</span>)}</span>
        </button>
      ))}
    </>
  );
}

/** one conversation, oldest first: what they sent, what you sent, in order; open any email; reply to the last */
export function ThreadView({ c, folders, toggleList, listOpen, back, flash, onMoved }: { c: Convo; folders: Folder[] | null; toggleList: () => void; listOpen: boolean; back: () => void; flash: (t: string) => void; onMoved: (m: MsgRow) => void }) {
  const last = c.msgs[c.msgs.length - 1];
  const [open, setOpen] = useState<Record<string, boolean>>({ [`${last.folder}:${last.uid}`]: true });
  const [full, setFull] = useState<Record<string, FullMsg | "err">>({});
  const [rep, setRep] = useState<FullMsg | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const load = (m: MsgRow) => { const k = `${m.folder}:${m.uid}`; if (full[k]) return; box<FullMsg>({ do: "message", path: m.folder, uid: m.uid }).then((x) => setFull((f) => ({ ...f, [k]: x })), () => setFull((f) => ({ ...f, [k]: "err" }))); };
  useEffect(() => { load(last); setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 300); }, [c.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (m: MsgRow) => { const k = `${m.folder}:${m.uid}`; setOpen((o) => ({ ...o, [k]: !o[k] })); load(m); };
  const lastIn = [...c.msgs].reverse().find((m) => !m.sent) || last;
  return (
    <div className="ibx2-work ibx2-solo">
      <section className="ibx2-mail" aria-label="Conversation">
        <header className="ibx2-mh">
          <div className="ibx2-sw"><button type="button" className="ibx2-back" onClick={back} aria-label="Back to the results">←</button></div>
          <div className="ibx2-mh-1">
            <button type="button" className="ibx2-listbtn" onClick={toggleList} aria-label={listOpen ? "Hide the list" : "Show the list"}>{listOpen ? "⟨" : "☰"}</button>
            <span className="ibx2-who"><b>{c.people.join(", ")}</b></span>
            <span className="ibx2-when">{c.count} email{c.count === 1 ? "" : "s"}</span>
          </div>
          <h2>{c.subject}</h2>
          <div className="ibx2-acts">
            <button type="button" className="btn sm primary" onClick={() => { const k = `${lastIn.folder}:${lastIn.uid}`; const f = full[k]; if (f && f !== "err") setRep(f); else { load(lastIn); box<FullMsg>({ do: "message", path: lastIn.folder, uid: lastIn.uid }).then(setRep); } }}>Reply</button>
            <span className="faint mf-hint">Oldest at the top. Click an email to open or fold it.</span>
          </div>
        </header>
        <div className="ibx2-read mf-thread">
          {c.msgs.map((m) => {
            const k = `${m.folder}:${m.uid}`, f = full[k], isOpen = !!open[k];
            return (
              <article key={k} className={"mf-msg" + (m.sent ? " sent" : "") + (isOpen ? " open" : "")}>
                <button type="button" className="mf-msg-h" onClick={() => toggle(m)} aria-expanded={isOpen}>
                  <b>{m.sent ? "You" : m.fromName || m.from}</b>
                  <span className="faint">{m.sent ? `to ${m.to.join(", ")}` : ""}</span>
                  <span className="spacer" />
                  <span className="mf-fold">{m.folder.split("/").pop()}</span>
                  <time>{new Date(m.date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                </button>
                {isOpen && <div className="mf-msg-b">
                  {!f ? <div className="faint">Opening…</div> : f === "err" ? <div className="pv-err">Couldn&apos;t open this one.</div> : <>
                    <MailFrame html={f.html} text={f.text} />
                    <Attachments m={f} />
                    <div className="mf-msg-a">
                      <button type="button" className="btn sm" onClick={() => setRep(f)}>Reply</button>
                      <MoveBar folders={folders} here={m.folder} onMove={async (to, label) => { try { await boxPost({ do: "move", path: m.folder, uid: m.uid, to }); flash(label); onMoved(m); } catch (e) { flash(e instanceof Error ? e.message : String(e)); } }} />
                    </div>
                  </>}
                </div>}
              </article>
            );
          })}
          <div ref={endRef} />
        </div>
        {rep && <ReplyBox m={rep} onClose={() => setRep(null)} onSent={(to) => { setRep(null); flash(`Sent to ${to}. It shows in the conversation next time you search.`); }} />}
      </section>
    </div>
  );
}

export type MailView = { kind: "inbox" } | { kind: "folder"; path: string } | { kind: "search"; q: string };
export const isTyping = (e: React.KeyboardEvent) => e.key === "Enter";
