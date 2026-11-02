"use client";
import { mockupHref, remakeMockup } from "@/lib/mockupFresh";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Group } from "@/lib/pricing";
import { guessHex, lineColor } from "@/lib/mockup";
import { fixDesignArt, type ArtAction } from "@/lib/artFix";
import { MicButton } from "@/components/SearchInput";
import { QuickLook, canQuickLook, type MailFile } from "@/components/MailFolders";
import { aiOrderFix, applyOrderFixChanges, loadOrderThread, markOrderChecked, noteArtChange, saveOrderLesson, saveOrderThread } from "@/app/shop/ai-actions";
import type { FixResult, OrderChange } from "@/lib/ai/orderFix";
import type { EOPart } from "@/lib/emailOrderShared";
import { doneOf, partialStep, type PartialCtx, type PartKind } from "@/components/tools/PartialOrder";
import { readDrop, type DropPic } from "@/lib/dropRead";
import AiReply from "@/components/AiReply";

/**
 * THE order check after it's made (Oct 23, Nick: "the right panel opens. That never closes until I say, yes, we've got
 * everything right… or no, we got to make these changes… my team should be able to just talk to you… you should learn
 * from it… I don't want my account manager to have to open up Illustrator"). One tool (lib/aiTools.ts "order-review"):
 * the end of Create order, and an order's page.
 *
 * A conversation that stays open (Oct 23, Nick: "keep the order panel open the entire time. It never closes until I say
 * order is right… you make the mock-up and you stay open. Then I should be able to click around the order, look at the
 * mock-up and say… you had smalls and extra smalls in the wrong category… you make the changes… does everything look
 * right now?… and then you close it"): OrderCheckDock keeps it on the right on every shop page until Yes (or Close for
 * now), and each round (what was said, what changed) is kept for this tab, so a page change or reload doesn't lose it.
 *   - what was made: each group's mockup, garments (sizes, extras stamped), prints (where, size, height, inks, art changes)
 *   - Check it for me: the AI compares it with what the customer sent and suggests changes
 *   - Say what to change (typed or spoken): order changes (sizes, colors, prints, extras, date) are made, art fixes drawn
 *     on the logo here; the order page showing it reloads by itself
 *   - a lesson for this customer, ticked to remember (their next Create order reads it first)
 *   - Yes, it's right: closes. Every correction is kept for the overnight review (lib/ai/orderFix.ts).
 */
type O = { id: string; number: number; nickname: string; customer_id: string | null; groups: Group[]; due_date: string | null; firm?: boolean; customers?: { name?: string; company?: string } | null };
type Art = OrderChange & { state: "doing" | "done" | "error"; err?: string };
type Round = { you: string; reply: string; applied: string[]; art: Art[]; suggest: OrderChange[]; rule?: string };
/** their PO first, then their mockup and art, then the last job's */
const RES_RANK = ["order_sheet", "customer_mockup", "print_art", "old_mockup", "barcodes"];
const RES_LABEL: Record<string, string> = { order_sheet: "Order sheet / PO", customer_mockup: "Their mockup", old_mockup: "Last job's mockup", print_art: "Their art", barcodes: "Barcodes" };
type Saved = { rounds: Round[]; lesson: { on: boolean; text: string }; did?: string[] };

const SIZE_ORDER = ["0-3M", "3-6M", "6-12M", "12M", "18M", "24M", "2T", "3T", "4T", "5T", "YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"];
const sizeRun = (sz: Record<string, unknown> | undefined) => Object.entries(sz || {}).filter(([, v]) => +(v || 0) > 0)
  .sort((a, b) => (SIZE_ORDER.indexOf(a[0]) + 1 || 99) - (SIZE_ORDER.indexOf(b[0]) + 1 || 99)).map(([k, v]) => `${k} ${v}`).join(", ");
const keyOf = (id: string) => `fbs:orderCheck:${id}`;
const readSaved = (id: string): Saved | null => { try { const x = sessionStorage.getItem(keyOf(id)); return x ? (JSON.parse(x) as Saved) : null; } catch { return null; } };

/** the order page showing this order saves what's typed there first, and reloads after a change */
async function pageSaves(orderId: string) {
  await new Promise<void>((res) => {
    const d = { orderId, handled: false, done: () => res() };
    window.dispatchEvent(new CustomEvent("fbs:order-save", { detail: d }));
    if (!d.handled) res(); else setTimeout(res, 4000);
  });
}
const pageReloads = (orderId: string) => window.dispatchEvent(new CustomEvent("fbs:order-changed", { detail: { orderId } }));

export default function OrderReview({ orderId, onClose, did, next, from, steps: steps0 }: { orderId: string; onClose: () => void; /** made a part at a time: the next step offered here (Oct 27) */ steps?: NextSteps; /** what Create order did, folded */ did?: string[]; /** Create order's own link to the Mockup Creator (keeps the email) */ next?: string; /** made from one of several orders in an email: the next one is offered when this one's right */ from?: { activity: string } }) {
  const sb = useRef(createClient()).current;
  const saved0 = useRef(typeof window !== "undefined" ? readSaved(orderId) : null).current;
  const [o, setO] = useState<O | null>(null);
  // the next step of an order made a part at a time (Oct 27, Nick: "bring in the sizes, put it in there, and then… stay
  // open, ask me what to do next"): what's still to bring in comes from the order itself; a step runs right here
  const [stepRun, setStepRun] = useState<{ log: string[]; err?: string } | null>(null);
  // opened on an order made from an email or ClickUp job that's still missing its garments or its prints (the AI order helper
  // from the order page, #40189): the same next steps, read from that job
  const [found, setFound] = useState<NextSteps | null>(null);
  const steps = steps0 || found;
  useEffect(() => {
    if (steps0 || !o) return;
    const have = doneOf(o.groups);
    if (have.length === 2) return;
    void sb.from("activities").select("id").eq("order_id", o.id).in("kind", ["email", "clickup"]).order("occurred_at", { ascending: true }).limit(1).then(({ data }) => {
      const a = (data || [])[0] as { id: string } | undefined;
      if (a) setFound({ ctx: { activity: a.id }, done: have });
    });
  }, [steps0, o?.id, sb]); // eslint-disable-line react-hooks/exhaustive-deps
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [rounds, setRounds] = useState<Round[]>(() => (saved0?.rounds || []).map((r) => ({ ...r, art: r.art.map((a) => (a.state === "doing" ? { ...a, state: "done" as const } : a)) })));
  /** the paperwork check held the Yes once (markOrderChecked): the next Yes keeps the order as it is */
  const [heldOnce, setHeldOnce] = useState<string[]>([]);
  const [pick, setPick] = useState<Record<number, boolean>>({});
  const [lesson, setLesson] = useState(saved0?.lesson || { on: true, text: "" });
  const [stale, setStale] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // dropped or pasted in (Nov 1, Nick: one AI tool for an order, the Quick ask's drops folded in): a PDF, a snip, a
  // picture or an email from Outlook. Dropped with nothing typed, it goes straight away and the AI says what it sees
  const [drop, setDrop] = useState<{ pics: DropPic[]; names: string[] }>({ pics: [], names: [] });
  const [over, setOver] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  /** what's dropped in is attached to the order too (Nov 1, Nick: "drag those attachments in and attach them to an
   *  order"): each file in Production files, labeled by its name; an Outlook email's attachments, not the email */
  async function keepOnOrder(fs: (File | Blob)[]) {
    const { guessProdKind } = await import("@/lib/productionFileKinds");
    const files: { name: string; blob: Blob }[] = [];
    for (const f of fs) {
      const nm = (f as File).name || "Snip.png";
      if (/\.msg$/i.test(nm) || /ms-outlook/i.test(f.type)) {
        try { const { readMsg } = await import("@/lib/outlookMsg"); for (const a of readMsg(await f.arrayBuffer()).attachments) if (!(a.data.length < 15_000 && /image0\d+|outlook|logo/i.test(a.name))) files.push({ name: a.name, blob: new Blob([a.data as BlobPart], { type: a.type }) }); } catch { /* read below */ }
      } else files.push({ name: nm, blob: f });
    }
    let n = 0;
    for (const f of files.slice(0, 12)) {
      const path = `art/${orderId}/${Date.now().toString(36)}${n}-${f.name.replace(/[^\w.\-]+/g, "_").slice(-100)}`;
      const up = await sb.storage.from("proofs").upload(path, f.blob, { contentType: f.blob.type || undefined, upsert: false });
      if (up.error) continue;
      await sb.from("art_files").insert({ order_id: orderId, name: f.name, file_path: path, file_type: f.blob.type || "", category: guessProdKind(f.name) || null, note: "Dropped in the AI order helper" });
      n++;
    }
    if (n) { pageReloads(orderId); setResN((x) => x + 1); }
    return n;
  }
  /** a file dragged from another site's page (ClickUp's attachments, Dropbox): it comes as its link; fetched here */
  async function dropLinks(dt: DataTransfer) {
    const html = dt.getData("text/html"), list = dt.getData("text/uri-list") || dt.getData("text/plain");
    const urls = [...new Set([...(list.match(/https:\/\/[^\s"'<>]+/g) || []), ...[...html.matchAll(/(?:href|src)=["'](https:\/\/[^"']+)["']/g)].map((m) => m[1].replace(/&amp;/g, "&"))])]
      .sort((a, b) => Number(/clickup-attachments/.test(b)) - Number(/clickup-attachments/.test(a))).slice(0, 3);
    if (!urls.length) return;
    setBusy("Getting the file…");
    const got: File[] = [];
    for (const u of urls) {
      const r = await fetch("/api/files/from-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u }) }).catch(() => null);
      if (!r || !r.ok) { if (!got.length && u === urls[urls.length - 1]) { const j = r ? await r.json().catch(() => ({})) as { error?: string } : {}; setErr(j.error || "Couldn't get that file. Download it and drop it in."); } continue; }
      const name = decodeURIComponent(r.headers.get("X-File-Name") || "file");
      got.push(new File([await r.blob()], name, { type: r.headers.get("Content-Type") || "" }));
      break;
    }
    setBusy("");
    if (got.length) void addDrop(got);
  }
  /** drops that go together (Nov 1, Nick: "I dragged in three separate attachments from three different emails… it should
   *  formulate them as one response"): files dropped one after another with nothing said in between are ONE ask. Each
   *  drop waits a moment for the next; a drop while the last ones are still being read, or right after their answer
   *  (nothing said since, nothing changed), asks again about all of them together, in place of that answer. */
  const batch = useRef<null | { pics: DropPic[]; names: string[]; texts: string[]; round: number | null }>(null);
  const batchT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const askRef = useRef<typeof ask | null>(null);
  async function addDrop(fs: (File | Blob)[]) {
    const live = !!batchT.current || !!inflight.current;
    if (!fs.length || (busy && !live)) return;
    setErr("");
    void keepOnOrder(fs);
    let d;
    try { d = await readDrop(fs); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read that."); return; }
    if (!d.text && !d.pics.length) { setErr("Drop a PDF, a picture, a snip or an email from Outlook."); return; }
    // something typed in the box: the files wait with it, and go when it's sent
    if (!d.text && (text.trim() || drop.pics.length)) { setDrop((x) => ({ pics: [...x.pics, ...d.pics].slice(0, 10), names: [...x.names, ...d.names] })); return; }
    const b = batch.current, lastR = rounds[rounds.length - 1];
    const joins = !!b && (live || (b.round === rounds.length - 1 && !!lastR && !lastR.applied.length && !lastR.art.length));
    const nb = joins && b ? b : { pics: [], names: [], texts: [], round: null };
    nb.pics = [...nb.pics, ...d.pics].slice(0, 10);
    nb.names = [...nb.names, ...(d.text ? [d.label || d.names[0] || "Email"] : d.names)];
    if (d.text) nb.texts = [...nb.texts, d.text];
    // its earlier answer goes: one answer for all of them
    if (joins && b && b.round != null && !live) { const at = b.round; setRounds((rs) => rs.slice(0, at)); }
    nb.round = null;
    batch.current = nb;
    inflight.current?.abort(); inflight.current = null;
    const n = nb.names.length;
    const label = n === 1 ? (nb.texts.length ? nb.names[0] : `Dropped: ${nb.names[0]}`) : `Dropped ${n} files:\n${nb.names.join("\n")}`;
    setPending(label); setBusy("Reading it…");
    if (batchT.current) clearTimeout(batchT.current);
    batchT.current = setTimeout(() => {
      batchT.current = null;
      const cur = batch.current; if (!cur) return;
      const many = cur.names.length > 1;
      const message = [many ? `Dropped ${cur.names.length} files together, one after another: ${cur.names.join("; ")}. Read them as ONE drop and give ONE answer for all of them (each picture is labeled with its file).` : cur.texts.length ? "" : `Dropped: ${cur.names[0]}`, ...cur.texts].filter(Boolean).join("\n\n");
      const ac = new AbortController(); inflight.current = ac;
      void askRef.current?.("change", { message, label, pics: cur.pics, signal: ac.signal, batch: true }).then((ri) => {
        if (inflight.current === ac) inflight.current = null;
        if (batch.current === cur && typeof ri === "number") cur.round = ri;
      });
    }, 1500);
  }
  // Order resources (Oct 23, Nick: "keep the production documents… at the bottom… pops up and pops down… looking back at
  // the original documents at the same time… call that order resources, like the purchase order, the work order"):
  // what the customer sent (their PO, mockup, art), then our work order, quote and proof, opened right here
  const [resOpen, setResOpen] = useState(false);
  const [res, setRes] = useState<MailFile[]>([]);
  const [resN, setResN] = useState(0);
  useEffect(() => {
    void sb.from("art_files").select("id, name, category, file_path").eq("order_id", orderId).order("created_at").then(({ data }) => {
      setRes((data || []).map((f) => ({ key: f.id as string, name: f.name as string, label: `${RES_LABEL[(f.category as string) || ""] || "File"}: ${f.name}`,
        href: `/api/files/open?${new URLSearchParams({ p: f.file_path as string, n: f.name as string })}`, rank: RES_RANK.indexOf((f.category as string) || "") + 1 || 9 }))
        .filter(canQuickLook).sort((a, b) => a.rank - b.rank).map(({ rank: _r, ...x }) => x)); // eslint-disable-line @typescript-eslint/no-unused-vars
    });
  }, [sb, orderId, resN]);
  const endRef = useRef<HTMLDivElement>(null);

  // one of several orders in the email (Oct 23, Nick: "when you're done, you'll say, do you want to go ahead and make the
  // second order? And then I'd say yes or no. And then I can come back to it later"): the next one not made yet
  const [nextUp, setNextUp] = useState<null | { label: string; at: number; of: number; part: EOPart }>(null);
  const [askNext, setAskNext] = useState(false);
  useEffect(() => {
    if (!from?.activity) return;
    let live = true;
    fetch(`/api/inbox/order/plan?activity=${encodeURIComponent(from.activity)}`).then((r) => r.json()).then((j: { parts?: EOPart[] }) => {
      const all = j.parts || [], nx = all.find((p) => !p.made);
      if (live && nx && all.length > 1) setNextUp({ label: nx.label, at: all.indexOf(nx) + 1, of: all.length, part: nx });
    }).catch(() => null);
    return () => { live = false; };
  }, [from?.activity]);
  const makeNext = () => {
    const a = nextUp, act = from?.activity; if (!a || !act) return;
    onClose();
    setTimeout(() => window.dispatchEvent(new CustomEvent("fbs:create-order", { detail: { activity: act, start: { parts: [a.part] } } })), 0);
  };

  // kept with the order (not just this tab): opened again later, everything said and done is still there
  const [didKept, setDidKept] = useState<string[] | undefined>(saved0?.did || did);
  const loaded = useRef(false);
  useEffect(() => {
    void loadOrderThread(orderId).then((r) => {
      const t = r.ok ? (r.thread as Saved | null) : null;
      if (t?.rounds?.length && t.rounds.length >= rounds.length) { setRounds(t.rounds.map((x) => ({ ...x, art: (x.art || []).map((a) => (a.state === "doing" ? { ...a, state: "done" as const } : a)) }))); if (t.lesson) setLesson(t.lesson); }
      if (!did?.length && t?.did?.length) setDidKept(t.did);
      loaded.current = true;
    });
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v: Saved = { rounds, lesson, did: didKept };
    try { sessionStorage.setItem(keyOf(orderId), JSON.stringify(v)); } catch { /* */ }
    if (!loaded.current) return;
    const t = setTimeout(() => { void saveOrderThread(orderId, v); }, 600);
    return () => clearTimeout(t);
  }, [rounds, lesson, didKept, orderId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [rounds.length, busy, askNext]);

  const load = useCallback(async () => {
    const { data } = await sb.from("orders").select("id, number, nickname, customer_id, groups, due_date, firm, customers(name, company)").eq("id", orderId).maybeSingle();
    if (data) setO(data as unknown as O);
  }, [sb, orderId]);
  // the mockup is made on another page or tab: its pictures show here when it's saved
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 6000); const f = () => void load(); window.addEventListener("focus", f); return () => { clearInterval(t); window.removeEventListener("focus", f); }; }, [load]);
  const thumbKey = (o?.groups || []).flatMap((g) => g.mockupThumbs || []).join("|");
  useEffect(() => {
    const ps = thumbKey ? thumbKey.split("|").filter((p) => p && !urls[p]) : [];
    if (!ps.length) return;
    void sb.storage.from("proofs").createSignedUrls(ps, 3600).then(({ data }) => { const m: Record<string, string> = {}; ps.forEach((p, i) => { if (data?.[i]?.signedUrl) m[p] = data[i].signedUrl; }); setUrls((u) => ({ ...u, ...m })); });
  }, [thumbKey, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = o?.customers?.company || o?.customers?.name || "this customer";
  const mockHref = (g: Group) => mockupHref(orderId, g, (g.mockupThumbs || []).length ? "" : "&auto=1");
  const onMockupPage = typeof window !== "undefined" && window.location.pathname.startsWith("/shop/artwork/mockup");
  const last = rounds[rounds.length - 1];
  const changed = rounds.some((r) => r.applied.length || r.art.length);
  /** what's been said and done so far, for the next ask */
  const earlier = rounds.map((r) => `- Staff: ${r.you} → ${[...r.applied, ...r.art.filter((a) => a.state !== "error").map((a) => a.say)].join("; ") || r.reply.slice(0, 300)}`).join("\n");

  /** the mockup pictures made again with the fixed art (Oct 23, Nick: "the little visual thumbnails that blow up didn't get
   *  updated in real time"): the Mockup Creator runs out of sight, saves, and says so; then the order shows the new ones */
  const [remaking, setRemaking] = useState(false);
  async function remakeMockups(groupIds: string[]) {
    if (!groupIds.length) return;
    setRemaking(true);
    for (const gid of groupIds) {
      // the one out-of-sight redraw (lib/mockupFresh.ts), in the builder it was made in
      await remakeMockup(orderId, o?.groups.find((x) => x.id === gid) || { id: gid });
    }
    setRemaking(false); setStale(false);
    void load(); pageReloads(orderId);
  }

  /** a change the mockup shows (a print's inks, size, spot; a garment's color): its mockup is made again too */
  async function remakeFor(cs: OrderChange[]) {
    if (!o) return;
    const ids = new Set<string>();
    for (const c of cs) {
      const g = c.what === "print" ? o.groups.find((x) => x.imprints.some((im) => im.id === c.id)) : c.what === "line" && c.field === "color" ? o.groups.find((x) => x.lines.some((l) => l.id === c.id)) : null;
      // only what the picture shows: the inks, size and spot of a print, a garment's color. "Production confirms on the run"
      // (confirm), underbase, colors don't change the mockup and never remake it (Oct 24, #40170: Nick's mockup was redone)
      const shows = c.what === "line" ? c.field === "color" : ["inks", "size", "location", "drop"].includes(c.field);
      if (g && shows && (g.mockupThumbs || []).length) ids.add(g.id);
    }
    await remakeMockups([...ids]);
  }

  /** the art fixes, drawn on each logo here, then said on its print */
  async function runArt(ri: number, art: OrderChange[]) {
    if (!o || !art.length) return;
    const byPrint = new Map<string, OrderChange[]>();
    for (const c of art) byPrint.set(c.id, [...(byPrint.get(c.id) || []), c]);
    const fixedGroups = new Set<string>();
    for (const [pid, cs] of byPrint) {
      const g = o.groups.find((x) => x.imprints.some((im) => im.id === pid)), im = g?.imprints.find((x) => x.id === pid);
      const mark = (state: "done" | "error", e?: string) => setRounds((rs) => rs.map((r, i) => (i !== ri ? r : { ...r, art: r.art.map((a) => (a.id === pid ? { ...a, state, err: e } : a)) })));
      if (!g || !im?.design_id) { mark("error", "That print has no logo"); continue; }
      const f = await fixDesignArt(sb, im.design_id, cs.map((c) => c.field as ArtAction), { shirt: guessHex(lineColor(g.lines[0])), widthIn: parseFloat(String(im.size || "")) || undefined, say: cs.map((c) => c.say) });
      if (!f.ok) { mark("error", f.error); continue; }
      for (const c of cs) await noteArtChange(orderId, pid, c.say).catch(() => null);
      mark("done"); setStale(true);
      if ((g.mockupThumbs || []).length) fixedGroups.add(g.id);
    }
    void load(); pageReloads(orderId);
    void remakeMockups([...fixedGroups]);
  }

  async function ask(m: "review" | "change", given?: { message: string; label?: string; pics?: DropPic[]; signal?: AbortSignal; batch?: boolean }): Promise<number | void> {
    if (!given?.batch) { batch.current = null; if (batchT.current) { clearTimeout(batchT.current); batchT.current = null; } }
    const pics = given?.pics ?? (m === "change" ? drop.pics : []);
    const said = given ? given.message : [text.trim(), !given && drop.pics.length ? `(Dropped: ${drop.names.join(", ")})` : ""].filter(Boolean).join(" ");
    const shown = given?.label || said;
    if (m === "change" && !said) { setErr("Say what to change first."); return; }
    setBusy(m === "review" ? "Comparing it with what the customer sent…" : pics.length ? "Reading it…" : "Making the changes…"); setErr("");
    setPending(m === "review" ? "Check it for me" : shown); if (m === "change" && !given) { setText(""); setDrop({ pics: [], names: [] }); }
    if (m === "change") await pageSaves(orderId);
    // with pictures: the chat's route (pictures run past a server action's 2 MB); else the action
    const r = m === "change" && (pics.length || given) ? await fetch(`/api/orders/${orderId}/chat`, { method: "POST", signal: given?.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: said, earlier, images: pics.map((p) => ({ media_type: p.media_type, data: p.data, label: p.name })) }) })
      .then(async (x) => { const j = await x.json().catch(() => ({})) as { ok?: boolean; r?: FixResult; error?: string }; return j.ok && j.r ? { ok: true as const, r: j.r } : { ok: false as const, error: j.error || "The AI didn't answer. Try again." }; })
      .catch(() => ({ ok: false as const, error: given?.signal?.aborted ? "" : "Couldn't reach the AI. Check the connection and try again." }))
      : await aiOrderFix(orderId, m === "change" ? said : "", m, earlier);
    // more was dropped while this was read: the new ask (about all of them) answers instead
    if (given?.signal?.aborted) return;
    setBusy(""); setPending(null);
    if (!r.ok) { setErr(r.error); if (m === "change" && !given) setText(text || said); return; }
    const x = r.r;
    const ri = rounds.length;
    if (m === "review") {
      setRounds((rs) => [...rs, { you: "Check it for me", reply: x.reply, applied: [], art: [], suggest: x.changes, rule: x.rule }]);
      setPick(Object.fromEntries(x.changes.map((_, i) => [i, true])));
    } else {
      setRounds((rs) => [...rs, { you: shown, reply: x.reply, applied: x.applied, art: x.art.map((a) => ({ ...a, state: "doing" as const })), suggest: [], rule: x.rule }]);
      setText("");
      if (x.applied.length) pageReloads(orderId);
      void runArt(ri, x.art);
      if (x.applied.length && !x.art.length) void remakeFor(x.changes);
      void load();
    }
    if (x.lesson) setLesson({ on: true, text: x.lesson });
    return ri;
  }
  askRef.current = ask;

  async function makeSuggested() {
    if (!last) return;
    const ri = rounds.length - 1;
    const ch = last.suggest.filter((_, i) => pick[i]);
    if (!ch.length) return;
    setBusy("Making the changes…"); setErr("");
    await pageSaves(orderId);
    const r = await applyOrderFixChanges(orderId, ch);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    const art = ch.filter((c) => c.what === "art");
    setRounds((rs) => rs.map((x, i) => (i !== ri ? x : { ...x, applied: r.applied, art: art.map((a) => ({ ...a, state: "doing" as const })), suggest: [] })));
    if (r.applied.length) pageReloads(orderId);
    void runArt(ri, art);
    if (r.applied.length && !art.length) void remakeFor(ch);
    void load();
  }

  /** Oct 23 (#40127, Nick: "it made the order, but didn't even make the mock-up"): a print with art and no mockup yet
   *  gets one. Create order goes to the Mockup Creator by itself; from anywhere else "Make the mockup" opens it in a new
   *  tab. */
  const needMock = o?.groups.find((g) => g.imprints.some((im) => im.design_id) && !(g.mockupThumbs || []).length) || null;
  const needMockN = o?.groups.filter((g) => g.imprints.some((im) => im.design_id) && !(g.mockupThumbs || []).length).length || 0;
  // a missing mockup is its own button (Oct 31, Nick: Yes "shouldn't be asking"): Yes always says the order is right
  const makeMock = () => { if (needMock) window.open(next && next.includes("/mockup?") ? next : mockHref(needMock), "_blank", "noopener"); };
  async function done() {
    setBusy("Checking it against the paperwork…");
    // checked against its paperwork before it's kept as an example: what differs is said, and Yes again keeps it as it is
    const mk = await markOrderChecked(orderId, heldOnce).catch(() => null);
    if (mk && mk.ok && mk.held.some((x) => !heldOnce.includes(x))) {
      setHeldOnce(mk.held);
      setRounds((rs) => [...rs, { you: "Yes, it\u2019s right", reply: `Before I keep it as an example for the next ones like it, the paperwork says otherwise in ${mk.held.length === 1 ? "one place" : `${mk.held.length} places`}: ${mk.held.join(" ")} Tell me what to change (or Check it for me), or press Yes again to keep it as it is.`, applied: [], art: [], suggest: [] }]);
      setBusy("");
      return;
    }
    setBusy("Saving…");
    const kept = lesson.on && lesson.text.trim() ? await saveOrderLesson(orderId, lesson.text).catch(() => null) : null;
    const tr = kept && kept.ok && "trainings" in kept ? kept : null;
    const inTr = tr?.trainings?.length ? ` · added to the ${tr.trainings.join(" and ")} training` : "";
    const tooFull = tr?.full?.length ? ` · the ${tr.full.join(" and ")} training is full, so it wasn't added there` : "";
    // the OK stays in the conversation, which is kept with the order
    const when = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const after: Round[] = [...rounds, { you: changed ? "Yes, it\u2019s right now" : "Yes, it\u2019s right", reply: `Marked right · ${when}${lesson.on && lesson.text.trim() ? ` · remembered for ${who}: ${kept && kept.ok ? kept.text : lesson.text.trim()}${inTr}${tooFull}` : ""}`, applied: [], art: [], suggest: [] }];
    await saveOrderThread(orderId, { rounds: after, lesson: { ...lesson, on: false }, did: didKept }).catch(() => null);
    try { sessionStorage.removeItem(keyOf(orderId)); } catch { /* */ }
    setBusy("");
    // the next order from the same email: asked here, in the thread
    if (nextUp) { setRounds(after); setAskNext(true); return; }
    onClose();
  }

  if (!o) return <div className="ap orv"><p className="faint">Opening the order…</p></div>;
  const working = rounds.some((r) => r.art.some((a) => a.state === "doing"));
  const lastRule = [...rounds].reverse().find((r) => r.rule)?.rule;
  const send = () => { if ((text.trim() || drop.pics.length) && !busy) void ask("change"); };
  const yesLabel = changed ? "Yes, it\u2019s right now" : "Yes, it\u2019s right";
  // like a text thread (Oct 23, Nick: "make it like an iPhone chat"): the order up top, the thread, and the box at the bottom
  return (
    <div className={"ap orv chat" + (over ? " orv-over" : "")} role="group" aria-label="AI order helper"
      onDragOver={(e) => { const t = e.dataTransfer.types; if (t.includes("Files") || t.includes("text/uri-list") || t.includes("text/html")) { e.preventDefault(); if (!over) setOver(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void addDrop([...e.dataTransfer.files]); else void dropLinks(e.dataTransfer); }}
      onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); void addDrop(fs); } }}>
      <div className="orv-top">
        <div className="orv-top-h"><b>#{o.number}</b><span className="faint">{o.nickname}</span><span className="orv-name">✦ AI order helper</span><button type="button" className="ap-link" onClick={onClose} title="Hide it; it comes back from ✦ AI on the order, with everything said">Close for now</button></div>
        {o.groups.map((g) => (
          <section key={g.id} className="orv-g">
            <div className="orv-pics">
              {(g.mockupThumbs || []).filter((p) => urls[p]).slice(0, 1).map((p) => <a key={p} href={mockHref(g)} target="_blank" rel="noreferrer" className="ap-pic"><img src={urls[p]} alt="The mockup" /></a>)}
              {!(g.mockupThumbs || []).length && (onMockupPage
                ? <span className="ap-pic orv-none"><span>Making the mockup…</span></span>
                : <a className="ap-pic orv-none" href={mockHref(g)} target="_blank" rel="noreferrer"><span>No mockup yet</span></a>)}
            </div>
            <div className="orv-d">
              {g.lines.map((l) => (
                <div key={l.id} className="orv-l" data-notranslate>
                  <b>{[l.brand, l.style].filter(Boolean).join(" ")}</b> · {l.color || "no color"} · {Object.values(l.sizes || {}).reduce<number>((a, v) => a + (+(v || 0)), 0)} pcs
                  {sizeRun(l.sizes as Record<string, unknown>) && <span className="faint"> ({sizeRun(l.sizes as Record<string, unknown>)})</span>}
                  {l.extras && <span className="gl-stamp orv-stamp"><span>{l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</span><span>· {l.extrasFree === false ? "charged" : "no charge"}</span></span>}
                </div>
              ))}
              {g.imprints.map((im) => (
                <div key={im.id} className="orv-p" data-notranslate>
                  <b>{im.location}</b> · {parseFloat(String(im.size || "")) > 0 ? `${parseFloat(String(im.size))}" wide` : "standard size"} · {im.drop ? `${im.drop}" below the collar` : "normal height"}{im.inks ? ` · ${im.inks}` : ""}{im.underbase ? " + white underbase" : ""}
                  {(im.artChanges || []).length > 0 && <ul className="orv-art">{im.artChanges!.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                </div>
              ))}
              {!onMockupPage && <a className="ap-link" href={mockHref(g)} target="_blank" rel="noreferrer">{(g.mockupThumbs || []).length ? "Open the mockup ›" : "Make the mockup ›"}</a>}
            </div>
          </section>
        ))}
      </div>

      <div className="orv-thread" aria-live="polite">
        <div className="bub them">
          {steps ? (() => {
            const have = doneOf(o.groups), left = (["sizes", "art"] as PartKind[]).filter((k) => !have.includes(k));
            const run = async (k: PartKind) => {
              setStepRun({ log: [] });
              try {
                await partialStep(steps.ctx, k, { id: o.id, number: o.number }, (x) => setStepRun((r) => ({ log: [...(r?.log || []), x] })));
                await load(); pageReloads(o.id);
                setDidKept((d) => [...(d || []), k === "art" ? "Brought in the prints and art" : "Brought in the garments and sizes"]);
                setStepRun(null);
              } catch (e) { setStepRun((r) => ({ log: r?.log || [], err: e instanceof Error ? e.message : "Something went wrong." })); }
            };
            return <>
              <p>#{o.number} has {have.length === 2 ? "its garments and its prints" : have.includes("sizes") ? "its garments" : have.includes("art") ? "its prints" : "the customer"}. What do you want to do next?</p>
              {stepRun ? <ul className="po-steps">{stepRun.log.map((x, i) => <li key={i} className={i === stepRun.log.length - 1 && !stepRun.err ? "on" : "done"}>{x}</li>)}{stepRun.err && <li className="err">{stepRun.err} <button type="button" className="ap-link" onClick={() => setStepRun(null)}>OK</button></li>}</ul>
                : <div className="po-next">
                  {left.map((k) => <button key={k} type="button" className="btn sm" onClick={() => void run(k)}>{k === "art" ? "Bring in the art" : "Bring in the sizes"}</button>)}
                  {have.length === 2 && o.groups.some((g) => !(g.mockupThumbs || []).length && g.imprints.some((im) => im.design_id)) && !onMockupPage && <a className="btn sm primary" href={mockHref(o.groups.find((g) => !(g.mockupThumbs || []).length && g.imprints.some((im) => im.design_id))!)}>Make the mockup</a>}
                </div>}
              <p className="bub-sub">Or tell me what to change, and I&apos;ll do it. Nothing goes to the customer.</p>
            </>;
          })() : did?.length ? <p>#{o.number} is made. Did I get everything right?</p> : <p>What can I help with on #{o.number}?</p>}
          {!steps && <p className="bub-sub">{did?.length ? "Click around the order and the mockup. Tell me anything that's off and I'll fix it." : "Drop in a PDF, a snip or an email from Outlook (their S&S or SanMar confirmation, a PO, a size sheet) and I'll say what I see and ask before adding anything. Or tell me what to change, or press Check it."} Nothing goes to the customer.</p>}
          {didKept && didKept.length > 0 && <details className="orv-did"><summary>What I did ({didKept.length})</summary><ul>{didKept.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
        </div>
        {rounds.map((r, ri) => {
          const isLast = ri === rounds.length - 1;
          const didSome = r.applied.length > 0 || r.art.length > 0;
          return (
            <div key={ri} className="bub-pair">
              <div className="bub me"><p>{r.you}</p></div>
              <div className="bub them">
                {r.reply && <AiReply text={r.reply} />}
                {r.applied.length > 0 && <ul className="orv-done">{r.applied.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                {r.art.length > 0 && <ul className="orv-done">{r.art.map((a, i) => <li key={i} className={a.state}>{a.say}{a.state === "doing" ? <span className="faint"> · changing the logo…</span> : a.state === "error" ? <span className="err-t"> · {a.err}</span> : <span className="orv-tag">On the proof</span>}</li>)}</ul>}
                {isLast && r.suggest.length > 0 && <>
                  <ul className="orv-sug">{r.suggest.map((c, i) => <li key={i}><label><input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick((p) => ({ ...p, [i]: e.target.checked }))} /> {c.say}{c.what === "art" && <span className="orv-tag">On the proof</span>}</label></li>)}</ul>
                  <button type="button" className="btn primary sm" onClick={() => void makeSuggested()} disabled={!!busy}>Make {Object.values(pick).filter(Boolean).length === 1 ? "this change" : "these changes"}</button>
                </>}
                {isLast && didSome && !working && <p className="bub-q">Does everything look right now?</p>}
                {/* a question: one tap to answer it (yes, or which group) */}
                {isLast && !busy && !didSome && !r.suggest.length && /\?/.test(r.reply || "") && (() => { const gs = o.groups.filter((g) => g.lines.length).map((g, k) => g.name || `Group ${k + 1}`); return (
                  <div className="orv-ans">{(/^Dropped \d+ files/.test(r.you) ? ["Yes, add them all", "All in one group", "A group for each", ...gs.map((g) => `Put them on ${g}`)]
                    : [/^Dropped/.test(r.you) ? "Yes, add them" : "Yes, do it", ...gs.map((g) => `Put them on ${g}`), gs.length ? "Make a new group" : "All in one new group"]).map((q) => <button key={q} type="button" className="chip" onClick={() => void ask("change", { message: q })}>{q}</button>)}</div>); })()}
              </div>
            </div>
          );
        })}
        {busy && <>{pending && <div className="bub me"><p>{pending}</p></div>}<div className="bub them typing" aria-label={busy}><i /><i /><i /></div></>}
        {remaking && <p className="bub-note">Making the mockup again with the new art…</p>}
        {stale && !working && !remaking && <p className="bub-note">{onMockupPage ? "The logo changed and the shirt on the left shows it now. Save the mockup to the order so its picture shows it too." : <>The logo changed: <a className="ap-link" href={mockHref(o.groups[0])} target="_blank" rel="noreferrer">open the mockup</a> and save it again so its picture shows it.</>}</p>}
        {lesson.text && <label className="orv-lesson"><input type="checkbox" checked={lesson.on} onChange={(e) => setLesson((l) => ({ ...l, on: e.target.checked }))} /> <span>Remember for {who}:</span><textarea rows={Math.min(5, Math.max(2, Math.ceil(lesson.text.length / 60)))} value={lesson.text} onChange={(e) => setLesson((l) => ({ ...l, text: e.target.value }))} aria-label="What to remember" /></label>}
        {lastRule && <p className="bub-note">For tonight&apos;s review: {lastRule}</p>}
        {err && <div className="err">{err}</div>}
        {askNext && nextUp && (
          <div className="bub them">
            <p>#{o.number} is done. Do you want to go ahead and make the next order from this email? <b>{nextUp.at} of {nextUp.of}: {nextUp.label}</b></p>
            <div className="orv-nextq">
              <button type="button" className="btn primary sm" onClick={makeNext}>Yes, make it</button>
              <button type="button" className="btn sm" onClick={onClose}>Not now</button>
            </div>
            <p className="bub-sub">Not now: it waits on the email. Create order there picks up with this one.</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {drop.pics.length > 0 && <div className="orv-pend">{drop.pics.map((p, k) => <img key={k} src={p.url} alt="To send" />)}<button type="button" className="ap-link" onClick={() => setDrop({ pics: [], names: [] })}>Remove</button></div>}
      <div className="orv-compose">
        {/* a group with no mockup yet: said above the box, not another button in the row (Oct 31, Nick) */}
        {needMock && !onMockupPage && <p className="orv-mknote">{needMockN > 1 ? `${needMockN} groups have no mockup.` : "One group has no mockup."} <button type="button" className="orv-mklink" onClick={makeMock} disabled={!!busy} title="Opens the Mockup Creator in a new tab">{needMockN > 1 ? "Make them" : "Make it"}</button></p>}
        <div className="orv-box">
          <textarea ref={box} rows={1} value={text} onChange={(e) => { setText(e.target.value); setErr(""); const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={rounds.length ? "Anything else?" : "Tell me what to change"} aria-label="What to change" />
          <input ref={fileIn} type="file" hidden multiple accept="image/*,application/pdf,.pdf,.msg" onChange={(e) => { void addDrop([...(e.target.files || [])]); e.target.value = ""; }} />
          <button type="button" onClick={() => fileIn.current?.click()} disabled={!!busy && !batchT.current && !inflight.current} aria-label="Add a PDF, a picture or an email" title="Add a PDF, a picture or an email from Outlook (or drop it anywhere on this panel, or paste a snip)" className="mic orv-att"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg></button>
          <MicButton target={() => box.current} append keepListening off={!!busy} label="Say what to change (click again when you're done)" />
          <button type="button" className="orv-send" onClick={send} disabled={!!busy || (!text.trim() && !drop.pics.length)} aria-label="Make the changes" title="Make the changes (Enter)">↑</button>
        </div>
        <div className="orv-quick">
          {res.length > 0 && <button type="button" className="chip orv-rsc-h" onClick={() => setResOpen(true)} title="What came in with the order (their PO, mockup, art), opened in the middle of the screen">Resources <span className="orv-rsc-n">{res.length}</span></button>}
          <span className="spacer" />
          <button type="button" className="chip" onClick={() => void ask("review")} disabled={!!busy} title="I look the order over against what came in">{rounds.length ? "Check again" : "Check it"}</button>
          <button type="button" className="chip ok" onClick={() => void done()} disabled={!!busy || working || askNext} title="Saves it and closes">{yesLabel}</button>
        </div>
      </div>
      {resOpen && res.length > 0 && typeof document !== "undefined" && createPortal(<QuickLook files={res} at={0} strip title="Order resources" onClose={() => setResOpen(false)} />, document.body)}
    </div>
  );
}

/** the AI order helper on the right, open on the pages of ITS order (Nov 1, Nick: "if you navigate away from an order,
 *  the AI order helper should close… don't lose your status. Next time you open that order back up, it should pop up
 *  where you were"): the order's page and anything opened for it (the Mockup Creator with ?order=, a page with ?chat=).
 *  Elsewhere it's put away, not closed: each order's open helper is kept for this tab (and its conversation with the
 *  order), so opening that order again brings it back as it was. Close for now / Yes, it's right put it away for good. */
const DOCK_KEY = "fbs:orderCheck";
/** the next steps of an order made a part at a time (Create order → Other options): how to read the job again, what's in */
export type NextSteps = { ctx: PartialCtx; done: PartKind[] };
type DockState = { orderId: string; did?: string[]; /** made from one of several orders in this email */ from?: { activity: string }; steps?: NextSteps };
const dockKey = (id: string) => `${DOCK_KEY}:${id}`;
const readDock = (id: string): DockState | null => { try { const x = sessionStorage.getItem(dockKey(id)); return x ? (JSON.parse(x) as DockState) : null; } catch { return null; } };
export function openOrderCheck(orderId: string, did?: string[], from?: { activity: string }, steps?: NextSteps) {
  const st: DockState = { orderId, did, ...(from ? { from } : {}), ...(steps ? { steps } : {}) };
  try { sessionStorage.setItem(dockKey(orderId), JSON.stringify(st)); } catch { /* */ }
  window.dispatchEvent(new CustomEvent("fbs:order-check", { detail: st }));
}
/** the order a page is about: /shop/orders/<id>…, or ?order= / ?chat= (the Mockup Creator, Create order's full form) */
function orderHere(path: string) {
  const m = /^\/shop\/orders\/([0-9a-f-]{36})/i.exec(path || "");
  if (m) return m[1];
  try { const q = new URLSearchParams(window.location.search), id = q.get("order") || q.get("chat") || ""; return /^[0-9a-f-]{36}$/i.test(id) ? id : null; } catch { return null; }
}

export function OrderCheckDock() {
  const path = usePathname();
  const [st, setSt] = useState<DockState | null>(null);
  // asked for just now (Create order, the AI menu): shown on the page it was asked on, even before that page is the order's
  const askedOn = useRef<string | null>(null);
  useEffect(() => {
    if (window.self !== window.top) return; // the Mockup Creator made out of sight (remakeMockups): no second check in it
    // opened in a new tab by Create order's full form (?chat=<order>): the AI order helper comes up there too (Oct 27, Nick:
    // "anytime we go through the create orders tool… I still want to leave that panel open so we can talk to it")
    try {
      const q = new URLSearchParams(window.location.search), id = q.get("chat") || "", em = q.get("email") || "";
      if (/^[0-9a-f-]{36}$/i.test(id) && !readDock(id)) sessionStorage.setItem(dockKey(id), JSON.stringify({ orderId: id, ...(/^[0-9a-f-]{36}$/i.test(em) ? { from: { activity: em } } : {}) }));
    } catch { /* */ }
    const on = (e: Event) => { const d = (e as CustomEvent<DockState | null>).detail; askedOn.current = d ? window.location.pathname : null; setSt(d); };
    window.addEventListener("fbs:order-check", on);
    return () => window.removeEventListener("fbs:order-check", on);
  }, []);
  // each page: the helper of the order it's about, if one was open for it; any other page puts it away (kept)
  useEffect(() => {
    if (window.self !== window.top) return;
    const id = orderHere(path || "");
    const d = id ? readDock(id) : null;
    if (d) { setSt(d); return; }
    if (askedOn.current && askedOn.current === path) return;
    askedOn.current = null;
    setSt(null);
  }, [path]);
  useEffect(() => {
    if (!st) return;
    window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: true } }));
    return () => { window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: false } })); };
  }, [st]);
  if (!st) return null;
  const close = () => { try { sessionStorage.removeItem(dockKey(st.orderId)); } catch { /* */ } askedOn.current = null; setSt(null); };
  return (
    <div className="dla-bg dock wide" role="dialog" aria-label="AI order helper">
      <div className="dla qo wide"><OrderReview key={st.orderId} orderId={st.orderId} did={st.did} from={st.from} steps={st.steps} onClose={close} /></div>
    </div>
  );
}
