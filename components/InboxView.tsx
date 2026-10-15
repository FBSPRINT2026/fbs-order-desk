"use client";
import CcField from "@/components/CcField";
import Link from "next/link";
import HistoryLink from "@/components/HistoryLink";
import { AppStartToggle } from "@/components/AppStart";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { mailRows } from "@/lib/inbox";
import { convoKeys, groupConvos } from "@/lib/mail/convo";
import { keepInboxEmail, addEmailToOrderNotes, setEmailProject, forwardEmail, archiveOutlookEmail, getOutlookInbox, readInboxEmail, replyInboxEmail, type InboxItem } from "@/app/shop/mail-actions";
import { addEvent, addTask, inboxBrief, inboxItemExtras, setEventStatus, setTaskDone, suggestFollowUps, type Brief, type CalEvent, type FollowUp, type Task } from "@/app/shop/myday-actions";
import { AREAS } from "@/components/MyDay";
import { onPullRefresh } from "@/components/PullRefresh";
import { emailIsMine, personName, senderLabel } from "@/lib/mail/sender";
import { orderGoodsHref, pieceCount } from "@/lib/pieces";
import { cheerWin } from "@/components/Cheer";
import { SayButton } from "@/components/VoiceDraft";
import { Attachments, OpeningNote, box as mailBox, boxPost, fitWidth, MailHead, PhoneNav, PSec, PTile, PPick, PHONE_MAIL_CSS, QuoteToggle, frameHeight, SwipeRow, type PhoneNavT, Toolbar, TbGroup, TbRow, TbBtn, TbMenu, TbIcon, ConvoList, FolderBar, FolderList, FolderMail, folderLabel, MailFrame, MoveBar, ThreadView, type Convo, type Folder, type FullMsg, type MailView, type MsgRow } from "@/components/MailFolders";
import { checkMailNow, connectMailbox, customerFromEmail, disconnectMailbox, getMailPrefs, getMailStatus, getSignature, setMailPrefs, markNotCustomer, refreshSignature, sendEmailReply, setEmailCustomer, setEmailOrder, setSignatureOn } from "@/app/shop/mail-actions";
import { aiReplyOptions, aiWriteReply, markNoReply, noteEmailChat, putBackInInbox } from "@/app/shop/ai-actions";
import EmailOrderPanel from "@/components/EmailOrderPanel";
import EmailChat from "@/components/EmailChat";
import type { EmailAction } from "@/lib/ai/emailChat";

/**
 * Inbox (reworked Oct 9, Nick: "it doesn't flow… too much information spread out… buttons in weird spots").
 * Three columns, each with one job:
 *  - the list: who, what it's about in one line, how long they've waited;
 *  - the email: who and the subject, one row of buttons (the everyday ones; the rest under More), the email, and the
 *    answer box docked at the bottom like Outlook. Create order swaps the email for the order in the same column;
 *  - the Assistant: what the email is, a short conversation, and the next steps as buttons. It stays open the whole
 *    time, while answering or making the order.
 * Vendors, newsletters and personal mail never get here (they're skipped, not stored).
 * My Inbox (Oct 12): your Outlook Inbox as it is right now, mirrored every couple of minutes (lib/mail/mirror.ts).
 * What's left in it is the to-do list: archive in Outlook and it's gone here; Archive here archives it in Outlook.
 * Customer email opens as usual; anything else shows the sender and subject only (the portal doesn't keep it).
 */
type Act = { id: string; customer_id: string | null; order_id: string | null; project_id?: string | null; direction: string; subject: string; body: string; from_email: string; to_email: string; external_id: string | null; thread_id: string | null; occurred_at: string; meta: { account_id?: string; account?: string; from_name?: string; lead?: boolean; ignored?: boolean; no_reply?: boolean; match?: string; references?: string[]; attachments?: { name: string; path: string; type: string; size: number; from_link?: string; source?: string }[]; links?: { url: string; kind: string; ok: boolean; error?: string }[]; html?: string; inline?: Record<string, string>; triage?: { intent?: string; summary?: string; urgency?: string; urgent_reason?: string; needs_reply?: boolean }; reply_options?: { at: string; options: { label: string; subject: string; body: string }[] } } };
type Sug = { id: string; kind: string; status: string; activity_id: string | null; title: string; body: string; draft: { subject?: string; body?: string } | null; payload: { groups?: unknown[] } | null; order_id: string | null };
type Cust = { id: string; company: string | null; name: string | null; email?: string | null };
type Ord = { id: string; number: number; nickname: string | null; customer_id: string | null; status: string };
type Box = { id: string; email: string; name: string; imap_host: string; enabled: boolean; last_ok_at: string | null; last_error: string | null; last_run_at: string | null; stats: Record<string, Record<string, number>> };
type Status = { mine: Box | null; all: Box[]; defaultHost: string; myEmail: string; /** viewing as this person (read only) */ viewing?: string | null };

const ago = (t: string) => { const m = (Date.now() - new Date(t).getTime()) / 60000; return m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
/** the new part of an email (the quoted thread under it cut off), for the conversation underneath */
const plainNew = (b: string) => { const t = String(b || ""); const m = t.search(/\n\s*(?:On .{6,120}wrote:|-{3,}\s*Original Message|From:\s.+\n\s*(?:Sent|Date):)/i); return (m > 0 ? t.slice(0, m) : t).replace(/\n{3,}/g, "\n\n").trim().slice(0, 1600); };
const INTENT: Record<string, string> = { new_order: "New order", reorder: "Reorder", change_to_order: "Order change", artwork: "Artwork", payment: "Payment", question: "Question", other: "Other" };

type Mode = "mail" | "crm";
type Bk = "all" | "customer" | "todo" | "event" | "fyi";
const BK: { k: Bk; label: string }[] = [{ k: "all", label: "All" }, { k: "customer", label: "Customers" }, { k: "todo", label: "To-dos" }, { k: "event", label: "Events" }, { k: "fyi", label: "FYI" }];
const bucketOf = (i: InboxItem): Bk => (i.activity_id ? "customer" : i.bucket === "todo" || i.bucket === "event" || i.bucket === "fyi" ? i.bucket : i.bucket === "ignore" ? "fyi" : "fyi");

export default function InboxView({ mode }: { mode: Mode }) {
  const [st, setSt] = useState<Status | null>(null);
  const [acts, setActs] = useState<Act[] | null>(null), [sugs, setSugs] = useState<Sug[]>([]), [custs, setCusts] = useState<Map<string, Cust>>(new Map()), [orders, setOrders] = useState<Ord[]>([]);
  // Inbox (mail): your Outlook Inbox, sorted by the AI. Conversations (crm): customer email: Needs reply / Leads / All.
  const [crmTab, setCrmTab] = useSticky<"reply" | "leads" | "all">("inbox.tab", "reply");
  const tab: "outlook" | "reply" | "leads" | "all" = mode === "mail" ? "outlook" : crmTab;
  const setTab = (t: "outlook" | "reply" | "leads" | "all") => { if (t !== "outlook") setCrmTab(t); };
  const [bk, setBk] = useSticky<Bk>("inbox.bucket", "all");
  // Email: the folder list, another folder's emails, and search as conversations (all live from the mailbox)
  const [view, setView] = useState<MailView>({ kind: "inbox" });
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [fRows, setFRows] = useState<MsgRow[] | null>(null), [fMore, setFMore] = useState<{ k: "seq"; n: number } | { k: "cache" | "live"; before: string } | null>(null), [fBusy, setFBusy] = useState(false), [fSel, setFSel] = useState<MsgRow | null>(null), [fErr, setFErr] = useState("");
  const [convos, setConvos] = useState<Convo[] | null>(null), [cSel, setCSel] = useState<Convo | null>(null), [sNote, setSNote] = useState("");
  // the folder list shows at once from last time (kept on this computer: folders hardly ever change), then refreshes
  // quietly: first the list, then the unread counts
  const loadFolders = useCallback(async () => {
    const key = "fbs:mail.folders";
    try { const c = localStorage.getItem(key); if (c) setFolders((f) => f || (JSON.parse(c) as Folder[])); } catch { /* none kept */ }
    const keep = (list: Folder[]) => { setFolders(list); try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* fine */ } };
    let have: Folder[] | null = null;
    try { const c = localStorage.getItem(key); have = c ? (JSON.parse(c) as Folder[]) : null; } catch { /* none */ }
    if (!have) { try { const r = await mailBox<{ folders: Folder[] }>({ do: "folders" }); keep(r.folders); have = r.folders; } catch { setFolders((f) => f || []); } }
    try { const r = await mailBox<{ folders: Folder[] }>({ do: "folders", counts: 1 }); keep(r.folders); } catch { /* the list without counts is fine */ }
  }, []);
  useEffect(() => { if (mode === "mail") void loadFolders(); }, [mode, loadFolders]);
  // a folder's emails: the cached 45 days first (instant), then older ones live, 50 at a time
  type ListResp = { rows: MsgRow[]; next?: number; cached?: boolean; live?: boolean; more?: boolean };
  const openFolder = async (path: string, page?: { k: "seq"; n: number } | { k: "cache" | "live"; before: string }) => {
    if (/^inbox$/i.test(path)) { setView({ kind: "inbox" }); setFSel(null); setCSel(null); return; }
    if (!page) { setView({ kind: "folder", path }); setFRows(null); setFSel(null); setFErr(""); setPicked(false); setFMore(null); }
    setFBusy(true);
    try {
      const params: Record<string, string | number> = { do: "list", path };
      if (page?.k === "seq") params.before = page.n; else if (page?.k === "cache") params.beforeDate = page.before; else if (page?.k === "live") params.older = page.before;
      const r = await mailBox<ListResp>(params);
      setFRows((x) => (page ? [...(x || []), ...r.rows] : r.rows));
      const oldest = r.rows.length ? r.rows[r.rows.length - 1].date : page && page.k !== "seq" ? page.before : new Date().toISOString();
      setFMore(r.cached ? (r.rows.length >= 50 ? { k: "cache", before: oldest } : { k: "live", before: oldest }) : r.live ? (r.more ? { k: "live", before: oldest } : null) : r.next && r.next > 1 ? { k: "seq", n: r.next } : null);
    }
    catch (e) { setFErr(e instanceof Error ? e.message : String(e)); setFRows((x) => x || []); }
    setFBusy(false);
  };
  const [olderBusy, setOlderBusy] = useState(false);
  // searched over EWS (Oct 14): the whole mailbox, every year, at once — no "last 45 days" / "search older mail"
  const [searchAll, setSearchAll] = useState(false);
  const runSearch = async (term: string) => {
    if (term.trim().length < 2) return;
    setView({ kind: "search", q: term.trim() }); setConvos(null); setCSel(null); setSNote(""); setPicked(false);
    try { const r = await mailBox<{ convos: Convo[]; folders: number; partial: boolean; all?: boolean }>({ do: "search", q: term.trim() }); setConvos(r.convos); setSearchAll(!!r.all); if (r.all && r.partial) setSNote("Some folders didn't answer, so there may be more."); }
    catch (e) { setConvos([]); setSNote(e instanceof Error ? e.message : String(e)); }
  };
  // past the 45 days: searched live on request, added to the list
  const searchOlder = async (term: string) => {
    setOlderBusy(true); setSNote("");
    try {
      const r = await mailBox<{ convos: Convo[]; folders: number; partial: boolean; indexing?: { indexed: number; total: number } | null }>({ do: "search", q: term.trim(), older: 1 });
      setConvos((cur) => { const have = new Set((cur || []).map((c) => c.key)); return [...(cur || []), ...r.convos.filter((c) => !have.has(c.key))]; });
      // older mail is searched from the kept headers; while they're still being filled in, say how far along
      const pct = r.indexing && r.indexing.total ? Math.floor((100 * r.indexing.indexed) / r.indexing.total) : null;
      const still = pct != null ? ` Older mail is still being read in (${pct}% so far), so there may be more: try again later.` : "";
      setSNote((r.convos.length ? "Older mail added below." : "Nothing older found.") + (still || (r.partial ? " The mail server was busy, so some folders weren't searched: try again in a minute." : "")));
    } catch (e) { setSNote(e instanceof Error ? e.message : String(e)); }
    setOlderBusy(false);
  };
  const [ol, setOl] = useState<InboxItem[] | null>(null); // my Outlook Inbox, mirrored
  const [settings, setSettings] = useState(false);
  /** phones: the folders-and-settings sheet from "Inbox ▾" (Oct 15, Nick) */
  const [pSheet, setPSheet] = useState(false), [pMore, setPMore] = useState(false);
  // the list can be hidden to give the email more room (remembered)
  // the list always shows beside the email (Oct 14: the hide arrow is gone)
  const [listOpen, setListOpen] = useState(true);
  // pane sizes, dragged like Outlook (remembered)
  const [listW, setListW] = useSticky<number>("inbox.listW", 300);
  const [open, setOpen] = useState<string | null>(null), [focus, setFocus] = useState<string | null>(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const sb = createClient();
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    // the mailbox status and the email go out together
    const [s, { data: a }] = await Promise.all([
      getMailStatus(),
      sb.from("activities").select("id, customer_id, order_id, project_id, direction, subject, body, from_email, to_email, external_id, thread_id, occurred_at, meta").eq("kind", "email").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(800),
      getOutlookInbox().then((r) => { if (r.ok) setOl(r.connected ? r.items : []); }, () => null),
    ]);
    if (s.ok) setSt(s as unknown as Status);
    // an email that came to someone's mailbox is theirs alone (Oct 12, Nick): only yours (or, viewing as someone,
    // theirs); one that came in another way (no mailbox) shows to everyone
    const myAcct = s.ok ? s.mine?.id || null : null, myAddr = s.ok ? s.mine?.email || null : null;
    const list = ((a || []) as Act[]).filter((x) => !x.meta?.ignored && emailIsMine(x, myAcct, myAddr));
    setActs(list);
    const ids = list.filter((x) => x.direction === "in").map((x) => x.id);
    const cIds = [...new Set(list.map((x) => x.customer_id).filter(Boolean))] as string[];
    const [{ data: sg }, { data: cs }, { data: os }] = await Promise.all([
      ids.length ? sb.from("ai_suggestions").select("id, kind, status, activity_id, title, body, draft, payload, order_id").in("activity_id", ids) : Promise.resolve({ data: [] }),
      cIds.length ? sb.from("customers").select("id, company, name, email").in("id", cIds) : Promise.resolve({ data: [] }),
      cIds.length ? sb.from("orders").select("id, number, nickname, customer_id, status").in("customer_id", cIds).order("number", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    ]);
    setSugs((sg || []) as Sug[]);
    setCusts(new Map(((cs || []) as Cust[]).map((c) => [c.id, c])));
    setOrders((os || []) as Ord[]);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  // phones: pull down to refresh, like the Mail app: just the list showing, quickly. (No mailbox check here: the
  // portal checks the mailbox by itself every couple of minutes, and a check holds up everything else for up to 35 s.)
  const viewRef = useRef(view); viewRef.current = view;
  useEffect(() => onPullRefresh(async () => {
    const v = viewRef.current;
    if (mode === "mail" && v.kind === "inbox") { await getOutlookInbox().then((r) => { if (r.ok) setOl(r.connected ? r.items : []); }, () => null); void load(); return; }
    await Promise.all([load(), v.kind === "folder" ? mailBox<ListResp>({ do: "list", path: v.path }).then((r) => setFRows((x) => [...r.rows, ...(x || []).filter((y) => !r.rows.some((z) => z.uid === y.uid && z.folder === y.folder) && r.rows.length && y.date < r.rows[r.rows.length - 1].date)]), () => null) : Promise.resolve()]);
  }), [load, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => mailRows(acts || [], sugs), [acts, sugs]);
  const mineId = st?.mine?.enabled ? st.mine.id : null;
  // opened from a link (the dashboard's Reply): /shop/inbox?open=<email id> opens it ready to answer.
  // The email showing is kept in the address (?show= / ?item=), so a reload (a new version of the portal, or coming
  // back to the app) opens the same email again (Oct 12: Brett's email from the dashboard became another one after the
  // app reloaded). Read once per page.
  const urlDone = useRef(false);
  useEffect(() => {
    if (!acts || !st || urlDone.current) return;
    const sp = new URLSearchParams(window.location.search), item = sp.get("item"), shown = sp.get("show"), id = sp.get("open") || shown;
    if (item && mode === "mail") {
      if (ol === null) return;
      urlDone.current = true;
      const it = ol.find((i) => i.id === item);
      if (it) { setBk("all"); setOpen(it.activity_id && rows.some((r) => r.x.id === it.activity_id) ? it.activity_id : "ol:" + it.id); setPicked(true); }
      return;
    }
    if (!id) { urlDone.current = true; return; }
    // ?order=1: open it with Create order already started (from a searched conversation)
    if (sp.get("order")) setAutoOrder(id);
    // a customer email that isn't in the Inbox (any more): it's in Conversations
    if (mode === "mail") {
      if (ol === null) return;
      urlDone.current = true;
      if (!ol.some((i) => i.activity_id === id)) { window.location.replace(`/shop/conversations?open=${id}`); return; }
      setBk("all"); setOpen(id); if (!shown) setFocus(id); setPicked(true);
      return;
    }
    urlDone.current = true;
    const r = rows.find((y) => y.x.id === id);
    if (r) {
      if (!(r.needs && tab === "reply")) setTab(r.needs ? "reply" : "all");
      setOpen(id); if (!shown) setFocus(id); setPicked(true);
    } else flash("That email isn't in the last 30 days of customer email here. Search for it in Email.");
  }, [acts, st, ol]); // eslint-disable-line react-hooks/exhaustive-deps
  const scoped = rows; // only your mailbox's email is loaded (see load)
  const shown = scoped.filter((r) => (tab === "reply" ? r.needs : tab === "leads" ? r.x.meta?.lead && !r.x.customer_id : true))
    .sort((a, b) => (tab === "reply" ? Number(b.urgent) - Number(a.urgent) : 0) || b.x.occurred_at.localeCompare(a.x.occurred_at)); // urgent ones first on Needs reply
  const counts = { urgent: scoped.filter((r) => r.urgent).length, reply: scoped.filter((r) => r.needs).length, leads: scoped.filter((r) => r.x.meta?.lead && !r.x.customer_id).length, all: scoped.length };

  // My Inbox: the Outlook Inbox, mirrored. A customer email opens as usual (by its email id); anything else is "ol:<row>".
  const rowByAct = useMemo(() => new Map(rows.map((r) => [r.x.id, r])), [rows]);
  const olKey = (i: InboxItem) => (i.activity_id && rowByAct.has(i.activity_id) ? i.activity_id : "ol:" + i.id);
  const who = (x: Act) => senderLabel(x.meta?.from_name, x.from_email, x.customer_id ? custs.get(x.customer_id) : null);
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  // the email showing: the one picked, else the first in the list (after sending, the next one)
  const [q, setQ] = useState("");
  const listed = q.trim() ? shown.filter((r) => `${who(r.x)} ${r.x.from_email} ${r.x.subject} ${r.x.meta?.triage?.summary || ""}`.toLowerCase().includes(q.trim().toLowerCase())) : shown;
  const bkN = (k: Bk) => (ol || []).filter((i) => k === "all" || bucketOf(i) === k).length;
  const olShown = (ol || []).filter((i) => bk === "all" || bucketOf(i) === bk).filter((i) => {
    const t = q.trim().toLowerCase(), r = i.activity_id ? rowByAct.get(i.activity_id) : undefined;
    return !t || `${i.from_name} ${i.from_email} ${i.subject} ${r ? who(r.x) + " " + (r.x.meta?.triage?.summary || "") : ""}`.toLowerCase().includes(t);
  });
  // conversations (Oct 12, Nick: "three emails from Methodist… should just be one email with the conversation
  // underneath it"): the Inbox grouped by conversation (lib/mail/convo), newest first; a conversation's row opens its
  // newest email, with the rest listed under it
  const inboxKeys = (i: InboxItem) => { const r = i.activity_id ? rowByAct.get(i.activity_id) : undefined; return convoKeys({ subject: i.subject, from_email: i.from_email, customer_id: r?.x.customer_id, thread_id: r?.x.thread_id, external_id: r?.x.external_id, references: r?.x.meta?.references }); };
  const olGroups = groupConvos(olShown, inboxKeys, (i) => i.received_at || "");
  const groupOf = new Map<string, InboxItem[]>(); for (const g of olGroups) for (const i of g) groupOf.set(i.id, g);
  // the whole Inbox's conversations too (a move takes the whole conversation, whatever tab it's on)
  const allGroupOf = useMemo(() => { const m = new Map<string, InboxItem[]>(); for (const g of groupConvos(ol || [], inboxKeys, (i) => i.received_at || "")) for (const i of g) m.set(i.id, g); return m; }, [ol, rowByAct]); // eslint-disable-line react-hooks/exhaustive-deps
  // customer email as conversations too (with our replies, keyed by who they went to): the rest of the conversation
  // under the email that's open
  const actConvo = useMemo(() => {
    const m = new Map<string, Act[]>();
    const keyOf = (x: Act) => convoKeys({ subject: x.subject, from_email: x.direction === "out" ? (x.to_email || "").split(/[,;]/)[0].replace(/.*</, "").replace(/>.*/, "").trim() : x.from_email, customer_id: x.customer_id, thread_id: x.thread_id, external_id: x.external_id, references: x.meta?.references });
    for (const g of groupConvos(acts || [], keyOf, (x) => x.occurred_at)) for (const x of g) m.set(x.id, g);
    return m;
  }, [acts]);
  // Email opens on the brief (the AI's read of the whole Inbox) until an email is picked
  // the summary opens by itself only when Email first opens; after that only when it's clicked
  const [autoBrief, setAutoBrief] = useState(true);
  const [autoOrder, setAutoOrder] = useState<string | null>(null);
  const briefOn = mode === "mail" && view.kind === "inbox" && (open === "brief" || (autoBrief && !open && !q.trim() && bk === "all"));
  const olCur = tab === "outlook" && !briefOn ? olShown.find((i) => olKey(i) === open) || olShown[0] : undefined;
  const sel = tab === "outlook" ? (olCur?.activity_id ? rowByAct.get(olCur.activity_id) : undefined)
    : listed.find((r) => r.x.id === open) || (open ? rows.find((r) => r.x.id === open) : undefined) || listed[0];
  const [picked, setPicked] = useState(false); // phones: the list until an email is picked, then the email
  // the email showing goes in the address (see the link handler above), so a reload comes back to it
  useEffect(() => {
    if (!urlDone.current) return;
    const u = new URL(window.location.href);
    for (const k of ["open", "order", "item", "show"]) u.searchParams.delete(k);
    if (picked && open && open !== "brief") {
      if (mode === "mail" && view.kind === "inbox" && olCur) u.searchParams.set("item", olCur.id);
      else if (mode === "crm" && sel) u.searchParams.set("show", sel.x.id);
    }
    const next = u.pathname + u.search;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
  }, [picked, open, olCur?.id, sel?.x.id, view.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasSel = mode === "mail" && view.kind === "folder" ? !!fSel : mode === "mail" && view.kind === "search" ? !!cSel : briefOn || !!(sel || olCur);
  const pickRow = (id: string, answer = false) => { setAutoBrief(false); setOpen(id); setPicked(true); if (answer) setFocus(id); };
  // the email showing stays put: a new email arriving at the top of the list never swaps it out from under you
  // Only fills in when nothing is picked yet, counting a pick made in the same moment (Oct 12: the dashboard's link to
  // Brett's email was overwritten by "show the first one" as the list loaded, and Methodist opened instead)
  useEffect(() => { if (briefOn) return; if (!open && sel) { const k = sel.x.id; setOpen((cur) => cur || k); } else if (!open && olCur) { const k = olKey(olCur); setOpen((cur) => cur || k); } }, [open, sel?.x.id, olCur?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const listRef = useRef<HTMLDivElement | null>(null);
  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (tab === "outlook") {
      const keys = olGroups.map((g) => olKey(g[0])), curG = olCur ? groupOf.get(olCur.id) : undefined, i = curG ? keys.indexOf(olKey(curG[0])) : -1, k = keys[Math.max(0, Math.min(keys.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (k) { setOpen(k); listRef.current?.querySelector<HTMLElement>(`[data-id="${k}"]`)?.focus(); }
      return;
    }
    const i = listed.findIndex((r) => r.x.id === sel?.x.id), n = listed[Math.max(0, Math.min(listed.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (n) { setOpen(n.x.id); listRef.current?.querySelector<HTMLElement>(`[data-id="${n.x.id}"]`)?.focus(); }
  };
  const box = st?.mine;
  // a problem only when mail has actually stopped: the last good check is over 10 minutes old (a single refused
  // connection is retried on the next check, Oct 12)
  const boxStuck = !!box?.last_error && (!box.last_ok_at || Date.now() - Date.parse(box.last_ok_at) > 10 * 60000);

  // phones: slide an email left for Archive / Later / Black Hole (the same moves as the buttons)
  const MOVED: Record<string, string> = { archive: "Archived.", later: "Moved to Later.", news: "Moved to News.", blackhole: "Black Hole: SaneBox won't show you this sender again." };
  const quickMove = async (path: string, uid: number, to: string, drop: () => void) => {
    try { await boxPost({ do: "move", path, uid, to }); drop(); flash(MOVED[to] || "Moved."); return true; }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); return false; }
  };
  /** the rest of an Inbox email's conversation, moved the same way (Archive takes the whole conversation, like Outlook) */
  const moveRest = async (it: InboxItem, to: string) => {
    const rest = (allGroupOf.get(it.id) || []).filter((y) => y.id !== it.id);
    const k = (["archive", "later", "news", "receipts", "cc", "blackhole"].includes(to) ? to : null) as "archive" | null;
    const gone: string[] = [];
    for (const y of rest) {
      try { await boxPost({ do: "move", path: "INBOX", uid: y.uid, to }); gone.push(y.id); }
      catch { if (k) { const r = await archiveOutlookEmail({ id: y.id, to: k }).catch(() => null); if (r?.ok) gone.push(y.id); } }
    }
    if (gone.length) setOl((l) => (l || []).filter((y) => !gone.includes(y.id)));
    return gone.length;
  };
  const moveGroup = async (g: InboxItem[], to: string) => {
    const head = g[0], ok = await quickMove("INBOX", head.uid, to, () => { setOl((l) => (l || []).filter((y) => y.id !== head.id)); if (g.some((y) => open === olKey(y))) setOpen(null); });
    if (ok && g.length > 1) await moveRest(head, to);
    return ok;
  };
  const pickFolderRow = (r: MsgRow) => { setFSel(r); setPicked(true); setFRows((x) => (x || []).map((y) => (y.uid === r.uid && y.folder === r.folder ? { ...y, seen: true } : y))); };
  // after sending a reply to an email in my Inbox (Oct 12, Nick): archive it, or keep it in the Inbox?
  type Sent = { to: string; subject: string; body: string; theirs?: string };
  const [afterSend, setAfterSend] = useState<{ it?: InboxItem; msg: string; sent?: Sent } | null>(null);
  // a reply sent from any folder or conversation says so too (MailFolders ReplyBox)
  useEffect(() => { const h = (e: Event) => setAfterSend((e as CustomEvent<{ msg: string; sent: Sent }>).detail); window.addEventListener("fbs:sent", h); return () => window.removeEventListener("fbs:sent", h); }, []);
  // Cheer mode: a reply sent counts as a win
  useEffect(() => { if (afterSend) cheerWin("sent"); }, [afterSend?.msg, afterSend?.sent?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const afterArchive = async () => {
    const a = afterSend; if (!a?.it) return; const it = a.it;
    setAfterSend(null);
    const drop = () => { setOl((l) => (l || []).filter((y) => y.id !== it.id)); setOpen(null); };
    try { await boxPost({ do: "move", path: "INBOX", uid: it.uid, to: "archive" }); drop(); flash("Archived."); }
    catch { const r = await archiveOutlookEmail({ id: it.id }); if (r.ok) { drop(); flash("Archived."); cheerWin("archived"); } else { flash(r.error); return; } }
    await moveRest(it, "archive");
    void load();
  };
  // a customer email that's in my Inbox: Archive / Later / Black Hole / Move it there
  /** an Inbox email the portal didn't keep: kept now, then opened with its Actions (Create order starts right away) */
  const keepAndOpen = async (it: InboxItem, then: "order" | "goods" | "match") => {
    setBusy("keep");
    const r = await keepInboxEmail(it.id).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setBusy("");
    if (!r.ok) { flash(r.error); return; }
    setOl((l) => (l || []).map((y) => (y.id === it.id ? { ...y, activity_id: r.activityId } : y)));
    await load();
    if (then === "goods") { window.location.href = `/shop/order-goods?email=${r.activityId}`; return; }
    if (then === "order") setAutoOrder(r.activityId);
    setOpen(r.activityId); setPicked(true);
  };
  const inboxMove = (actId: string) => {
    const it = ol?.find((i) => i.activity_id === actId);
    if (!it || mode !== "mail") return undefined;
    return async (to: string, label: string, confirmed?: boolean) => { setBusy("mv"); try { await boxPost({ do: "move", path: "INBOX", uid: it.uid, to, ...(confirmed ? { confirmed: true } : {}) }); setOl((l) => (l || []).filter((y) => y.id !== it.id)); const n = await moveRest(it, to); flash(n ? `${label.replace(/\.$/, "")} (the whole conversation, ${n + 1} emails).` : label); setOpen(null); void load(); } catch (e) { flash(e instanceof Error ? e.message : String(e)); } setBusy(""); };
  };
  // phones: "‹ Inbox" and ∧ ∨ on an open email, like the iPhone Mail app
  const nav: PhoneNavT | null = (() => {
    const step = (keys: string[], cur: string, pick: (k: string) => void, label: string): PhoneNavT => {
      const i = keys.indexOf(cur), go = (k: string) => () => { pick(k); window.scrollTo({ top: 0 }); };
      return { label, back: () => setPicked(false), up: i > 0 ? go(keys[i - 1]) : undefined, down: i >= 0 && i < keys.length - 1 ? go(keys[i + 1]) : undefined };
    };
    if (mode === "mail" && view.kind === "folder") {
      const f = folders?.find((x) => x.path === view.path), rs = fRows || [];
      return step(rs.map((r) => `${r.folder}:${r.uid}`), fSel ? `${fSel.folder}:${fSel.uid}` : "", (k) => { const r = rs.find((y) => `${y.folder}:${y.uid}` === k); if (r) pickFolderRow(r); }, f ? folderLabel(f) : "Back");
    }
    if (mode === "mail" && view.kind === "search") { const cs = convos || []; return step(cs.map((c) => c.key), cSel?.key || "", (k) => setCSel(cs.find((c) => c.key === k) || null), "Search"); }
    if (tab === "outlook") { const g = olCur ? groupOf.get(olCur.id) : undefined; return step(olGroups.map((x) => olKey(x[0])), briefOn || !g ? "" : olKey(g[0]), (k) => pickRow(k), "Inbox"); }
    return step(listed.map((r) => r.x.id), sel?.x.id || "", (k) => pickRow(k), tab === "reply" ? "Needs reply" : tab === "leads" ? "Leads" : "All");
  })();

  const [cvPop, setCvPop] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);
  const stripKey = (tab === "outlook" && olCur ? (groupOf.get(olCur.id) || allGroupOf.get(olCur.id))?.[0]?.id : "") || "";
  useEffect(() => { setStripOpen(false); }, [stripKey]);
  // the open email's conversation, at the top of the email (phones, or with the list hidden): tap one to read it
  const curGroup = tab === "outlook" && olCur ? groupOf.get(olCur.id) || allGroupOf.get(olCur.id) : undefined;
  // oldest first, newest last (Oct 13, Nick); a long chain folds to the first email, "N more", and the one showing
  // (with anything newer than it), so the email itself is right below
  const stripAll = curGroup ? [...curGroup].sort((a, b) => String(a.received_at || "").localeCompare(String(b.received_at || ""))) : [];
  const curAt = olCur ? stripAll.findIndex((y) => y.id === olCur.id) : -1;
  // a long chain: just the original email, the arrow to open the rest, and the email you're reading (Oct 13, Nick)
  const stripFold = !stripOpen && stripAll.length > 3;
  const stripShown: (typeof stripAll[number] | "more")[] = stripFold ? (curAt <= 0 ? [stripAll[0], "more"] : [stripAll[0], "more", stripAll[curAt]]) : stripAll;
  const stripHidden = stripAll.length - (curAt <= 0 ? 1 : 2);
  // phones: folded to one line until you tap it (Oct 14, Nick: the cleaner phone look)
  const convoStrip = curGroup && curGroup.length > 1 && olCur ? <div className={"cv-strip" + (cvPop ? " pop" : "")} role="group" aria-label="This conversation">
    <button type="button" className="cv-sum" onClick={() => setCvPop(!cvPop)} aria-expanded={cvPop}><b>{curGroup.length} emails</b> in this conversation<span>{cvPop ? "Hide" : "Show ›"}</span></button>
    <div className="cv-h">This conversation · {curGroup.length} emails</div>
    {stripShown.map((y) => { if (y === "more") return <button key="more" type="button" className="cv-more" onClick={() => setStripOpen(true)} aria-expanded={false}>▸ {stripHidden} more email{stripHidden === 1 ? "" : "s"} — tap to show</button>;
      const ry = y.activity_id ? rowByAct.get(y.activity_id) : undefined; return (
      <button key={y.id} type="button" className={"cv-i" + (y.id === olCur.id ? " on" : "") + (y.unread ? " ol-unread" : "")} aria-current={y.id === olCur.id ? "true" : undefined} onClick={() => { if (y.id !== olCur.id) { pickRow(olKey(y)); window.scrollTo({ top: 0 }); } }}>
        <b>{personName(y.from_name) || y.from_email || (ry ? who(ry.x) : "")}</b><time>{y.received_at ? new Date(y.received_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</time>
        <span>{y.id === olCur.id ? "Showing below" : ry?.x.meta?.triage?.summary || y.summary || y.subject}</span>
      </button>
    ); })}
  </div> : null;

  return (
    <>
      <div className="page-head ibx2-head">
        <div><div className="eyebrow">{mode === "mail" ? "Your mailbox" : "Sales"}</div><h1>{mode === "mail" ? "Email" : "Conversations"}</h1></div>
        <div className="ibx2-status">
          {mode === "mail" && <AppStartToggle path="/shop/inbox" label="Email" />}
          {box?.enabled && <span className={"ibx2-box" + (boxStuck ? " bad" : "")} title={box.last_error || `${box.email}${st && st.all.length > 1 ? ` · also connected: ${st.all.filter((b) => b.id !== box.id).map((b) => b.email).join(", ")}` : ""}`}>
            <i aria-hidden />{boxStuck ? "Mailbox problem" : `Checked ${box.last_ok_at ? ago(box.last_ok_at) + " ago" : "—"}`}
          </span>}
          {box?.enabled && <button type="button" className="btn sm" disabled={!!busy} onClick={async () => { setBusy("check"); const r = await checkMailNow(); setBusy(""); if (!r.ok) flash(r.error); else { flash("Checked."); load(); } }}>{busy === "check" ? "Checking…" : "Check now"}</button>}
          {st && !st.viewing && <button type="button" className="btn sm ghost" onClick={() => setSettings(!settings)}>{box?.enabled ? (settings ? "Close settings" : "⚙ Email settings") : "Connect my email"}</button>}
        </div>
      </div>
      {st && !box?.enabled && <Connect st={st} onDone={(t) => { setSettings(false); flash(t); load(); }} />}
      {st && box?.enabled && settings && <EmailSettings st={st} onClose={() => setSettings(false)} onDone={(t) => { flash(t); load(); }} />}
      {box?.enabled && boxStuck && <div className="pv-err" style={{ marginBottom: 10 }}>{box.last_error}</div>}
      {msg && <div className="ibx2-toast" role="status">{msg}</div>}
      {afterSend && <AfterSend key={afterSend.msg + (afterSend.sent?.body.length || 0)} a={afterSend} onArchive={() => void afterArchive()} onClose={() => setAfterSend(null)} />}

      {/* phones (Oct 15, Nick: "make the email home page match the message page: folder and search up top, then the
          quick actions"): Inbox ▾ (folders and settings), check now, search; a light AI card with the summary and the
          filters; the desktop's heading, folder bar and tabs are hidden there (globals.css .pit) */}
      {mode === "mail" && (() => {
        const cur = view.kind === "folder" ? folders?.find((f) => f.path === view.path) : folders?.find((f) => f.special === "\\Inbox");
        const curName = view.kind === "search" ? "Search" : view.kind === "folder" ? folderLabel(cur || { name: view.path.split("/").pop() || view.path, special: "" }) : "Inbox";
        const unread = view.kind === "inbox" ? (ol || []).filter((i) => i.unread).length : cur?.unseen || 0;
        const main = (folders || []).filter((f) => /\\(Inbox|Sent|Archive|Drafts)/.test(f.special));
        const sane = (folders || []).filter((f) => f.sane), rest = (folders || []).filter((f) => !main.includes(f) && !f.sane && !/\\(Junk|Trash)/.test(f.special));
        const go = (path: string, inbox: boolean) => { setPSheet(false); setPMore(false); setQ(""); if (inbox) { setView({ kind: "inbox" }); } else void openFolder(path); };
        const sum = [counts.reply ? `${counts.reply} customer${counts.reply === 1 ? "" : "s"} need${counts.reply === 1 ? "s" : ""} a reply${counts.urgent ? ` (${counts.urgent} urgent)` : ""}` : "No customer waiting on a reply", bkN("todo") ? `${bkN("todo")} to-do${bkN("todo") === 1 ? "" : "s"}` : "", bkN("event") ? `${bkN("event")} event${bkN("event") === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
        return <div className="pit">
          <div className="pit-top">
            <button type="button" className="pit-fold" onClick={() => setPSheet(true)} aria-haspopup="menu">{curName}{unread > 0 && <span className="pit-n">{unread}</span>}<svg viewBox="0 0 24 24" aria-hidden><path d="M6 9l6 6 6-6" /></svg></button>
            <span className="spacer" />
            {box?.enabled && <button type="button" className="pit-ic" aria-label="Check for new email" disabled={!!busy} onClick={async () => { setBusy("check"); const r = await checkMailNow(); setBusy(""); if (!r.ok) flash(r.error); else { flash("Checked."); load(); } }}><svg viewBox="0 0 24 24" aria-hidden className={busy === "check" ? "spin" : ""}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></svg></button>}
            <button type="button" className="pit-ic" aria-label="Folders and settings" onClick={() => setPSheet(true)}><svg viewBox="0 0 24 24" aria-hidden><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg></button>
          </div>
          <form className="pit-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void runSearch(q); }}>
            <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all mail" aria-label="Search all mail" enterKeyHint="search" />
          </form>
          {box?.enabled && <div className={"pit-chk" + (boxStuck ? " bad" : "")}><i aria-hidden />{boxStuck ? "Mailbox problem" : `Checked ${box.last_ok_at ? ago(box.last_ok_at) + " ago" : "—"}`}</div>}
          {view.kind === "inbox" && <div className="pit-ai">
            <button type="button" className="pit-ai-h" onClick={() => { setQ(""); setBk("all"); setOpen("brief"); setPicked(true); }}><span className="eh-ai-orb" aria-hidden>✦</span>Inbox summary<span className="pit-go" aria-hidden>›</span></button>
            <p>{ol ? sum : "Loading…"}</p>
            <div className="pit-qa" role="tablist">
              {([["customer", "Customers", TbIcon.reply], ["todo", "To-dos", TbIcon.check], ["event", "Events", <svg key="e" viewBox="0 0 24 24" aria-hidden><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>], ["all", "All", null]] as [Bk, string, React.ReactNode][]).map(([k, label, icon]) => (
                <button key={k} type="button" role="tab" aria-selected={bk === k} className={bk === k ? "on" : ""} onClick={() => { setBk(k); setOpen(null); }}>{icon}{label}{ol && <b>{bkN(k)}</b>}</button>
              ))}
            </div>
          </div>}
          {pSheet && <div className="pbar-bg pit-bg" onClick={() => setPSheet(false)}>
            <div className="pbar-sheet" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="ps-grab" aria-hidden />
              <div className="pbar-t">Folders</div>
              {main.map((f) => <button key={f.path} type="button" role="menuitem" className={"pit-f" + ((f.special === "\\Inbox" ? view.kind === "inbox" : view.kind === "folder" && view.path === f.path) ? " on" : "")} onClick={() => go(f.path, f.special === "\\Inbox")}>{f.special === "\\Sent" ? <svg viewBox="0 0 24 24" aria-hidden><path d="m4 12 16-8-6 16-2-6z" /></svg> : f.special === "\\Archive" ? TbIcon.archive : f.special === "\\Inbox" ? <svg viewBox="0 0 24 24" aria-hidden><path d="M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z" /></svg> : TbIcon.file}<span>{f.special === "\\Inbox" ? "Inbox" : folderLabel(f)}</span>{(f.special === "\\Inbox" ? (ol || []).filter((i) => i.unread).length : f.unseen) > 0 && <span className="pit-fc">{f.special === "\\Inbox" ? (ol || []).filter((i) => i.unread).length : f.unseen}</span>}</button>)}
              {sane.map((f) => <button key={f.path} type="button" role="menuitem" className={"pit-f" + (view.kind === "folder" && view.path === f.path ? " on" : "")} onClick={() => go(f.path, false)}>{TbIcon.news}<span>{folderLabel(f)}</span>{f.unseen > 0 && <span className="pit-fc">{f.unseen}</span>}</button>)}
              {rest.length > 0 && <button type="button" className="pit-f" onClick={() => setPMore(!pMore)} aria-expanded={pMore}>{TbIcon.file}<span>{pMore ? "Fewer folders" : "More folders…"}</span></button>}
              {pMore && rest.map((f) => <button key={f.path} type="button" role="menuitem" className={"pit-f sub" + (view.kind === "folder" && view.path === f.path ? " on" : "")} style={{ paddingLeft: 14 + Math.min(3, f.depth) * 14 }} onClick={() => go(f.path, false)}>{TbIcon.file}<span>{folderLabel(f)}</span>{f.unseen > 0 && <span className="pit-fc">{f.unseen}</span>}</button>)}
              <div className="pbar-t">Settings</div>
              <div className="pit-set"><AppStartToggle path="/shop/inbox" label="Email" /></div>
              {st && !st.viewing && <button type="button" className="pit-f" onClick={() => { setPSheet(false); setSettings(true); }}><svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg><span>{box?.enabled ? "Email settings" : "Connect my email"}</span></button>}
              <button type="button" className="pbar-cancel" onClick={() => setPSheet(false)}>Close</button>
            </div>
          </div>}
        </div>;
      })()}
      {mode === "mail" && <FolderBar folders={folders} current={view.kind === "folder" ? view.path : view.kind === "inbox" ? (folders?.find((f) => f.special === "\\Inbox")?.path || "INBOX") : ""} onPick={(p) => { setQ(""); void openFolder(p); }} />}
      <div className={"ibx2" + (picked && hasSel ? " picked" : "") + (!listOpen && hasSel ? " nolist" : "")} style={{ ["--ibx-list" as string]: `${listW}px` }}>
        {(listOpen || !hasSel) && <Splitter dir="x" value={listW} min={220} max={560} onChange={setListW} className="ibx2-sv ibx2-sv-list" style={{ left: listW + 2 }} label="Drag to make the email list wider or narrower" />}
        {/* 1. the list */}
        <section className="ibx2-list" aria-label="Emails">
          <div className="ibx2-list-h">
            {mode === "mail" && view.kind !== "inbox" ? <div className="mf-lh">
              {view.kind === "folder" ? <><b>{folderLabel(folders?.find((f) => f.path === view.path) || { name: view.path.split("/").pop() || view.path, special: "" })}</b><span className="faint">{folders?.find((f) => f.path === view.path)?.messages ?? ""} emails</span></>
                : <><b>“{view.q}”</b><span className="faint">{convos ? `${convos.length} conversation${convos.length === 1 ? "" : "s"}` : "Searching…"}</span><button type="button" className="md-link" onClick={() => { setQ(""); setView({ kind: "inbox" }); }}>Clear</button></>}
            </div> : <div className="ibx2-tabs" role="tablist">
              {mode === "mail" ? BK.map((b) => (
                <button key={b.k} type="button" role="tab" aria-selected={bk === b.k} className={bk === b.k ? "on" : ""} onClick={() => { setBk(b.k); setOpen(null); }}>{b.label} <span>{ol ? bkN(b.k) : ""}</span></button>
              )) : <>
              <button type="button" role="tab" aria-selected={tab === "reply"} className={tab === "reply" ? "on" : ""} onClick={() => setTab("reply")}>Needs reply <span className={counts.urgent ? "hot" : ""} title={counts.urgent ? `${counts.urgent} urgent` : undefined}>{counts.reply}</span></button>
              <button type="button" role="tab" aria-selected={tab === "leads"} className={tab === "leads" ? "on" : ""} onClick={() => setTab("leads")}>Leads <span>{counts.leads}</span></button>
              <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All</button>
              </>}
            </div>}
            <div className="ibx2-find">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (mode === "mail" && e.key === "Enter") { e.preventDefault(); void runSearch(q); } }} placeholder={mode === "mail" ? "Search all mail, then Enter" : "Search"} aria-label="Search email" title={mode === "mail" ? "Type a name, company, email or subject and press Enter: results show as conversations, what they sent and what you sent, in order" : undefined} />
              
            </div>
          </div>
          {/* the Inbox brief: always first, stays put while the list scrolls */}
          {mode === "mail" && view.kind === "inbox" && <button type="button" className={"ibx2-briefbtn" + (briefOn ? " on" : "")} onClick={() => { setQ(""); setBk("all"); setOpen("brief"); setPicked(true); }} aria-pressed={briefOn}>
            <span className="ibx2-briefic" aria-hidden>✦</span>
            <span className="ibx2-brieft"><b>Inbox summary</b><span>What&apos;s in your Inbox and what to do first</span></span>
            <span className="ibx2-briefgo" aria-hidden>›</span>
          </button>}
          <div className="ibx2-items" ref={listRef} onKeyDown={onKeys}>
            {mode === "mail" && view.kind === "folder" ? <>{fErr && <div className="pv-err">{fErr}</div>}<FolderList rows={fRows} sel={fSel ? `${fSel.folder}:${fSel.uid}` : ""} onPick={pickFolderRow}
              onSwipe={(r, to) => quickMove(r.folder, r.uid, to, () => { setFRows((x) => (x || []).filter((y) => !(y.uid === r.uid && y.folder === r.folder))); if (fSel?.uid === r.uid && fSel.folder === r.folder) setFSel(null); })} sentBox={/\\Sent/.test(folders?.find((f) => f.path === view.path)?.special || "")} more={!!fMore} loading={fBusy} onMore={() => fMore && void openFolder(view.path, fMore)} /></>
            : mode === "mail" && view.kind === "search" ? (!convos ? <div className="ibx2-none">Searching your mail for “{view.q}”…</div> : !convos.length ? (searchAll ? <div className="ibx2-none">Nothing in your mailbox for “{view.q}”.{sNote ? ` ${sNote}` : ""}</div> : <div className="ibx2-none">Nothing in the last 45 days for “{view.q}”.{sNote ? ` ${sNote}` : ""}<div style={{ marginTop: 10 }}><button type="button" className="btn sm" disabled={olderBusy} onClick={() => void searchOlder(view.q)}>{olderBusy ? "Searching older mail…" : "Search older mail"}</button></div></div>) : <><div className="faint mf-note">{searchAll ? "Your whole mailbox, newest first." : "Last 45 days."}</div><ConvoList convos={convos} sel={cSel?.key || ""} me={(st?.mine?.email || "").toLowerCase()} onPick={(c) => { setCSel(c); setPicked(true); }} />
              <div className="mf-older-s">{sNote && <div className="faint">{sNote}</div>}{!searchAll && <button type="button" className="btn sm ghost" disabled={olderBusy} onClick={() => void searchOlder(view.q)}>{olderBusy ? "Searching older mail… (up to a minute)" : "Search older mail too"}</button>}</div></>)
            : tab === "outlook" ? (!ol ? <div className="ibx2-none">Loading…</div> : <>
              { !olShown.length ? <div className="ibx2-none">{q ? "Nothing matches." : bk === "all" ? "Your Inbox is empty. Nice." : "Nothing here right now."}</div>
              : olGroups.map((g) => {
                const i = g[0], k = olKey(i), r = i.activity_id ? rowByAct.get(i.activity_id) : undefined;
                const nameOf = (y: InboxItem) => { const ry = y.activity_id ? rowByAct.get(y.activity_id) : undefined; return ry ? who(ry.x) : personName(y.from_name) || y.from_email || "(unknown sender)"; };
                // a conversation: everyone in it, newest first (like Outlook)
                const names = [...new Set(g.map(nameOf))];
                const name = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
                const rs = g.map((y) => (y.activity_id ? rowByAct.get(y.activity_id) : undefined));
                const needsG = rs.some((y) => y?.needs), urgentG = rs.some((y) => y?.urgent), unreadG = g.some((y) => y.unread), flagG = g.some((y) => y.flagged);
                const openG = !!olCur && g.some((y) => y.id === olCur.id);
                const ordG = rs.map((y) => y?.x.order_id && orders.find((o) => o.id === y.x.order_id)).find(Boolean);
                return (
                  <div key={i.id} className={"ibx2-cv" + (g.length > 1 ? " multi" : "") + (openG && g.length > 1 ? " open" : "")}>
                  <SwipeRow onAct={(to) => moveGroup(g, to)}>
                  <button data-id={k} type="button" className={"ibx2-item ol" + (openG ? " on" : "") + (needsG ? " needs" : "") + (urgentG ? " urgent" : "") + (unreadG ? " ol-unread" : "") + (!r ? " ol-plain" : "")} onClick={() => pickRow(openG && olCur ? olKey(olCur) : k)} onDoubleClick={() => r && pickRow(k, true)} aria-expanded={g.length > 1 ? openG : undefined}>
                    {/* Oct 15, Nick: bold + blue dot = unread, nothing else; what it is goes in colored tags */}
                    {unreadG && <span className="ibx2-dot" aria-label="Unread" />}
                    <span className="ibx2-item-1">
                      <b>{name}</b>
                      {g.length > 1 && <span className="ibx2-cvn" title={`${g.length} emails in this conversation`}>{g.length}</span>}
                      {flagG && <span className="ibx2-flag" title="Flagged in Outlook" aria-label="Flagged">⚑</span>}
                      <time>{i.received_at ? ago(i.received_at) : ""}</time>
                    </span>
                    <span className="ibx2-item-s">{i.subject || "(no subject)"}</span>
                    {(() => { const sm = r?.x.meta?.triage?.summary || i.summary || ""; return sm && sm !== i.subject ? <span className="ibx2-item-2">{sm}</span> : null; })()}
                    <span className="ibx2-item-3">
                      {urgentG && <span className="itag urg">Urgent</span>}
                      {r ? <>{needsG ? <span className="itag rep">Needs reply</span> : r.answered ? <span className="itag fyi">Answered</span> : null}<span className="itag cus">Customer</span></>
                        : i.bucket === "todo" ? <span className="itag todo">To-do</span> : i.bucket === "event" ? <span className="itag ev">Event</span> : i.bucket ? <span className="itag fyi">FYI</span> : <span className="itag-sorting">Sorting…</span>}
                      {i.cc_only && <span className="itag fyi" title="You were copied (Cc), not sent to">CC&apos;d</span>}
                      {ordG && <span className="itag fyi">#{ordG.number}</span>}
                    </span>
                  </button>
                  </SwipeRow>
                  {/* the conversation, under it: each email in it, newest first */}
                  {g.length > 1 && openG && <div className="ibx2-cvl" role="group" aria-label="Emails in this conversation">
                    {g.map((y) => { const ky = olKey(y), ry = y.activity_id ? rowByAct.get(y.activity_id) : undefined; return (
                      <button key={y.id} type="button" className={"ibx2-cvi" + (olCur?.id === y.id ? " on" : "") + (y.unread ? " ol-unread" : "")} onClick={() => pickRow(ky)} onDoubleClick={() => ry && pickRow(ky, true)}>
                        <b>{personName(y.from_name) || y.from_email || nameOf(y)}</b><time>{y.received_at ? ago(y.received_at) : ""}</time>
                        <span>{ry?.x.meta?.triage?.summary || y.summary || y.subject || "(no subject)"}</span>
                      </button>
                    ); })}
                  </div>}
                  </div>
                );
              })}</>) : !acts ? <div className="ibx2-none">Loading…</div> : !listed.length ? <div className="ibx2-none">{q ? "Nothing matches." : tab === "reply" ? "Nothing waiting on you." : tab === "leads" ? "No new leads." : "No customer email in the last 30 days."}</div>
              : listed.map(({ x, answered, needs, urgent }) => {
                const late = needs && (Date.now() - new Date(x.occurred_at).getTime()) / 36e5 > 24;
                const ord = orders.find((o) => o.id === x.order_id);
                return (
                  <button key={x.id} data-id={x.id} type="button" className={"ibx2-item" + (sel?.x.id === x.id ? " on" : "") + (needs ? " needs" : "") + (urgent ? " urgent" : "")} onClick={() => pickRow(x.id)} onDoubleClick={() => pickRow(x.id, true)} title="Double-click to answer it">
                    <span className="ibx2-item-1">
                      <b>{who(x)}</b>
                      {urgent && <em>Urgent</em>}
                      <time className={late ? "late" : ""}>{ago(x.occurred_at)}</time>
                    </span>
                    <span className="ibx2-item-2">{x.meta?.triage?.summary || x.subject || "(no subject)"}</span>
                    {(ord || (x.meta?.lead && !x.customer_id) || answered || (x.meta?.attachments || []).length > 0) && <span className="ibx2-item-3">
                      {x.meta?.lead && !x.customer_id && <span>New sender</span>}
                      {ord && <span>#{ord.number}</span>}
                      {(x.meta?.attachments || []).length > 0 && <span>📎 {x.meta!.attachments!.length}</span>}
                      {answered && <span>Answered</span>}
                    </span>}
                  </button>
                );
              })}
          </div>
        </section>

        {/* 2 + 3. the email and the Assistant */}
        <PhoneNav.Provider value={nav}>
        {mode === "mail" && view.kind === "folder" ? (fSel ? <FolderMail key={`${fSel.folder}:${fSel.uid}`} row={fSel} folders={folders} listOpen={listOpen} toggleList={() => setListOpen(!listOpen)} back={() => setPicked(false)} flash={flash}
            onGone={() => { const rs = fRows || [], i = rs.findIndex((y) => y.uid === fSel.uid && y.folder === fSel.folder), nx = rs[i + 1] || rs[i - 1] || null; setFRows(rs.filter((_, j) => j !== i)); if (nx) pickFolderRow(nx); else setFSel(null); }} /> : <section className="ibx2-empty"><b>{fRows ? "Pick an email" : "Loading…"}</b></section>)
          : mode === "mail" && view.kind === "search" ? (cSel ? <ThreadView key={cSel.key} c={cSel} folders={folders} listOpen={listOpen} toggleList={() => setListOpen(!listOpen)} back={() => setPicked(false)} flash={flash}
            onMoved={(m) => setCSel((c) => (c ? { ...c, msgs: c.msgs.map((y) => (y.uid === m.uid && y.folder === m.folder ? { ...y, folder: "(moved)" } : y)) } : c))} /> : <section className="ibx2-empty"><b>{convos ? "Pick a conversation" : "Searching…"}</b><span>Each one shows what they sent and what you sent, oldest first.</span></section>)
          : briefOn && ol === null ? <section className="ibx2-empty"><b>Loading…</b></section>
          : briefOn ? <BriefPane name={(st?.mine?.name || "").split(/\s+/)[0]} items={ol || []}
 listOpen={listOpen} toggleList={() => setListOpen(!listOpen)} back={() => setPicked(false)}
            openItem={(id) => { const it = (ol || []).find((x) => x.id === id); if (it) { setAutoBrief(false); setOpen(olKey(it)); setPicked(true); } }} />
          : !sel && tab === "outlook" && olCur ? <LiveMail key={olCur.id} onKeep={(then) => void keepAndOpen(olCur, then)} convo={convoStrip} onMoved={(to) => void moveRest(olCur, to)} onSent={(m, sent) => setAfterSend({ it: olCur, msg: m, sent })} i={olCur} older={!!olCur.activity_id} folders={folders} listOpen={listOpen} toggleList={() => setListOpen(!listOpen)} back={() => setPicked(false)} busy={busy} setBusy={setBusy}
            done={(t, gone) => { flash(t); if (gone !== false) { setOl((l) => (l || []).filter((y) => y.id !== olCur.id)); setOpen(null); } }} />
          : !sel ? <section className="ibx2-empty"><b>{acts ? "Nothing to answer" : "Loading…"}</b>{acts && <span>New customer email shows up here within a couple of minutes.</span>}</section>
          : <Detail key={sel.x.id + (focus === sel.x.id ? ":f" : "")} autoOrder={autoOrder === sel.x.id} onAutoOrdered={() => setAutoOrder(null)} onSent={(m, sent) => setAfterSend({ it: mode === "mail" ? ol?.find((i) => i.activity_id === sel.x.id) : undefined, msg: m, sent })} focus={focus === sel.x.id} x={sel.x} inOutlook={!!ol?.some((i) => i.activity_id === sel.x.id)}
              moveBar={inboxMove(sel.x.id) ? <MoveBar folders={folders} busy={busy === "mv"} here="INBOX" onMove={inboxMove(sel.x.id)!} known={sel.x.customer_id ? who(sel.x) : undefined} /> : null} onMove={inboxMove(sel.x.id)} folders={folders} ccOnly={sel.ccOnly} who={who(sel.x)} reply={sel.reply} quote={sel.quote} needs={sel.needs} urgent={sel.urgent} answered={sel.answered}
              orders={orders.filter((o) => o.customer_id && o.customer_id === sel.x.customer_id)}
              thread={(acts || []).filter((o) => o.id !== sel.x.id && ((actConvo.get(sel.x.id) || []).includes(o) || (o.thread_id && (o.thread_id === sel.x.thread_id || o.thread_id === sel.x.external_id)) || (sel.x.external_id && (o.meta?.references || []).includes(sel.x.external_id)) || (o.external_id && (sel.x.meta?.references || []).includes(o.external_id))))}
              convo={convoStrip}
              back={() => setPicked(false)} listOpen={listOpen} toggleList={() => setListOpen(!listOpen)} busy={busy} setBusy={setBusy} done={(t, next) => { flash(t); void load().then(() => { if (next) setOpen(null); }); }} />}
        </PhoneNav.Provider>
      </div>
    </>
  );
}

type Opt = { label: string; subject: string; body: string };

/**
 * Email → Inbox brief (Oct 12, Nick: "AI summarize the inbox… good morning, you've got these things to do, some recent
 * reorders came in"). Written by the AI when the Inbox changes (kept for this tab until it does); each line opens its email.
 */
/** each group of the summary gets its own color, from its name */
const toneOf = (t: string) => (/just so you know|fyi|heads up/i.test(t) ? "fyi" : /need|urgent|right now|reply/i.test(t) ? "hot" : /order|reorder|quote|customer/i.test(t) ? "ord" : /to-?do|task/i.test(t) ? "todo" : /coming|calendar|due|week|today/i.test(t) ? "cal" : "fyi");
// the last summary, kept while the page is open, so opening it again is instant
let briefMem: Brief | null = null;

/**
 * Email → Inbox summary (third try, Oct 12, Nick: "not doing much… reads very slow"). Written ahead of time by the
 * mailbox job, so it opens at once; refreshed quietly when the Inbox has changed. One column to read top to bottom:
 * the greeting and the AI's read, "Start here" (the few things to do first, numbered, biggest), then everything else
 * as a short list with small colored group labels. Each line opens its email.
 */
function BriefPane({ name, items, listOpen, toggleList, back, openItem }: { name: string; items: InboxItem[]; listOpen: boolean; toggleList: () => void; back: () => void; openItem: (id: string) => void }) {
  const [b, setB] = useState<Brief | null>(briefMem), [updating, setUpdating] = useState(false), [err, setErr] = useState("");
  const load = useCallback(async (fresh = false) => {
    setErr("");
    if (fresh) setUpdating(true);
    const r = await inboxBrief(fresh);
    if (!r.ok) { setUpdating(false); if (!briefMem) setErr(r.error); return; }
    briefMem = r.brief; setB(r.brief);
    if (!fresh && r.stale) { setUpdating(true); const f = await inboxBrief(true); if (f.ok) { briefMem = f.brief; setB(f.brief); } }
    setUpdating(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const live = (ref: string) => (ref ? byId.get(ref) : undefined);
  // Start here: the first few of "Needs you now" (else of whatever comes first)
  const secs = (b?.sections || []).map((s0) => ({ ...s0, items: s0.items.filter((it) => !it.ref || byId.has(it.ref)) })).filter((s0) => s0.items.length);
  const first = secs.find((s0) => toneOf(s0.title) === "hot") || secs[0];
  const start = first ? first.items.slice(0, 3) : [];
  const rest = secs.map((s0) => ({ ...s0, items: s0 === first ? s0.items.slice(3) : s0.items })).filter((s0) => s0.items.length);
  const hour = new Date().getHours();
  return (
    <div className="ibx2-work ibx2-solo">
      <section className="ibx2-mail sm2" aria-label="Inbox summary">
        <div className="eh-bar">
          <button type="button" className="eh-back" onClick={back} aria-label="Back to the list"><svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg></button>
          <button type="button" className="eh-list" onClick={toggleList} aria-label={listOpen ? "Hide the list" : "Show the list"}>{listOpen ? "⟨" : "☰"}</button>
          <span className="sm2-k">✦ Inbox summary</span>
          <span className="spacer" />
          {updating ? <span className="faint sm2-at"><span className="br-dots" aria-hidden><i /><i /><i /></span> Updating</span> : b && <span className="faint sm2-at">Updated {new Date(b.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
          <button type="button" className="btn sm ghost" disabled={updating} onClick={() => load(true)}>Refresh</button>
        </div>
        <div className="ibx2-read sm2-b">
          <div className="sm2-in">
            <div className="sm2-date">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" })}</div>
            <h2 className="sm2-hi">{b ? b.greeting : `Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}${name ? `, ${name}` : ""}`}</h2>
            {b ? <p className="sm2-head">{b.headline}</p> : <p className="sm2-head faint">{err ? `Couldn't write the summary: ${err}` : <><span className="br-dots" aria-hidden><i /><i /><i /></span> Reading your Inbox…</>}</p>}

            {start.length > 0 && <>
              <h3 className="sm2-h">Start here</h3>
              <ol className="sm2-start">{start.map((it, k) => {
                const r = live(it.ref);
                return (
                  <li key={k} className={k === 0 ? "top" : ""}>
                    <button type="button" disabled={!r} onClick={() => r && openItem(r.id)}>
                      <span className="sm2-num" aria-hidden>{k + 1}</span>
                      <span className="sm2-tx"><b>{it.who || r?.from_name || r?.from_email || ""}</b><span>{it.text}</span>{it.why && <em>{it.why}</em>}</span>
                      {r && <span className="sm2-go">Open<span aria-hidden> ›</span></span>}
                    </button>
                  </li>
                );
              })}</ol>
            </>}

            {rest.map((sec, k) => (
              <div key={k} className={"sm2-grp sm2-t-" + toneOf(sec.title)}>
                <h3 className="sm2-h"><i aria-hidden />{sec.title}<span>{sec.items.length}</span></h3>
                <ul>{sec.items.map((it, j) => {
                  const r = live(it.ref);
                  const inner = <><b>{it.who || r?.from_name || r?.from_email || ""}</b><span>{it.text}</span>{r && <span className="sm2-chev" aria-hidden>›</span>}</>;
                  return <li key={j}>{r ? <button type="button" onClick={() => openItem(r.id)}>{inner}</button> : <div>{inner}</div>}</li>;
                })}</ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Inbox: an email that isn't a customer's. Read live from the mailbox (the portal doesn't keep it), with what the AI
 * made of it (to-dos, suggested events), Reply, Archive and the SaneBox moves.
 */
function LiveMail({ i, older, folders, listOpen, toggleList, back, busy, setBusy, done, onSent, convo, onMoved, onKeep }: { /** Actions (Oct 14): keep the email in the portal, then open it there with this started */ onKeep?: (then: "order" | "goods" | "match") => void; /** the rest of its conversation, shown at the top */ convo?: React.ReactNode; /** moved: the rest of the conversation goes the same way */ onMoved?: (to: string) => void; /** sent a reply: ask archive or keep */ onSent?: (msg: string, sent: { to: string; subject: string; body: string; theirs?: string }) => void; i: InboxItem; older: boolean; folders: Folder[] | null; listOpen: boolean; toggleList: () => void; back: () => void; busy: string; setBusy: (s: string) => void; done: (msg: string, gone?: boolean) => void }) {
  const [m, setM] = useState<{ html: string; text: string; from: string; to: string; cc: string; date: string; attachments: { name: string; size: number }[] } | null>(null);
  const [full, setFull] = useState<FullMsg | null>(null);
  const [err, setErr] = useState(""), [loadErr, setLoadErr] = useState("");
  const [ex, setEx] = useState<{ tasks: Task[]; events: CalEvent[] } | null>(null);
  const [writing, setWriting] = useState(false), [body, setBody] = useState(""), [cc, setCc] = useState<string[]>([]);
  const [h, setH] = useState(240), ref = useRef<HTMLIFrameElement | null>(null), [plain, setPlain] = useState(false);
  const [tryN, setTryN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoadErr("");
    // straight from the Inbox by its uid (with attachments to open); the Message-ID lookup if the uid moved. Each
    // step gives up after a while, so it never sits on "Opening…" (Oct 13, Meena Harris's email)
    const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The mail server didn't answer in time.")), ms))]);
    within(mailBox<FullMsg>({ do: "message", path: "INBOX", uid: i.uid }), 56000).then((r) => { if (!live) return; setFull(r); setM(r); })
      .catch((e1) => { if (!live) return; if (/didn't answer in time/.test(String(e1?.message))) { setLoadErr(String(e1.message)); return; }
        if (/not in your Inbox any more/.test(String(e1?.message))) { done("That one was already moved out of your Inbox.", true); return; }
        within(readInboxEmail(i.id), 30000).then((r) => { if (!live) return; if (r.ok) setM(r);
          // already moved out of the Inbox (SaneBox, Outlook, the phone): off the list, no error to stare at
          else if ("gone" in r && r.gone) done("That one was already moved out of your Inbox.", true);
          else setLoadErr(r.error); }, (e2) => live && setLoadErr(e2 instanceof Error ? e2.message : String(e2))); });
    inboxItemExtras(i.id).then((r) => { if (live && r.ok) setEx({ tasks: r.tasks, events: r.events }); });
    return () => { live = false; };
  }, [i.id, tryN]);
  const doc = useMemo(() => {
    if (!m?.html) return null;
    const head = `<base target="_blank"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; form-action 'none'"><style>html,body{margin:0;padding:10px 12px;font:14px/1.45 Calibri,Segoe UI,Arial,sans-serif;color:#222;background:#fff;overflow-x:auto}img{max-width:100%;height:auto}${PHONE_MAIL_CSS}table img{max-width:none}table{max-width:100%}</style>`;
    const html = m.html.replace(/<script[\s\S]*?<\/script>/gi, "");
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (x) => x + head) : head + html;
  }, [m?.html]);
  const fit = () => { const f = ref.current, d = f?.contentDocument; if (!f || !d?.body) return; fitWidth(f, d); setH(Math.min(20000, Math.max(60, frameHeight(d)))); };
  const move = async (to: string, label: string) => {
    setBusy("mv"); setErr("");
    try { await boxPost({ do: "move", path: "INBOX", uid: i.uid, to }); onMoved?.(to); done(label); }
    catch (e) {
      // the uid changed (Outlook moved things around): the Message-ID route for the usual moves
      const k = ["archive", "later", "news", "receipts", "cc", "blackhole"].includes(to) ? (to as "archive") : null;
      const r = k ? await archiveOutlookEmail({ id: i.id, to: k }) : { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      if (!r.ok) setErr(r.error); else { onMoved?.(to); done(label); }
    }
    setBusy("");
  };
  const when = i.received_at ? new Date(i.received_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const openTasks = (ex?.tasks || []).filter((t) => t.status === "open"), sugg = (ex?.events || []).filter((e) => e.status === "suggested"), added = (ex?.events || []).filter((e) => e.status === "added");
  return (
    <div className="ibx2-work ibx2-solo">
      <section className="ibx2-mail" aria-label="Email">
        <MailHead listOpen={listOpen} toggleList={toggleList} back={back} subject={i.subject} fromName={i.from_name} fromEmail={i.from_email} to={m?.to} cc={m?.cc} date={when} summary={i.summary}
          phone={{ reply: m ? () => setWriting(true) : undefined, move: (to, label) => void move(to, label), here: "INBOX", folders, busy: busy === "mv",
            ask: { id: "inbox:" + i.id, who: i.from_name || i.from_email, onDraft: (d) => { setBody(d.body); if (d.cc?.length) setCc((c) => [...new Set([...c, ...d.cc!])]); setWriting(true); } },
            more: onKeep ? (close) => <PSec label="Actions">
              <PTile icon={TbIcon.order} label="Create order" kind="primary" disabled={!!busy} onClick={() => { close(); onKeep("order"); }} />
              <PTile icon={TbIcon.goods} label="Order goods" disabled={!!busy} onClick={() => { close(); onKeep("goods"); }} />
              <PTile icon={TbIcon.person} label="Match to customer" disabled={!!busy} onClick={() => { close(); onKeep("match"); }} />
            </PSec> : undefined }}
          // the order buttons only on an email that could be one: a customer's, or one the AI sorted as a to-do (Oct 15: not
          // on a marketing email)
          ai={onKeep && (older || i.bucket === "todo" || i.bucket === "customer") ? <>
            <button type="button" className="tb-b primary eh-ai-go" disabled={!!busy} onClick={() => onKeep("order")}>{TbIcon.order}<span className="tb-l">{busy === "keep" ? "Opening…" : "New order"}</span></button>
            <button type="button" className="tb-b eh-ai-go" disabled={!!busy} onClick={() => onKeep("order")}>{TbIcon.repeat}<span className="tb-l">Reorder</span></button>
            <button type="button" className="tb-b eh-ai-go" disabled={!!busy} onClick={() => onKeep("goods")}>{TbIcon.goods}<span className="tb-l">Order goods</span></button>
          </> : undefined}
          tags={<>
            {i.bucket === "todo" && <span className="eh-tag todo">To-do</span>}
            {i.bucket === "event" && <span className="eh-tag event">Event</span>}
            {(i.bucket === "fyi" || i.bucket === "ignore") && <span className="eh-tag">FYI</span>}
            {i.cc_only && <span className="eh-tag" title="You were copied (Cc)">CC&apos;d</span>}
            {older && <span className="eh-tag">Customer</span>}
          </>}
          toolbar={<Toolbar>
            <TbRow line={1}>
            <TbGroup label="Email"><TbBtn icon={TbIcon.reply} label="Reply" kind="primary" disabled={!m} onClick={() => setWriting(true)} /></TbGroup>
            <MoveBar folders={folders} busy={busy === "mv"} here="INBOX" onMove={(to, label) => move(to, label)} />
            </TbRow>
            {onKeep && <TbRow line={2}><TbGroup label="Actions">
              <TbBtn icon={TbIcon.order} label={busy === "keep" ? "Opening…" : "Create order"} disabled={!!busy} title="Bring this email into the portal and make an order from it" onClick={() => onKeep("order")} />
              <TbBtn icon={TbIcon.goods} label="Order goods" disabled={!!busy} onClick={() => onKeep("goods")} />
              <TbBtn icon={TbIcon.person} label="Match to customer" disabled={!!busy} title="Make them a customer, or add them as a contact at one" onClick={() => onKeep("match")} />
            </TbGroup></TbRow>}
          </Toolbar>} />
        {err && <div className="pv-err eh-err">{err}</div>}
        <div className="ibx2-read">
          {convo}
          {(openTasks.length > 0 || sugg.length > 0 || added.length > 0) && <div className="lm-ai">
            <div className="lm-ai-h">✦ From this email</div>
            {openTasks.map((t) => (
              <div key={t.id} className="lm-row" style={{ ["--ac" as string]: AREAS[t.area]?.c }}>
                <button type="button" className="md-check" aria-label={`Done: ${t.title}`} onClick={async () => { setEx((x) => (x ? { ...x, tasks: x.tasks.map((y) => (y.id === t.id ? { ...y, status: "done" } : y)) } : x)); const r = await setTaskDone(t.id, true); if (r.ok && r.archived) done("Done. The email is archived."); }}><svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg></button>
                <div><b>{t.title}</b><span className="faint">{AREAS[t.area]?.label}{t.due ? ` · due ${new Date(t.due + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}` : ""}</span>{t.notes && <div className="faint">{t.notes}</div>}</div>
              </div>
            ))}
            {sugg.map((e) => (
              <div key={e.id} className="lm-row ev">
                <span className="lm-cal" aria-hidden>📅</span>
                <div><b>{e.title}</b><span className="faint">{e.day ? new Date(e.day + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : ""}{e.starts_at ? ` · ${new Date(e.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}{e.place ? ` · ${e.place}` : ""}</span></div>
                <span className="spacer" />
                <button type="button" className="btn sm primary" onClick={async () => { setEx((x) => (x ? { ...x, events: x.events.map((y) => (y.id === e.id ? { ...y, status: "added" } : y)) } : x)); await setEventStatus(e.id, "added"); }}>Add to calendar</button>
                <button type="button" className="btn sm ghost" onClick={async () => { setEx((x) => (x ? { ...x, events: x.events.map((y) => (y.id === e.id ? { ...y, status: "dismissed" } : y)) } : x)); await setEventStatus(e.id, "dismissed"); }}>Not now</button>
              </div>
            ))}
            {added.map((e) => <div key={e.id} className="lm-row ev on"><span className="lm-cal" aria-hidden>✓</span><div><b>{e.title}</b><span className="faint">On your calendar</span></div></div>)}
          </div>}
          {!m ? <div className="ibx2-none">{loadErr ? <>{loadErr} <button type="button" className="btn ghost sm" onClick={() => setTryN((x) => x + 1)}>Try again</button></> : <OpeningNote />}</div> : <>
            {full ? <><MailFrame html={full.html} text={full.text} /><Attachments m={full} /></> : doc && !plain ? <div className="ibx-html">
              <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={() => { fit(); setTimeout(fit, 400); setTimeout(fit, 1500); }} />
              <QuoteToggle html={doc} frame={ref} fit={fit} />
              <button type="button" className="btn sm ghost" onClick={() => setPlain(true)}>Plain text</button>
            </div> : <div className="lm-text">{m.text || "(no text)"}</div>}
            {!full && m.attachments.length > 0 && <div className="ibx2-files">{m.attachments.map((f, k) => <span key={k} className="lm-att">📎 {f.name}</span>)}<span className="faint"> Open attachments in Outlook for now.</span></div>}
          </>}
        </div>
        {writing && <div className="ibx2-compose open">
          <div className="ibx2-to"><span>To {i.from_email}</span></div>
          <CcField value={cc} onChange={setCc} text={body} />
          <textarea rows={7} autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your reply" aria-label="Reply" />
          <SayButton chatId={"inbox:" + i.id} who={i.from_name || i.from_email} onDraft={(d) => { setBody(d.body); if (d.cc?.length) setCc((c) => [...new Set([...c, ...d.cc!])]); }} />
          <div className="ibx2-send">
            <button type="button" className="btn primary" disabled={!!busy || !body.trim()} onClick={async () => { setBusy("send"); setErr(""); const r = await replyInboxEmail({ id: i.id, body, cc }); setBusy(""); if (!r.ok) setErr(r.error); else { setWriting(false); setBody(""); setCc([]); if (onSent) onSent(`Sent to ${r.to}.`, { to: r.to, subject: i.subject, body, theirs: m?.text || "" }); else done(`Sent to ${r.to}.`, false); } }}>{busy === "send" ? "Sending…" : "Send"}</button>
            <span className="faint">Your signature and their email go underneath.</span>
            <span className="spacer" />
            <button type="button" className="btn sm ghost" onClick={() => setWriting(false)}>Close</button>
          </div>
        </div>}
      </section>
    </div>
  );
}

/**
 * A border between two panes that can be dragged, like Outlook (Oct 10, Nick): left/right for the list and the
 * Assistant, up/down for the answer box. Arrow keys move it too. `invert`: dragging toward the start makes it bigger.
 */
function Splitter({ dir, value, min, max, onChange, invert, className, style, label }: { dir: "x" | "y"; value: number; min: number; max: number; onChange: (v: number) => void; invert?: boolean; className: string; style?: React.CSSProperties; label: string }) {
  const start = useRef<{ p: number; v: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)));
  return (
    <div role="separator" aria-orientation={dir === "x" ? "vertical" : "horizontal"} aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
      className={className} style={style} title={label}
      onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); start.current = { p: dir === "x" ? e.clientX : e.clientY, v: value }; document.body.classList.add(dir === "x" ? "ibx2-dragx" : "ibx2-dragy"); }}
      onPointerMove={(e) => { const s0 = start.current; if (!s0) return; const d = (dir === "x" ? e.clientX : e.clientY) - s0.p; onChange(clamp(s0.v + (invert ? -d : d))); }}
      onPointerUp={() => { start.current = null; document.body.classList.remove("ibx2-dragx", "ibx2-dragy"); }}
      onPointerCancel={() => { start.current = null; document.body.classList.remove("ibx2-dragx", "ibx2-dragy"); }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16, back = dir === "x" ? "ArrowLeft" : "ArrowUp", fwd = dir === "x" ? "ArrowRight" : "ArrowDown";
        if (e.key !== back && e.key !== fwd) return;
        e.preventDefault(); onChange(clamp(value + (e.key === fwd ? step : -step) * (invert ? -1 : 1)));
      }} />
  );
}

/**
 * The email column and the Assistant column for one email. The email column is either the email (with the answer box
 * docked at the bottom) or, after Create order, the order being made from it; the Assistant stays beside it.
 */
function Detail({ x, who, reply, quote, needs, urgent, answered, focus, orders, thread, back, busy, setBusy, done, listOpen, toggleList, inOutlook, ccOnly, moveBar, onMove, folders, onSent, autoOrder, onAutoOrdered, convo }: { /** the Inbox emails in its conversation, shown at the top */ convo?: React.ReactNode; /** opened to make the order (from a searched conversation) */ autoOrder?: boolean; onAutoOrdered?: () => void; /** sent a reply to an email in my Inbox: ask archive or keep */ onSent?: (msg: string, sent: { to: string; subject: string; body: string; theirs?: string }) => void; /** it's in my Outlook Inbox: Archive archives it there */ inOutlook?: boolean; ccOnly?: boolean; /** Email: Archive, Black Hole, Later, Move to… */ moveBar?: React.ReactNode; /** phones: the same moves for the bottom bar */ onMove?: (to: string, label: string) => void; folders?: Folder[] | null; x: Act; who: string; reply?: Sug; quote?: Sug; needs: boolean; urgent: boolean; answered: boolean; focus: boolean; orders: Ord[]; thread: Act[]; back: () => void; busy: string; setBusy: (s: string) => void; /** next: it's handled, show the next email */ done: (msg: string, next?: boolean) => void; listOpen: boolean; toggleList: () => void }) {
  const draftSubject = reply?.draft?.subject || (x.subject?.toLowerCase().startsWith("re:") ? x.subject : `Re: ${x.subject || ""}`);
  // an order was made from this email: its confirmation ("Thanks for your order…") is the answer, ready to send
  const confirm0 = (x.meta?.reply_options?.options || [])[0] as Opt | undefined;
  const confirm = confirm0?.label === "Order confirmation" ? confirm0 : undefined;
  // the old confirmation isn't put in the box just because the email was opened again (Oct 14, Nick: "this still pops up
  // when I click that email from Cheri"): it comes in only when the order is made (the effect on confirmAt below)
  const [subject, setSubject] = useState(draftSubject);
  const [body, setBody] = useState(reply?.draft?.body || "");
  const [err, setErr] = useState("");
  const [opts, setOpts] = useState<Opt[] | null>(x.meta?.reply_options?.options || null), [picked, setPicked] = useState(reply?.draft?.body ? -2 : -1), [ask, setAsk] = useState("");
  // Cc (Oct 12): who's copied, and what you told the AI ("copy Amanda") so they're added
  const [cc, setCc] = useState<string[]>([]), [told, setTold] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null), moreRef = useRef<HTMLDetailsElement | null>(null);
  // the answer box: a slim bar until you start answering (an email opened to answer starts open)
  const [writing, setWriting] = useState(focus);
  // the email column shows the email, or the order being made from it
  const [view, setView] = useState<"mail" | "order">("mail"), [orderStart, setOrderStart] = useState<{ told?: string; job?: string; n: number } | null>(null), [ordering, setOrdering] = useState(false);
  // phones: one column at a time
  const [side, setSide] = useState<"mail" | "ai">("mail");
  // phones: "✦ Assistant" sits in the email's top bar and opens the chat full screen
  const pnav = useContext(PhoneNav);
  const myNav = pnav; // the Assistant is in the bottom bar (PhoneBar)
  const [made, setMade] = useState<{ id: string; number: number } | null>(null), [bump, setBump] = useState(0);
  const [aiW, setAiW] = useSticky<number>("inbox.aiW", 330), [composeH, setComposeH] = useSticky<number>("inbox.composeH", 0);
  // the Assistant's room (Oct 10, Nick: half screen, the chat took too much space): the email keeps at least EMAIL_MIN;
  // when that leaves the chat under 280px it folds into a slim rail and slides out over the email when you click it.
  // On a wide screen it stays open unless you hide it.
  const workRef = useRef<HTMLDivElement | null>(null), [workW, setWorkW] = useState(0), [stacked, setStacked] = useState(false);
  const [aiHidden, setAiHidden] = useSticky<boolean>("inbox.aiHidden", false), [peek, setPeek] = useState(false);
  useEffect(() => {
    const el = workRef.current; if (!el) return;
    const mq = window.matchMedia("(max-width:1080px)");
    const on = () => { setWorkW(el.clientWidth); setStacked(mq.matches); };
    on(); const ro = new ResizeObserver(on); ro.observe(el); mq.addEventListener("change", on);
    return () => { ro.disconnect(); mq.removeEventListener("change", on); };
  }, []);
  const EMAIL_MIN = 470, room = workW ? workW - EMAIL_MIN - 12 : aiW;
  const narrow = !stacked && workW > 0 && room < 280;
  // the Assistant isn't there until you ask for it (Oct 14, Nick: "the assistant shouldn't be there by default, you
  // should hit that button"): the AI section's Assistant button opens it on the side
  const [aiOpen, setAiOpen] = useState(false);
  void aiHidden;
  const aiMode: "full" | "rail" | "drawer" | "off" = stacked ? "full" : !aiOpen ? "off" : narrow ? "drawer" : "full";
  const aiShown = narrow ? aiW : Math.max(280, Math.min(aiW, room));
  // Oct 14, Nick: "when you click the assistant button it should … start recording automatically"; it opens on the
  // right, as before (Oct 14, Nick): each open bumps `listen`, which starts the microphone; hiding it stops listening
  const [listen, setListen] = useState(0);
  const openAi = () => { setListen((n) => n + 1); if (stacked) setSide("ai"); else { setAiOpen(true); setPeek(true); setAiHidden(false); } };
  const hideAi = stacked ? undefined : () => { setAiOpen(false); setPeek(false); };
  useEffect(() => { setOrdering(false); setOrderStart(null); setMade(null); setView("mail"); }, [x.id]);
  const startOrder = (s?: { told?: string; job?: string }) => { if (s) setOrderStart((p) => ({ ...s, n: (p?.n || 0) + 1 })); setOrdering(true); setView("order"); setSide("mail"); };
  useEffect(() => { if (autoOrder) { startOrder(); onAutoOrdered?.(); } }, [autoOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const write = (focusBox = true) => { setWriting(true); setView("mail"); setSide("mail"); if (focusBox) setTimeout(() => boxRef.current?.focus(), 40); };
  // a step the Assistant suggested: open Create order with what to know, put a reply in the box, file it, no reply
  function act(a: EmailAction) {
    if (a.kind === "create_order") startOrder({ told: a.told, job: a.job });
    else if (a.kind === "reply") { if (a.subject) setSubject(a.subject); setBody(a.body); setPicked(-1); write(); }
    else if (a.kind === "file_under") { const o = orders.find((z) => z.number === a.order_number); if (o) void run("ord", () => setEmailOrder(x.id, o.id), `Filed under #${o.number}.`); else setErr(`#${a.order_number} isn't one of their open orders.`); }
    else if (a.kind === "no_reply") void run("nr", () => markNoReply(x.id), "Off your Needs reply list.");
    else if (a.kind === "order_goods") window.open(`/shop/order-goods?email=${x.id}`, "_blank");
  }
  // anywhere in a customer conversation (Oct 12, Nick: replied "got it, thanks" and Create order was gone): the order
  // comes from the customer's latest email in it, and it reads as an order when any email in it did
  const custThread = [x, ...thread].filter((t) => t.direction === "in" && t.customer_id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const orderFrom = x.direction === "in" ? x : custThread[0] || null;
  const intents = [x, ...thread].map((t) => t.meta?.triage?.intent || "");
  const orderish = intents.some((i) => i === "new_order" || i === "reorder") || !!quote;
  // a reorder only when nothing in the conversation reads as a new order (Oct 12: Methodist's "keep the original shirt
  // count" was read as a reorder of a brand-new order)
  const reorder = intents.includes("reorder") && !intents.includes("new_order");
  // a piece count in the email ("700 shirts"): an Order goods button right on it (Oct 12, Nick)
  const goodsPcs = pieceCount(x.meta?.triage?.summary, x.subject, (x.body || "").slice(0, 4000));
  /** Match to customer (toolbar): opens the new-sender box on "Add to a customer" */
  const [matchKey, setMatchKey] = useState(0);
  const [fwdOpen, setFwdOpen] = useState(false);
  const [askBH, setAskBH] = useState(false);
  /** the customer's projects, for Messages → Save to project */
  const [projs, setProjs] = useState<{ id: string; name: string; status: string }[]>([]);
  useEffect(() => {
    if (!x.customer_id) { setProjs([]); return; }
    let live = true;
    createClient().from("projects").select("id, name, status").eq("customer_id", x.customer_id).order("created_at", { ascending: false }).limit(30).then(({ data }) => { if (live) setProjs((data || []) as never); });
    return () => { live = false; };
  }, [x.customer_id]);
  const projOn = projs.find((p) => p.id === x.project_id);
  async function loadOpts(fresh = false) {
    setBusy("opts"); setErr("");
    const r = await aiReplyOptions(x.id, fresh);
    setBusy("");
    if (!r.ok) return setErr(r.error || "The AI couldn't come up with answers.");
    setOpts(r.options);
  }
  function pick(i: number) {
    if (i === -2) { setPicked(-2); setSubject(draftSubject); setBody(reply?.draft?.body || ""); }
    else { const o = opts?.[i]; if (!o) return; setPicked(i); setSubject(o.subject); setBody(o.body); }
    write();
  }
  // emails waiting on an answer get their suggested answers straight away (written once, then kept with the email)
  // (no suggested answers fetched up front any more: Oct 14)
  useEffect(() => { if (focus) setTimeout(() => boxRef.current?.focus(), 60); }, [focus]);
  async function urlFor(path: string) { const { data } = await createClient().storage.from("proofs").createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => { setBusy(key); setErr(""); if (moreRef.current) moreRef.current.open = false; const r = await fn(); setBusy(""); if (r.ok && key === "arch") cheerWin("archived"); if (!r.ok) setErr(r.error || "Something went wrong."); else if (key === "send" && onSent) { setWriting(false); onSent(ok, { to: x.from_email || "", subject, body, theirs: x.body || "" }); done("", false); } else done(ok, key === "send" || key === "nr" || key === "ign" || key === "arch"); };
  // the order confirmation arrives after the order is made: into the empty answer box, never over what's typed
  const confirmAt = x.meta?.reply_options?.at;
  // only when it arrives while you're on the email (an order just made from it), never just from opening the email again
  // (Oct 14, Nick: "whenever I go into this message from Cheri the weird pop-up shows up": the reply box opened every time
  // with the old confirmation in it)
  const confirmSeen = useRef(confirmAt);
  useEffect(() => {
    if (confirmAt === confirmSeen.current) return;
    confirmSeen.current = confirmAt;
    if (confirm && !body.trim()) { setSubject(confirm.subject); setBody(confirm.body); setPicked(0); setWriting(true); }
  }, [confirmAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // the More menu closes when you click anywhere else
  useEffect(() => {
    const off = (e: PointerEvent) => { const m = moreRef.current; if (m?.open && !m.contains(e.target as Node)) m.open = false; };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, []);
  const when = new Date(x.occurred_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const filed = orders.find((o) => o.id === x.order_id);
  const fromName = x.meta?.from_name || x.from_email;
  void loadOpts; void pick; void opts;
  const suggestions: { i: number; label: string; text: string }[] = [
    ...(reply?.draft?.body ? [{ i: -2, label: "AI's draft", text: reply.draft.body }] : []),
    ...(opts || []).map((o, i) => ({ i, label: o.label, text: o.body })),
  ];
  void suggestions;

  return (
    <div className="ibx2-work" ref={workRef} data-side={side} data-ai={aiMode} style={{ ["--ibx-ai" as string]: `${aiShown}px` }}>
      {aiMode === "full" && !stacked && <Splitter dir="x" value={aiShown} min={280} max={Math.max(280, Math.min(720, room))} invert onChange={setAiW} className="ibx2-sv ibx2-sv-ai" style={{ right: aiShown + 2 }} label="Drag to make the Assistant wider or narrower" />}
      <div className="ibx2-sw" role="tablist" aria-label="Show">
        <button type="button" className="ibx2-back" onClick={back} aria-label="Back to the emails">←</button>
        <button type="button" role="tab" aria-selected={side === "mail"} className={side === "mail" ? "on" : ""} onClick={() => setSide("mail")}>{view === "order" ? "Order" : "Email"}</button>
        <button type="button" role="tab" aria-selected={side === "ai"} className={side === "ai" ? "on" : ""} onClick={() => setSide("ai")}>✦ Assistant</button>
      </div>

      {/* 2. the email (or the order being made from it) */}
      <PhoneNav.Provider value={myNav}>
      <section className="ibx2-mail" aria-label="The email">
        <MailHead listOpen={listOpen} toggleList={toggleList} subject={x.subject}
          phone={{
            reply: x.direction === "in" ? () => write() : undefined, forward: view !== "order" ? () => setFwdOpen(true) : undefined, known: x.customer_id ? who : undefined,
            busy: busy === "mv" || busy === "arch", folders, here: "INBOX",
            ask: x.direction === "in" ? { id: x.id, who, onDraft: (d) => { act({ kind: "reply", label: "", subject: d.subject, body: d.body }); if (d.cc?.length) setCc((c) => [...new Set([...c, ...d.cc!])]); }, openChat: () => setSide("ai") } : undefined,
            move: onMove || (inOutlook ? (to, label, confirmed) => { const k = (["archive", "later", "news", "receipts", "cc", "blackhole"].includes(to) ? to : "archive") as "archive"; void run("arch", () => archiveOutlookEmail({ activityId: x.id, to: k, ...(confirmed ? { confirmed: true } : {}) }), label); } : undefined),
            more: (close) => <>
              <PSec label="Actions">
                {view === "order" ? <PTile icon={TbIcon.back} label="Back to the email" onClick={() => { close(); setView("mail"); }} />
                  : <PTile icon={TbIcon.order} label={ordering ? "Back to the order" : reorder ? "Create reorder" : "Create order"} kind="primary" disabled={!!busy} onClick={() => { close(); startOrder(); }} />}
                <PTile icon={TbIcon.goods} label="Order goods" href={orderGoodsHref(x.id)} onClick={close} />
                {x.customer_id ? <PTile icon={TbIcon.person} label="Customer" href={`/shop/customers/${x.customer_id}`} onClick={close} />
                  : <PTile icon={TbIcon.person} label="Match to customer" onClick={() => { close(); setMatchKey((k) => k + 1); }} />}
                {x.direction === "in" && !x.customer_id && <PTile icon={TbIcon.ban} label="Not a customer" disabled={!!busy} onClick={() => { close(); void run("ign", () => markNotCustomer(x.id), `${x.from_email} won't be read again.`); }} />}
              </PSec>
              {x.customer_id && <PSec label="Messages">
                <PPick icon={TbIcon.file} label={filed ? `Filed #${filed.number}` : "File under"} empty="No orders for this customer yet."
                  items={[...orders.slice(0, 40).map((o) => ({ key: o.id, on: o.id === x.order_id, label: <>#{o.number} {o.nickname || ""} <span className="faint">({o.status})</span></>, onClick: () => { close(); void run("ord", () => setEmailOrder(x.id, o.id), `Filed under #${o.number}.`); } })),
                    ...(x.order_id ? [{ key: "none", label: "Not filed under an order", onClick: () => { close(); void run("ord", () => setEmailOrder(x.id, null), "Not filed under an order now."); } }] : [])]} />
                <PPick icon={TbIcon.folder} label={projOn ? projOn.name.slice(0, 18) : "Project"} empty="No projects for this customer yet."
                  items={[...projs.map((p) => ({ key: p.id, on: p.id === x.project_id, label: <>{p.name} <span className="faint">({p.status})</span></>, onClick: () => { close(); void run("proj", () => setEmailProject(x.id, p.id), `Saved to the project ${p.name}.`); } })),
                    ...(x.project_id ? [{ key: "none", label: "Not on a project", onClick: () => { close(); void run("proj", () => setEmailProject(x.id, null), "Taken off the project."); } }] : [])]}
                  extra={<a href={`/shop/projects?new=${x.customer_id}`} onClick={close}>New project…</a>} />
                <PPick icon={TbIcon.note} label="Order notes" empty="No orders for this customer yet."
                  items={orders.slice(0, 40).map((o) => ({ key: o.id, label: <>#{o.number} {o.nickname || ""} <span className="faint">({o.status})</span></>, onClick: () => { close(); void run("onote", () => addEmailToOrderNotes(x.id, o.id), `Added to the notes on #${o.number}.`); } }))} />
              </PSec>}
            </>,
          }} ai={x.direction === "in" ? <>{/* the design's running history (Oct 14, Nick) */}<HistoryLink customer={x.customer_id} text={x.subject || ""} text2={x.meta?.triage?.summary || ""} className="eh-hist" />{/* phones: the AI card's buttons (Oct 14, Nick: "New Order, Reorder, Order goods, then the microphone") */}
            {view !== "order" && (ordering ? <button type="button" className="tb-b primary eh-ai-go" onClick={() => startOrder()}>{TbIcon.order}<span className="tb-l">Back to the order</span></button> : <>
              <button type="button" className={"tb-b eh-ai-go" + (!reorder ? " primary" : "")} disabled={!!busy} onClick={() => startOrder(reorder ? { told: "This is a new order, not a reorder of a past job." } : undefined)}>{TbIcon.order}<span className="tb-l">New order</span></button>
              <button type="button" className={"tb-b eh-ai-go" + (reorder ? " primary" : "")} disabled={!!busy} onClick={() => startOrder(!reorder ? { told: "This is a reorder of a past job: find the job it repeats." } : undefined)}>{TbIcon.repeat}<span className="tb-l">Reorder</span></button>
            </>)}
            {view !== "order" && <a className="tb-b eh-ai-go" href={orderGoodsHref(x.id)}>{TbIcon.goods}<span className="tb-l">Order goods</span></a>}<button type="button" className={"tb-b ai eh-ai-btn" + (aiOpen ? " on" : "")} onClick={() => (aiOpen ? hideAi?.() : openAi())} aria-expanded={aiOpen} title={aiOpen ? "Hide the Assistant" : "Open the Assistant and start listening"}><svg viewBox="0 0 24 24" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg><span className="tb-l">{aiOpen ? "Hide Assistant" : "Assistant"}</span></button></> : undefined}
          fromName={personName(fromName) || who} org={who !== personName(fromName) && who !== fromName ? who : undefined} fromEmail={x.from_email} to={x.to_email || ""} date={when} summary={x.meta?.triage?.summary}
          tags={<>
            {urgent && <span className="eh-tag hot">Urgent{x.meta?.triage?.urgent_reason ? `: ${x.meta.triage.urgent_reason}` : ""}</span>}
            {x.meta?.triage?.intent && INTENT[x.meta.triage.intent] && <span className="eh-tag">{INTENT[x.meta.triage.intent]}</span>}
            {x.customer_id && <Link className="eh-tag link" href={`/shop/customers/${x.customer_id}`}>Customer</Link>}
            {filed && <Link className="eh-tag link" href={`/shop/orders/${filed.id}`}>#{filed.number}</Link>}
            {answered && <span className="eh-tag ok">Answered</span>}
            {ccOnly && <span className="eh-tag" title="You were copied (Cc), not sent to: not on your Needs reply list">CC&apos;d</span>}
          </>}
          toolbar={<Toolbar>
            {view === "order" ? <TbGroup><TbBtn icon={TbIcon.back} label="Back to the email" onClick={() => setView("mail")} /></TbGroup> : <>
            <TbRow line={1}>
            {/* Email (Oct 14, Nick: Email · Move · Spam · Actions, then the AI summary, then the email as it came) */}
            {x.direction === "in" && <TbGroup label="Email">
              <TbBtn icon={TbIcon.reply} label="Reply" kind={!orderish || x.order_id ? "primary" : undefined} onClick={() => write()} />
              <TbBtn icon={TbIcon.forward} label="Forward" onClick={() => setFwdOpen((v) => !v)} />
            </TbGroup>}
            {/* Move · Spam */}
            {moveBar || (inOutlook && <>
              <TbGroup label="Move">
                <TbBtn icon={TbIcon.archive} label={busy === "arch" ? "Archiving…" : "Archive"} kind="strong" disabled={!!busy} title="Moves it to Archive in your Outlook" onClick={() => run("arch", () => archiveOutlookEmail({ activityId: x.id }), "Archived in Outlook.")} />
                <TbBtn icon={TbIcon.news} label="News" disabled={!!busy} title="SaneBox News: this sender's mail goes to News from now on" onClick={() => run("arch", () => archiveOutlookEmail({ activityId: x.id, to: "news" }), "Moved to News (SaneBox).")} />
              </TbGroup>
              <TbGroup label="Spam">
                {askBH ? <span className="tb-ask" role="alertdialog" aria-label="Black Hole a customer?">
                  <span><b>{who}</b> is a customer. Black Hole blocks their email from now on. Are you sure?</span>
                  <button type="button" className="btn sm danger" disabled={!!busy} onClick={() => { setAskBH(false); void run("arch", () => archiveOutlookEmail({ activityId: x.id, to: "blackhole", confirmed: true }), "Black Hole: SaneBox won't show you this sender again."); }}>Yes, Black Hole</button>
                  <button type="button" className="btn sm ghost" onClick={() => setAskBH(false)}>Cancel</button>
                </span>
                  : <TbBtn icon={TbIcon.ban} label="Black Hole" kind="danger" disabled={!!busy} title="SaneBox Black Hole: junk, and this sender is blocked from now on" onClick={() => (x.customer_id ? setAskBH(true) : run("arch", () => archiveOutlookEmail({ activityId: x.id, to: "blackhole" }), "Black Hole: SaneBox won't show you this sender again."))} />}
              </TbGroup>
            </>)}
            </TbRow>
            <TbRow line={2}>
            {/* Actions */}
            <TbGroup label="Actions">
              {<TbBtn icon={TbIcon.order} label={ordering ? "Back to the order" : reorder ? "Create reorder" : "Create order"} kind={orderish && !x.order_id ? "primary" : undefined} disabled={!!busy} onClick={() => startOrder()} title="The AI reads the email and its attachments and fills in the order (new, or a reorder of a past job) for you to check" />}
              <TbBtn icon={TbIcon.goods} label="Order goods" title="Order the goods for this from S&S, or email our S&S rep for a custom quote" onClick={() => { window.location.href = orderGoodsHref(x.id); }} />
              {x.customer_id
                ? <TbBtn icon={TbIcon.person} label="Customer" title="Customer profile: open this customer's page" onClick={() => { window.location.href = `/shop/customers/${x.customer_id}`; }} />
                : <TbBtn icon={TbIcon.person} label="Match to customer" title="Make them a customer, or add them as a contact at one" onClick={() => setMatchKey((k) => k + 1)} />}
              <TbMenu icon={TbIcon.more} label="More">{(close) => <>
                {needs && <button type="button" role="menuitem" disabled={!!busy} onClick={() => { close(); void run("nr", () => markNoReply(x.id), "Off your Needs reply list."); }}>No reply needed</button>}
                {!needs && x.meta?.no_reply && <button type="button" role="menuitem" disabled={!!busy} onClick={() => { close(); void run("nr-undo", () => markNoReply(x.id, false), "Back on Needs reply."); }}>Needs a reply after all</button>}
                {!needs && !x.meta?.no_reply && answered && <button type="button" role="menuitem" disabled={!!busy} onClick={() => { close(); void run("back", () => putBackInInbox(x.id), "Back in the Inbox."); }}>Back to Needs reply</button>}
                {x.direction === "in" && <button type="button" role="menuitem" disabled={!!busy} onClick={() => { close(); void run("ign", () => markNotCustomer(x.id), `${x.from_email} won't be read again.`); }}>Not a customer (stop reading their email)</button>}
              </>}</TbMenu>
            </TbGroup>
            {/* Messages: keep this email with an order or a project (Oct 14) */}
            {x.customer_id && <TbGroup label="Messages">
              <TbMenu icon={TbIcon.file} label={filed ? `Filed #${filed.number}` : "File under"}>{(close) => <>
                {orders.slice(0, 40).map((o) => <button key={o.id} type="button" role="menuitem" className={o.id === x.order_id ? "on" : ""} disabled={!!busy} onClick={() => { close(); void run("ord", () => setEmailOrder(x.id, o.id), `Filed under #${o.number}.`); }}>#{o.number} {o.nickname || ""} <span className="faint">({o.status})</span></button>)}
                {x.order_id && <button type="button" role="menuitem" onClick={() => { close(); void run("ord", () => setEmailOrder(x.id, null), "Not filed under an order now."); }}>Not filed under an order</button>}
                {!orders.length && <span className="faint" style={{ padding: 8 }}>No orders for this customer yet.</span>}
              </>}</TbMenu>
              <TbMenu icon={TbIcon.folder} label={projOn ? projOn.name.slice(0, 18) : "Project"}>{(close) => <>
                {projs.map((p) => <button key={p.id} type="button" role="menuitem" className={p.id === x.project_id ? "on" : ""} disabled={!!busy} onClick={() => { close(); void run("proj", () => setEmailProject(x.id, p.id), `Saved to the project ${p.name}.`); }}>{p.name} <span className="faint">({p.status})</span></button>)}
                {x.project_id && <button type="button" role="menuitem" onClick={() => { close(); void run("proj", () => setEmailProject(x.id, null), "Taken off the project."); }}>Not on a project</button>}
                {!projs.length && <span className="faint" style={{ padding: 8 }}>No projects for this customer yet.</span>}
                <a role="menuitem" href={`/shop/projects?new=${x.customer_id}`} onClick={close}>New project…</a>
              </>}</TbMenu>
              <TbMenu icon={TbIcon.note} label="Order notes">{(close) => <>
                {orders.slice(0, 40).map((o) => <button key={o.id} type="button" role="menuitem" disabled={!!busy} onClick={() => { close(); void run("onote", async () => { const r = await addEmailToOrderNotes(x.id, o.id); return r; }, `Added to the notes on #${o.number}.`); }}>#{o.number} {o.nickname || ""} <span className="faint">({o.status})</span></button>)}
                {!orders.length && <span className="faint" style={{ padding: 8 }}>No orders for this customer yet.</span>}
              </>}</TbMenu>
            </TbGroup>}
            </TbRow>
            </>}
          </Toolbar>} />
        {fwdOpen && view !== "order" && <ForwardBox id={x.id} onDone={(msg) => { setFwdOpen(false); if (msg) done(msg, false); }} />}
        {made && <div className="ibx2-made eh-err">Order <b>#{made.number}</b> created. <a href={`/shop/orders/${made.id}`} target="_blank" rel="noreferrer">Open it</a></div>}
        {err && <div className="pv-err eh-err">{err}</div>}

        {ordering && <div className="ibx2-order" hidden={view !== "order"}>
          <EmailOrderPanel key={`${x.id}:${orderStart?.n || 0}`} activityId={orderFrom?.id || x.id} start={orderStart || undefined}
            onClose={() => { setOrdering(false); setView("mail"); }}
            onCreated={(id, n, opened) => { setOrdering(false); setView("mail"); setMade({ id, number: n }); if (!opened) window.open(`/shop/orders/${id}`, "_blank"); void noteEmailChat(x.id, `Order #${n} created from this email.`, `/shop/orders/${id}`).then(() => setBump((b) => b + 1)); done(`Order #${n} created. Our mockup is being built in a new tab.`); }} />
        </div>}

        {view === "mail" && <>
          <div className="ibx2-read">
            {convo}
            {!x.customer_id && x.direction === "in" && <NewSender key={`ns-${matchKey}`} x={x} busy={busy} run={run} start={matchKey ? "contact" : ""} />}
            <div className="ibx2-orig-h">{x.direction === "in" ? `${fromName}'s email, as sent` : "Our email, as sent"} <span className="faint">· {when}</span></div>
            <EmailBody x={x} />
            {(x.meta?.attachments || []).length > 0 && <div className="ibx2-files">{x.meta!.attachments!.map((f) => <button key={f.path} type="button" onClick={() => urlFor(f.path)}>📎 {f.name}</button>)}</div>}
            <CanvaGet x={x} busy={busy} run={run} />
            {/* the whole conversation underneath, newest first, our replies too (Oct 12, Nick) */}
            {thread.length > 0 && <details className="ibx2-thread" open>
              <summary>The rest of this conversation ({thread.length})</summary>
              {[...thread].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).map((t) => <div key={t.id} className={"ibx-t " + t.direction + (t.occurred_at > x.occurred_at ? " newer" : "")}><b>{t.direction === "out" ? "You" : personName(t.meta?.from_name) || t.from_email}</b> · {new Date(t.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{t.occurred_at > x.occurred_at && <span className="ibx-newer">Newer</span>}<div>{plainNew(t.body)}</div></div>)}
            </details>}
          </div>

          {/* the answer, docked at the bottom like Outlook */}
          {x.direction === "in" && writing && <Splitter dir="y" value={composeH || 300} min={160} max={900} invert onChange={setComposeH} className="ibx2-sh" label="Drag to make the answer box taller or shorter" />}
          {x.direction === "in" && <div className={"ibx2-compose" + (writing ? " open" : "") + (writing && composeH ? " sized" : "")} style={writing && composeH ? { height: composeH } : undefined}>
            {/* the suggested answers strip is gone (Oct 14, Nick: "you're going to get there from whatever I tell you to do"): tell the Assistant instead */}
            {!writing ? (
              <button type="button" className="ibx2-replybar" onClick={() => write()}>Reply to {fromName.split(/[\s@]/)[0]}…</button>
            ) : <>
              <div className="ibx2-to"><span>To {x.from_email}</span><input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" /></div>
              <CcField value={cc} onChange={setCc} text={`${told}\n${body}`} />
              <textarea ref={boxRef} rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your answer, or tell the AI what to say below" aria-label="Reply" />
              <SayButton chatId={x.id} who={who} onDraft={(d) => { act({ kind: "reply", label: "", subject: d.subject, body: d.body }); if (d.cc?.length) setCc((c) => [...new Set([...c, ...d.cc!])]); }} />
              <form className="ibx2-tell" onSubmit={async (e) => { e.preventDefault(); if (!ask.trim()) return; setBusy("ai"); setErr(""); setTold((t) => `${t}\n${ask}`); const r = await aiWriteReply({ activityId: x.id, instruction: ask, subject }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't write that."); else { setSubject(r.subject || subject); setBody(r.body); setPicked(-1); setAsk(""); boxRef.current?.focus(); } }}>
                <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Tell the AI what to say, e.g. “yes, if we get the order by Saturday”" aria-label="Tell the AI what to say" />
                <button type="submit" className="btn sm" disabled={!!busy || !ask.trim()}>{busy === "ai" ? "Writing…" : "✦ Write it"}</button>
              </form>
              <div className="ibx2-send">
                <button type="button" className="btn primary" disabled={!!busy || !body.trim()} onClick={() => run("send", () => sendEmailReply({ activityId: x.id, subject, body, suggestionId: reply?.id, cc }), `Sent to ${x.from_email}.`)}>{busy === "send" ? "Sending…" : "Send"}</button>
                {body.trim() && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={async () => { setBusy("polish"); setErr(""); const r = await aiWriteReply({ activityId: x.id, subject, body }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't rewrite that."); else setBody(r.body); }}>{busy === "polish" ? "Polishing…" : "✦ Polish"}</button>}
                <span className="faint">Your signature and their email go underneath.</span>
                <span className="spacer" />
                <button type="button" className="btn sm ghost" onClick={() => setWriting(false)}>Close</button>
              </div>
            </>}
          </div>}
        </>}
      </section>
      </PhoneNav.Provider>

      {/* 3. the Assistant: stays open while answering or making the order */}
      {aiMode === "drawer" && (
        <button type="button" className="ibx2-rail" aria-expanded={aiMode === "drawer"} onClick={() => (aiMode === "drawer" ? hideAi?.() : openAi())} title={aiMode === "drawer" ? "Hide the Assistant" : "Open the Assistant"}>
          <span className="tx-av" aria-hidden>✦</span><span className="ibx2-rail-t">Assistant</span>
        </button>
      )}
      <aside className="ibx2-ai" aria-label="Assistant">
        {x.direction === "in"
          ? <EmailChat activityId={x.id} onAction={(a) => { if (narrow) setPeek(false); act(a); }} busyOutside={!!busy} bump={bump} summary={x.meta?.triage?.summary} onHide={hideAi} onBack={() => setSide("mail")} who={who} listen={listen} hush={stacked ? side !== "ai" : !aiOpen} />
          : <div className="ibx2-none">Your sent email.</div>}
      </aside>
    </div>
  );
}

/** A sender who isn't a customer yet: make them one, or add them as a contact at a customer you have. */
/** whether the shop's Canva account is connected (asked once per page load) */
let canvaOnP: Promise<boolean> | null = null;
const canvaOn = () => (canvaOnP ||= fetch("/api/canva/status", { cache: "no-store" }).then((r) => r.json()).then((j: { connected?: boolean }) => !!j.connected).catch(() => false));

/** A Canva link in the email whose design isn't saved yet: export it through the shop's Canva account (lib/linkArt.ts) */
function CanvaGet({ x, busy, run }: { x: Act; busy: string; run: (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => Promise<void> }) {
  const got = new Set((x.meta?.attachments || []).filter((f) => f.source === "canva-export").map((f) => f.from_link));
  const todo = (x.meta?.links || []).filter((l) => l.kind === "canva" && !got.has(l.url));
  const [on, setOn] = useState(false);
  useEffect(() => { if (todo.length) void canvaOn().then(setOn); }, [todo.length]);
  if (!todo.length || !on) return null;
  const err = todo.find((l) => l.error)?.error;
  const get = async () => {
    const r = await fetch("/api/inbox/link-art", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: x.id, force: true }) }).then((r) => r.json()).catch(() => null) as { ok?: boolean; error?: string; found?: { kind: string; saved?: unknown; error?: string }[] } | null;
    if (!r?.ok) return { ok: false, error: r?.error || "Couldn't reach Canva." };
    const bad = (r.found || []).find((f) => f.kind === "canva" && !f.saved);
    return bad ? { ok: false, error: bad.error || "Canva didn't send the design." } : { ok: true };
  };
  return (
    <div className="ibx2-files">
      <button type="button" disabled={!!busy} onClick={() => run("canva", get, "Saved the design from Canva with this email.")}>{busy === "canva" ? "Getting the design from Canva…" : "Get the design from Canva"}</button>
      {err && busy !== "canva" && <span className="faint" style={{ fontSize: 12.5, alignSelf: "center" }}>{err}</span>}
    </div>
  );
}

function NewSender({ x, busy, run, start = "" }: { x: Act; busy: string; run: (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => Promise<void>; /** opened from the Match to customer button */ start?: "" | "contact" }) {
  const [mode, setMode] = useState<"" | "new" | "contact">(start), [company, setCompany] = useState(""), [custQ, setCustQ] = useState(""), [hits, setHits] = useState<Cust[]>([]);
  async function find(q: string) { setCustQ(q); if (q.trim().length < 2) return setHits([]); const s = q.replace(/[,()]/g, ""); const { data } = await createClient().from("customers").select("id, company, name").or(`company.ilike.%${s}%,name.ilike.%${s}%,email.ilike.%${s}%`).limit(8); setHits((data || []) as Cust[]); }
  const first = x.meta?.from_name?.split(" ")[0] || "them";
  return (
    <div className="ibx2-new">
      <span><b>New sender.</b> Not a customer yet.</span>
      {mode === "" && <>
        <button type="button" className="btn sm" onClick={() => setMode("new")}>Make them a customer</button>
        <button type="button" className="btn sm ghost" onClick={() => setMode("contact")}>Add to a customer</button>
      </>}
      {mode === "new" && <>
        <input placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="New customer company" autoFocus />
        <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => run("new", () => customerFromEmail(x.id, company), "New customer made from the email.")}>Make customer</button>
        <button type="button" className="btn sm ghost" onClick={() => setMode("")}>Cancel</button>
      </>}
      {mode === "contact" && <span className="ibx2-pick">
        <input placeholder={`Which customer is ${first} at?`} value={custQ} onChange={(e) => find(e.target.value)} aria-label="Find the customer they work for" autoFocus />
        {hits.length > 0 && <span className="ibx-hits">{hits.map((c) => <button key={c.id} type="button" onClick={() => run("cust", () => setEmailCustomer(x.id, c.id), `${x.meta?.from_name || x.from_email} is now a contact at ${c.company || c.name}.`)}>{c.company || c.name}</button>)}</span>}
        <button type="button" className="btn sm ghost" onClick={() => setMode("")}>Cancel</button>
      </span>}
    </div>
  );
}

/**
 * The email as Outlook shows it: its own formatting, signature and pictures, in a locked-down frame (no scripts run;
 * links open in a new tab). Pictures sent inside the email come from our private copy; email stored before we kept
 * the formatting shows as plain text until the next mailbox check fills it in.
 */
/**
 * An email with no saved formatting, shown like Outlook would: the whole text (no box with its own scrollbar),
 * Gmail's hard line breaks joined back into paragraphs, and "[image: name.png]" replaced by that picture.
 */
function PlainBody({ x }: { x: Act }) {
  const [pics, setPics] = useState<Record<string, string>>({});
  const imgs = (x.meta?.attachments || []).filter((f) => /^image\//.test(f.type));
  useEffect(() => {
    let live = true;
    if (!imgs.length) return;
    createClient().storage.from("proofs").createSignedUrls(imgs.map((f) => f.path), 3600).then(({ data }) => {
      if (!live) return;
      const m: Record<string, string> = {};
      imgs.forEach((f) => { const u = data?.find((r) => r.path === f.path)?.signedUrl; if (u) m[f.name.toLowerCase()] = u; });
      setPics(m);
    });
    return () => { live = false; };
  }, [x.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // join lines a mail program wrapped at ~76 characters back into paragraphs
  const lines = String(x.body || "").replace(/\r/g, "").split("\n"), out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev != null && prev.length >= 55 && prev.length <= 80 && l.trim() && !/^\s*([-*•>]|\d+[.)]|\[image:)/.test(l) && !/[:]$/.test(prev)) out[out.length - 1] = `${prev} ${l.trim()}`;
    else out.push(l);
  }
  const text = out.join("\n");
  const parts = text.split(/(\[image: [^\]]+\])/g);
  return (
    <div className="ibx2-plain">
      {parts.map((p, i) => {
        const m = p.match(/^\[image: ([^\]]+)\]$/);
        if (m) { const u = pics[m[1].toLowerCase()]; return u ? <img key={i} src={u} alt={m[1]} /> : <span key={i} className="faint">[{m[1]}]</span>; }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

function EmailBody({ x }: { x: Act }) {
  const [doc, setDoc] = useState<string | null>(null), [plain, setPlain] = useState(false), [h, setH] = useState(240);
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    let live = true;
    setDoc(null); setH(240);
    const path = x.meta?.html;
    if (!path) return;
    (async () => {
      const sb = createClient().storage.from("proofs");
      const { data: blob } = await sb.download(path);
      if (!blob || !live) return;
      let html = await blob.text();
      const inline = Object.entries(x.meta?.inline || {});
      if (inline.length) {
        const { data: urls } = await sb.createSignedUrls(inline.map(([, p]) => p), 3600);
        inline.forEach(([cid, p]) => { const u = urls?.find((r) => r.path === p)?.signedUrl; if (u) html = html.split(`cid:${cid}`).join(u); });
      }
      html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
      const head = `<base target="_blank"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; form-action 'none'"><style>html,body{margin:0;padding:10px 12px;font:14px/1.45 Calibri,Segoe UI,Arial,sans-serif;color:#222;background:#fff;overflow-x:auto}img{max-width:100%;height:auto}${PHONE_MAIL_CSS}table img{max-width:none}table{max-width:100%}</style>`;
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
      if (live) setDoc(html);
    })().catch(() => null);
    return () => { live = false; };
  }, [x.id, x.meta?.html, x.meta?.inline]);
  // the frame grows to the whole email (the pane scrolls, not a box inside it)
  const fit = () => { const f = ref.current, d = f?.contentDocument; if (!f || !d?.body) return; fitWidth(f, d); setH(Math.min(20000, Math.max(60, frameHeight(d)))); };
  if (!x.meta?.html || plain || doc == null) return (
    <div>
      <PlainBody x={x} />
      {x.meta?.html && plain && <button type="button" className="btn sm ghost" onClick={() => setPlain(false)}>Show as in Outlook</button>}
    </div>
  );
  return (
    <div className="ibx-html">
      <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={() => { fit(); setTimeout(fit, 400); setTimeout(fit, 1500); }} />
      <QuoteToggle html={doc} frame={ref} fit={fit} />
      <button type="button" className="btn sm ghost" onClick={() => setPlain(true)}>Plain text</button>
    </div>
  );
}

function Connect({ st, onDone }: { st: Status; onDone: (msg: string) => void }) {
  const [email, setEmail] = useState(st.mine?.email || st.myEmail), [name, setName] = useState(st.mine?.name || ""), [pw, setPw] = useState("");
  const host = st.mine?.imap_host || st.defaultHost;
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  return (
    <section className="panel ibx-connect"><form className="panel-b stack" style={{ gap: 10 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); const r = await connectMailbox({ email, password: pw, name, host }); setBusy(false); setPw(""); if (!r.ok) setErr(r.error); else if (r.sendProblem) setErr(`Connected for reading, but sending isn't on yet. ${r.sendProblem}`); else onDone("Your email is connected. Customer email will show up within a couple of minutes."); }}>
      <div><b>{st.viewing ? `Connect ${st.viewing.split("@")[0].replace(/^./, (c) => c.toUpperCase())}'s email` : st.mine?.enabled ? "Your email" : "Connect your email"}</b>{st.viewing && <div className="faint" style={{ fontSize: 13, marginBottom: 4 }}>You&apos;re viewing as {st.viewing}. Type their email password below; it connects to their account, not yours.</div>}<div className="faint" style={{ fontSize: 13 }}>The portal reads your Inbox and Sent Items every 2 minutes and keeps only customer email. Replies you send from here go out from your address and land in your Sent Items. Your password is checked with the mail server, then stored encrypted; nobody can see it.</div></div>
      <div className="ibx-form">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!!st.viewing} autoComplete="username" required /></label>
        <label>{st.viewing ? "Their name (signs replies)" : "Your name (signs replies)"}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={st.viewing ? st.viewing.split("@")[0].replace(/^./, (c) => c.toUpperCase()) : "Nicholas"} /></label>
        <label>Email password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>IMAP and SMTP have to be ticked for your mailbox in HostPilot first (Services → Exchange → your name → Advanced Settings): IMAP to read, SMTP to send. The owner can do that for everyone.</div>
      {err && <div className="pv-err">{err}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Checking the sign-in…" : st.mine?.enabled ? "Save" : "Connect"}</button>
        {st.mine?.enabled && <button type="button" className="btn ghost" disabled={busy} onClick={async () => { setBusy(true); await disconnectMailbox(); setBusy(false); onDone("Your email is disconnected. Email already on file stays."); }}>Disconnect</button>}
      </div>
    </form></section>
  );
}

/** your Outlook signature, read from the emails you've sent, as it'll appear on replies sent from here */
/**
 * After a reply goes out (Oct 12, Nick): the follow-ups it promises ("we'll deliver Wednesday" → a to-do or event on My
 * Day, one tap each), then, for an email in the Inbox, archive it or keep it.
 */
function AfterSend({ a, onArchive, onClose }: { a: { it?: InboxItem; msg: string; sent?: { to: string; subject: string; body: string; theirs?: string } }; onArchive: () => void; onClose: () => void }) {
  const [items, setItems] = useState<FollowUp[] | null>(a.sent ? null : []), [added, setAdded] = useState<Record<number, string>>({});
  useEffect(() => { if (a.sent) void suggestFollowUps(a.sent).then((r) => setItems(r.ok ? r.items : []), () => setItems([])); }, [a.sent]);
  const day = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
  const time = (t: string | null) => (t ? new Date(`2000-01-01T${t}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
  const add = async (k: number, f: FollowUp) => {
    setAdded((x) => ({ ...x, [k]: "…" }));
    const r = f.kind === "event" && f.day ? await addEvent({ title: f.title, day: f.day, start: f.start }) : await addTask({ title: f.title, area: f.area, due: f.day });
    setAdded((x) => ({ ...x, [k]: r.ok ? "✓ On My Day" : r.error }));
  };
  return (
    <div className="as-card" role="dialog" aria-label="After sending">
      <div className="as-t"><b>{a.msg}</b></div>
      {items === null ? <div className="as-f faint">✦ Looking for anything you promised…</div>
        : items.length > 0 && <div className="as-fl">
          <span className="as-q">Want a reminder?</span>
          {items.map((f, k) => <div key={k} className="as-f">
            <span className={"as-k " + f.kind}>{f.kind === "event" ? "Event" : "To-do"}</span>
            <span className="as-ft"><b>{f.title}</b>{(f.day || f.start) && <span className="faint"> · {day(f.day)}{f.start ? ` ${time(f.start)}` : ""}</span>}</span>
            {added[k] ? <span className={"as-done" + (added[k].startsWith("✓") ? " ok" : "")}>{added[k]}</span> : <button type="button" className="btn sm" onClick={() => void add(k, f)}>Add</button>}
          </div>)}
        </div>}
      <div className="as-b">
        {a.it ? <>
          <span className="as-q">This email:</span>
          <button type="button" className="btn sm ghost" onClick={onClose}>Keep in Inbox</button>
          <button type="button" className="btn sm primary" onClick={onArchive}>Archive</button>
        </> : <button type="button" className="btn sm ghost" onClick={onClose}>Done</button>}
      </div>
    </div>
  );
}

/**
 * Email settings (Oct 12, Nick: "an email settings tab… signature and all those things… I don't want my emails to say
 * 'Thanks, FBS Team' and then have my signature"): how replies end (your sign-off line, then your signature) and who
 * the AI writes as; your signature; your mailbox connection.
 */
const SIGN_OFFS = ["Thanks,", "Thank you,", "Thanks!", "Best,", "Talk soon,", "Appreciate it,"];
function EmailSettings({ st, onClose, onDone }: { st: Status; onClose: () => void; onDone: (msg: string) => void }) {
  const [tab, setTab] = useSticky<"replies" | "signature" | "mailbox">("mail.settingsTab", "replies");
  const [p, setP] = useState<{ signOff: string; writeAs: "me" | "shop"; name: string } | null>(null), [custom, setCustom] = useState(false), [saved, setSaved] = useState("");
  useEffect(() => { void getMailPrefs().then((r) => { if (r.ok) { setP(r); setCustom(!!r.signOff && !SIGN_OFFS.includes(r.signOff)); } }); }, []);
  const save = async (x: Partial<{ signOff: string; writeAs: "me" | "shop" }>) => { if (!p) return; setP({ ...p, ...x }); const r = await setMailPrefs(x); setSaved(r.ok ? "Saved." : r.error); setTimeout(() => setSaved(""), 2500); };
  const first = (p?.name || st.mine?.name || "").split(/\s+/)[0];
  return (
    <section className="panel es" aria-label="Email settings">
      <div className="es-h">
        <b>Email settings</b>
        <div className="ibx2-tabs es-tabs" role="tablist">
          {([["replies", "Replies"], ["signature", "Signature"], ["mailbox", "Mailbox"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {saved && <span className="faint es-saved">{saved}</span>}
        <button type="button" className="btn sm ghost" onClick={onClose}>Done</button>
      </div>
      {tab === "replies" && <div className="panel-b es-b">
        {!p ? <div className="faint">Loading…</div> : <>
          <div className="es-row">
            <div className="es-l"><b>End my replies with</b><span className="faint">Your signature goes right under it. The AI won&apos;t add its own sign-off, a name or &quot;FBS Team&quot;.</span></div>
            <div className="es-chips">
              {SIGN_OFFS.map((x) => <button key={x} type="button" className={"mf-chip" + (!custom && p.signOff === x ? " on" : "")} onClick={() => { setCustom(false); void save({ signOff: x }); }}>{x}</button>)}
              <button type="button" className={"mf-chip" + (!custom && !p.signOff ? " on" : "")} onClick={() => { setCustom(false); void save({ signOff: "" }); }}>Nothing (just my signature)</button>
              <button type="button" className={"mf-chip" + (custom ? " on" : "")} onClick={() => setCustom(true)}>My own…</button>
            </div>
            {custom && <input className="es-own" defaultValue={SIGN_OFFS.includes(p.signOff) ? "" : p.signOff} placeholder="e.g. Thanks so much," onBlur={(e) => void save({ signOff: e.target.value })} aria-label="Your own sign-off" />}
          </div>
          <div className="es-row">
            <div className="es-l"><b>The AI writes as</b><span className="faint">For replies it drafts for you (Write it, the Assistant, suggested answers).</span></div>
            <div className="es-chips">
              <button type="button" className={"mf-chip" + (p.writeAs === "me" ? " on" : "")} onClick={() => void save({ writeAs: "me" })}>Me{first ? ` (${first})` : ""}: &quot;I&quot;</button>
              <button type="button" className={"mf-chip" + (p.writeAs === "shop" ? " on" : "")} onClick={() => void save({ writeAs: "shop" })}>The shop: &quot;we&quot;</button>
            </div>
          </div>
          <div className="es-prev" aria-label="How a reply ends">
            <span className="faint">How a reply ends</span>
            <div>Hi Ryan,<br /><br />{p.writeAs === "shop" ? "Yes, we do both embroidery and printing. We'd love to set up a time to talk." : "Yes, we do both embroidery and printing. I'd love to set up a time to talk."}<br /><br />{p.signOff && <>{p.signOff}<br /></>}<i>— your signature —</i></div>
          </div>
        </>}
      </div>}
      {tab === "signature" && <Signature />}
      {tab === "mailbox" && <Connect st={st} onDone={(t) => { onDone(t); }} />}
    </section>
  );
}

function Signature() {
  const [sig, setSig] = useState<{ html: string; css: string; on: boolean; at: string | null } | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [h, setH] = useState(120);
  const ref = useRef<HTMLIFrameElement | null>(null);
  const load = useCallback(async () => { const r = await getSignature(); if (r.ok) setSig(r); }, []);
  useEffect(() => { load(); }, [load]);
  if (!sig) return null;
  const fit = () => { const d = ref.current?.contentDocument; if (d?.body) setH(Math.min(500, Math.max(60, d.documentElement.scrollHeight + 4))); };
  return (
    <div className="panel-b stack ibx-sig" style={{ gap: 8, borderTop: "1px solid var(--line)" }}>
      <div><b>Your signature</b><div className="faint" style={{ fontSize: 13 }}>Read from the emails you send in Outlook, and added under replies you send from here, logo and all, with their email quoted below the way Outlook does it.</div></div>
      {sig.html
        ? <iframe ref={ref} title="Your signature" sandbox="allow-same-origin" srcDoc={`<style>html,body{margin:0;padding:10px 12px;background:#fff}img{max-width:100%;height:auto}table img{max-width:none}${sig.css}</style><div class="WordSection1">${sig.html}</div>`} style={{ height: h, opacity: sig.on ? 1 : 0.45 }} onLoad={() => { fit(); setTimeout(fit, 400); }} />
        : <div className="faint">Not found yet. It&apos;s read from emails you&apos;ve sent to customers from Outlook; send one or two, then press the button below.</div>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn sm" disabled={busy} onClick={async () => { setBusy(true); setMsg(""); const r = await refreshSignature(); setBusy(false); setMsg(r.ok ? "Signature updated from your latest Outlook emails." : r.error); load(); }}>{busy ? "Reading your sent email…" : sig.html ? "Update from Outlook" : "Find my signature"}</button>
        {sig.html && <label className="row" style={{ gap: 6, alignItems: "center" }}><input type="checkbox" checked={sig.on} onChange={async (e) => { const on = e.target.checked; setSig({ ...sig, on }); await setSignatureOn(on); }} /> Add it to my replies</label>}
        {msg && <span className="faint" style={{ fontSize: 12.5 }}>{msg}</span>}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>Changed your signature in Outlook? Send an email from Outlook, wait a few minutes, then press Update from Outlook.</div>
    </div>
  );
}

/** Forward (Oct 14): to whoever you type, your note on top, the original and its attachments underneath */
function ForwardBox({ id, onDone }: { id: string; onDone: (msg: string) => void }) {
  const [to, setTo] = useState(""), [body, setBody] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const send = async () => {
    setBusy(true); setErr("");
    const r = await forwardEmail({ activityId: id, to, body }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone(`Forwarded to ${r.to.join(", ")}.`);
  };
  return (
    <div className="ibx2-fwd">
      <label className="ibx2-fwd-to">To<input type="text" inputMode="email" autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com (comma between)" aria-label="Forward to" /></label>
      <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note (optional). The email and its attachments go underneath." aria-label="Your note" />
      <div className="ibx2-fwd-a">
        <button type="button" className="btn primary sm" disabled={busy || !to.includes("@")} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => onDone("")}>Cancel</button>
        {err && <span className="pv-err" style={{ margin: 0 }}>{err}</span>}
      </div>
    </div>
  );
}
