"use client";
import { useSticky } from "@/lib/useSticky";
import { mzCss } from "@/components/MailZoom";
import CcField from "@/components/CcField";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Convo, Folder, FullMsg, MsgRow } from "@/lib/mail/folders";
import VoiceDraft, { SayButton, startListening, type Draft } from "@/components/VoiceDraft";
import { cheerWin } from "@/components/Cheer";
import { createClient } from "@/lib/supabase/client";

/**
 * Email beyond the Inbox (Oct 12): the folder list, a folder's emails, reading / replying / moving any email, and
 * search shown as conversations (received and sent in order). All live from the mailbox (/api/mail/box).
 */
export type { Convo, Folder, FullMsg, MsgRow };

export async function box<T>(params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`/api/mail/box?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`, { cache: "no-store", signal });
  const j = await r.json().catch(() => ({ error: "The mail server didn't answer." }));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j as T;
}
export async function boxPost<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/mail/box", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: "The mail server didn't answer." }));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  // Cheer mode: an email archived (or blackholed) counts as a win
  if (body.do === "move" && (body.to === "archive" || body.to === "blackhole")) cheerWin("archived");
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

/** the folders across the top (no extra width): Inbox, Sent, Archive, Drafts, Deleted, then SaneBox and your own folders in menus */
export function FolderBar({ folders, current, onPick }: { folders: Folder[] | null; current: string; onPick: (path: string) => void }) {
  const sRef = useRef<HTMLDetailsElement | null>(null), fRef = useRef<HTMLDetailsElement | null>(null);
  const list = folders || [];
  const main = ["\\Inbox", "\\Sent", "\\Archive", "\\Drafts", "\\Trash", "\\Junk"].map((s) => list.find((f) => f.special === s)).filter(Boolean) as Folder[];
  const sane = list.filter((f) => f.sane), rest = list.filter((f) => !main.includes(f) && !f.sane);
  const inSane = sane.find((f) => f.path === current), inRest = rest.find((f) => f.path === current);
  const pick = (p: string) => { if (sRef.current) sRef.current.open = false; if (fRef.current) fRef.current.open = false; onPick(p); };
  const chip = (f: Folder) => (
    <button key={f.path} type="button" role="tab" aria-selected={current === f.path} className={"mf-chip" + (current === f.path ? " on" : "")} onClick={() => pick(f.path)}>
      {f.special === "\\Inbox" ? "Inbox" : folderLabel(f)}{f.unseen > 0 && f.special !== "\\Sent" && <b>{f.unseen}</b>}
    </button>
  );
  return (
    <div className="mf-bar" role="tablist" aria-label="Folders">
      {!folders ? <span className="faint mf-load">Loading folders…</span> : <>
        {main.length ? main.map(chip) : <button type="button" className={"mf-chip" + (/^inbox$/i.test(current) ? " on" : "")} onClick={() => pick("INBOX")}>Inbox</button>}
        {sane.length > 0 && <details className={"mf-dd" + (inSane ? " on" : "")} ref={sRef}>
          <summary className="mf-chip">{inSane ? folderLabel(inSane) : "SaneBox"} ▾{sane.reduce((n, f) => n + f.unseen, 0) > 0 && !inSane && <b>{sane.reduce((n, f) => n + f.unseen, 0)}</b>}</summary>
          <div className="mf-ddm">{sane.map((f) => <button key={f.path} type="button" className={current === f.path ? "on" : ""} onClick={() => pick(f.path)}>{folderLabel(f)}{f.unseen > 0 && <b>{f.unseen}</b>}</button>)}</div>
        </details>}
        {rest.length > 0 && <details className={"mf-dd" + (inRest ? " on" : "")} ref={fRef}>
          <summary className="mf-chip">{inRest ? folderLabel(inRest) : "More folders"} ▾</summary>
          <div className="mf-ddm">{rest.map((f) => <button key={f.path} type="button" className={current === f.path ? "on" : ""} style={{ paddingLeft: 12 + Math.min(3, f.depth) * 12 }} onClick={() => pick(f.path)}>{folderLabel(f)}{f.unseen > 0 && <b>{f.unseen}</b>}</button>)}</div>
        </details>}
      </>}
    </div>
  );
}

/* ───────── the toolbar on top of an email: big, clear buttons in groups (Reply · organize · work) ───────── */
const P = (d: string) => <svg viewBox="0 0 24 24" aria-hidden><path d={d} /></svg>;
export const TbIcon = {
  reply: P("M10 8V4L3 11l7 7v-4c5 0 8 1.5 11 6-1-6-4-11-11-12z"),
  forward: P("M14 8V4l7 7-7 7v-4c-5 0-8 1.5-11 6 1-6 4-11 11-12z"),
  replyAll: P("M8 8V4L1 11l7 7v-4M14 8V4l-7 7 7 7v-4c4 0 7 1.4 9 5-1-5-3.5-9.6-9-11"),
  archive: P("M3 4h18v4H3zM5 8v12h14V8M10 12h4"),
  later: P("M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z"),
  news: P("M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7M7 16h4"),
  ban: P("M5.6 5.6l12.8 12.8M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z"),
  move: P("M3 6h6l2 2h10v11H3zM12 13h6M15 10l3 3-3 3"),
  order: P("M6 3h9l3 3v15H6zM9 12h6M12 9v6"),
  file: P("M4 5h7l2 2h7v12H4zM8 13h8"),
  goods: P("M4 8h16l-1.5 12h-13zM8 8V6a4 4 0 0 1 8 0v2"),
  folder: P("M3 6h6l2 2h10v11H3z"),
  note: P("M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"),
  person: P("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0M19 8v6M16 11h6"),
  check: P("M4 12l5 5L20 6"),
  repeat: P("M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"),
  more: P("M5 12h.01M12 12h.01M19 12h.01"),
  back: P("M15 5l-7 7 7 7"),
  up: P("M5 15l7-7 7 7"),
  down: P("M5 9l7 7 7-7"),
};

/**
 * Phones, like the iPhone Mail app (Oct 12, Nick): an open email gets "‹ Inbox" to go back and ∧ ∨ for the previous /
 * next email across the top, and its buttons (Reply, Archive, Later, Black Hole, Move) along the bottom of the screen.
 * The page that lists the emails says where back goes and what's before / after; every email header reads it.
 */
export type PhoneNavT = { label: string; back: () => void; up?: () => void; down?: () => void; pos?: string; /** e.g. the Assistant button on a customer email */ extra?: React.ReactNode };
export const PhoneNav = createContext<PhoneNavT | null>(null);

type SwipeTo = "archive" | "news" | "blackhole";
let closeOpenRow: (() => void) | null = null;
/**
 * Phones: slide an email left for News, Black Hole and Archive (like the iPhone Mail app); slide it all the way to
 * archive it. Touch only: on a computer the row is a plain row.
 */
export function SwipeRow({ children, onAct, onHold }: { children: React.ReactNode; onAct: (to: SwipeTo) => Promise<boolean>; /** pressed and held (Oct 15, Nick): the AI menu */ onHold?: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unhold = () => { if (hold.current) { clearTimeout(hold.current); hold.current = null; } };
  useEffect(() => unhold, []);
  /** the touch: where it started, the offset then, and the last few points (for how fast it's moving) */
  const g = useRef<{ x: number; y: number; base: number; on: boolean; off: boolean; pts: { x: number; t: number }[] } | null>(null);
  const swallow = useRef(false);
  const [off, setOffS] = useState(0), [drag, setDrag] = useState(false), [gone, setGone] = useState(false);
  const cur = useRef(0); // the offset now (a quick flick lets go before React has drawn the last move)
  const setOff = (v: number) => { cur.current = v; setOffS(v); };
  const OPEN = 222; // three buttons
  const width = () => ref.current?.offsetWidth || 360;
  const far = () => -Math.max(OPEN + 90, width() * 0.75); // dragged past here, letting go archives it
  const full = off < far();
  const [shut] = useState(() => () => { cur.current = 0; setOffS(0); }); // the same function every render: what's open is remembered by it
  const close = () => { shut(); if (closeOpenRow === shut) closeOpenRow = null; };
  useEffect(() => () => { if (closeOpenRow === shut) closeOpenRow = null; }, [shut]);
  const fire = async (to: SwipeTo) => {
    setGone(true); setOff(to === "archive" ? -width() : cur.current);
    if (closeOpenRow === shut) closeOpenRow = null;
    const ok = await onAct(to);
    if (!ok) { setGone(false); setOff(0); }
  };
  const openIt = () => { setOff(-OPEN); closeOpenRow = shut; };
  return (
    <div className={"sw" + (gone ? " gone" : "") + (off ? " open" : "")} ref={ref}>
      <div className={"sw-acts" + (full ? " full" : "")} style={{ width: Math.max(0, -off) }} aria-hidden={!off}>
        <button type="button" className="sw-later" tabIndex={off ? 0 : -1} onClick={() => void fire("news")}>{TbIcon.news}<span>News</span></button>
        <button type="button" className="sw-bh" tabIndex={off ? 0 : -1} onClick={() => void fire("blackhole")}>{TbIcon.ban}<span>Black Hole</span></button>
        <button type="button" className="sw-arch" tabIndex={off ? 0 : -1} onClick={() => void fire("archive")}>{TbIcon.archive}<span>Archive</span></button>
      </div>
      <div className="sw-row" style={{ transform: off ? `translateX(${off}px)` : undefined, transition: drag ? "none" : undefined }}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch" || gone) return;
          if (closeOpenRow && closeOpenRow !== shut) { closeOpenRow(); closeOpenRow = null; swallow.current = true; }
          g.current = { x: e.clientX, y: e.clientY, base: cur.current, on: false, off: false, pts: [{ x: e.clientX, t: e.timeStamp }] };
          // held still for half a second: the menu (any movement first is a scroll or a swipe instead)
          unhold();
          if (onHold && !cur.current) hold.current = setTimeout(() => {
            hold.current = null;
            const s = g.current; if (!s || s.on) return;
            s.off = true; swallow.current = true;
            try { navigator.vibrate?.(12); } catch { /* not on iPhone */ }
            onHold();
          }, 480);
        }}
        onPointerMove={(e) => {
          const s = g.current; if (!s || s.off) return;
          const dx = e.clientX - s.x, dy = e.clientY - s.y;
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) unhold();
          if (!s.on) {
            // easier to start (Oct 15, Nick: "sliding is a little difficult… pop open a little quick"): sideways wins
            // unless it's clearly a scroll
            if (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx) * 1.3) { s.off = true; return; }
            if (Math.abs(dx) < 6) return;
            s.on = true; setDrag(true);
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ }
          }
          s.pts.push({ x: e.clientX, t: e.timeStamp }); if (s.pts.length > 5) s.pts.shift();
          // a little resistance past the buttons, so a flick doesn't throw it all the way to Archive
          let v = s.base + dx;
          if (v < -OPEN) v = -OPEN + (v + OPEN) * 0.75;
          setOff(Math.max(-width(), Math.min(0, v)));
        }}
        onPointerUp={(e) => {
          unhold();
          const s = g.current; g.current = null; setDrag(false);
          if (!s?.on) { if (s && !s.off && s.base) { swallow.current = true; close(); } return; }
          swallow.current = true;
          const o = cur.current;
          // how fast, over the last moment of the touch (px per ms; minus = left)
          const a = s.pts[0], b = { x: e.clientX, t: e.timeStamp }, speed = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
          if (o < far()) void fire("archive");
          else if (speed < -0.25) openIt(); // a quick flick left opens it, however short
          else if (speed > 0.25) close(); // a flick right closes it
          else if (o < -50) openIt(); // or pulled a little way
          else close();
        }}
        onContextMenu={(e) => { if (onHold && (hold.current || swallow.current)) e.preventDefault(); }}
        onPointerCancel={() => { unhold(); g.current = null; setDrag(false); if (cur.current > -50) close(); else openIt(); }}
        onClickCapture={(e) => { if (swallow.current) { swallow.current = false; e.preventDefault(); e.stopPropagation(); } }}>
        {children}
      </div>
    </div>
  );
}
export function Toolbar({ children }: { children: React.ReactNode }) { return <div className="tb" role="toolbar" aria-label="Email actions">{children}</div>; }
/** a section of the toolbar; label: the little header above it (Oct 14, Nick: Email · Move · Spam · Actions) */
export function TbGroup({ children, label }: { children: React.ReactNode; label?: string }) {
  if (!label) return <div className="tb-g">{children}</div>;
  return <div className="tb-g tb-sec" role="group" aria-label={label}><span className="tb-sec-l" aria-hidden>{label}</span>{children}</div>;
}
/** one line of the toolbar (Oct 14, Nick: "always two lines, never three"): it never wraps; when it runs out of room
 *  the buttons drop their words (icon + tooltip) instead. r1: Email · Move · Spam; r2: Actions · Messages */
export function TbRow({ children, line }: { children: React.ReactNode; line: 1 | 2 }) { return <div className={`tb-row r${line}`}>{children}</div>; }
export function TbBtn({ icon, label, onClick, kind, disabled, title }: { icon: React.ReactNode; label: string; onClick?: () => void; kind?: "primary" | "danger" | "strong"; disabled?: boolean; title?: string }) {
  return <button type="button" className={"tb-b" + (kind ? " " + kind : "")} onClick={onClick} disabled={disabled} title={title || label}>{icon}<span className="tb-l">{label}</span></button>;
}
/** a toolbar button that opens a menu */
export function TbMenu({ icon, label, children, kind }: { icon: React.ReactNode; label: string; children: (close: () => void) => React.ReactNode; kind?: "strong" }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; }; document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, []);
  return (
    <details className="tb-m" ref={ref}>
      <summary className={"tb-b" + (kind ? " " + kind : "")} title={label}>{icon}<span className="tb-l">{label}</span><span className="tb-caret" aria-hidden>▾</span></summary>
      <div className="tb-menu" role="menu">{children(() => { if (ref.current) ref.current.open = false; })}</div>
    </details>
  );
}

/** what an open email can do, for the phone's bottom bar */
export type PhoneActs = { reply?: () => void; /** Forward (greyed when the email can't be forwarded from here) */ forward?: () => void;
  move?: (to: string, label: string, confirmed?: boolean) => void; here?: string; folders?: Folder[] | null; busy?: boolean;
  /** the More sheet's own sections (Actions, Messages…): <PSec> blocks of <PTile>/<PPick>; Move & spam is added after them */
  more?: (close: () => void) => React.ReactNode;
  /** the sender is a customer (their name): Black Hole asks first */ known?: string;
  /** the Assistant: say what to tell them, it writes the reply (id: a customer email's id, "inbox:<id>" or "box:<uid>:<folder>") */
  ask?: { id: string; who?: string; onDraft: (d: Draft) => void; openChat?: () => void } };

/** a section of the phone's More sheet: a small header, then its buttons as tiles */
export function PSec({ label, children }: { label: string; children: React.ReactNode }) {
  return <><div className="pbar-t">{label}</div><div className="ps-grid">{children}</div></>;
}
/** a button in the phone's More sheet: icon over a word, like the iPhone's share sheet */
export function PTile({ icon, label, onClick, href, kind, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string; kind?: "primary" | "danger"; disabled?: boolean }) {
  const cls = "ps-t" + (kind ? " " + kind : "");
  if (href) return <a className={cls} href={href} onClick={onClick} role="menuitem">{icon}<span>{label}</span></a>;
  return <button type="button" className={cls} onClick={onClick} disabled={disabled} role="menuitem">{icon}<span>{label}</span></button>;
}
/** a tile that opens its choices right under the tiles (File under, Project, Order notes) */
export function PPick({ icon, label, items, empty, extra }: { icon: React.ReactNode; label: string; items: { key: string; label: React.ReactNode; on?: boolean; onClick: () => void }[]; empty?: string; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={"ps-t" + (open ? " open" : "")} onClick={() => setOpen(!open)} aria-expanded={open}>{icon}<span>{label}</span></button>
      {open && <div className="ps-list" role="menu">
        {items.map((it) => <button key={it.key} type="button" role="menuitem" className={it.on ? "on" : ""} onClick={it.onClick}>{it.label}</button>)}
        {!items.length && <span className="faint">{empty || "Nothing to pick yet."}</span>}
        {extra}
      </div>}
    </>
  );
}
/**
 * Phones (Oct 14, Nick: "reimagine a cleaner look"): five buttons along the bottom, where your thumb is: Archive, Black
 * Hole, Reply, Forward (Nick's pick, Oct 14), More; Move is in More. More slides up a sheet with every other button as tiles, under the same section names as the
 * computer's toolbar (Actions, Messages, Move & spam). The main next step (Create order / reorder) and the Assistant's
 * microphone sit in the AI card at the top of the email. A button an email can't use stays in its place, greyed out.
 */
function PhoneBar({ a }: { a: PhoneActs }) {
  const [sheet, setSheet] = useState<"" | "move" | "more" | "bh">("");
  const [askBH, setAskBH] = useState(false);
  const [voice, setVoice] = useState<{ l: ReturnType<typeof startListening> } | null>(null);
  const others = (a.folders || []).filter((f) => f.path !== a.here && !/\\(Drafts|Junk)/.test(f.special));
  const close = () => { setSheet(""); setAskBH(false); };
  const mv = (to: string, label: string, confirmed?: boolean) => { close(); a.move?.(to, label, confirmed); };
  const off = !a.move || !!a.busy;
  const bh = "Black Hole: SaneBox won't show you this sender again.";
  return (
    <>
      <nav className="pbar" aria-label="Email actions">
        <button type="button" className="pbar-b" disabled={off} onClick={() => mv("archive", "Archived.")}>{TbIcon.archive}<span>Archive</span></button>
        <button type="button" className="pbar-b danger" disabled={off} onClick={() => (a.known ? (setSheet("bh"), setAskBH(true)) : mv("blackhole", bh))}>{TbIcon.ban}<span>Black Hole</span></button>
        <button type="button" className="pbar-b" disabled={!a.reply} onClick={() => { a.reply?.(); window.scrollTo({ top: 0 }); }}>{TbIcon.reply}<span>Reply</span></button>
        <button type="button" className="pbar-b" disabled={!a.forward} onClick={() => a.forward?.()}>{TbIcon.forward}<span>Forward</span></button>
        <button type="button" className="pbar-b" onClick={() => setSheet("more")}>{TbIcon.more}<span>More</span></button>
      </nav>
      {voice && a.ask && <VoiceDraft chatId={a.ask.id} who={a.ask.who} listener={voice.l} onDraft={(d) => { a.ask?.onDraft(d); window.scrollTo({ top: 0 }); }} openChat={a.ask.openChat} onClose={() => setVoice(null)} />}
      {sheet && <div className="pbar-bg" onClick={close}>
        <div className="pbar-sheet" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="ps-grab" aria-hidden />
          {sheet === "move" ? <>
            <div className="pbar-t">Move to</div>
            <button type="button" role="menuitem" disabled={off} onClick={() => mv("news", "Moved to News.")}>{TbIcon.news} News <span>SaneBox: this sender goes to News from now on</span></button>
            {others.map((f) => <button key={f.path} type="button" role="menuitem" disabled={off} onClick={() => mv(f.path, `Moved to ${folderLabel(f)}.`)} style={{ paddingLeft: 16 + Math.min(3, f.depth) * 12 }}>{TbIcon.file} {folderLabel(f)}</button>)}
            {!others.length && <span className="faint" style={{ padding: 12 }}>Loading folders…</span>}
          </> : <>
            {sheet === "more" && a.more?.(close)}
            {sheet === "more" && <PSec label="Move">
              <PTile icon={TbIcon.news} label="News" disabled={off} onClick={() => mv("news", "Moved to News.")} />
              <PTile icon={TbIcon.move} label="Move to…" disabled={off} onClick={() => setSheet("move")} />
              {a.ask && !a.ask.openChat && <PTile icon={<span className="pbar-ic" aria-hidden>✦</span>} label="Say a reply" onClick={() => { close(); setVoice({ l: startListening() }); }} />}
            </PSec>}
            {askBH && <div className="ps-ask" role="alertdialog" aria-label="Black Hole a customer?">
              <span><b>{a.known}</b> is a customer. Black Hole blocks their email from now on. Are you sure?</span>
              <div><button type="button" className="btn danger" onClick={() => mv("blackhole", bh, true)}>Yes, Black Hole</button><button type="button" className="btn ghost" onClick={() => (sheet === "bh" ? close() : setAskBH(false))}>No</button></div>
            </div>}
          </>}
          <button type="button" className="pbar-cancel" onClick={close}>Cancel</button>
        </div>
      </div>}
    </>
  );
}

/** Move (Archive, News, Move to any folder) and Spam (Black Hole): the same groups on every email (News took Later's place Oct 14:
 *  Nick uses SaneBox News, rarely Later; Later is still in Move → SaneBox folders) */
export function MoveBar({ folders, busy, onMove, here, known }: { folders: Folder[] | null; busy?: boolean; onMove: (to: string, label: string, confirmed?: boolean) => void; here?: string;
  /** the sender is a customer (their name): Black Hole asks first (Oct 14, Nick: "keep you from black holing a known customer") */ known?: string }) {
  const [askBH, setAskBH] = useState(false);
  const bh = () => onMove("blackhole", "Black Hole: SaneBox won't show you this sender again.", true);
  const others = (folders || []).filter((f) => f.path !== here && !/\\(Drafts|Junk)/.test(f.special));
  return (
    <>
    {/* Move (Oct 14, Nick: Email · Move · Spam · Actions) */}
    <TbGroup label="Move">
      <TbBtn icon={TbIcon.archive} label="Archive" kind="strong" disabled={busy} onClick={() => onMove("archive", "Archived.")} title="Move it to Archive, like Outlook's Archive button" />
      <TbBtn icon={TbIcon.news} label="News" disabled={busy} onClick={() => onMove("news", "Moved to News.")} title="SaneBox News: this sender's mail goes to News from now on" />
      <TbMenu icon={TbIcon.move} label="Move">{(close) => <>
        {others.map((f) => <button key={f.path} type="button" role="menuitem" disabled={busy} onClick={() => { close(); onMove(f.path, `Moved to ${folderLabel(f)}.`); }} style={{ paddingLeft: 12 + Math.min(3, f.depth) * 10 }}>{folderLabel(f)}</button>)}
        {!others.length && <span className="faint" style={{ padding: 8 }}>Loading folders…</span>}
      </>}</TbMenu>
    </TbGroup>
    {/* Spam */}
    <TbGroup label="Spam">
      {askBH && known ? <span className="tb-ask" role="alertdialog" aria-label="Black Hole a customer?">
        <span><b>{known}</b> is a customer. Black Hole blocks their email from now on. Are you sure?</span>
        <button type="button" className="btn sm danger" disabled={busy} onClick={() => { setAskBH(false); bh(); }}>Yes, Black Hole</button>
        <button type="button" className="btn sm ghost" onClick={() => setAskBH(false)}>Cancel</button>
      </span>
        : <TbBtn icon={TbIcon.ban} label="Black Hole" kind="danger" disabled={busy} onClick={() => (known ? setAskBH(true) : onMove("blackhole", "Black Hole: SaneBox won't show you this sender again."))} title="SaneBox Black Hole: junk, and this sender is blocked from now on" />}
    </TbGroup>
    </>
  );
}

/**
 * The top of an open email, one layout everywhere (Oct 12, Nick: "clean up this area"): the toolbar first (Reply on
 * the left, organize in the middle), then the subject, then who it's from (to / cc fold away), the AI's one-line read
 * and small tags. On a phone the toolbar keeps its icons and drops the words for everything but Reply.
 */
/**
 * An email wider than its frame (a fixed-width newsletter or a big table on a phone) is scaled down to fit, like the
 * iPhone's Mail app, instead of making you scroll sideways (Oct 12, Nick).
 */
export function fitWidth(f: HTMLIFrameElement, d: Document) {
  const b = d.body;
  if (!b) return;
  b.style.zoom = "";
  const w = f.clientWidth, sw = Math.max(d.documentElement.scrollWidth, b.scrollWidth);
  if (w > 0 && sw > w + 2) b.style.zoom = String(Math.max(0.35, w / sw));
}

export function MailHead({ toolbar, phone, subject, tags, fromName, org, fromEmail, to, cc, date, summary, listOpen, toggleList, back, ai }: { /** the AI section's button(s), e.g. Assistant (Oct 14) */ ai?: React.ReactNode;
  toolbar: React.ReactNode; /** phones: the bottom bar's actions */ phone?: PhoneActs; subject: string; /** the sender's company, beside their name */ org?: string; tags?: React.ReactNode; fromName: string; fromEmail: string; to?: string; cc?: string; date: string; summary?: string;
  listOpen: boolean; toggleList: () => void; back?: () => void;
}) {
  const [full, setFull] = useState(false);
  // the AI summary: one line until clicked (Oct 16, Nick: "the AI suggestions is huge"), remembered
  const [aiFull, setAiFull] = useSticky("mail.aiFull", false);
  void listOpen; void toggleList; // the list's hide arrow is gone (Oct 14): the list always shows beside the email
  const nav = useContext(PhoneNav);
  const name = fromName || fromEmail;
  const ini = name.replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "?";
  const names = (v?: string) => (v || "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/<[^>]+>/, "").replace(/"/g, "").trim()).filter(Boolean);
  const toN = names(to), ccN = names(cc);
  const short = [...toN, ...ccN].slice(0, 2).map((x) => x.split(/[\s@]/)[0]).join(", ") + (toN.length + ccN.length > 2 ? ` +${toN.length + ccN.length - 2}` : "");
  return (
    <header className="eh">
      <div className={"eh-bar" + (nav ? " has-pn" : "")}>
        {nav ? <div className="eh-pn">
          <button type="button" className="eh-pn-back" onClick={nav.back}>{TbIcon.back}<span>{nav.label}</span></button>
          {nav.pos && <span className="eh-pn-pos">{nav.pos}</span>}
          {nav.extra}
          <button type="button" className="eh-pn-ud" disabled={!nav.up} onClick={nav.up} aria-label="Previous email">{TbIcon.up}</button>
          <button type="button" className="eh-pn-ud" disabled={!nav.down} onClick={nav.down} aria-label="Next email">{TbIcon.down}</button>
        </div> : null}
        {(nav || back) && <button type="button" className="eh-back" onClick={nav?.back || back} aria-label="Back to the list">{TbIcon.back}</button>}
        {toolbar}
        {nav && <PhoneBar a={phone || {}} />}
      </div>
      {/* AI: the summary and the Assistant button, right under the toolbar, above the email (Oct 14, Nick) */}
      {(summary || tags || ai) && <div className={"eh-ai" + (aiFull ? "" : " mini")} role="group" aria-label="AI">
        <button type="button" className="eh-ai-l" onClick={() => setAiFull(!aiFull)} aria-expanded={aiFull} title={aiFull ? "Show the AI summary on one line" : "Show the whole AI summary and its tags"}><span className="eh-ai-orb">✦</span>AI<span className="eh-ai-car" aria-hidden>{aiFull ? "▴" : "▾"}</span></button>
        <div className="eh-ai-b" onClick={() => { if (!aiFull) setAiFull(true); }}>{summary && <span className="eh-sum">{summary}</span>}{tags && <span className="eh-ai-tags">{tags}</span>}</div>
        {ai}
      </div>}
      {/* Oct 14, Nick: a section header over the email itself, like the toolbar's */}
      <div className="eh-sec" aria-hidden><span>Message</span></div>
      <div className="eh-b">
        <h2 className="eh-subj">{subject || "(no subject)"}</h2>
        <div className="eh-from">
          <span className="eh-av" aria-hidden>{ini}</span>
          <div className="eh-who">
            <div className="eh-n"><b>{name}</b>{org && <span className="eh-org">{org}</span>}{fromName && fromEmail && <span className="eh-addr">{fromEmail}</span>}</div>
            {short && <button type="button" className="eh-to" onClick={() => setFull(!full)} aria-expanded={full}>to {short} <span aria-hidden>{full ? "▴" : "▾"}</span></button>}
            {full && <div className="eh-full">{fromEmail && fromName && <div className="eh-full-from"><span>From</span>{fromEmail}</div>}{to && <div><span>To</span>{to}</div>}{cc && <div><span>Cc</span>{cc}</div>}</div>}
          </div>
          <time className="eh-date">{date}</time>
        </div>
      </div>
    </header>
  );
}

/**
 * Inside an email's frame (Oct 14, Nick: "clean up how the email conversation reads"): one font and size for the whole
 * email, no box, and the earlier emails it quotes folded away (they're in the conversation list) until "Show the
 * earlier emails" is tapped (QuoteToggle puts .show-q on the frame's body). Phones first; the computer too since Oct 15
 * (Nick: "make the full web versions match that style")
 */
export const PHONE_MAIL_CSS = `html,body{padding:0 0 4px!important;font:calc(14.5px*var(--mz,1))/1.32 Aptos,Calibri,"Segoe UI",-apple-system,BlinkMacSystemFont,Arial,sans-serif!important;color:#1d2433}body p,body div,body span,body td,body li,body font,body a,body pre,body b,body strong,body i,body em{font-family:inherit!important;font-size:calc(14.5px*var(--mz,1))!important;line-height:1.32!important}body.fold-q:not(.show-q) blockquote,body.fold-q:not(.show-q) .gmail_quote,body.fold-q:not(.show-q) .yahoo_quoted,body.fold-q:not(.show-q) #divRplyFwdMsg,body.fold-q:not(.show-q) #divRplyFwdMsg~*,body.fold-q:not(.show-q) #appendonsend~*,body.fold-q:not(.show-q) div[type=cite],body.fold-q:not(.show-q) div:has(+blockquote),body.fold-q:not(.show-q) div:has(+br+blockquote){display:none!important}body.show-q blockquote{margin:8px 0!important;padding:0 0 0 10px!important;border-left:2px solid #d5dbe3!important;color:#5a6577}body.show-q blockquote *{color:#5a6577!important}`;
const HEAD = `<base target="_blank"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; form-action 'none'"><style>html,body{margin:0;padding:10px 12px;font:14px/1.45 Calibri,Segoe UI,Arial,sans-serif;color:#222;background:#fff;overflow-x:auto}img{max-width:100%;height:auto}table img{max-width:none}table{max-width:100%}${PHONE_MAIL_CSS}</style>`;
/** how tall an email's frame needs to be: its content, not the frame's current height (documentElement.scrollHeight
 *  never drops below the frame, so folding the quoted emails away left a blank gap) */
export function frameHeight(d: Document) {
  const cs = d.defaultView?.getComputedStyle(d.documentElement);
  const pad = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
  return Math.max(d.body.scrollHeight, d.body.offsetHeight) + pad + 4;
}
const QUOTED = /<blockquote|gmail_quote|yahoo_quoted|divRplyFwdMsg|appendonsend/i;
/** "Show the earlier emails" under an email whose quoted replies are folded away (PHONE_MAIL_CSS) */
export function QuoteToggle({ html, frame, fit }: { html: string | null; frame: React.RefObject<HTMLIFrameElement | null>; fit: () => void }) {
  const [on, setOn] = useState(false), [folded, setFolded] = useState(false);
  // only a reply's quoted earlier emails are folded: the email has to say "… wrote:" / "From: … Sent:" / "Original
  // Message" and have the quote (Oct 15: a marketing email's own layout was folded away as if it were a quote)
  useEffect(() => {
    setOn(false); setFolded(false);
    if (!html || !QUOTED.test(html) || !/wrote:|-----\s*Original Message|From:[\s\S]{1,300}?Sent:|divRplyFwdMsg|gmail_quote/i.test(html)) return;
    let n = 0;
    const t = setInterval(() => {
      const d = frame.current?.contentDocument;
      if (++n > 25) { clearInterval(t); return; }
      if (!d?.body || d.readyState !== "complete") return;
      clearInterval(t);
      if (!d.querySelector("blockquote, .gmail_quote, .yahoo_quoted, #divRplyFwdMsg, #appendonsend")) return;
      d.body.classList.add("fold-q"); setFolded(true); setTimeout(fit, 30); setTimeout(fit, 300);
    }, 200);
    return () => clearInterval(t);
  }, [html]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!folded) return null;
  const flip = () => { const b = frame.current?.contentDocument?.body; if (!b) return; b.classList.toggle("show-q", !on); setOn(!on); setTimeout(fit, 30); setTimeout(fit, 300); };
  return <button type="button" className="ibx-q" onClick={flip} aria-expanded={on}>{on ? "Hide the earlier emails" : "··· Show the earlier emails"}</button>;
}
/** an email's body, the way Outlook shows it (sandboxed, links open in a new tab), or its text */
/** "Opening…", then after a few seconds why it can take a while (Oct 13) */
export function OpeningNote() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(t); }, []);
  return <>{slow ? "Still opening: this one is coming from the mail server, and a big email can take up to a minute the first time…" : "Opening the email…"}</>;
}

export function MailFrame({ html, text }: { html: string; text: string }) {
  const [h, setH] = useState(200), ref = useRef<HTMLIFrameElement | null>(null), [plain, setPlain] = useState(false);
  const doc = useMemo(() => {
    if (!html) return null;
    const x = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    return /<head[^>]*>/i.test(x) ? x.replace(/<head[^>]*>/i, (m) => m + HEAD + `<style>${mzCss()}</style>`) : HEAD + `<style>${mzCss()}</style>` + x;
  }, [html]);
  const fit = () => { const f = ref.current, d = f?.contentDocument; if (!f || !d?.body) return; fitWidth(f, d); setH(Math.min(20000, Math.max(80, frameHeight(d)))); };
  if (!doc || plain) return <div className="lm-text">{text || "(no text)"}{doc && <div><button type="button" className="btn sm ghost" onClick={() => setPlain(false)}>Show as in Outlook</button></div>}</div>;
  return (
    <div className="ibx-html">
      <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={() => { fit(); setTimeout(fit, 400); setTimeout(fit, 1500); }} />
      <QuoteToggle html={doc} frame={ref} fit={fit} />
      <button type="button" className="btn sm ghost" onClick={() => setPlain(true)}>Plain text</button>
    </div>
  );
}

export const attUrl = (path: string, uid: number, i: number) => `/api/mail/box?${new URLSearchParams({ do: "attachment", path, uid: String(uid), i: String(i) })}`;
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Attachments({ m }: { m: FullMsg }) {
  if (!m.attachments.length) return null;
  return <div className="mf-atts">{m.attachments.map((a) => <a key={a.i} href={a.ews ? `/api/mail/box?${new URLSearchParams({ do: "ewsatt", id: a.ews })}` : attUrl(m.folder, m.uid, a.i)} target="_blank" rel="noreferrer" className="mf-att">📎 {a.name}<span>{kb(a.size)}</span></a>)}</div>;
}

/** reply / reply all box (to any email in any folder) */
export function ReplyBox({ m, all, start, startCc, onClose, onSent }: { m: FullMsg; all?: boolean; /** a draft to start from (the Assistant's) */ start?: string; /** who the Assistant was told to copy */ startCc?: string[]; onClose: () => void; onSent: (to: string) => void }) {
  const [body, setBody] = useState(start || ""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [toAll, setToAll] = useState(!!all);
  const [cc, setCc] = useState<string[]>(startCc || []);
  // the email being answered, above the box (Oct 15, Nick: "on the phone you can't see the original email you're replying to")
  const [quoteOpen, setQuoteOpen] = useState(false);
  const quote = useMemo(() => {
    let t = m.text || "";
    if (!t && m.html && typeof DOMParser !== "undefined") { const d = new DOMParser().parseFromString(m.html, "text/html"); d.querySelectorAll("style,script,head,blockquote,.gmail_quote,#divRplyFwdMsg").forEach((n) => n.remove()); t = d.body?.innerText || d.body?.textContent || ""; }
    return t.replace(/\r/g, "").split(/\n\s*(?:On .{5,160} wrote:|-----\s*Original Message|From: .{3,200}\n\s*(?:Sent|Date): )/)[0].replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
  }, [m.text, m.html]);
  return (
    <div className="ibx2-compose open mf-reply">
      {quote && <div className={"mf-quote" + (quoteOpen ? " open" : "")}>
        <div className="mf-quote-h"><b>{m.fromName || m.fromAddress}</b><span className="faint"> · {new Date(m.date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>
        <div className="mf-quote-t">{quote}</div>
        {quote.length > 220 && <button type="button" className="linkbtn" onClick={() => setQuoteOpen(!quoteOpen)}>{quoteOpen ? "Show less" : "Show the whole email"}</button>}
      </div>}
      <div className="ibx2-to"><span>{toAll ? "Reply all" : "Reply"} to {m.fromName || m.fromAddress}</span><label className="check" style={{ marginLeft: "auto" }}><input type="checkbox" checked={toAll} onChange={(e) => setToAll(e.target.checked)} />Everyone on it</label></div>
      <CcField value={cc} onChange={setCc} text={body} />
      <textarea rows={7} autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your reply" aria-label="Reply" />
      <SayButton chatId={`box:${m.uid}:${m.folder}`} who={m.fromName || m.fromAddress} onDraft={(d) => { setBody(d.body); if (d.cc?.length) setCc((c) => [...new Set([...c, ...d.cc!])]); }} />
      {err && <div className="pv-err">{err}</div>}
      <div className="ibx2-send">
        <button type="button" className="btn primary" disabled={busy || !body.trim()} onClick={async () => { setBusy(true); setErr(""); try { const r = await boxPost<{ to: string }>({ do: "reply", path: m.folder, uid: m.uid, body, all: toAll, cc }); onSent(r.to);
            // the Email page offers the follow-ups this reply promises (a to-do or event on My Day)
            window.dispatchEvent(new CustomEvent("fbs:sent", { detail: { msg: `Sent to ${r.to}.`, sent: { to: r.to, subject: m.subject, body, theirs: m.text || "" } } })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(false); }}>{busy ? "Sending…" : "Send"}</button>
        <span className="faint">Your signature and their email go underneath.</span>
        <span className="spacer" />
        <button type="button" className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

const when = (d: string) => { const x = new Date(d), t = new Date(); return x.toDateString() === t.toDateString() ? x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : x.getFullYear() === t.getFullYear() ? x.toLocaleDateString([], { month: "short", day: "numeric" }) : x.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); };

/** a folder's emails (Sent shows who it went to) */
export function FolderList({ rows, sel, onPick, onSwipe, sentBox, more, onMore, loading }: { rows: MsgRow[] | null; sel: string; onPick: (r: MsgRow) => void; onSwipe?: (r: MsgRow, to: SwipeTo) => Promise<boolean>; sentBox: boolean; more: boolean; onMore: () => void; loading: boolean }) {
  if (!rows) return <div className="ibx2-none">Loading…</div>;
  if (!rows.length) return <div className="ibx2-none">This folder is empty.</div>;
  return (
    <>
      {rows.map((r) => {
        const k = `${r.folder}:${r.uid}`;
        const row = (
          <button key={k} data-id={k} type="button" className={"ibx2-item ol" + (sel === k ? " on" : "") + (!r.seen && !r.sent ? " ol-unread" : "")} onClick={() => onPick(r)}>
            <span className="ibx2-item-1"><b>{sentBox || r.sent ? `${(r.toNames?.length ? r.toNames : r.to)[0] || ""}${r.to.length > 1 ? ` +${r.to.length - 1}` : ""}` : r.fromName || r.from}</b>{r.flagged && <span className="ibx2-flag">⚑</span>}<time>{when(r.date)}</time></span>
            <span className="ibx2-item-2">{r.subject || "(no subject)"}</span>
          </button>
        );
        return onSwipe ? <SwipeRow key={k} onAct={(to) => onSwipe(r, to)}>{row}</SwipeRow> : row;
      })}
      {more && <button type="button" className="btn sm ghost mf-older" disabled={loading} onClick={onMore}>{loading ? "Loading…" : "Older emails"}</button>}
    </>
  );
}

/** one email from any folder: read it, reply, move it */
export function FolderMail({ row, folders, onGone, toggleList, listOpen, back, flash }: { row: MsgRow; folders: Folder[] | null; onGone: () => void; toggleList: () => void; listOpen: boolean; back: () => void; flash: (t: string) => void }) {
  const [m, setM] = useState<FullMsg | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [rep, setRep] = useState<"" | "one" | "all">(""), [draft, setDraft] = useState<{ body: string; cc?: string[]; n: number } | null>(null);
  const [n, setN] = useState(0), [full, setFull] = useState(false);
  useEffect(() => {
    let live = true; setM(null); setErr("");
    const slow = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The mailbox didn't answer in time.")), 56000));
    Promise.race([box<FullMsg>({ do: "message", path: row.folder, uid: row.uid, ...(full ? { live: 1 } : {}) }), slow]).then((x) => live && setM(x), (e) => live && setErr(e.message));
    return () => { live = false; };
  }, [row.folder, row.uid, n, full]);
  useEffect(() => { setFull(false); }, [row.folder, row.uid]);
  const move = async (to: string, label: string) => { setBusy(true); try { await boxPost({ do: "move", path: row.folder, uid: row.uid, to }); flash(label); onGone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(false); };
  return (
    <div className="ibx2-work ibx2-solo">
      <section className="ibx2-mail" aria-label="Email">
        <MailHead listOpen={listOpen} toggleList={toggleList} back={back} subject={row.subject} fromName={row.fromName} fromEmail={row.from} to={m?.to} cc={m?.cc}
          phone={{ reply: m ? () => setRep("one") : undefined, move, here: row.folder, folders, busy,
            ask: { id: `box:${row.uid}:${row.folder}`, who: row.fromName || row.from, onDraft: (d) => { setDraft((x) => ({ body: d.body, cc: d.cc || [], n: (x?.n || 0) + 1 })); setRep("one"); } },
            more: m ? (close) => <PSec label="Email"><PTile icon={TbIcon.replyAll} label="Reply all" onClick={() => { close(); setRep("all"); }} /></PSec> : undefined }}
          date={new Date(row.date).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          toolbar={<Toolbar>
            <TbGroup label="Email">
              <TbBtn icon={TbIcon.reply} label="Reply" kind="primary" disabled={!m} onClick={() => setRep("one")} />
              <TbBtn icon={TbIcon.replyAll} label="Reply all" disabled={!m} onClick={() => setRep("all")} />
            </TbGroup>
            <MoveBar folders={folders} busy={busy} onMove={move} here={row.folder} />
          </Toolbar>} />
        {err && <div className="pv-err eh-err">{err}</div>}
        <div className="ibx2-read">
          {!m ? <div className="ibx2-none">{err ? <button type="button" className="btn ghost sm" onClick={() => setN((x) => x + 1)}>Try again</button> : <OpeningNote />}</div> : <>
            {m.partial && <div className="mf-partial">Opened fast: big pictures and attachments in this email aren&apos;t shown here. <button type="button" className="btn ghost sm" onClick={() => setFull(true)}>Show the full email</button></div>}
            <MailFrame html={m.html} text={m.text} />
            <Attachments m={m} />
          </>}
        </div>
        {rep && m && <ReplyBox key={draft?.n || 0} m={m} all={rep === "all"} start={draft?.body} startCc={draft?.cc} onClose={() => { setRep(""); setDraft(null); }} onSent={(to) => { setRep(""); setDraft(null); flash(`Sent to ${to}.`); }} />}
      </section>
    </div>
  );
}

/** search results as conversations */
/** the start of each email's text, kept for the page's life (PersonTimeline previews) */
const previews = new Map<string, string>();
const previewOf = (f: FullMsg) => {
  let t = f.text || "";
  if (!t && f.html) { const d = new DOMParser().parseFromString(f.html, "text/html"); d.querySelectorAll("style,script,head,blockquote,.gmail_quote").forEach((n) => n.remove()); t = d.body?.textContent || ""; }
  return t.replace(/\r/g, "").split(/\n\s*(?:On .{5,160} wrote:|-----\s*Original Message|From: .{3,200}\n\s*(?:Sent|Date): )/)[0]
    .replace(/^(hi|hey|hello|good (morning|afternoon))\b[^\n]{0,40}\n/i, "").replace(/\s+/g, " ").trim().slice(0, 240);
};
/**
 * Everything with one person or customer, email by email, compact like the Inbox (Oct 15, Nick: "show it like before,
 * just a from or to indicator… and a little more text so we can see what's in the email"): each row says From (theirs)
 * or To (mine), who, the date, the subject and the start of what it says (read as the rows come into view); a tap
 * opens its conversation.
 */
export function PersonTimeline({ convos, me, onOpen }: { convos: Convo[]; me: string; onOpen: (c: Convo) => void }) {
  const [newest, setNewest] = useState(true);
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [, bump] = useState(0);
  const isMine = (m: MsgRow) => m.sent || m.from.toLowerCase() === me;
  const every = useMemo(() => {
    const seen = new Set<string>(), out: { m: MsgRow; c: Convo }[] = [];
    for (const c of convos) for (const m of c.msgs) { const k = m.messageId || `${m.folder}:${m.uid}`; if (seen.has(k)) continue; seen.add(k); out.push({ m, c }); }
    return out.sort((a, b) => (newest ? b.m.date.localeCompare(a.m.date) : a.m.date.localeCompare(b.m.date)));
  }, [convos, newest]);
  const nOut = every.filter((x) => isMine(x.m)).length, nIn = every.length - nOut;
  // the From / To toggle (Oct 15, Nick: "a little toggle above the search results, to and from")
  const items = useMemo(() => (dir === "all" ? every : every.filter((x) => isMine(x.m) === (dir === "out"))), [every, dir]); // eslint-disable-line react-hooks/exhaustive-deps
  // previews for the rows on screen (and just below), three at a time
  const want = useRef<MsgRow[]>([]), busy = useRef(0), asked = useRef(new Set<string>());
  const pump = () => {
    while (busy.current < 3 && want.current.length) {
      const m = want.current.shift()!, k = `${m.folder}:${m.uid}`;
      busy.current++;
      box<FullMsg>({ do: "message", path: m.folder, uid: m.uid }).then((f) => { previews.set(k, previewOf(f) || " "); }).catch(() => { previews.set(k, " "); })
        .finally(() => { busy.current--; bump((n) => n + 1); pump(); });
    }
  };
  const ask = (m: MsgRow) => { const k = `${m.folder}:${m.uid}`; if (previews.has(k) || asked.current.has(k)) return; asked.current.add(k); want.current.push(m); pump(); };
  const io = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    io.current = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const el = e.target as HTMLElement; const it = items[Number(el.dataset.i)]; if (it) ask(it.m); io.current?.unobserve(el); } }, { rootMargin: "300px 0px" });
    document.querySelectorAll<HTMLElement>(".pt-row[data-i]").forEach((el) => io.current?.observe(el));
    return () => io.current?.disconnect();
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="pt-bar">
        <span className="pt-seg" role="group" aria-label="Show">
          {([["all", "All", every.length], ["in", "From", nIn], ["out", "Sent", nOut]] as const).map(([k, t, n]) => (
            <button key={k} type="button" aria-pressed={dir === k} className={dir === k ? "on" : ""} onClick={() => setDir(k)}>{t} <small>{n}</small></button>
          ))}
        </span>
        <button type="button" className="linkbtn" onClick={() => setNewest(!newest)}>{newest ? "Newest first ↓" : "Oldest first ↑"}</button></div>
      {items.map(({ m, c }, i) => {
        const mine = isMine(m);
        const them = mine ? (m.toNames?.length ? m.toNames : m.to).filter((x) => x.toLowerCase() !== me).slice(0, 2).join(", ") : m.fromName || m.from;
        const pv = previews.get(`${m.folder}:${m.uid}`);
        return (
          <button key={m.messageId || `${m.folder}:${m.uid}`} data-i={i} type="button" className={"ibx2-item ol pt-row " + (mine ? "out" : "in") + (!m.seen && !mine ? " ol-unread" : "")} onClick={() => onOpen(c)}>
            <span className="ibx2-item-1">
              <span className={"pt-dir " + (mine ? "out" : "in")}>{mine ? "To" : "From"}</span>
              <b>{them || (mine ? "—" : m.from)}</b>
              <time>{when(m.date)}</time>
            </span>
            <span className="ibx2-item-s">{m.subject || "(no subject)"}</span>
            <span className="ibx2-item-2 pt-pv">{pv === undefined ? "…" : pv.trim() || ""}</span>
          </button>
        );
      })}
    </>
  );
}

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

/** one conversation, oldest first, the emails in between folded when there are many (Oct 13, Nick); the newest open at the bottom */
export function ThreadView({ c, folders, toggleList, listOpen, back, flash, onMoved }: { c: Convo; folders: Folder[] | null; toggleList: () => void; listOpen: boolean; back: () => void; flash: (t: string) => void; onMoved: (m: MsgRow) => void }) {
  const last = c.msgs[c.msgs.length - 1];
  const [open, setOpen] = useState<Record<string, boolean>>({ [`${last.folder}:${last.uid}`]: true });
  const [full, setFull] = useState<Record<string, FullMsg | "err">>({});
  const [rep, setRep] = useState<FullMsg | null>(null), [repStart, setRepStart] = useState(""), [repCc, setRepCc] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [why, setWhy] = useState<Record<string, string>>({});
  const asked = useRef<Set<string>>(new Set());
  // open one email: from the cache (instant), or from the mailbox (`live`: the full email, pictures and all). A read
  // that takes over 30 s shows "Try again" instead of "Opening…" forever (Oct 13, Margaret Trame's conversation)
  const load = (m: MsgRow, live = false) => {
    const k = `${m.folder}:${m.uid}`;
    if (!live && (full[k] || asked.current.has(k))) return;
    asked.current.add(k);
    if (live) setFull((f) => { const n = { ...f }; delete n[k]; return n; });
    const slow = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The mailbox didn't answer in time.")), 56000));
    Promise.race([box<FullMsg>({ do: "message", path: m.folder, uid: m.uid, ...(live ? { live: 1 } : {}) }), slow])
      .then((x) => setFull((f) => ({ ...f, [k]: x })), (e) => { asked.current.delete(k); setWhy((w) => ({ ...w, [k]: e instanceof Error ? e.message : "" })); setFull((f) => ({ ...f, [k]: "err" })); });
  };
  // long conversations: the first email, "N more emails", and the last few (Oct 13, Nick); the newest open at the bottom
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); load(last); setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 300); }, [c.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const FOLD = c.msgs.length > 3 && !showAll;
  const shown: (MsgRow | "more")[] = FOLD ? [c.msgs[0], "more", c.msgs[c.msgs.length - 1]] : c.msgs;
  const toggle = (m: MsgRow) => { const k = `${m.folder}:${m.uid}`; setOpen((o) => ({ ...o, [k]: !o[k] })); load(m); };
  const lastIn = [...c.msgs].reverse().find((m) => !m.sent) || last;
  // a customer's email in this conversation (stored when it came in): Create order / reorder from it, from here too
  // (Oct 12, Nick: replied "got it, thanks" and couldn't make the order from the conversation)
  const [orderAct, setOrderAct] = useState<{ id: string; reorder: boolean } | null>(null);
  useEffect(() => {
    const ids = [...new Set(c.msgs.map((m) => m.messageId).filter(Boolean))];
    if (!ids.length) return;
    const variants = [...new Set(ids.flatMap((m) => { const b = m.replace(/^<|>$/g, ""); return [b, `<${b}>`]; }))];
    let live = true;
    void createClient().from("activities").select("id, direction, customer_id, occurred_at, meta").eq("kind", "email").in("external_id", variants).order("occurred_at", { ascending: false }).then(({ data }) => {
      if (!live) return;
      const rows = (data || []) as { id: string; direction: string; customer_id: string | null; meta: { triage?: { intent?: string } } | null }[];
      const hit = rows.find((r) => r.direction === "in" && r.customer_id);
      setOrderAct(hit ? { id: hit.id, reorder: rows.some((r) => r.meta?.triage?.intent === "reorder") } : null);
    });
    return () => { live = false; };
  }, [c.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const orderHref = orderAct ? `/shop/email-order/${orderAct.id}` : "";
  const orderLabel = orderAct?.reorder ? "Create reorder" : "Create order";
  const replyLast = () => { const k = `${lastIn.folder}:${lastIn.uid}`; const f = full[k]; if (f && f !== "err") setRep(f); else { load(lastIn); box<FullMsg>({ do: "message", path: lastIn.folder, uid: lastIn.uid }).then(setRep); } };
  return (
    <div className="ibx2-work ibx2-solo">
      <section className="ibx2-mail" aria-label="Conversation">
        <MailHead listOpen={listOpen} toggleList={toggleList} back={back} subject={c.subject} fromName={c.people.join(", ")} fromEmail="" date={`${c.count} email${c.count === 1 ? "" : "s"}`}
          tags={orderAct ? <a className="eh-tag order" href={orderHref}>＋ {orderLabel}</a> : undefined}
          phone={{ reply: replyLast, more: (close) => <>
            {orderAct && <PSec label="Actions"><PTile icon={TbIcon.order} label={orderLabel} kind="primary" href={orderHref} onClick={close} /></PSec>}
          </>, ask: { id: `box:${lastIn.uid}:${lastIn.folder}`, who: lastIn.fromName || lastIn.from, onDraft: (d) => { setRepStart(d.body); setRepCc(d.cc || []); replyLast(); } } }}
          toolbar={<Toolbar>
            <TbGroup label="Email"><TbBtn icon={TbIcon.reply} label="Reply" kind="primary" onClick={replyLast} /></TbGroup>
            <span className="faint mf-hint">Oldest at the top, newest at the bottom. Click an email to open or fold it.</span>
          </Toolbar>} />
        <div className="ibx2-read mf-thread">
          {shown.map((m) => {
            if (m === "more") return <button key="more" type="button" className="mf-more" onClick={() => setShowAll(true)}>▾ {c.msgs.length - 2} more email{c.msgs.length - 2 === 1 ? "" : "s"} in between</button>;
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
                  {!f ? <div className="faint"><OpeningNote /></div> : f === "err" ? <div className="pv-err">Couldn&apos;t open this one{why[k] ? `: ${why[k]}` : "."} <button type="button" className="btn ghost sm" onClick={() => load(m, true)}>Try again</button></div> : <>
                    {f.partial && <div className="mf-partial">Opened fast: big pictures and attachments in this email aren&apos;t shown here. <button type="button" className="btn ghost sm" onClick={() => load(m, true)}>Show the full email</button></div>}
                    <MailFrame html={f.html} text={f.text} />
                    <Attachments m={f} />
                    <div className="mf-msg-a tb">
                      <TbGroup><TbBtn icon={TbIcon.reply} label="Reply" onClick={() => setRep(f)} /></TbGroup>
                      <MoveBar folders={folders} here={m.folder} onMove={async (to, label) => { try { await boxPost({ do: "move", path: m.folder, uid: m.uid, to }); flash(label); onMoved(m); } catch (e) { flash(e instanceof Error ? e.message : String(e)); } }} />
                    </div>
                  </>}
                </div>}
              </article>
            );
          })}
          <div ref={endRef} />
        </div>
        {rep && <ReplyBox key={repStart} m={rep} start={repStart} startCc={repCc} onClose={() => { setRep(null); setRepStart(""); }} onSent={(to) => { setRep(null); setRepStart(""); flash(`Sent to ${to}. It shows in the conversation next time you search.`); }} />}
      </section>
    </div>
  );
}

export type MailView = { kind: "inbox" } | { kind: "folder"; path: string } | { kind: "search"; q: string; /** a person or customer picked from the suggestions: their addresses */ who?: string[];
  /** a recent project picked from the suggestions (Oct 15, Nick): the words that name it, and whose it is */ about?: string; cust?: string };
export const isTyping = (e: React.KeyboardEvent) => e.key === "Enter";
