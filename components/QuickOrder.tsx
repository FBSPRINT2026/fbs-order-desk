"use client";
import { sizeRank } from "@/lib/sizeOrder";
import { clearPageFile } from "@/lib/inkColors";
import { pdfText } from "@/lib/printavoArt";
import { useEffect, useRef, useState } from "react";
import type { Group } from "@/lib/pricing";
import type { EODraft, EOPart, PastJob } from "@/lib/emailOrderShared";
import { createClient } from "@/lib/supabase/client";
import { loadInkFormulas } from "@/lib/inkFormulas";
import { openOrderCheck } from "@/components/tools/OrderReview";
import { stampOrderMockups } from "@/lib/mockupStamp";
import { attachFilms, pullReorderArt } from "@/lib/reorderArt";
import ColorCheck, { applyColors, checkColors, type ColorRow } from "@/components/ColorCheck";
import SizeFitAsk, { applySizeFit, checkSizeFit, type FitRow } from "@/components/SizeFit";
import SizeRunsAsk, { garmentStep, type RunPick, type RunsAsk } from "@/components/SizeRunsAsk";
import GoodsBoughtAsk, { dayWord, type GoodsBought } from "@/components/GoodsBoughtAsk";
import { applyGoods } from "@/lib/goodsGarments";
import { goodsWaiting, linkGoods } from "@/app/shop/order-goods/actions";
import { rememberOrderNote } from "@/app/shop/ai-actions";
import { cleanPrintNotes, LOCATIONS, inkNames, locationsFor } from "@/lib/pricing";
import { uploadDesign } from "@/lib/designs";
import { newImprint, uid } from "@/lib/pricing";
import { makePreview } from "@/lib/artPrep";
import { cutProduct, looksLikeSheet, measureDrop, splitSheet, type Box } from "@/lib/setupSheet";
import { mockupNamed, pagePicture, pdfLike, pieceFor, pullOffMockup, type Pulled } from "@/lib/mockupPull";
import type { ArtPiece } from "@/lib/printavoArt";
import { handOffArt } from "@/app/shop/ai-actions";
import { discardDraftArt } from "@/app/shop/draft-art-actions";
import { PROD_KINDS, guessProdKind, prodKindLabel } from "@/lib/productionFileKinds";
import { pdfPicture, sizesOnSheet, type SheetSide } from "@/lib/printavoArt";
import { isPsd, psdPicture } from "@/lib/psdPic";
import { drawPic } from "@/lib/pdfPic";
import { knockOutBackground, measureFilm } from "@/lib/printavoArt";
import type { OrderStart } from "@/components/OrderStartPick";
import { guessHex, isHeather, lineColor, shirtBg, spotFor } from "@/lib/mockup";
import { knockOut } from "@/lib/artPrep";
import { inkName, planPrint, pxOfImage } from "@/lib/printPlan";
import { colorHex } from "@/lib/inkColors";

/**
 * Create order, start to finish, in one window (Oct 20, Nick: "once I click create order or create reorder… just
 * create a new pop-up and say reading email and creating order, and then a little secondary screen: okay, here's what
 * I did, view created order… we don't need to see the screen or think through it").
 *
 * For each order (one, or each design when the email holds several): the AI's reading (already made in the background,
 * or read now), then what staff would have clicked through, decided the usual way and listed on the result:
 *   - the shirt colors matched to the style's real colors (the closest when not exact);
 *   - a wholesale reorder at new screens gets the reprint screen fee;
 *   - an old Printavo job's art pulled from its files and film;
 *   - the order made as a quote, the customer's mockup stamped into Production files.
 * Then "View order" (our mockup is made first when the order needs one). Nothing is sent to the customer.
 */
type Loaded = { files?: { name: string; role?: string }[]; emails?: number; draft: EODraft | null; past: PastJob[]; created: string | null; customer: { id: string; price_type: string; company?: string | null; name?: string | null } | null; fees?: { screen: number | null; remake: number | null } };
type Made = { id: string; number: number; label: string; pcs: number; url: string; kind: "new" | "reorder"; did: string[]; ask: string[]; mockup: boolean };
type HelpPick = { kind: "keep" } | { kind: "file"; file: File; name: string; /** art the Helper pulled off a mockup: its size and drop */ pc?: ArtPiece; from?: string; how?: Pulled["kind"]; /** what our mockup sheet says about this print (size, inks) */ sheet?: SheetSpec } | { kind: "upload"; file: File } | { kind: "design"; id: string; name: string } | { kind: "production"; note: string } | { kind: "skip" };
type Help = { /** the spots these garments print on: a hat's own spots (Oct 26, Nick) */ spots?: string[]; job: string; customerId: string; /** the old Printavo job (archived id): all its files are listed */ archivedId: string; /** the old job in the new system, to look at */ jobUrl: string; /** every garment line, for "which items get this art" */ lines: { id: string; gi: number; label: string }[]; prints: { key: string; label: string; colors: number; location: string; method?: string; /** a dark garment in its group (an underbase is likely) */ dark?: boolean; /** printed width, inches ("" = standard) */ size: string; /** art already pulled for it */ design?: string }[]; /** what went wrong bringing it in */ why: string[]; /** prints already covered by the art they sent: only the old job's other files are asked about */ settled?: string[]; files: { path: string; name: string }[]; resolve: (a: HelpAns) => void };
/** each print's art, and the old job's files for the new order's Production files (null: leave them as they were) */
type HelpAns = { /** art for a spot the old job didn't print (Oct 24, Nick: "tell me what it is: full front, full back, left chest"): a new print on every group */ adds?: { location: string; pick: HelpPick }[]; picks: Record<string, HelpPick>; /** art for only some of a group's lines: those lines become a group of their own with this art */ splits?: { pk: string; lineIds: string[]; pick: HelpPick }[]; /** per location: the old job's screens included a white underbase ("ub") or not ("none") */ know?: Record<string, { colors: number; ub: boolean } | null>; /** visual: a mockup only, the details wait for production on the print run; details: the mockup with our details */ mode?: "visual" | "details"; place?: Record<string, { location: string; size: string }>; files: { path: string; name: string; role: "art" | "mockup" | "production"; /** its label in Production files */ kind: string; note?: string }[] | null; skipped?: number };
type ConfirmItem = { gi: number; ii: number; design: string; location: string; size: string; colors: number };
type ConfirmAns = { gi: number; ii: number; location: string; size: string }[];
type Confirm = { /** the spots these garments print on (hats: Full Front, sides, Back) */ spots?: string[]; job: string; items: ConfirmItem[]; resolve: (a: ConfirmAns) => void };
type Step = { label: string; state: "doing" | "done" | "error"; note?: string };
/** a reorder email that came with art: theirs, or the old job's (Oct 22, Nick: "he actually attached all the art. We
 *  could have just used it, but you ignored it because you treated it as a reorder") */
/** a customer's mockup sheet: what was read off it, to confirm (Oct 22, Nick: "you just ask me, what is this?… or you
 *  confirm it: hey, this is a customer mockup with sizing and information") */
/** what doesn't add up, asked before the order is made (Oct 22, Nick): each question with the AI's guess, your answer,
 *  and whether to remember it for this customer */
/** one print as our FBS mockup sheet writes it: "Front Imprint · SIZE: W 3" H 0.7" · COLORS 1. PMS 534C 2. PMS 2178C" */
type SheetSpec = SheetSide;
type ReviewAns = { answers: { q: string; answer: string; remember: boolean }[]; /** the logo per print: an art file path, or "design:<id>" */ art: Record<string, string>; /** each print's size and inks as the check left them */ specs?: Record<string, Spec> };
/** a print's size and inks at the check, and how they were arrived at */
type Spec = { size?: number; sizeWhy?: string; inks?: string; inksWhy?: string; /** a white underbase under the inks, and why */ ub?: boolean; ubWhy?: string; /** screens that aren't inks (halftones): counted with the inks */ extra?: number; last?: string; lastW?: number; lastH?: number; flag?: { text: string; size: number } };
type ReviewAsk = { d: EODraft; customer: string; again: boolean; resolve: (a: ReviewAns) => void };
type SheetAsk = { name: string; art: string; mockup: string; background: string | null; specs: string[]; resolve: (a: "sheet" | "art") => void;
  /** the art was on a shirt (a photo, a person, a mockup, drawn shirts) and the Helper pulled it off; more = the other prints pulled */ onShirt?: "photos" | "drawn"; more?: string[] };
type ArtAsk = { job: string; /** the old job's files */ old?: { name: string; url: string; type: string }[]; /** the email's files they sent */ from?: string[]; items: { key: string; label: string; file: { name: string; url: string; type: string; path?: string } }[]; resolve: (a: "theirs" | "old") => void };

/** Cancel clicked: stop where it is and take back what it made */
class Cancelled extends Error {}
/** garment colors that usually print without an underbase (a first guess for the question, never decided by it) */
const LIGHTISH = /white|natural|cream|ivory|ash\b|light|pink|mauve|stone|sand|silver|yellow|bone|oatmeal|heather gr[ae]y|athletic heather|sport gr[ae]y|columbia blue|baby|pastel|mint|lavender|peach/i;
const pcsOf = (gs: Group[]) => gs.reduce((n, g) => n + g.lines.reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, v) => a + (+v || 0), 0), 0), 0);

/** a supplier's order confirmation or invoice for blanks (S&S Activewear, SanMar, alphabroder), by its own words */
const supplierPaper = (t: string) => /order\s*confirmation|sales\s*order|invoice/i.test(t) && /s\s*&\s*s\s*activewear|ssactivewear|\bS&S\b|sanmar|alphabroder|\bwarehouse:/i.test(t);

export default function QuickOrder({ activityId, start, onClose, onCreated, onReview, dock }: { activityId: string; start: OrderStart; onClose: () => void;
  /** a panel on the right, the email and its attachments still there to look at (Oct 23, Nick) */ dock?: boolean;
  /** each order made (for the email's notes) */ onCreated: (id: string, number: number, label: string) => void;
  /** open the full form instead (check every detail before it's made) */ onReview: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [made, setMade] = useState<Made[]>([]);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [help, setHelp] = useState<Help | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [artAsk, setArtAsk] = useState<ArtAsk | null>(null);
  const [sheetAsk, setSheetAsk] = useState<SheetAsk | null>(null);
  const [review, setReview] = useState<ReviewAsk | null>(null);
  // answers already given on this order (a color, whose art, their sheet): not asked again when it's made again with
  // your answers at the check
  const memo = useRef(new Map<string, unknown>());
  async function askOnce<T>(key: string, open: (resolve: (v: T) => void) => void): Promise<T> {
    if (memo.current.has(key)) return memo.current.get(key) as T;
    const v = await waitFor<T>(open);
    memo.current.set(key, v);
    return v;
  }
  const [colorAsk, setColorAsk] = useState<{ rows: ColorRow[]; done: (r: ColorRow[] | null) => void } | null>(null);
  const [fitAsk, setFitAsk] = useState<{ rows: FitRow[]; done: (r: FitRow[] | null) => void } | null>(null);
  // goods already bought for this (Order goods from the email, no order yet): use them? and which order of this run took them
  const [goodsAsk, setGoodsAsk] = useState<{ list: GoodsBought[]; done: (id: string | null) => void } | null>(null);
  const goodsUsed = useRef(new Map<string, string>());
  const [runsAsk, setRunsAsk] = useState<(RunsAsk & { done: (a: { picks: Record<string, RunPick | null>; remember: boolean } | null) => void }) | null>(null);
  // several orders: which one is being made, and the stop after each one
  const [cur, setCur] = useState(0);
  const [pause, setPause] = useState<null | { made: Made | null; i: number; resolve: (v: void) => void }>(null);
  const ran = useRef(false);
  // Cancel (Oct 20, Nick: "if I get to art I can't resolve… X out and cancel… delete everything you did or tried to
  // start doing… nothing saved, nothing should go to the files"): stops at the next step, takes off the logos it made
  // (drafts, on no order) and closes. Not offered once the order is being saved.
  const stopped = useRef(false);
  const waiting = useRef<((e: Error) => void) | null>(null);
  const made0 = useRef<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const guard = () => { if (stopped.current) throw new Cancelled("Cancelled"); };
  function waitFor<T>(open: (resolve: (v: T) => void) => void) {
    return new Promise<T>((resolve, reject) => { waiting.current = reject; open((v) => { waiting.current = null; resolve(v); }); });
  }
  const cancel = () => {
    if (committing) return;
    stopped.current = true;
    waiting.current?.(new Cancelled("Cancelled")); waiting.current = null;
    onClose();
  };

  const step = (label: string) => setSteps((s) => [...s.map((x) => (x.state === "doing" ? { ...x, state: "done" as const } : x)), { label, state: "doing" }]);
  // what it's doing right now, under the step with the spinner (Oct 20, Nick: "give us updates along the way…
  // reading through old email, generating new size breakdown, getting order ready… I can see what you're thinking")
  const note = (n: string) => setSteps((s) => s.map((x) => (x.state === "doing" ? { ...x, note: n } : x)));
  const ticker = (lines: string[], ms = 3500) => { let i = 0; note(lines[0]); const t = setInterval(() => { i = Math.min(i + 1, lines.length - 1); note(lines[i]); }, ms); return () => clearInterval(t); };
  const finishSteps = (state: "done" | "error" = "done") => setSteps((s) => s.map((x) => (x.state === "doing" ? { ...x, state } : x)));

  async function one(part: EOPart | null, of: string, again: string[] = [], fix = ""): Promise<Made | null> {
    // every PMS in the Ink Room, for the inks read off the paperwork and our sheets (PMS 2178 C)
    void loadInkFormulas(createClient()).catch(() => 0);
    const qs = `activity=${encodeURIComponent(activityId)}${part ? `&part=${encodeURIComponent(part.key)}` : ""}`;
    step(`${of}Reading the email${part ? ` for ${part.label}` : ""}…`);
    const g = await fetch(`/api/inbox/order?${qs}`).then((r) => r.json()).catch(() => null) as Loaded & { error?: string } | null;
    guard();
    if (!g || g.error) throw new Error(g?.error || "Couldn't load the email.");
    // a choice made on the card (Create order, Oct 24): order type, past job, decoration: read fresh with it
    // the reading made in the background is used when the card's choice is the one it was read with (the same past job,
    // or a new order on both), with nothing else typed (Oct 26, Nick: "the create order tool is very slow"): only a
    // different choice reads the email again
    const rw = (g as { readWith?: { job?: string | null; jobs?: string[]; emails?: boolean } | null }).readWith;
    const sameChoice = !!rw && !rw.emails && (rw.job || "") === (part ? part.job || "" : start.job || "") && (part || (rw.jobs || []).join() === (start.jobs || []).join())
      && !(start.include?.length || start.exclude?.length) && (!start.orderType || (start.orderType === "new") === !rw.job);
    let d = !start.note && !again.length && !fix && ((!start.told && !start.job && !part?.told) || sameChoice) ? g.draft : null;
    if (d) note("Already read in the background: using that");
    if (!d) {
      const files = (g.files || []).filter((f) => f.role !== "signature");
      const sheets = files.filter((f) => /\.(pdf|xlsx?|csv|docx?)$/i.test(f.name)), pics = files.filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name));
      const stop = ticker([
        (g.emails || 1) > 1 ? `Reading all ${g.emails} emails in the conversation…` : "Reading the email…",
        ...(sheets.length ? [`Opening ${sheets.length === 1 ? sheets[0].name : `${sheets.length} size sheets`}…`] : []),
        ...(pics.length ? [`Looking at ${pics.length === 1 ? "the picture" : `${pics.length} pictures`} they sent…`] : []),
        ...((part?.job || start.job) ? [`Pulling up ${part?.jobLabel || "the past order"} to copy…`] : ["Checking their past orders for a match…"]),
        "Working out the garments and colors…",
        "Building the size breakdown…",
        ...(part?.pieces ? [`Adding up the sheets (they say ${part.pieces.toLocaleString("en-US")} pcs)…`] : []),
        "Checking the prints and inks…",
        "Writing down anything to ask the customer…",
        "Getting the order ready…",
      ]);
      const r = await fetch("/api/inbox/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, told: [part ? part.told || "" : start.told || "", start.note || "", ...again, fix].filter(Boolean).join("\n"), job: part ? (part.job ?? null) : start.job || null, jobs: part ? [] : start.jobs || [], reorderOk: !!(part ? part.job : start.job), ...(part ? { part: part.key } : {}), include: start.include || [], exclude: start.exclude || [] }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
      stop(); guard();
      if (!r?.ok || !j.draft) throw new Error(j.error || "The AI couldn't read this email.");
      d = j.draft as EODraft; g.past = j.past || g.past;
    }
    { const pcs = pcsOf(d.groups), lines = d.groups.reduce((n, x) => n + x.lines.length, 0); note(`Found ${lines} garment line${lines === 1 ? "" : "s"}, ${pcs.toLocaleString("en-US")} pcs${d.kind === "reorder" ? ", a reorder" : ""}`); }
    // the sheets' own total checked in code, not left to the AI (Oct 24, Nick: In Every Season is 550 + 400 = 950 pcs and
    // came in as 1,025 every time): off, it's read once more told exactly what's off; still off, it's said plainly
    const sheetsSay = part?.pieces || 0, got = pcsOf(d.groups);
    let countOff = "";
    if (sheetsSay && got !== sheetsSay) {
      if (!fix) {
        note(`The lines add to ${got.toLocaleString("en-US")} pcs but the sheets say ${sheetsSay.toLocaleString("en-US")}: reading the sheets again`);
        return one(part, of, again, `COUNT CHECK: ${d.countNote ? d.countNote + " " : ""}the size sheets for this order total ${sheetsSay} pieces (their file names: ${(part?.names || []).join(", ") || "see the files"}), but your garment lines added to ${got}. Read each size sheet again on its own, sheet by sheet, check each against its own total, then add them. Don't count any size twice.`);
      }
      countOff = `Check the quantities: the size sheets say ${sheetsSay.toLocaleString("en-US")} pcs, the order has ${got.toLocaleString("en-US")} (read twice)`;
    }
    const did: string[] = [];
    if (countOff) did.push(countOff);
    if (d.countNote) did.push(d.countNote);
    /** each print's color count before our sheet's inks replaced it (the old job's or the paperwork's: "3 colors") */
    const saidColors = new Map<string, number>();
    if (again.length) did.push(...again.map((x) => `You said: ${x}`));
    const job = d.reorderOf ? (g.past || []).find((p) => p.ref === d!.reorderOf) : null;
    // several past jobs in one order (Hutchins T10A + T11A): all of them
    const jobs = (d.reorderJobs || []).map((ref) => (g.past || []).find((p) => p.ref === ref)).filter(Boolean) as PastJob[];
    const jobLabel = (jobs.length > 1 ? jobs.map((j) => j.label.replace(/\s*\(Printavo\)$/, "").replace(/^(#\d+).*/, "$1")).join(" and ") : (job?.label || part?.jobLabel || "")).replace(/\s*\(Printavo\)$/, "");
    // goods were bought ahead for this (Oct 26, Nick: "hey I noticed we placed an order on Thursday for these goods. Are we
    // completing this order and adding in the art… pull in the sizes and what it is"): on yes the order's garments,
    // colors and sizes are what was bought, and nothing about the garment is asked again
    let goodsId = "";
    {
      const w = await goodsWaiting({ activityId, customerId: g.customer?.id || null }).catch(() => null);
      const list = ((w?.ok ? w.list : []) as GoodsBought[]).filter((b) => !goodsUsed.current.has(b.id) || goodsUsed.current.get(b.id) === of);
      guard();
      if (list.length) {
        note("Goods were already ordered for this: asking you");
        const pick = await askOnce<string | null>(`goods:${of}:${list.map((b) => b.id).join(",")}`, (resolve) => setGoodsAsk({ list, done: resolve }));
        setGoodsAsk(null);
        guard();
        const b = pick ? list.find((x) => x.id === pick) : null;
        if (b) {
          const ap = applyGoods(d.groups, b.garments);
          d = { ...d, groups: ap.groups };
          goodsId = b.id; goodsUsed.current.set(b.id, of);
          did.push(`Garments and sizes from the goods ordered ${dayWord(b.created_at)} (S&S #${b.supplier_order})`);
          if (ap.kept.length) did.push(`No goods were ordered for: ${ap.kept.join(", ")} (kept as read from the email)`);
        }
      }
    }
    // the email didn't name the garment (Oct 26, Nick: "this exact tool… should be one of the steps in the create order
    // tool… we go into this whole same talk"): the same step as Order goods (components/SizeRunsAsk.tsx): which garment
    // and color each size run is, their brand standards offered first; nothing filled in on its own
    if (d.groups.some((x) => x.lines.some((l) => !String(l.style || "").trim())) && g.customer?.id) step(`${of}Finding the garment…`);
    const gs = await garmentStep(d.groups, { customerId: g.customer?.id, activityId, ask: (a) => { note(a.prefs.length ? "The email doesn't say which garment: asking you, with their brand standards" : "The email doesn't say which garment: asking you"); return askOnce<{ picks: Record<string, RunPick | null>; remember: boolean } | null>(`runs:${a.runs.map((r) => r.id).join("|")}`, (resolve) => setRunsAsk({ ...a, done: resolve })).finally(() => setRunsAsk(null)); } });
    guard();
    d = { ...d, groups: gs.groups };
    const prefsColors = gs.usual;
    if (gs.asked) { did.push(...gs.did); if (gs.skipped.length) did.push(`Left without a garment: ${gs.skipped.join(", ")} (ask the customer)`); }
    // sizes the style doesn't come in (Oct 30, Nick: PC099Y written for the whole run, adult sizes included): they go on
    // its sister style (youth ↔ adult, toddler, infant), sure ones straight on, the rest asked (components/SizeFit.tsx)
    step(`${of}Checking the sizes each style comes in…`);
    const sf = await checkSizeFit(d.groups).catch(() => ({ rows: [] as FitRow[], ask: [] as FitRow[] }));
    guard();
    if (sf.ask.length) {
      note("A style doesn't come in some of its sizes: asking you");
      const picked = await askOnce<FitRow[] | null>(`fit:${sf.ask.map((x) => `${x.gi}:${x.li}:${x.style}`).join("|")}`, (resolve) => setFitAsk({ rows: sf.rows, done: resolve }));
      setFitAsk(null);
      if (picked) sf.rows = picked;
    }
    if (sf.rows.length) { const r = applySizeFit(d.groups, sf.rows); d = { ...d, groups: r.groups }; did.push(...r.did); }
    // the shirt colors: the style's real color names (the closest one when not an exact match)
    step(`${of}Checking the shirt colors…`);
    const cc = await checkColors(d.groups, prefsColors).catch(() => ({ rows: [] as ColorRow[], ask: [] as ColorRow[] }));
    guard();
    // a color that isn't one of the style's: asked, not guessed (Oct 22, Nick: "it says 64400 NeonBlue… did you mean Neon Blue?")
    if (cc.ask.length) {
      note("A shirt color isn't one of the style's colors: asking you");
      const picked = await askOnce<ColorRow[] | null>(`color:${cc.ask.map((x) => JSON.stringify(x)).join("|")}`, (resolve) => setColorAsk({ rows: cc.rows, done: resolve }));
      setColorAsk(null);
      if (picked) cc.rows = picked;
    }
    if (cc.rows.length) {
      const before = d.groups.flatMap((x) => x.lines.map((l) => l.color));
      d = { ...d, groups: applyColors(d.groups, cc.rows) };
      const after = d.groups.flatMap((x) => x.lines.map((l) => l.color));
      const changed = before.map((c, i) => (c && after[i] && c !== after[i] ? `${c} → ${after[i]}` : "")).filter(Boolean);
      if (changed.length) did.push(`Shirt colors matched to the style's colors: ${[...new Set(changed)].join(", ")}`);
    }
    // a wholesale reorder still at new screens: the reprint screen fee (kept on this design's reorders)
    if (d.kind === "reorder" && g.customer?.price_type === "wholesale" && g.fees?.remake != null && g.fees.screen != null && g.fees.remake < g.fees.screen) {
      const ims = d.groups.flatMap((x) => x.imprints.filter((im) => im.method === "screen" && !(im.remake ?? x.remake)));
      if (ims.length) {
        // the same print on several garment groups shares its screens (lib/pricing.ts screenKey)
        const n = [...new Map(ims.map((im) => [`${im.design_id || ""}|${im.location}|${im.colors}`, im])).values()].reduce((a, im) => a + Math.max(1, +im.colors || 1), 0);
        d = { ...d, groups: d.groups.map((x) => ({ ...x, imprints: x.imprints.map((im) => (im.method === "screen" ? { ...im, remake: true } : im)) })) };
        did.push(`Reprint screen fee: ${n} screen${n === 1 ? "" : "s"} at $${g.fees.remake} instead of $${g.fees.screen}`);
      }
    }
    // the customer sent art with a reorder: use theirs, or the old job's? (theirs is the default: it's newer)
    let theirs = new Set<string>();
    const sentArt = d.kind === "reorder" ? d.groups.flatMap((x) => x.imprints.map((im) => ({ x, im, path: d!.art?.[im.id] || "" }))).filter((z) => z.path) : [];
    if (sentArt.length) {
      note("They sent art with the email: asking you whose art to use");
      // the old job's files, to see side by side (Oct 22, Nick: "I don't know if you took it from the original Printavo
      // or from here. You got to ask me first what to do with all of the art")
      const oldFiles = [...new Map(d.groups.flatMap((x) => [...(x.pvArt || []), ...(x.pvRef || [])]).map((f) => [f.path, f])).values()].slice(0, 8);
      const { data: oldUrls } = oldFiles.length ? await createClient().storage.from("proofs").createSignedUrls(oldFiles.map((f) => f.path), 3600) : { data: [] };
      const ans = await askOnce<"theirs" | "old">(`art:${sentArt.map((z) => z.path).join("|")}`, (resolve) => setArtAsk({ job: jobLabel || "the old job", resolve, old: oldFiles.map((f, i) => ({ name: f.name, url: oldUrls?.[i]?.signedUrl || "", type: /\.pdf$/i.test(f.path) ? "application/pdf" : "image/png" })), from: d!.files.filter((f) => sentArt.some((z) => z.path === f.path)).map((f) => f.name), items: sentArt.map(({ x, im, path }) => {
        const f = d!.files.find((y) => y.path === path);
        return { key: im.id, label: `${x.name ? `${x.name} · ` : ""}${im.location}`, file: { name: f?.name || path.split("/").pop() || "art", url: f?.url || "", type: f?.type || "", path } };
      }) }));
      setArtAsk(null);
      if (ans === "old") { d = { ...d, art: {} }; did.push("You chose the old job's art over the files they sent"); }
      else { theirs = new Set(sentArt.map((z) => z.im.id)); did.push(`Using the art they sent (${[...new Set(sentArt.map((z) => d!.files.find((y) => y.path === z.path)?.name || "art"))].join(", ")})`); }
    }
    const hasArt = (im: { id: string; design_id?: string }) => !!im.design_id || theirs.has(im.id);
    // an old Printavo job: its art from the job's files and the film
    let films: { id: string; name: string }[] = [];
    const why: string[] = [];
    const handOff: { title: string; notes: string }[] = [];
    // a Printavo job with files: nothing is pulled or changed by itself. Its files are shown as they are in Printavo and
    // you say what each one is, background and all, on one screen (the Resolution Center below) (Oct 20, Nick: "you
    // removed the gray background… I should have to tell you that… pull up just the art the way it exactly appears in
    // Printavo and say, hey, what's this? Full front? …and it's on a background. Yep."). Without files: the art and
    // size from the film, as before.
    const pvAll = d.kind === "reorder" && !!d.reorderOf?.startsWith("a:") && d.groups.some((x) => (x.pvRef || []).length + (x.pvArt || []).length > 0);
    if (!pvAll && d.kind === "reorder" && d.reorderOf && g.customer?.id && d.groups.some((x) => x.imprints.some((im) => !hasArt(im)))) {
      step(`${of}Pulling the art from ${jobLabel || "the old job"}…`);
      try {
        const had = new Set(d.groups.flatMap((x) => x.imprints.map((im) => im.design_id || "")));
        const r = await pullReorderArt(d, { customerId: g.customer.id, jobLabel: job?.label, jobDate: job?.date, onStep: note });
        for (const id of r.draft.groups.flatMap((x) => x.imprints.map((im) => im.design_id || ""))) if (id && !had.has(id)) made0.current.add(id);
        guard();
        d = r.draft; films = r.films;
        const got = d.groups.flatMap((x) => x.imprints).filter((im) => im.design_id).length;
        did.push(got ? `Art pulled from ${jobLabel || "the old job"}${films.length ? `, size from the film ${films.map((f) => f.name).join(", ")}` : ""}` : "No art could be pulled from the old job: add it on the order");
        for (const n of r.notes) { did.push(n); why.push(n); }
      } catch (e) { if (e instanceof Cancelled) throw e; const m = `The art couldn't be pulled (${e instanceof Error ? e.message : String(e)})`; did.push(m); why.push(m); }
    }
    // art found, but not on a mockup (the original art file or the film): where it goes and how big isn't known, so
    // ask (Oct 20, Nick: "I'm finding art but it's not a mockup like I was expecting, what should I do with it? …that's
    // the art for the front, here's the art for the back")
    const unsure = d.groups.flatMap((x, gi) => x.imprints.map((im, ii) => ({ gi, ii, im }))).filter(({ im }) => im.design_id && /Art: the original from|Art and size from the film/.test(im.notes || ""));
    if (unsure.length && !pvAll) {
      note("Found the art, but not on a mockup: checking with you where it goes");
      const ans = await waitFor<ConfirmAns>((resolve) => setConfirm({ spots: locationsFor(d!.groups.flatMap((x) => x.lines)), job: jobLabel || "the old job", items: unsure.map(({ gi, ii, im }) => ({ gi, ii, design: im.design_id!, location: im.location, size: (im.size || "").replace(/"\s*wide/, ""), colors: im.colors || 1 })), resolve }));
      setConfirm(null);
      for (const a of ans) {
        d = { ...d, groups: d.groups.map((x, xi) => (xi !== a.gi ? x : { ...x, imprints: x.imprints.map((y, yi) => {
          if (yi !== a.ii) return y;
          if (a.location === "none") return { ...y, design_id: undefined as unknown as string };
          return { ...y, location: a.location, ...(a.size ? { size: `${a.size}" wide`, sizeFrom: "customer" as const } : {}) };
        }) })) };
        did.push(a.location === "none" ? "You said the art it found isn't this print's" : `You confirmed the art: ${a.location}${a.size ? `, ${a.size}" wide` : ""}`);
      }
    }
    // the Printavo Art Resolution Center. An old Printavo job: always, to say what each of its files is (Oct 20, Nick:
    // "once you're recreating a Printavo and you pull art, whether it's production files or whatever, you should ask
    // me what they are… one is barcodes… that should go in our production files… there's no rhyme and reason to how
    // it's done in Printavo"). Any reorder: when a print still has no art ("give us some sort of error… help me out").
    const isPv = d.kind === "reorder" && !!d.reorderOf?.startsWith("a:");
    const all = d.groups.flatMap((grp, gi) => grp.imprints.map((im, ii) => ({ gi, ii, im, grp })));
    const missing = d.kind === "reorder" && g.customer?.id ? all.filter(({ im }) => !hasArt(im)) : [];
    // their own art is settled: the Resolution Center asks only about the rest
    const targets = isPv && g.customer?.id ? all.filter(({ im }) => !theirs.has(im.id)) : missing;
    const replaced: string[] = [];
    const files = [...new Map(d.groups.flatMap((x) => [...(x.pvRef || []), ...(x.pvArt || [])]).map((f) => [f.path, f])).values()];
    // their art covers every print, but the old job had other files (barcodes, labels…): still ask what each one is
    // (Oct 22, Nick: "if you use the new customer's art, you should probably still ask me… what to do with the other
    // art… some of it we might need to keep")
    const othersOnly = !targets.length && isPv && files.length > 0 && theirs.size > 0;
    if ((targets.length && (missing.length || (isPv && files.length))) || othersOnly) {
      if (pvAll) step(`${of}Asking you about the files on ${jobLabel || "the old job"}…`);
      note(pvAll ? "Waiting for you: what each file is" : "Couldn't tell which file is the art: asking you");
      const prints = targets.map(({ gi, ii, im, grp }) => ({ key: `${gi}:${ii}`, label: `${im.location}${d!.groups.length > 1 ? ` (${grp.lines.map((l) => [l.style, l.color].filter(Boolean).join(" ")).slice(0, 2).join(", ")})` : ""}`, colors: im.colors || 1, location: im.location, size: String(im.size || "").replace(/"\s*wide/, "").trim(), method: im.method, dark: grp.lines.some((l) => l.color && !LIGHTISH.test(l.color)), ...(im.design_id ? { design: im.design_id } : {}) }));
      const ans = await waitFor<HelpAns>((resolve) => setHelp({ spots: locationsFor(d!.groups.flatMap((x) => x.lines)), customerId: g.customer!.id, job: jobLabel || "the old job", archivedId: isPv ? d!.reorderOf!.slice(2) : "", jobUrl: isPv ? `/shop/archive/${d!.reorderOf!.slice(2)}` : d!.reorderOf?.startsWith("o:") ? `/shop/orders/${d!.reorderOf.slice(2)}` : "", prints, files, why, ...(othersOnly ? { settled: sentArt.map((z) => `${z.x.name ? `${z.x.name} · ` : ""}${z.im.location}`) } : {}), lines: d!.groups.flatMap((x, gi) => x.lines.map((l) => ({ id: l.id, gi, label: [l.style, l.color].filter(Boolean).join(" ") || "Garment" }))), resolve }));
      setHelp(null);
      const made = new Map<File, string>();
      // a file that's a mockup (the art on a shirt, a person, our old mockup or theirs): the Helper pulls the art off it,
      // the art for that print's side becomes the logo, with the size and drop measured off the shirt (Oct 22, Nick: "if
      // you see it in Printavo, any way, shape, and form… you've got to go in and use the helper and pull it out")
      const pulledOf = new Map<File, Pulled | null>(), usedOf = new Map<File, Set<ArtPiece>>();
      const pulledFor = new Map<string, { pc: ArtPiece; from: string; kind: Pulled["kind"]; sheet?: SheetSpec }>();
      // a picked file or upload saved as their logo (once per file, or per print pulled off it)
      const designFor = async (picked: HelpPick, im: (typeof targets)[number]["im"]): Promise<string | null> => {
        if (picked.kind === "design") return picked.id;
        if (picked.kind !== "file" && picked.kind !== "upload") return null;
        const file = picked.file;
        if (pdfLike(file) && !pulledOf.has(file)) {
          note(`Is the art in ${file.name} on a shirt? Checking with the Helper…`);
          // shirts drawn flat are looked for in every PDF / Illustrator file, not only ones named "mockup" (Oct 28, Nick: McKenna's
          // LYL 102326.ai, a front and a back tee drawn side by side, became the logo with the shirts in it); a shape is only
          // a shirt when it has sleeves (lib/printavoArt.ts drawnPage), and staff confirm what was pulled
          pulledOf.set(file, await pullOffMockup(file, file.name, { drawn: true }).catch(() => null));
          guard();
        }
        const pl = pulledOf.get(file) || null;
        const used = usedOf.get(file) || new Set<ArtPiece>(); usedOf.set(file, used);
        const pc = pl ? pieceFor(pl, im.location, used) || pieceFor(pl, "front", used) || pieceFor(pl, "back", used) : undefined;
        if (pc) used.add(pc);
        const src0 = pc ? pc.file : file;
        let id = made.get(src0);
        // a film PNG or scan on a white page: kept as the art itself, page off and cropped (Oct 24, Nick on #40166)
        const src = id ? src0 : (await clearPageFile(src0)) || src0;
        if (!id) {
          // a print file (PDF, AI, EPS, SVG) keeps a picture of it, so the Mockup Creator can use it right away
          const vector = !pc && picked.kind === "upload" && !/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name);
          const preview = vector ? await makePreview(/\.ai$/i.test(file.name) ? new File([file], file.name, { type: "application/pdf" }) : file).catch(() => null) : null;
          const dsg = await uploadDesign(createClient(), { draft: true, file: src, ...(preview ? { preview } : {}), customer_id: g.customer!.id, name: d!.nickname || "Art", colors: im.colors || 1, inks: im.inks || "", notes: pc ? `Pulled off ${file.name} with the Helper, for the reorder of ${jobLabel}` : `For the reorder of ${jobLabel}`, method: im.method });
          id = dsg.id; made.set(src0, id); made0.current.add(id);
          guard();
        }
        if (pc && pl) pulledFor.set(id, { pc, from: file.name, kind: pl.kind });
        else if (picked.kind === "file" && picked.pc) pulledFor.set(id, { pc: picked.pc, from: picked.from || file.name, kind: picked.how || "photos", ...(picked.sheet ? { sheet: picked.sheet } : {}) });
        return id;
      };
      for (const { gi, ii, im } of targets) {
        const picked = ans.picks[`${gi}:${ii}`] || (im.design_id ? { kind: "keep" as const } : { kind: "skip" as const });
        const setIm = (patch: Partial<typeof im>, note2: string) => { d = { ...d!, groups: d!.groups.map((x, xi) => (xi !== gi ? x : { ...x, imprints: x.imprints.map((y, yi) => (yi === ii ? { ...y, ...patch, notes: [y.notes, note2].filter(Boolean).join(". ").slice(0, 300) } : y)) })) }; };
        if (picked.kind === "keep") continue;
        if (im.design_id) replaced.push(im.design_id);
        if (picked.kind === "skip") { if (im.design_id) setIm({ design_id: undefined as unknown as string }, ""); did.push(`${im.location}: made without art for now (add it on the order: Upload logo)`); continue; }
        if (picked.kind === "design") { setIm({ design_id: picked.id }, `Art: their logo ${picked.name}`); did.push(`${im.location}: their logo ${picked.name} (already on file, nothing new made)`); continue; }
        if (picked.kind === "production") {
          handOff.push({ title: `Find the art: ${jobLabel || "reorder"} · ${im.location}`, notes: [`Reorder of ${jobLabel}. The art couldn't be brought in from Printavo.`, ...why, picked.note ? `Note: ${picked.note}` : ""].filter(Boolean).join("\n") });
          setIm({ design_id: undefined as unknown as string }, "ART NEEDED: handed to production to find the file");
          did.push(`${im.location}: handed to production to find the art (a to-do on their My Day)`);
          continue;
        }
        note("Saving the art as their logo…");
        try {
          const id = await designFor(picked, im);
          if (!id) continue;
          const pu = pulledFor.get(id);
          if (pu?.sheet) {
            // our own mockup sheet: the size and inks as written on it, the art pulled off it (Oct 23, Nick on HALFF #32997:
            // "this is going to be our most common mockup… this actually has everything you need")
            const inks = [...new Set((pu.sheet.inks || []).map(stockName))];
            if (+im.colors > 0) saidColors.set(im.id, +im.colors);
            // no size written on the sheet: the art pulled off our sized proof is at its real size
            if (!pu.sheet.w) pu.sheet = { ...pu.sheet, w: pu.pc.widthIn, h: pu.pc.heightIn };
            // the sheet has the size and inks: nothing for production to confirm ("Reorder details needed" was on #40119)
            // its halftones are a screen of their own (counted as a color), its underbase is the white underbase (Oct 23,
            // All Star #34528: "1. NAVY (MATCH TRIM) 2. GOLD 3. HALFTONES 4. UNDERBASE")
            const extra = pu.sheet.halftones ? 1 : 0, more = [pu.sheet.halftones ? "halftones" : "", pu.sheet.ub ? "white underbase" : ""].filter(Boolean);
            setIm({ design_id: id, size: `${pu.sheet.w}" wide`, ...(inks.length ? { inks: inks.join(", "), colors: inks.length + extra, confirm: undefined } : {}), ...(pu.sheet.ub ? { underbase: true } : {}) }, `From our mockup sheet ${pu.from}: ${pu.sheet.w}" wide${pu.sheet.h ? ` × ${pu.sheet.h}"` : ""}${inks.length ? `, ${inks.join(", ")}` : ""}${more.length ? ` + ${more.join(" + ")}` : ""}${pu.sheet.notes?.length ? ` (${pu.sheet.notes.join("; ")})` : ""}`);
            did.push(`${im.location}: from our mockup sheet ${pu.from}: ${pu.sheet.w}" wide${inks.length ? `, ${inks.join(", ")}` : ""}`);
            continue;
          }
          if (pu) {
            const trust = !pu.pc.approx && !(pu.pc.dropIn > 5 && /front|chest/i.test(im.location));
            setIm({ design_id: id, ...(parseFloat(String(im.size || "")) > 0 || !trust ? {} : { size: `${pu.pc.widthIn}" wide` }), ...(im.drop || !trust ? {} : { drop: String(pu.pc.dropIn) }) }, `Art pulled off ${pu.from} with the Helper: ${pu.pc.widthIn}" × ${pu.pc.heightIn}", ${pu.pc.dropIn}" below the collar${pu.kind === "drawn" ? " (read off a drawn shirt: close, not exact)" : ""}`);
            did.push(`${im.location}: the art in ${pu.from} was on a shirt, so the Helper pulled it off (${pu.pc.widthIn}" wide, ${pu.pc.dropIn}" down)`);
            continue;
          }
          setIm({ design_id: id }, picked.kind === "upload" ? "Art uploaded when the reorder was made" : `Art from ${picked.name}`);
          did.push(`${im.location}: art ${picked.kind === "upload" ? "uploaded by you" : `from ${picked.name}`}`);
        } catch (e) { if (e instanceof Cancelled) throw e; did.push(`${im.location}: the art couldn't be saved (${e instanceof Error ? e.message : String(e)}): add it on the order`); }
      }
      // art for a spot the old job didn't print: a new print on each group, with that art (Oct 24, Nick)
      for (const ad of ans.adds || []) {
        const nim = { ...newImprint(ad.location), colors: 1 };
        let id: string | null = null;
        try { id = await designFor(ad.pick, nim as never); } catch (e) { if (e instanceof Cancelled) throw e; }
        d = { ...d!, groups: d!.groups.map((x) => (x.imprints.some((y) => y.location === ad.location) ? x : { ...x, imprints: [...x.imprints, { ...nim, id: uid(), ...(id ? { design_id: id } : {}) }] })) };
        did.push(`${ad.location}: a new print${id ? " with the art you picked" : " (the art couldn't be saved: add it on the order)"}`);
      }
      // art for only some of a group's items (Oct 20, Nick: "ask me if this is the front on all items or a specific
      // item"): those lines become their own group with that art (the new groups go at the end, so the numbers above hold)
      for (const sp of ans.splits || []) {
        const [gi, ii] = sp.pk.split(":").map(Number);
        const src = d.groups[gi], im = src?.imprints[ii];
        if (!src || !im) continue;
        const moving = src.lines.filter((l) => sp.lineIds.includes(l.id));
        if (!moving.length || moving.length >= src.lines.length) continue;
        let id: string | null = null;
        try { id = await designFor(sp.pick, im); } catch (e) { if (e instanceof Cancelled) throw e; }
        const ng: Group = { ...(JSON.parse(JSON.stringify(src)) as Group), id: uid(), lines: moving, pvRef: [], pvArt: [] };
        ng.imprints = ng.imprints.map((x, k) => ({ ...x, id: uid(), ...(k === ii ? { design_id: id || (undefined as unknown as string) } : {}) }));
        delete (ng as { mockupThumbs?: unknown }).mockupThumbs;
        const rest = src.lines.filter((l) => !sp.lineIds.includes(l.id));
        d = { ...d, groups: [...d.groups.map((x, xi) => (xi === gi ? { ...x, lines: rest, ...(x.mockupThumbs ? { mockupThumbs: undefined } : {}) } : x)), ng] };
        did.push(`${im.location} on ${moving.map((l) => [l.style, l.color].filter(Boolean).join(" ")).join(", ")}: ${id ? "its own art" : "no art yet"} (a group of its own)`);
      }
      // the old job's files go in the new order's Production files only as you said (art, mockup, production file);
      // "Not needed" ones stay out
      // what you know about each print (Oct 20, Nick: "ask me what I know… do you know how many colors this printed as or
      // how wide it was? …I know it printed as 6 colors plus underbase"), and the mockup: visual only (the details wait
      // for production on the print run; nothing guessed goes to the customer) or with the details
      for (const { gi, ii, im } of targets) {
        const k = ans.know?.[im.location];
        const vis = ans.mode === "visual";
        const patch: Partial<typeof im> = {};
        if (k && im.method === "screen") Object.assign(patch, { colors: Math.max(1, k.colors), underbase: im.puff ? undefined : k.ub }); // puff: no underbase unless set by hand
        if (vis) patch.visualOnly = true;
        if (!Object.keys(patch).length) continue;
        const note2 = k ? `You said: printed ${k.colors} color${k.colors === 1 ? "" : "s"}${k.ub ? " + underbase" : ", no underbase"}` : "";
        d = { ...d, groups: d.groups.map((x, xi) => (xi !== gi ? x : { ...x, imprints: x.imprints.map((y, yi) => (yi !== ii ? y : { ...y, ...patch, notes: [y.notes, note2].filter(Boolean).join(". ").slice(0, 300) })) })) };
      }
      for (const [loc, k] of Object.entries(ans.know || {})) if (k) did.push(`${loc}: ${k.colors} color${k.colors === 1 ? "" : "s"}${k.ub ? " + underbase" : ", no underbase"} (you said)`);
      if (ans.mode === "visual") did.push("Visual mockup only: the print details wait for production to confirm on the print run (the customer sees just the mockup)");
      // where each print goes and how wide, as you said
      for (const { gi, ii, im } of targets) {
        const pl = ans.place?.[`${gi}:${ii}`];
        if (!pl) continue;
        const loc = pl.location && pl.location !== im.location ? pl.location : "";
        const size = pl.size && pl.size !== String(im.size || "").replace(/"\s*wide/, "").trim() ? pl.size : "";
        if (!loc && !size) continue;
        d = { ...d, groups: d.groups.map((x, xi) => (xi !== gi ? x : { ...x, imprints: x.imprints.map((y, yi) => (yi !== ii ? y : { ...y, ...(loc ? { location: loc } : {}), ...(size ? { size: `${size}" wide`, sizeFrom: "customer" as const } : {}) })) })) };
        did.push(`You set the ${loc || im.location}${size ? `: ${size}" wide` : ""}`);
      }
      if (ans.files) {
        d = { ...d, groups: d.groups.map((x, xi) => ({ ...x, pvRef: [], pvArt: xi === 0 ? ans.files!.map((f) => ({ path: f.path, name: f.name, ...(f.kind ? { kind: f.kind } : {}), ...(f.note ? { note: f.note } : {}) })) : [] })) };
        const kinds = { art: "art", mockup: "mockup", production: "production file" } as const;
        if (ans.files.length) did.push(`In Production files: ${ans.files.map((f) => `${f.name} (${prodKindLabel(f.kind) || kinds[f.role]})`).join(", ")}`);
        if (ans.skipped) did.push(`Left out (not needed): ${ans.skipped} file${ans.skipped === 1 ? "" : "s"}`);
      }
    }
    // THE ORDER OF THINGS on a reorder (Oct 22, Nick): the old job's art or the email's; the old job's files, which to
    // keep (the barcodes) and which to drop (the old mockup); then "here's the art in the email, this is what I got".
    // A customer's mockup sheet (the art big with a spec box, then the shirt): confirm, then the art is cut off its art
    // page with the background panel taken out, the shirt page is their mockup (stamped, in Production files like any
    // customer mockup) and the PDF itself goes in Production files as the customer mockup
    // A distributor's product sheet (Cedar Promo's Embark sheets, rule 4d; Oct 26, Nick: "he is expecting us to pull
    // sizing, make a mock-up, and then use that to create the art also… that is your production file"): each product's
    // logo cut off the page as its print's art, its photo as the group's mockup, each confirmed like a mockup sheet
    if ((d.cuts || []).length) {
      const sbc = createClient(), bufs = new Map<string, ArrayBuffer>(), cutFiles = new Set<string>();
      for (const c of d.cuts!) {
        guard();
        const gi = c.gi != null && d.groups[c.gi] ? c.gi : d.groups.findIndex((x) => x.name === c.about);
        const grp = d.groups[gi]; if (!grp) continue;
        if (!bufs.has(c.path)) { const { data: blob } = await sbc.storage.from("proofs").download(c.path); if (blob) bufs.set(c.path, await blob.arrayBuffer()); }
        const buf = bufs.get(c.path); if (!buf) continue;
        step(`${of}Cutting ${grp.name || "the product"} off ${c.name}…`);
        const ims = grp.imprints.filter((im) => !d!.art?.[im.id] || d!.art[im.id] === c.path);
        const widthIn = ims.map((im) => parseFloat(String(im.size || ""))).find((n) => n > 0);
        const parts = await cutProduct(buf, { page: c.page, logo: (c.logo as Box) || null, photo: (c.photo as Box) || null, widthIn, name: `${c.name.replace(/\.[^.]+$/, "")} ${grp.name || ""}`.trim() });
        guard();
        if (!parts.art && !parts.mockup) { did.push(`${grp.name || "A product"}: couldn't cut its logo or photo off ${c.name}; the PDF is used as sent`); continue; }
        const specs = [
          ...ims.map((im) => [im.location, im.size, im.colors && im.method === "screen" ? `${im.colors} color${+im.colors === 1 ? "" : "s"}${im.inks ? `: ${im.inks}` : ""}` : im.inks].filter(Boolean).join(" · ")),
          ...[...new Set(grp.lines.map((l) => [l.brand, l.style, l.color].filter(Boolean).join(" ")))].filter(Boolean),
        ];
        const artUrl = parts.art ? URL.createObjectURL(parts.art) : "", mockUrl = parts.mockup ? URL.createObjectURL(parts.mockup) : "";
        note(`Cut ${grp.name || "a product"} off their product sheet: checking with you`);
        const ans = await askOnce<"sheet" | "art">(`cut:${c.path}:${gi}`, (resolve) => setSheetAsk({ name: `${grp.name || "Product"} · ${c.name}`, art: artUrl, mockup: mockUrl, background: null, specs, resolve }));
        setSheetAsk(null);
        if (ans === "art") { did.push(`${grp.name || "A product"}: ${c.name} used as sent (you said not to cut it)`); continue; }
        const key = `designs/sheet-${crypto.randomUUID().slice(0, 8)}`, base = `${c.name.replace(/\.[^.]+$/, "")}-${grp.name || gi + 1}`.replace(/[^\w.-]+/g, "-").slice(0, 60);
        const artPath = `${key}/${base}-art.png`, mockPath = `${key}/${base}-mockup.png`;
        const upA = parts.art ? await sbc.storage.from("proofs").upload(artPath, parts.art, { contentType: "image/png" }) : { error: { message: "no logo" } };
        const upM = parts.mockup ? await sbc.storage.from("proofs").upload(mockPath, parts.mockup, { contentType: "image/png" }) : { error: { message: "no photo" } };
        const art2 = { ...(d.art || {}) };
        if (!upA.error) for (const im of ims) art2[im.id] = artPath;
        const mock2 = { ...(d.mockups || {}) };
        if (!upM.error) mock2[grp.id] = [mockPath, ...(mock2[grp.id] || []).filter((p0) => p0 !== c.path)];
        cutFiles.add(c.path);
        d = { ...d, art: art2, mockups: mock2, files: [
          ...d.files,
          ...(upA.error ? [] : [{ path: artPath, name: `${base} logo.png`, type: "image/png", size: parts.art!.size, role: "art" as const, what: `logo cut off ${c.name}` }]),
          ...(upM.error ? [] : [{ path: mockPath, name: `${base} mockup.png`, type: "image/png", size: parts.mockup!.size, role: "mockup" as const, what: `their product photo from ${c.name}` }]),
        ] };
        did.push(`${grp.name || "A product"}: logo${upA.error ? " (couldn't save)" : ""} and their photo${upM.error ? " (couldn't save)" : ""} cut off ${c.name}`);
      }
      // the sheet itself goes in Production files as their mockup
      if (cutFiles.size) d = { ...d, files: d.files.map((x) => (cutFiles.has(x.path) ? { ...x, role: "other" as const, kind: "customer_mockup" } : x)) };
    }
    if (d.kind !== "reorder" || theirs.size || !sentArt.length) {
      const used = new Set([...Object.values(d.art || {}), ...Object.values(d.mockups || {}).flat()]);
      const sb0 = createClient();
      const helperGot = new Map<string, Pulled | null>();
      for (const f of d.files.filter((x) => used.has(x.path) && (/pdf/i.test(x.type) || /\.pdf$/i.test(x.name)))) {
        guard();
        const { data: blob } = await sb0.storage.from("proofs").download(f.path);
        if (!blob) continue;
        const buf = await blob.arrayBuffer();
        // the Helper first (Oct 30, Nick: our own FBS proof, VBALL GLAC, was cut up as a mockup sheet and the proof's
        // shirt came along as art): a file with the art on a garment (our sized proof, their mockup, a drawn shirt) is the
        // Helper's to pull apart below, never the sheet cutter's
        if (!helperGot.has(f.path)) helperGot.set(f.path, await pullOffMockup(new File([buf.slice(0)], f.name, { type: blob.type || "application/pdf" }), f.name, { drawn: true }).catch(() => null));
        if (helperGot.get(f.path)?.pieces.length) continue;
        const pages = f.sheet || (await looksLikeSheet(buf));
        if (!pages) continue;
        step(`${of}Reading their mockup sheet ${f.name}…`);
        const ims: { x: Group; im: Group["imprints"][number] }[] = d.groups.flatMap((x) => x.imprints.filter((im) => d!.art?.[im.id] === f.path).map((im) => ({ x, im })));
        const widthIn = ims.map(({ im }) => parseFloat(String(im.size || ""))).find((n) => n > 0);
        const parts = await splitSheet(buf, { ...pages, widthIn, name: f.name });
        guard();
        if (!parts) continue;
        const gs: Group[] = [...new Set(ims.map(({ x }) => x))];
        // where their mockup puts it: the drop below the neckline, measured with the spec box's width as the ruler
        const place = parts.mockup && widthIn ? await measureDrop(parts.mockup, widthIn).catch(() => null) : null;
        const specs = [
          ...ims.map(({ im }) => [im.location, im.size, place ? `${place.dropIn}" below the collar, as on their mockup` : "", im.colors ? `${im.colors} color${+im.colors === 1 ? "" : "s"}${im.inks ? `: ${im.inks}` : ""}` : im.inks].filter(Boolean).join(" · ")),
          ...gs.flatMap((x) => [...new Set(x.lines.map((l) => [l.brand, l.style, l.color].filter(Boolean).join(" ")))]).filter(Boolean),
        ];
        const artUrl = URL.createObjectURL(parts.art), mockUrl = parts.mockup ? URL.createObjectURL(parts.mockup) : "";
        note("Found their mockup sheet: checking with you");
        const ans = await askOnce<"sheet" | "art">(`sheet:${f.path}`, (resolve) => setSheetAsk({ name: f.name, art: artUrl, mockup: mockUrl, background: parts.background, specs, resolve }));
        setSheetAsk(null);
        if (ans === "art") { did.push(`${f.name}: used as the art, as sent (you said it's not a mockup sheet)`); continue; }
        const key = `designs/sheet-${crypto.randomUUID().slice(0, 8)}`, base = f.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 60);
        const artPath = `${key}/${base}-art.png`, mockPath = `${key}/${base}-mockup.png`;
        const upA = await sb0.storage.from("proofs").upload(artPath, parts.art, { contentType: "image/png" });
        if (upA.error) { did.push(`${f.name}: the art couldn't be cut off it (${upA.error.message}): the PDF is used as sent`); continue; }
        const upM = parts.mockup ? await sb0.storage.from("proofs").upload(mockPath, parts.mockup, { contentType: "image/png" }) : { error: { message: "no shirt page" } };
        const art2: Record<string, string> = {};
        for (const [k, v] of Object.entries(d.art || {})) art2[k] = v === f.path ? artPath : v;
        const mock2: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(d.mockups || {})) mock2[k] = [...new Set(v.map((p0) => (p0 === f.path ? (upM.error ? "" : mockPath) : p0)).filter(Boolean))];
        // the shirt page is the mockup of every group printing this art
        if (!upM.error) for (const x of gs) mock2[x.id] = [...new Set([...(mock2[x.id] || []), mockPath])];
        // their placement on the prints made from this sheet
        if (place) {
          const ids = new Set(ims.map(({ im }) => im.id));
          d = { ...d, groups: d.groups.map((x) => ({ ...x, imprints: x.imprints.map((im) => (ids.has(im.id) ? { ...im, drop: String(place.dropIn), notes: [im.notes, `Placement from their mockup: ${place.dropIn}" below the collar`].filter(Boolean).join(". ").slice(0, 300) } : im)) })) };
        }
        d = { ...d, art: art2, mockups: mock2, files: [
          ...d.files.map((x) => (x.path === f.path ? { ...x, role: "other" as const, kind: "customer_mockup" } : x)),
          { path: artPath, name: `${base} art.png`, type: "image/png", size: parts.art.size, role: "art" as const, what: "art cut off their mockup sheet" },
          ...(upM.error ? [] : [{ path: mockPath, name: `${base} mockup.png`, type: "image/png", size: parts.mockup!.size, role: "mockup" as const, what: "their mockup page" }]),
        ] };
        did.push(`${f.name}: their mockup sheet. Art cut off page ${parts.artPage}${parts.background ? ", its background taken out (it doesn't print)" : ""}; page ${parts.mockupPage} is their mockup; the PDF is in Production files`);
      }
      // art that came ON A GARMENT (a person wearing it, a shirt photo, our old mockup or theirs, shirts drawn in their
      // software): the Mockup Creator's Helper pulls the art off it before anything else, never the whole picture as
      // the logo (Oct 22, Nick: McKenna's HUD 102026.ai, a man in the red tee, became a 10-color logo; "before you start,
      // you should immediately identify: do I need to go upload the art or move this to the helper and pull that art out")
      for (const path of [...new Set(Object.values(d.art || {}))]) {
        const f = d.files.find((x) => x.path === path);
        if (!f || !pdfLike(f)) continue;
        guard();
        const { data: blob } = await sb0.storage.from("proofs").download(f.path);
        if (!blob) continue;
        step(`${of}Is the art in ${f.name} on a shirt? Checking with the Helper…`);
        const got: Pulled | null = helperGot.has(f.path) ? helperGot.get(f.path)! : await pullOffMockup(blob, f.name, { drawn: true }).catch(() => null);
        guard();
        if (!got) continue;
        const used = new Set<ArtPiece>();
        type Plan = { x: Group; im: Group["imprints"][number]; pc: ArtPiece };
        const plan: Plan[] = d.groups.flatMap((x) => x.imprints.filter((im) => d!.art?.[im.id] === f.path).map((im) => {
          const pc = pieceFor(got, im.location, used) || pieceFor(got, "front", used) || pieceFor(got, "back", used);
          if (pc) used.add(pc);
          return { x, im, pc };
        })).filter((z): z is Plan => !!z.pc);
        if (!plan.length) continue;
        const page = await pagePicture(blob);
        const shown: ArtPiece[] = [...new Set<ArtPiece>(plan.map((z) => z.pc))];
        const urls = shown.map((pc) => URL.createObjectURL(pc.file)), mockUrl = page ? URL.createObjectURL(page) : "";
        const specs = plan.map(({ im, pc }) => `${im.location}: ${pc.widthIn}" × ${pc.heightIn}", ${pc.dropIn}" below the collar${pc.ink ? ` · looks like ${pc.ink}` : ""}`);
        note(`${f.name} has the art on a shirt: pulled it off with the Helper, checking with you`);
        const ans = await askOnce<"sheet" | "art">(`shirt:${f.path}`, (resolve) => setSheetAsk({ name: f.name, art: urls[0], more: urls.slice(1), mockup: mockUrl, background: null, specs, resolve, onShirt: got.kind }));
        setSheetAsk(null);
        if (ans === "art") { did.push(`${f.name}: used as the art, as sent (you said the art isn't on a shirt)`); continue; }
        const key = `designs/pulled-${crypto.randomUUID().slice(0, 8)}`, base = f.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 60);
        const art2: Record<string, string> = { ...(d.art || {}) };
        const added: EODraft["files"] = [];
        const pathOf = new Map<ArtPiece, string>();
        const ok = new Set<string>();
        for (const [k, pc] of shown.entries()) {
          const pth = `${key}/${base}-${pc.side}${k ? `-${k + 1}` : ""}.png`;
          const up = await sb0.storage.from("proofs").upload(pth, pc.file, { contentType: "image/png" });
          if (up.error) continue;
          pathOf.set(pc, pth);
          added.push({ path: pth, name: `${base} ${pc.side} art.png`, type: "image/png", size: pc.file.size, role: "art" as const, what: `art pulled off ${f.name} (the Helper)` });
        }
        for (const { im, pc } of plan) { const pth = pathOf.get(pc); if (pth) { art2[im.id] = pth; ok.add(im.id); } }
        if (!ok.size) { did.push(`${f.name}: the art on it couldn't be saved: the file is used as sent`); continue; }
        // their file is their mockup: a picture of it with the group's mockups (stamped, in Production files) and the file in Production files
        const mockPath = `${key}/${base}-mockup.png`;
        const upM = page ? await sb0.storage.from("proofs").upload(mockPath, page, { contentType: "image/png" }) : { error: { message: "no picture" } };
        const mock2: Record<string, string[]> = { ...(d.mockups || {}) };
        if (!upM.error) for (const x of new Set<Group>(plan.map((z) => z.x))) mock2[x.id] = [...new Set([...(mock2[x.id] || []).filter((p0) => p0 !== f.path), mockPath])];
        // the size and drop measured off their shirt, where the order doesn't say
        const by = new Map(plan.map((z) => [z.im.id, z.pc]));
        d = { ...d, art: art2, mockups: mock2, groups: d.groups.map((x) => ({ ...x, imprints: x.imprints.map((im) => {
          const pc = ok.has(im.id) ? by.get(im.id) : undefined;
          if (!pc) return im;
          const sized = parseFloat(String(im.size || "")) > 0;
          // off a photo of a person (or any photo that isn't our flat shirt): the art only; the size and drop are the shop's
          // usual for the spot (HUD 102026 came out 9.25" down, in the belly); a drop deeper than a chest print sits isn't used
          const trust = !pc.approx && !(pc.dropIn > 5 && /front|chest/i.test(im.location));
          return { ...im, ...(sized || !trust ? {} : { size: `${pc.widthIn}" wide` }), ...(trust ? { drop: im.drop || String(pc.dropIn) } : {}), ...(!im.inks && pc.ink ? { inks: pc.ink } : {}),
            notes: [im.notes, trust ? `Art pulled off ${f.name} with the Helper: ${pc.widthIn}" × ${pc.heightIn}", ${pc.dropIn}" below the collar${got.kind === "drawn" ? " (read off a drawn shirt: close, not exact)" : ""}` : `Art pulled off ${f.name} with the Helper (a photo of it worn: the usual size and drop for the ${im.location})`].filter(Boolean).join(". ").slice(0, 300) };
        }) })), files: [
          ...d.files.map((x) => (x.path === f.path ? { ...x, role: "other" as const, kind: "customer_mockup" } : x)),
          ...added,
          ...(upM.error ? [] : [{ path: mockPath, name: `${base} mockup.png`, type: "image/png", size: page!.size, role: "mockup" as const, what: `their mockup (${f.name})` }]),
        ] };
        did.push(`${f.name}: the art was on ${got.kind === "drawn" ? "drawn shirts" : "a shirt"}, so the Helper pulled it off (${plan.map(({ im, pc }) => `${im.location} ${pc.widthIn}" wide`).join(", ")}); their file is the customer mockup, in Production files`);
      }
    }
    guard();
    // how each print's size and inks were arrived at, shown beside them at the check (Oct 23, Nick: "you have to say
    // something about how you got there… last time on the mock-up we used these dimensions, or the PO says this… it says
    // best fit, I'm thinking 10 inches")
    const howGot = new Map<string, Spec>();
    const whyOf = (id: string) => { if (!howGot.has(id)) howGot.set(id, {}); return howGot.get(id)!; };
    // a print done like a past job that didn't keep its size (Printavo never did): measured off that job's mockup with the
    // Helper, else asked at the check (Oct 23, Nick on #40113: "you should have used the previous order to size the back
    // art or ask that question")
    for (const x of d.groups) for (const im of x.imprints) {
      if (!im.sameAs || parseFloat(String(im.size || "")) > 0) continue;
      let w = 0, dropIn = -1;
      if (im.sameAs.pdf) {
        note(`Measuring the ${im.location} on ${im.sameAs.label}'s mockup…`);
        try {
          const side = /sleeve/i.test(im.location) ? (/left/i.test(im.location) ? "left sleeve" : "right sleeve") : /back|yoke|shoulder|nape/i.test(im.location) ? "back" : "front";
          // the size written on our mockup sheet ("Back Imprint · SIZE: W 10"") wins over measuring the drawing: every PDF
          // on the old job is looked at (the sheet may not be the first)
          let blob: Blob | null = null, said: { w: number; h?: number; inks?: string[] } | undefined;
          for (const pth of im.sameAs.pdfs?.length ? im.sameAs.pdfs : [im.sameAs.pdf]) {
            const { data: su } = await createClient().storage.from("proofs").createSignedUrl(pth, 600);
            const b = su?.signedUrl ? await (await fetch(su.signedUrl)).blob().catch(() => null) : null;
            if (!b) continue;
            if (!blob) blob = b;
            said = (await sizesOnSheet(await b.arrayBuffer()).catch(() => ({} as Awaited<ReturnType<typeof sizesOnSheet>>)))[side];
            if (said?.w) break; // a sheet with no size written: measured off it instead (below)
          }
          if (said && !said.w) said = undefined;
          if (said) {
            w = said.w;
            Object.assign(whyOf(im.id), { sizeWhy: `${im.sameAs.label}'s mockup sheet: ${side[0].toUpperCase() + side.slice(1)} Imprint W ${said.w}"${said.h ? ` × H ${said.h}"` : ""}`, last: `Last time (${im.sameAs.label.replace(/^(#\d+).*/, "$1")}): ${said.w}" wide${said.inks?.length ? ` · ${said.inks.map(stockName).join(", ")}` : ""}`, lastW: said.w, ...(said.h ? { lastH: said.h } : {}) });
            if (said.inks?.length) whyOf(im.id).inksWhy = `${im.sameAs.label.replace(/^(#\d+).*/, "$1")}'s sheet: ${said.inks.join(", ")}`;
            // the inks it printed in, as the sheet lists them ("1. WHITE 2. SCARLET RED"): ours by name
            if (said.inks?.length) {
              const names = [...new Set(said.inks.map(stockName))], id0 = im.id;
              d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id0 ? z : { ...z, inks: names.join(", "), colors: names.length })) })) };
              did.push(`${im.location}: inks from ${im.sameAs.label}'s sheet: ${names.join(", ")}`);
            }
          }
          else {
            const got = blob ? await pullOffMockup(new File([blob], "old mockup.pdf", { type: "application/pdf" }), "old mockup.pdf", { drawn: true }) : null;
            const pc = got ? pieceFor(got, im.location) : undefined;
            // never bigger than the spot can print (a 14" back: "we can't even print 14 wide")
            if (pc && !pc.approx && pc.widthIn <= spotFor(im.location).maxW) { w = pc.widthIn; dropIn = pc.dropIn; }
          }
        } catch { /* asked below */ }
        guard();
      }
      const id = im.id;
      if (w > 0) {
        const how = dropIn >= 0 ? "measured" : "written on it";
        if (dropIn >= 0) whyOf(id).sizeWhy = `Measured on ${im.sameAs.label.replace(/^(#\d+).*/, "$1")}'s mockup`;
        d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, size: `${w}" wide`, ...(dropIn >= 0 ? { drop: String(dropIn) } : {}), notes: [z.notes, `Size from ${im.sameAs!.label}'s mockup: ${w}" wide${dropIn >= 0 ? `, ${dropIn}" below the collar` : ""} (${how})`].filter(Boolean).join(". ").slice(0, 300) })) })) };
        did.push(`${im.location}: ${w}" wide, ${how} on ${im.sameAs.label}'s mockup`);
      } else {
        d = { ...d, check: [...(d.check || []), { q: `${im.location}: what size? ${im.sameAs.label} didn't keep one`, guess: "Standard size", about: x.name, choices: [{ label: "Standard size" }, { label: "Production measures it" }] }] };
      }
    }
    // art on a solid box (Oct 23, Nick on Tongue in Cheek: "do I remove the background and make it a two-color print?
    // Because it's on a black shirt"): the box found on the art's picture, its other colors counted without the shirt's,
    // and asked at the check, with taking it out as the guess
    const boxedOut: { group: string; location: string }[] = [], artInks = new Map<string, { name: string; hex: string }[]>(), ratioOf = new Map<string, number>();
    for (const x of d.groups) {
      const shirt = guessHex(lineColor(x.lines.find((l) => l.color)) || "White"), shirtName = x.lines.find((l) => l.color)?.color || "white";
      for (const im of x.imprints) {
        const path = d.art?.[im.id];
        if (!path || im.method === "dtf" || (d.check || []).some((c) => c.local === `bg:${im.id}`)) continue;
        const b0 = await boxOf(path, shirt).catch(() => null);
        guard();
        if (!b0) continue;
        artInks.set(im.id, b0.inks);
        if (b0.ratio) ratioOf.set(im.id, b0.ratio);
        if (!b0.box) continue;
        const b = { ...b0.box, inks: b0.inks.map((k) => k.name) };
        const n = b.inks.length, list = b.inks.join(", ");
        // the shirt's own color never prints (Oct 23, Nick: "black on a black shirt, you should always think I'm removing
        // it… yellow on a yellow shirt… only time you might be unsure is a heathered shirt"): out without asking
        if (b.sameAsShirt && !isHeather(shirtName)) {
          const id = im.id;
          boxedOut.push({ group: x.name || "", location: im.location });
          d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, colors: z.inks ? z.colors : n || z.colors, notes: [z.notes, `The ${b.bgName.toLowerCase()} box behind the art is the shirt's color: taken out, the shirt shows through, ${n} color${n === 1 ? "" : "s"}`].filter(Boolean).join(". ").slice(0, 300) })) })) };
          did.push(`${im.location}: the ${b.bgName.toLowerCase()} box behind the art is the shirt's color, so it's out: ${n} color${n === 1 ? "" : "s"}${list ? ` (${list})` : ""}`);
          continue;
        }
        const q = b.sameAsShirt
          ? `${im.location}: the art is on a ${b.bgName.toLowerCase()} box on a heathered ${shirtName} shirt. Take it out and print ${n} color${n === 1 ? "" : "s"}?`
          : `${im.location}: the art is on a ${b.bgName.toLowerCase()} box. Take it out (${n} color${n === 1 ? "" : "s"}) or print the box?`;
        d = { ...d, check: [...(d.check || []), { q, guess: "Take it out", about: x.name, local: `bg:${im.id}|${n}|${list}|${b.bgName}`, choices: [{ label: `Take it out: ${n} color${n === 1 ? "" : "s"}${list ? ` (${list})` : ""}` }, { label: `Print the box: ${n + 1} colors` }] }] };
      }
    }
    // the reader's own questions about those prints' colors (count the black outline? confirm Black, White, Red?) are
    // settled by that: not asked
    if (boxedOut.length) {
      const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      d = { ...d, check: (d.check || []).filter((c) => c.local || !boxedOut.some((b) => (!c.about || !b.group || sameName(c.about, b.group)) && new RegExp(esc(b.location), "i").test(c.q) && /colou?rs?\b|inks?\b|black|outline|base/i.test(c.q))) };
    }
    // one set of inks for a garment's prints (Oct 23, Nick on #40115: "when you use two colors on the front, you're probably
    // going to use the same two colors on the back, unless it's drastically different… if they don't specify it"): a print
    // with no inks named takes the inks another print on the same garments has, when its art's colors are those colors
    for (const x of d.groups) {
      // plain color words ("White, Red") aren't a pick of ink: a print with only those takes the other print's inks too
      const generic = (t: string) => t.split(/\s*,\s*/).every((w) => /^(white|black|red|blue|green|yellow|orange|purple|pink|gr[ae]y|brown|gold|navy|silver)$/i.test(w.trim()));
      const ref = x.imprints.find((im) => im.inks && !/simulated/i.test(im.inks) && !generic(im.inks));
      if (!ref) continue;
      const refInks = ref.inks.split(/\s*,\s*/).map((n) => ({ n, hex: colorHex(n) })).filter((k) => k.hex);
      if (!refInks.length) continue;
      const rgb = (h: string) => { const v = parseInt(h.replace("#", ""), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
      const dist = (a: string, b: string) => { const p = rgb(a), q = rgb(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
      for (const im of x.imprints) {
        if (im === ref || (im.inks && !generic(im.inks))) continue;
        const cols = artInks.get(im.id);
        if (!cols?.length) continue;
        const picks = cols.map((c) => refInks.slice().sort((a, b) => dist(c.hex, a.hex!) - dist(c.hex, b.hex!))[0]).map((k, i) => (dist(cols[i].hex, k.hex!) < 110 ? k.n : ""));
        if (picks.some((p0) => !p0)) continue; // a color that isn't one of them: drastically different, left alone
        const names = [...new Set(picks)], id = im.id;
        d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, inks: names.join(", "), colors: names.length, notes: [z.notes, `Same inks as the ${ref.location} (${names.join(", ")}): none were named for this print`].filter(Boolean).join(". ").slice(0, 300) })) })) };
        did.push(`${im.location}: the same inks as the ${ref.location} (${names.join(", ")})`);
        whyOf(id).inksWhy = `Same as the ${ref.location}: nothing named for this print`;
      }
    }
    // one more color on the paperwork than the inks it names, on a shirt that isn't white: the extra one is the white
    // underbase (Oct 23, Nick on HALFF: "anytime somebody says three colors and they only give you two and it's on a darker
    // or a different color garment than the white, you got to know that's just underbase"). Not asked: said on the print
    const ubOf = new Map<string, string>();
    {
      const notWhite = (c?: string) => !!c && !/\b(white|natural|cream|ivory|pfd)\b/i.test(c);
      // any question about a print's colors or inks: the reader words it differently every time ("add a 3rd color or White
      // underbase?", "J1 had 2 colors; this work order says 3. Confirm 3rd ink"), so it's matched by what it's about and
      // the count it gives (one more than the inks named), never by its wording
      const ubQ = (t: string) => /colou?rs?\b|\binks?\b|underbase|screens?\b|\bpms\b/i.test(t);
      // the counts a question gives: numbers, ordinals ("3rd screen color", "a third ink") and "one more / another / extra
      // / missing" color (= one more than named)
      const ORD: Record<string, number> = { second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, "6th": 6 };
      const counts = (t: string, n: number) => [...nums(t), ...(t.match(/\b(second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th)\b/gi) || []).map((w) => ORD[w.toLowerCase()]), ...(/\b(one more|another|extra|additional|missing|unnamed|not named)\b/i.test(t) ? [n + 1] : [])];
      const nums = (t: string) => (t.replace(/\([^)]*\)/g, " ").replace(/\b(pms|pantone)\s*\d+\s*[a-z]?\b/gi, " ").replace(/\b\d{3,4}\s?[cu]\b/gi, " ").match(/\b(1[0-2]|[1-9])\b/g) || []).map(Number);
      const drop = new Set<number>();
      for (const x of d.groups) {
        if (!x.lines.length || !x.lines.every((l) => notWhite(l.color))) continue;
        const shirt = x.lines[0].color;
        const qs = (d.check || []).map((c, i) => ({ c, i })).filter(({ c }) => !c.local && ubQ(c.q) && (!c.about || sameName(c.about, x.name || "") || !d!.groups.some((g2) => sameName(c.about, g2.name || ""))));
        for (const im of x.imprints) {
          if (im.method && im.method !== "screen") continue;
          const n = inkNames(im.inks || "").filter((t) => !/underbase/i.test(t)).length;
          if (!n || im.printStyle === "fashion" || im.underbase === true) continue; // our sheet already said it
          const asked = qs.filter(({ c }) => counts(c.q, n).includes(n + 1) && (!c.about || !/(front|back|sleeve|chest)/i.test(c.q) || new RegExp(im.location.split(/\s+/)[0], "i").test(c.q) || !d!.groups.some((g2) => sameName(c.about, g2.name || ""))));
          if (!asked.length && +im.colors !== n + 1 && saidColors.get(im.id) !== n + 1) continue;
          asked.forEach(({ i }) => drop.add(i));
          const why = `${n + 1} colors on their paperwork = these ${n} + a white underbase (${String(shirt).toLowerCase().replace(/\b\w/g, (k) => k.toUpperCase())} shirt)`;
          ubOf.set(im.id, why);
          const id = im.id;
          d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, underbase: true, colors: n, inks: inkNames(z.inks || "").filter((t) => !/underbase/i.test(t)).join(", "), notes: [z.notes, `${why}`].filter(Boolean).join(". ").slice(0, 300) })) })) };
          did.push(`${im.location}: ${why}`);
        }
      }
      if (drop.size) d = { ...d, check: (d.check || []).filter((_, i) => !drop.has(i)) };
    }
    // their extras (Oct 23, Nick on McKenna's HUD 102026: "when you're reading it, you say, hey, I've got one extra of
    // each size. Are these extras? …to be printed or not to be printed"): a line the reader called extras, or a small
    // line (1 or 2 a size) under a bigger one of the same style, is asked at the check, answered here
    {
      const qty = (l: { sizes?: Record<string, number | undefined> }) => Object.values(l.sizes || {}).reduce<number>((a, v) => a + (+(v || 0)), 0);
      for (const x of d.groups) for (const [li, l] of x.lines.entries()) {
        if (l.extrasPrint != null || (d.check || []).some((c) => c.local === `xt:${l.id}`)) continue;
        const prev = li > 0 ? x.lines[li - 1] : null, qs = Object.values(l.sizes || {}).map((v) => +(v || 0)).filter((v) => v > 0);
        const small = qs.length >= 3 && qs.every((v) => v <= 2) && !!prev && (prev.style || "").trim().toLowerCase() === (l.style || "").trim().toLowerCase() && qty(prev) >= 5 * qty(l);
        if (!l.extras && !small) continue;
        const n = qty(l), what = [l.style, l.color].filter(Boolean).join(" ") || "this garment";
        d = { ...d, check: [...(d.check || []), { q: `${n} more ${what}${qs.every((v) => v === 1) ? ", one of each size" : ""}. Are these extras?`, guess: "Yes, printed extras", about: x.name, local: `xt:${l.id}`, choices: [{ label: "Yes, printed extras" }, { label: "Yes, not printed" }] }] };
      }
    }
    // every print's size and inks, with how they were arrived at, for the check (whatever it says there is what's made)
    {
      const specs: Record<string, Spec> = {};
      for (const x of d.groups) for (const im of x.imprints) {
        const sp: Spec = { ...(howGot.get(im.id) || {}) }, w = parseFloat(String(im.size || "")), r = ratioOf.get(im.id);
        // set from our own mockup sheet in the Resolution Center
        const fromSheet = (im.notes || "").match(/From our mockup sheet ([^:]+): ([\d.]+)" wide/);
        if (fromSheet) {
          sp.sizeWhy ||= `Our mockup sheet ${fromSheet[1]}: W ${fromSheet[2]}"`;
          if (im.inks) sp.inksWhy ||= `Our mockup sheet ${fromSheet[1]}`;
          if (/\+ halftones/.test(im.notes || "")) { sp.extra = 1; sp.inksWhy = `${sp.inksWhy || "Our mockup sheet"}, plus halftones`; }
          if (im.underbase === true && /\+ (halftones \+ )?white underbase/.test(im.notes || "")) { sp.ub = true; sp.ubWhy = "Our mockup sheet lists a white underbase"; }
        }
        if (w > 0) { sp.size = w; sp.sizeWhy ||= im.sizeFrom === "customer" ? "Their PO or email gives this size" : im.aiPlace ? "Read off their mockup" : "From the order"; }
        else { const rule = sizeRule(im.location, r); sp.size = rule.w; sp.sizeWhy = `${/best fit/i.test(im.notes || "") ? `"Best fit" on their paperwork: ` : ""}${rule.why}`; }
        if (im.inks && !/simulated/i.test(im.inks)) { sp.inks = im.inks; sp.inksWhy ||= "Named on their paperwork"; }
        if (ubOf.has(im.id)) { sp.ub = true; sp.ubWhy = ubOf.get(im.id); }
        else { const a = artInks.get(im.id); if (a?.length) { sp.inks = a.map((k) => k.name).join(", "); sp.inksWhy = "Read off the art (the shirt's own color left out)"; } }
        // the new art shaped differently from last time's (an extra circle on the right): a bigger size suggested
        if (sp.lastW && sp.lastH && r) {
          const was = sp.lastW / sp.lastH, now = 1 / r;
          if (now > was * 1.12) { const sug = Math.round(sp.lastW * (now / was) * 4) / 4; if (sug <= spotFor(im.location).maxW) sp.flag = { text: `This art is wider than ${im.sameAs?.label.replace(/^(#\d+).*/, "$1") || "last time"}'s (${sp.lastW}" × ${sp.lastH}"). Same ${sp.lastW}", or ${sug}"?`, size: sug }; }
        }
        specs[im.id] = sp;
      }
      d = { ...d, specs };
    }
    // the check, at the end, with pictures (Oct 23, Nick: "you don't ask until you get to the end and you've read all the
    // data and we've identified all the mockups and work orders… maybe it would be more visual"): each group as a card,
    // their picture of it beside the art picked and the shirts, and what doesn't add up asked on its card, by picture.
    // An answer that changes something: it's read again with your answers and made again (the answers you already gave
    // along the way aren't asked twice); ticked: remembered for this customer's next orders
    {
      const cust = g.customer?.company || g.customer?.name || "this customer";
      step(`${of}${d.check?.length ? `Checking ${d.check.length === 1 ? "one thing" : `${d.check.length} things`} with you…` : "Here's the order: look it over…"}`);
      if (d.check?.length) note(`${d.check.length} thing${d.check.length === 1 ? "" : "s"} to check, on the order's cards`);
      const rv = await waitFor<ReviewAns>((resolve) => setReview({ d: d!, customer: cust, again: again.length > 0, resolve }));
      setReview(null);
      guard();
      // the background boxes: answered here, never sent back to the reader
      const localOf = new Map((d.check || []).filter((c) => c.local).map((c) => [c.q, c.local!]));
      // their extras: printed, not printed (counted, sent back blank), or not extras (charged)
      for (const a of rv.answers.filter((x) => localOf.get(x.q)?.startsWith("xt:"))) {
        const lid = localOf.get(a.q)!.slice(3), no = /^\s*no\b|not extras/i.test(a.answer), blank = /not printed/i.test(a.answer), free = !/\bcharged\b/i.test(a.answer);
        d = { ...d, groups: d.groups.map((y) => ({ ...y, lines: y.lines.map((l) => (l.id !== lid ? l : no ? { ...l, extras: undefined, extrasPrint: undefined, extrasFree: undefined, priceOverride: l.priceOverride === 0 ? null : l.priceOverride } : { ...l, extras: true, extrasPrint: !blank, extrasFree: free, priceOverride: free ? 0 : l.priceOverride === 0 ? null : l.priceOverride })) })) };
        const l0 = d.groups.flatMap((y) => y.lines).find((l) => l.id === lid);
        did.push(`${[l0?.style, l0?.color].filter(Boolean).join(" ")}: ${no ? "not extras, charged" : `their extras, ${blank ? "not printed" : "printed"}, ${free ? "no charge" : "charged"}`}`);
      }
      for (const a of rv.answers.filter((x) => localOf.get(x.q)?.startsWith("bg:"))) {
        const [key, n0, list, bgName] = localOf.get(a.q)!.split("|"), id = key.slice(3), n = +n0 || 1;
        const keep = /print the box/i.test(a.answer);
        d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, colors: keep ? n + 1 : n, notes: [z.notes, keep ? `Their ${bgName.toLowerCase()} box prints too` : `The ${bgName.toLowerCase()} box behind the art is taken out: the shirt shows through, ${n} color${n === 1 ? "" : "s"}`].filter(Boolean).join(". ").slice(0, 300) })) })) };
        did.push(`${y0(d, id)}: ${keep ? `the ${bgName.toLowerCase()} box prints too (${n + 1} colors)` : `${bgName.toLowerCase()} box taken out, ${n} color${n === 1 ? "" : "s"}${list ? ` (${list})` : ""}`}`);
      }
      const ans = rv.answers.filter((x) => !localOf.has(x.q));
      // a date question settled on a firm date ("Firm 11/2 (notes)"): the order's Firm box is ticked
      for (const c of (d.check || []).filter((c0) => /\b(due|dates?|in-?hands|deadline|needed by)\b/i.test(c0.q))) {
        const a1 = ans.find((x) => x.q === c.q)?.answer.trim() || c.guess || "";
        if (/\bfirm\b/i.test(a1)) d = { ...d, firm: true };
      }
      // the size and inks as the check shows them: that's what's made
      for (const [id, sp] of Object.entries(rv.specs || {})) {
        const was = d.specs?.[id];
        const inks = (sp.inks || "").split(/\s*,\s*/).map((t) => t.trim()).filter(Boolean).map(stockName);
        const changed = !!was && (was.size !== sp.size || (was.inks || "") !== (sp.inks || ""));
        d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, ...(sp.size && sp.size > 0 ? { size: `${sp.size}" wide`, ...(changed ? { sizeFrom: "staff" as const } : {}) } : {}), ...(inks.length ? { inks: inks.join(", "), colors: inks.length + (sp.extra || 0) } : {}), ...(changed ? { notes: [z.notes, `Set at the check: ${sp.size}" wide${inks.length ? `, ${inks.join(", ")}` : ""}`].filter(Boolean).join(". ").slice(0, 300) } : {}) })) })) };
        if (changed) did.push(`${y0(d, id)}: you set ${sp.size}" wide${inks.length ? `, ${inks.join(", ")}` : ""}`);
        if (was?.ubWhy && !sp.ub) {
          d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, underbase: false, notes: [z.notes, "No underbase (set at the check)"].filter(Boolean).join(". ").slice(0, 300) })) })) };
          did.push(`${y0(d, id)}: no underbase (you said)`);
        }
      }
      // a different logo picked for a print: it goes on, with its own colors (no ink names carried over from the other one)
      for (const x of d.groups) for (const im of x.imprints) {
        const v = rv.art[im.id] || "", was = d.art?.[im.id] || (im.design_id ? `design:${im.design_id}` : "");
        if (!v || v === was) continue;
        const art2 = { ...(d.art || {}) };
        if (v.startsWith("design:")) delete art2[im.id]; else art2[im.id] = v;
        d = { ...d, art: art2, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== im.id ? z : { ...z, design_id: v.startsWith("design:") ? v.slice(7) : (undefined as unknown as string), inks: "" })) })) };
        did.push(`${x.name || "The order"} · ${im.location}: you picked ${v.startsWith("design:") ? "their logo on file" : d.files.find((f) => f.path === v)?.name || "another logo"}`);
      }
      const said = ans.filter((a) => a.answer.trim()).map((a) => `${a.q} → ${a.answer.trim()}`);
      let kept = 0;
      for (const a of ans.filter((x) => x.remember && x.answer.trim())) { const r = await rememberOrderNote(activityId, `${a.q} Answer: ${a.answer.trim()}`).catch(() => null); if (r?.ok) kept++; }
      if (kept) did.push(`Remembered ${kept === 1 ? "that" : `those ${kept}`} for ${cust}'s next orders`);
      if (said.length && !again.length) {
        // made again with your answers: the logos this pass made are taken back first
        const ids = [...made0.current]; made0.current = new Set();
        if (ids.length) await discardDraftArt(ids).catch(() => null);
        step(`${of}Reading it again with your answers…`);
        return one(part, of, said);
      }
      if (said.length) {
        d = { ...d, notes: [d.notes, `Answers given when it was made: ${said.join("; ")}`].filter(Boolean).join("\n").slice(0, 2000) };
        did.push(...said.map((x) => `You said: ${x} (in the order's notes)`));
      } else if (d.check?.length) did.push(`Went with my guesses on: ${d.check.map((c) => c.q).join(" · ")}`.slice(0, 400));
    }
    // the prints in order on the order: the front, then the back, then sleeves (Oct 23, #40116 had the Full Back first);
    // their notes keep only what a person said, not how Create order got there (that's in "What I did", Oct 23)
    d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: [...y.imprints].sort((p0, p1) => spotRank(p0.location) - spotRank(p1.location)).map((im) => ({ ...im, notes: cleanPrintNotes(im.notes) })) })) };
    setCommitting(true);
    step(`${of}Creating the order…`);
    note(d.kind === "reorder" ? "Copying the job with the new sizes as a quote…" : "Saving it as a quote…");
    const r = await fetch("/api/inbox/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, draft: d, status: "quote" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!r?.ok || !j.id) { setCommitting(false); throw new Error(j.error || "Couldn't create the order."); }
    // the goods bought ahead are this order's now (its reminder to-do closes)
    if (goodsId) { const lk = await linkGoods(goodsId, j.id).catch(() => null); if (!lk?.ok) did.push(`The goods order couldn't be linked to #${j.number}: link it on Order goods`); }
    // the order type picked on Create order's card (New order / Reorder / Reorder with changes): the order's Job details → Order type
    { const ot = part?.orderType || start.orderType; if (ot) await createClient().from("orders").update({ order_type: ot }).eq("id", j.id).then(() => null, () => null); }
    // its logos are the order's now; art you replaced in the Resolution Center is taken off (if on no order)
    made0.current = new Set();
    if (replaced.length) void discardDraftArt(replaced).catch(() => null);
    await attachFilms(j.id, films);
    for (const h of handOff) { const x = await handOffArt(j.id, `${h.title} (#${j.number})`, h.notes).catch(() => null); if (x && !x.ok) did.push(`The to-do for production couldn't be made: ${x.error}`); }
    let url = `/shop/orders/${j.id}`, mockup = false;
    try {
      const sb = createClient();
      const { data: o } = await sb.from("orders").select("groups").eq("id", j.id).maybeSingle();
      const gs = ((o?.groups || []) as Group[]);
      if (gs.some((x) => (x.customerMockups || []).length)) note("Saving the customer's mockup to Production files…");
      if (gs.some((x) => (x.customerMockups || []).length)) await Promise.race([stampOrderMockups(sb, j.id, gs), new Promise((res) => setTimeout(res, 25_000))]);
      // a brand's logo on file needs no mockup (it shows as the logo itself on the order, like #40195)
      const first = gs.find((x) => x.imprints.some((im) => im.design_id && !im.fromBrand) && !(x.mockupThumbs || []).some(Boolean));
      if (first) { url = `/shop/artwork/mockup?order=${j.id}&group=${first.id}&auto=1`; mockup = true; }
      else if (gs.some((x) => (x.mockupThumbs || []).some(Boolean))) did.push("Same mockup as last time (nothing new made)");
    } catch { /* the order page stamps them when it opens */ }
    url = `${url}${url.includes("?") ? "&" : "?"}email=${activityId}`;
    const label = d.kind === "reorder" ? `Reorder of ${jobLabel || "a past job"}` : `New order${d.nickname ? `: ${d.nickname}` : ""}`;
    onCreated(j.id, j.number, part?.label || d.nickname || label);
    return { id: j.id, number: j.number, label: part ? `${part.label}: ${label.toLowerCase().replace(/^reorder/, "reorder")}` : label, pcs: pcsOf(d.groups), url, kind: d.kind, did, ask: d.questions || [], mockup };
  }

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    (async () => {
      const parts = start.parts?.length ? start.parts : [null];
      for (const [i, p] of parts.entries()) {
        const many = parts.length > 1;
        if (many) { setCur(i); setSteps([]); setErr(""); }
        try {
          const m = await one(p, "");
          if (m) setMade((x) => [...x, m]);
          setCommitting(false);
          // several orders (Oct 20, Nick: "reorder one… ask me all the questions and say OK complete, and that opens in a
          // new tab… then I'll complete order two…"): each one stops here; Complete opens it in a new tab and goes on
          if (many && m) { finishSteps(); await waitFor<void>((resolve) => setPause({ made: m, i, resolve })); setPause(null); }
        } catch (e) {
          if (e instanceof Cancelled || stopped.current) {
            setConfirm(null); setHelp(null); setArtAsk(null); setSheetAsk(null); setRunsAsk(null); setGoodsAsk(null);
            const ids = [...made0.current]; made0.current = new Set();
            if (ids.length) await discardDraftArt(ids).catch(() => null);
            return;
          }
          finishSteps("error");
          setErr(`${p ? `${p.label}: ` : ""}${e instanceof Error ? e.message : String(e)}`);
          if (parts.length === 1) { setDone(true); return; }
          // this one wasn't made: say so, and go on to the next when you're ready
          try { await waitFor<void>((resolve) => setPause({ made: null, i, resolve })); } catch { return; }
          setPause(null);
        }
      }
      if (parts.length > 1) { onClose(); return; }
      finishSteps(); setDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parts = start.parts?.length ? start.parts : [null];
  const many = parts.length > 1;
  // one order made (Oct 23, Nick: "keep the order panel open the entire time… you make the mock-up and you stay open…
  // click around the order, look at the mock-up"): the check opens on the right (it stays on every page until it's
  // closed) and this tab goes on to the Mockup Creator, which makes the mockup and then shows the order
  const handed = useRef(false);
  useEffect(() => {
    if (!done || many || made.length !== 1 || handed.current) return;
    handed.current = true;
    const m = made[0];
    // one of several orders in the email: the check offers the next one when this one's right
    openOrderCheck(m.id, [...m.did, ...m.ask.map((q) => `Question for the customer (in the order's notes): ${q}`)], start.parts?.length ? { activity: activityId } : undefined);
    onClose();
    window.location.assign(m.url);
  }, [done, many, made, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={"dla-bg" + (dock ? " dock" + (help || confirm || review || (done && made.length === 1 && !many) ? " wide" : "") : "")} role="dialog" aria-modal={dock ? undefined : true} aria-label="Creating the order">
      <div className={"dla qo" + (help || confirm || review || (done && made.length === 1 && !many) ? " wide" : "")}>
        {!done && !committing && <button type="button" className="qo-x" onClick={cancel} aria-label={made.length ? "Stop here: the orders already made stay" : "Cancel: nothing is saved"} title={made.length ? "Stop here: the orders already made stay; the one in progress isn't saved" : "Cancel: stop here, nothing is saved"}>×</button>}
        {many && !done && (() => {
          const p = parts[cur]!;
          return (
            <div className="qo-part">
              <span className="qo-part-n">{p.kind === "reorder" ? "Reorder" : "Order"} {cur + 1} of {parts.length}</span>
              <b>{p.label}</b>
              <span className="qo-part-dots" aria-hidden>{parts.map((x, k) => <i key={x.key} className={k < cur || (k === cur && pause?.made) ? "done" : k === cur ? "on" : ""} />)}</span>
            </div>
          );
        })()}
        {pause ? (() => {
          const m = pause.made, last = pause.i === parts.length - 1, nx = parts[pause.i + 1];
          const go = () => { if (m) window.open(`${m.url}${m.url.includes("?") ? "&" : "?"}chat=${m.id}`, "_blank", "noopener"); if (last) onClose(); else pause.resolve(); };
          return (
            <div className="qo-pause">
              {m ? <>
                <h3>{parts[pause.i]!.kind === "reorder" ? "Reorder" : "Order"} {pause.i + 1} of {parts.length} is ready: #{m.number}</h3>
                <div className="qo-made">
                  <div className="qo-made-h"><b>#{m.number}</b><span>{m.label}</span><span className="faint">{m.pcs.toLocaleString("en-US")} pcs · Quote</span></div>
                  {m.did.length > 0 && <ul className="qo-did">{m.did.map((x, k) => <li key={k}>{x}</li>)}</ul>}
                  {m.ask.length > 0 && <details className="qo-ask"><summary>{m.ask.length} question{m.ask.length === 1 ? "" : "s"} for the customer (saved in the order&apos;s notes)</summary><ul>{m.ask.map((q, k) => <li key={k}>{q}</li>)}</ul></details>}
                </div>
              </> : <>
                <h3>{parts[pause.i]!.label} wasn&apos;t made</h3>
                {err && <div className="err">{err}</div>}
              </>}
              <div className="dla-acts qo-foot">
                <button type="button" className="btn ghost" onClick={onClose} title="Stop here: the orders already made stay">Stop here</button>
                <button type="button" className="btn primary" onClick={go}>{m ? `Complete: open #${m.number}${last ? " & close" : ` & start ${nx?.kind === "reorder" ? "reorder" : "order"} ${pause.i + 2}`}` : last ? "Close" : `Go on to ${nx?.kind === "reorder" ? "reorder" : "order"} ${pause.i + 2}`}</button>
              </div>
              {m && <p className="faint qo-pause-n">#{m.number} opens in a new tab{m.mockup ? ", in the Mockup Creator" : ""}; this window stays here for the next one.</p>}
            </div>
          );
        })() : <>
        {!done ? <>
          <h3>Reading the email and creating the order…</h3>
          <p className="dla-sub">This takes about a minute. Nothing is sent to the customer.</p>
        </> : !(made.length === 1 && !many) ? <h3>{made.length ? `${made.length === 1 ? "Order" : `${made.length} orders`} created` : "The order wasn't made"}</h3> : null}
        {!done && <ol className="qo-steps">{steps.map((s, i) => <li key={i} className={s.state}><i aria-hidden>{s.state === "done" ? "✓" : s.state === "error" ? "!" : ""}</i><span>{s.label}{s.note && s.state === "doing" && <small className="qo-note" aria-live="polite">{s.note}</small>}</span></li>)}</ol>}
        {sheetAsk && <SheetConfirm a={sheetAsk} onCancel={cancel} />}
        {review && <ReviewConfirm a={review} onCancel={cancel} />}
        {goodsAsk && <GoodsBoughtAsk list={goodsAsk.list} activityId={activityId} onDone={(id) => goodsAsk.done(id)} onCancel={cancel} />}
        {runsAsk && <SizeRunsAsk runs={runsAsk.runs} prefs={runsAsk.prefs} company={runsAsk.company} sender={runsAsk.sender} onDone={(picks, remember) => runsAsk.done({ picks, remember })} onCancel={cancel} />}
        {fitAsk && <SizeFitAsk inline rows={fitAsk.rows} onDone={(r) => fitAsk.done(r)} onCancel={cancel} />}
        {colorAsk && <ColorCheck inline rows={colorAsk.rows} onDone={(r) => colorAsk.done(r)} onCancel={cancel} />}
        {artAsk && <SentArt a={artAsk} onCancel={cancel} />}
        {confirm && <ArtConfirm c={confirm} onCancel={cancel} />}
        {help && <ArtHelp help={help} onCancel={cancel} />}
        {/* one order made: the panel stays open to check it (Oct 23, Nick: "that never closes until I say, yes, we've
            got everything right") */}
        {done && !many && made.length === 1 && <p className="dla-sub">Opening #{made[0].number}{made[0].mockup ? " and making its mockup" : ""}… the Order chat stays open on the right.</p>}
        {!many && !(done && made.length === 1) && made.map((m) => (
          <div key={m.id} className="qo-made">
            <div className="qo-made-h"><b>#{m.number}</b><span>{m.label}</span><span className="faint">{m.pcs.toLocaleString("en-US")} pcs · Quote</span></div>
            {m.did.length > 0 && <ul className="qo-did">{m.did.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {m.ask.length > 0 && <details className="qo-ask"><summary>{m.ask.length} question{m.ask.length === 1 ? "" : "s"} for the customer (saved in the order&apos;s notes)</summary><ul>{m.ask.map((q, i) => <li key={i}>{q}</li>)}</ul></details>}
            {done && made.length > 1 && <a className="qo-open" href={`${m.url}${m.url.includes("?") ? "&" : "?"}chat=${m.id}`} target="_blank" rel="noreferrer">{m.mockup ? "Make the mockup & open #" : "Open #"}{m.number} ›</a>}
          </div>
        ))}
        {err && <div className="err">{err}</div>}
        {done && !(made.length === 1 && !many) && (
          <div className="dla-acts qo-foot">
            {!made.length && <button type="button" className="btn ghost" onClick={onReview}>Check the details by hand</button>}
            <button type="button" className="btn" onClick={onClose}>Back to the email</button>
            {made.length === 1 && <a className="btn primary" href={made[0].url} target="_blank" rel="noreferrer" onClick={onClose}>{made[0].mockup ? "Make the mockup & view order" : "View order"}</a>}
          </div>
        )}
        </>}
      </div>
    </div>
  );
}

/**
 * Printavo Art Resolution Center (Oct 20, Nick: "you should immediately bring up the Printavo invoice and say, I found
 * these two pieces of art, tell me what they are… there should be the mockups, there should be production files…
 * all I want you to do is ask me what those are"). Every file on the old job, drawn large, each with what it could be:
 * the art for each print that's missing it, a mockup, or not needed. The art goes in with its flat background taken
 * off (a checkbox per file), then the mockup is made. Not there? Their emails and logos, the film folder, an upload,
 * production, or without art for now; or Cancel reorder (nothing saved).
 */
type Item = { key: string; /** the file as it is, to open full size */ open?: string; where: "old" | "kept" | "pulled" | "else"; /** the print it can only be (art already pulled) */ only?: string; path?: string; hint?: string; tag: string; name: string; title?: string; cutUrl: string; asIsUrl: string; canCut: boolean; ready: boolean; pick: (bg: boolean) => HelpPick | null };
type Drawn = { cut: Blob | null; cutUrl: string; asIs: Blob | null; asIsUrl: string; raw: Blob | null };
async function drawFile(url: string, name: string, type: string): Promise<Drawn | null> {
  const r = await fetch(url); if (!r.ok) return null;
  const b = await r.blob();
  const pdfish = /pdf|illustrator/i.test(b.type || type) || /\.(pdf|ai)$/i.test(name);
  // a Photoshop file: its flattened picture (Oct 21, Nick: "I can't figure out if it's a front or a back without the image")
  const c = isPsd(name, b.type || type) ? await psdPicture(await b.arrayBuffer(), 1400).catch(() => null) : pdfish ? await pdfPicture(await b.arrayBuffer(), 1400).catch(() => null) : /^image\/(png|jpe?g|gif|webp)/i.test(b.type) || /\.(png|jpe?g|gif|webp)$/i.test(name) ? await drawPic(URL.createObjectURL(b), 1400) : null;
  if (!c) return { cut: null, cutUrl: "", asIs: null, asIsUrl: "", raw: new File([b], name, { type: b.type }) };
  const asIs = await new Promise<Blob | null>((res) => trimToArt(c).toBlob(res, "image/png"));
  knockOutBackground(c, 28, true);
  const cut = await new Promise<Blob | null>((res) => trimToArt(c).toBlob(res, "image/png"));
  return { cut, cutUrl: cut ? URL.createObjectURL(cut) : "", asIs, asIsUrl: asIs ? URL.createObjectURL(asIs) : "", raw: b };
}
/** a first guess from the name, shown under the file (Printavo files are named any old way: Nick still says what it is) */
const hintOf = (n: string) => (/barcode|label|upc|sku/i.test(n) ? "Looks like barcode labels" : /mock/i.test(n) ? "Looks like a mockup" : /film|sep|separation/i.test(n) ? "Looks like film or separations" : /proof/i.test(n) ? "Looks like a proof" : "");
const png = (b: Blob, name: string) => new File([b], `${name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });

function ArtHelp({ help, onCancel }: { help: Help; onCancel: () => void }) {
  type Old = { name: string; path: string; url: string; type: string };
  type Found = { source: "library" | "email"; name: string; label: string; date: string; type: string; url?: string; design_id?: string; /** a supplier's paperwork: not shown */ hide?: boolean };
  const [old, setOld] = useState<null | (Old & { d?: Drawn | null })[]>(null);
  const [found, setFound] = useState<null | (Found & { d?: Drawn | null })[]>(null);
  const [pieces, setPieces] = useState<{ name: string; file: File; url: string; size: string }[]>([]);
  const [ups, setUps] = useState<{ file: File; url: string }[]>([]);
  // a file marked Mockup: the Helper pulls the art off it right away, each piece shown as a file of its own and given to
  // the print it's for (Oct 23, Nick, reordering #33728 from Printavo with only Peticolas_Velvet_Hammer_Mockup_Red.pdf:
  // "it asks me what this file is and I say mockup. And then it goes, well, I don't have the art then. A lot of times
  // this is all you're going to have. And you can easily use the mockup helper to pull the art")
  const [pulls, setPulls] = useState<Record<string, { busy: boolean; from: string; how?: Pulled["kind"]; pieces: { pc: ArtPiece; url: string }[]; sheet?: Partial<Record<string, SheetSpec>> }>>({});
  // our own FBS mockup sheet among the old job's files (the blank template, filled in: "Front Imprint · SIZE: W 3" ·
  // COLORS 1. PMS 534C…"): read for its writing as soon as it's open; null = not one of ours
  const [sheets, setSheets] = useState<Record<string, Partial<Record<string, SheetSpec>> | null | "reading">>({});
  // the old job's paperwork set to Not needed by itself (its PO, its work order)
  const autoNone = useRef(new Set<string>());
  const [films, setFilms] = useState<null | { busy?: boolean; note?: string; list: { id: string; name: string }[] }>(null);
  // what each file is: a print's key, "mockup" or "none"; and whether its background comes off
  const [as, setAs] = useState<Record<string, string>>({});
  const [bgOff, setBgOff] = useState<Record<string, boolean>>({});
  const [elseOpen, setElseOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false), [prodNote, setProdNote] = useState("");
  const [say, setSay] = useState(""), [thinking, setThinking] = useState(false), [aiSaid, setAiSaid] = useState("");
  const upRef = useRef<HTMLInputElement | null>(null);
  // art already pulled for a print: shown as its own card, already given to that print
  const [kept, setKept] = useState<Record<string, string>>({});
  const [place, setPlace] = useState<Record<string, { location: string; size: string }>>(() => Object.fromEntries(help.prints.map((p) => [p.key, { location: p.location, size: p.size }])));
  useEffect(() => {
    const ds = help.prints.filter((p) => p.design);
    if (!ds.length) return;
    setAs((a) => ({ ...Object.fromEntries(ds.map((p) => [`K${p.key}`, p.key])), ...a }));
    let live = true;
    (async () => {
      const sb = createClient();
      const { data } = await sb.from("designs").select("id, preview_path, file_path").in("id", ds.map((p) => p.design!));
      const paths = (data || []).map((x) => ({ id: x.id as string, p: (x.preview_path || x.file_path) as string })).filter((x) => x.p);
      const { data: sg } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths.map((x) => x.p), 1800) : { data: [] };
      if (live) setKept(Object.fromEntries(paths.map((x, i) => [x.id, sg?.[i]?.signedUrl || ""])));
    })();
    return () => { live = false; };
  }, [help]);

  useEffect(() => {
    let live = true;
    (async () => {
      const j = await fetch(`/api/art/candidates?${new URLSearchParams({ customer: help.customerId, q: help.job, archived: help.archivedId })}`).then((x) => x.json()).catch(() => ({})) as { found?: Found[]; old?: Old[] };
      if (!live) return;
      // the old job's files (from Printavo); the files the reorder had in hand when there's no list
      let olds: Old[] = j.old || [];
      if (!olds.length && help.files.length) {
        const { data } = await createClient().storage.from("proofs").createSignedUrls(help.files.map((f) => f.path), 1800);
        olds = help.files.map((f, i) => ({ name: realName(f.name, f.path), path: f.path, url: data?.[i]?.signedUrl || "", type: /\.pdf$/i.test(f.path) ? "application/pdf" : "image" })).filter((x) => x.url);
      }
      if (!live) return;
      // never Printavo's stand-in icon for a file it couldn't show (ico-document.png): it isn't one of the job's files
      olds = olds.filter((o) => !/(^|[-/])i?co-document-[0-9a-f]{16,}/i.test(`${o.name} ${o.path}`));
      setOld(olds); setFound(j.found || []);
      if (!olds.length) setElseOpen(true);
      for (const [k, f] of olds.entries()) {
        // a file that never finishes opening (a stuck PDF) can't hold up the rest: 25 seconds, then it's shown as a plain file
        // (Oct 24, Nick: #34298 sat on "Opening the old job's files…")
        const d = await Promise.race([drawFile(f.url, f.name, f.type).catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), 25000))]);
        if (!live) return;
        setOld((x) => (x ? x.map((y, yi) => (yi === k ? { ...y, d } : y)) : x));
      }
      for (const [k, f] of (j.found || []).entries()) {
        if (!f.url || f.source === "library") continue;
        // a supplier's order confirmation (S&S, SanMar) in their emails: never art, so it isn't offered here either
        // (Oct 24, Nick: "teach it to not look for these also in this section")
        if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          const t = await fetch(f.url).then((r) => r.arrayBuffer()).then((b) => pdfText(b, 2)).catch(() => "");
          if (!live) return;
          if (supplierPaper(t)) { setFound((x) => (x ? x.map((y, yi) => (yi === k ? { ...y, hide: true } : y)) : x)); continue; }
        }
        const d = await drawFile(f.url, f.name, f.type).catch(() => null);
        if (!live) return;
        setFound((x) => (x ? x.map((y, yi) => (yi === k ? { ...y, d } : y)) : x));
      }
    })();
    return () => { live = false; };
  }, [help]);

  const fromDrawn = (d: Drawn | null | undefined, name: string, bg: boolean, label: string): HelpPick | null => {
    if (!d) return null;
    const b = bg && d.cut ? d.cut : d.asIs;
    if (b) return { kind: "file", file: png(b, name), name: label };
    return d.raw instanceof File ? { kind: "upload", file: d.raw } : null;
  };
  // the old job's paperwork left out by itself (its PO, work order, a supplier's blank order) isn't stepped through
  const leftOut = (old || []).map((f, i) => ({ f, k: `O${i}` })).filter(({ k }) => as[k] === "none" && autoNone.current.has(k));
  const items: Item[] = [
    ...help.prints.filter((p) => p.design).map((p) => ({ key: `K${p.key}`, where: "kept" as const, only: p.key, tag: `Pulled for the ${p.label}`, name: "Art pulled from the old job", cutUrl: kept[p.design!] || "", asIsUrl: kept[p.design!] || "", canCut: false, ready: true, pick: () => ({ kind: "keep" as const }) })),
    ...(old || []).map((f, i) => ({ f, i })).filter(({ i }) => !leftOut.some((x) => x.k === `O${i}`)).map(({ f, i }) => ({ key: `O${i}`, open: f.url, where: "old" as const, path: f.path, hint: hintOf(f.name), tag: f.name, name: f.name, cutUrl: f.d?.cutUrl || "", asIsUrl: f.d?.asIsUrl || "", canCut: !!f.d?.cut, ready: f.d !== undefined, pick: (bg: boolean) => fromDrawn(f.d, f.name, bg, `${f.name} on ${help.job}`) })),
    ...Object.entries(pulls).filter(([k]) => as[k] === "mockup").flatMap(([k, pu]) => pu.pieces.map((x, n) => ({ key: `P${k}:${n}`, where: "pulled" as const, tag: `Pulled off ${pu.from} · ${x.pc.side === "back" ? "Back" : "Front"}, ${x.pc.widthIn}" × ${x.pc.heightIn}"`, name: `${pu.from} ${x.pc.side} art`, cutUrl: x.url, asIsUrl: x.url, canCut: false, ready: true,
      pick: () => ({ kind: "file" as const, file: x.pc.file, name: `the art pulled off ${pu.from}`, pc: x.pc, from: pu.from, how: pu.how, ...(pu.sheet?.[x.pc.side] ? { sheet: pu.sheet[x.pc.side] } : {}) }) }))),
    ...ups.map((u, i) => ({ key: `U${i}`, where: "else" as const, tag: `Uploaded · ${u.file.name}`, name: u.file.name, cutUrl: u.url, asIsUrl: u.url, canCut: false, ready: true, pick: () => ({ kind: "upload" as const, file: u.file }) })),
    ...pieces.map((p, i) => ({ key: `M${i}`, where: "else" as const, tag: `Film · ${p.size}`, name: p.name, cutUrl: p.url, asIsUrl: p.url, canCut: false, ready: true, pick: () => ({ kind: "file" as const, file: p.file, name: `the film ${p.name}` }) })),
    ...(found || []).map((f, i) => ({ f, i })).filter(({ f, i }) => !f.hide && !(found || []).some((g, gi) => gi < i && !g.hide && g.name === f.name && g.source === f.source)).map(({ f, i }) => ({ key: `E${i}`, where: "else" as const, tag: f.source === "library" ? `Their logo · ${f.name}` : `Email ${f.date.slice(0, 7)} · ${f.name}`, title: `${f.label} · ${f.date}`, name: f.name,
      cutUrl: f.source === "library" ? f.url || "" : f.d?.cutUrl || "", asIsUrl: f.source === "library" ? f.url || "" : f.d?.asIsUrl || "", canCut: !!f.d?.cut, ready: f.source === "library" || f.d !== undefined,
      pick: (bg: boolean) => (f.source === "library" && f.design_id ? { kind: "design" as const, id: f.design_id, name: f.name } : fromDrawn(f.d, f.name, bg, `${f.name} (${f.label}, ${f.date})`)) })),
  ];
  // one file per print: giving a print to a file takes it off the one that had it
  // one file at a time, 1 of N, back and forth (Oct 20, Nick: "we may reorder something and I don't remember
  // everything about this job… click through all the different arts")
  /** files from "Not here?" brought up into the files above, to be told what they are there (Oct 24, Nick: "just click it and say, bring it in. And then it'll ask you above") */
  const [brought, setBrought] = useState<string[]>([]);
  const [at, setAt] = useState(0);
  // two steps (Oct 20, Nick: "ask at the end once you know everything… then click to the next screen"): what the files
  // are, then how it printed and the mockup
  const [stage, setStage] = useState<"files" | "details">("files");
  // which items a file is the art for (Nick: "ask me if this is the front on all items or a specific item"): none = all
  // (less what other files took)
  const [lineSel, setLineSel] = useState<Record<string, string[]>>({});
  // per location with a multi-color screen print: were the old job's screens counting an underbase?
  // what you know about each print location (an old Printavo job): colors and underbase, or "don't know", and the width
  const knowLocs = !help.archivedId ? [] : [...new Map(help.prints.filter((p) => (p.method || "screen") === "screen").map((p) => [p.location, p])).values()];
  const [know, setKnow] = useState<Record<string, { colors: number; ub: boolean } | null>>({});
  const [mode, setMode] = useState<"visual" | "details">("visual");
  const [sizeKnown, setSizeKnown] = useState<Record<string, boolean>>({});
  const [spotOpen, setSpotOpen] = useState("");
  // a production file's label: barcodes, film, mailing list… (lib/productionFileKinds.ts)
  const [kindOf, setKindOf] = useState<Record<string, string>>({});
  const [noteOf, setNoteOf] = useState<Record<string, string>>({});
  // what the AI sees in each old file (a barcode sheet, the art on a background…), for you to confirm
  const [aiG, setAiG] = useState<Record<string, { kind: string; why: string }>>({});
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !old?.length) return;
    asked.current = true;
    void fetch("/api/production/guess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: old.map((f) => ({ path: f.path, name: f.name })) }) }).then((r) => r.json()).then((j: { guesses?: Record<string, { kind: string; why: string }> }) => {
      const g = j.guesses || {};
      setAiG(g);
      // the AI sees a supplier's blank order (an S&S order confirmation under any file name): left out, not asked
      (old || []).forEach((f, i) => { if (g[f.path]?.kind === "supplier_order") { const k = `O${i}`; autoNone.current.add(k); setAs((a) => (a[k] ? a : { ...a, [k]: "none" })); } });
    }).catch(() => null);
  }, [old]);
  const aiKind = (path?: string) => { const g = path ? aiG[path] : undefined; return g && g.kind !== "?" ? g.kind : ""; };
  // no jumping ahead by itself (Oct 20, Nick: "when I clicked production file it immediately took me to the next
  // screen… we need a Next file button on the bottom right"): a label and a note get typed after the answer
  const answer = (key: string, v: string) => assign(key, v);
  // "Full Front, all styles" (Oct 20, Nick: "if you have just one artwork and multiple lines and products in Printavo,
  // that's going to be the same art for all the products… unless you had individual arts for each line"): one answer
  // gives a file to every print at that location ("loc:<location>"); a style's own answer still wins for that style
  const isPrintVal = (v: string) => v.startsWith("loc:") || v.startsWith("new:") || help.prints.some((p) => p.key === v);
  const printsOf = (v: string) => (v.startsWith("loc:") ? help.prints.filter((p) => p.location === v.slice(4)) : help.prints.filter((p) => p.key === v));
  const locs = [...new Set(help.prints.filter((p) => !p.design).map((p) => p.location))];
  const assign = (key: string, v: string) => {
    const off = as[key] === v;
    // a second file for the same print spot: it's for some of the items (picked next), the first keeps the rest
    if (!off && v.startsWith("loc:") && Object.entries(as).some(([k, x]) => k !== key && x === v)) setLineSel((s0) => ({ ...s0, [key]: [] }));
    else setLineSel((s0) => { const y = { ...s0 }; delete y[key]; return y; });
    setAs((a) => {
      const n: Record<string, string> = {};
      const mine = isPrintVal(v) && !v.startsWith("loc:") ? new Set([v]) : new Set<string>();
      for (const [k, x] of Object.entries(a)) if (!(k !== key && mine.has(x))) n[k] = x;
      if (off) delete n[key]; else n[key] = v;
      return n;
    });
  };
  /** the lines at a print spot, and the ones a file is the art for there */
  const linesAt = (loc: string) => { const gis = new Set(help.prints.filter((p) => p.location === loc).map((p) => +p.key.split(":")[0])); return help.lines.filter((l) => gis.has(l.gi)); };
  const effLines = (key: string, loc: string) => {
    const at0 = linesAt(loc).map((l) => l.id);
    if (lineSel[key]) return lineSel[key].filter((x) => at0.includes(x));
    const taken = new Set(Object.entries(lineSel).filter(([k]) => k !== key && as[k] === `loc:${loc}`).flatMap(([, ids]) => ids));
    return at0.filter((x) => !taken.has(x));
  };
  const toggleLine = (key: string, loc: string, id: string) => setLineSel((s0) => {
    const mine = s0[key] ?? effLines(key, loc), on = mine.includes(id);
    const y: Record<string, string[]> = {};
    for (const [k, ids] of Object.entries(s0)) if (k !== key) y[k] = on ? ids : ids.filter((x) => x !== id);
    y[key] = on ? mine.filter((x) => x !== id) : [...mine, id];
    return y;
  });
  useEffect(() => {
    for (const [i, f] of (old || []).entries()) {
      const k = `O${i}`;
      // marked Mockup, or not answered yet and it looks like one (by its name, or what the AI sees in it): a PDF with
      // the art still in it (vector, ready to go) is found here and marked Mockup for you; a flat one gets nothing off it
      // wait until the file has been read for our sheet's writing
      if (sheets[k] === undefined || sheets[k] === "reading") continue;
      const sh = sheets[k] as Partial<Record<string, SheetSpec>> | null;
      const looks = (!as[k] || as[k] === "mockup") && (!!sh || (!as[k] && (mockupNamed(f.name) || /mock/i.test(aiG[f.path]?.kind || ""))));
      if ((as[k] !== "mockup" && !looks) || pulls[k] || !f.d?.raw || !pdfLike({ name: f.name, type: f.d.raw.type })) continue;
      const raw = f.d.raw instanceof File ? f.d.raw : new File([f.d.raw], f.name, { type: f.d.raw.type || "application/pdf" });
      setPulls((x) => ({ ...x, [k]: { busy: true, from: f.name, pieces: [] } }));
      void pullOffMockup(raw, f.name, { drawn: true }).catch(() => null).then((got) => {
        // on our sheet, small bits count too (a 3" × 0.7" left chest): the sheet says where its prints are
        const pieces = (got?.pieces || []).filter((pc) => (sh ? !!sh[pc.side] : pc.widthIn * pc.heightIn >= 1)).map((pc) => ({ pc, url: URL.createObjectURL(pc.file) }));
        setPulls((x) => ({ ...x, [k]: { busy: false, from: f.name, how: got?.kind, pieces, ...(sh ? { sheet: sh } : {}) } }));
        // each piece to the print on its side that has no art yet (the biggest piece first)
        if (!pieces.length) return;
        setAs((a) => {
          if (a[k] && a[k] !== "mockup") return a;
          const n: Record<string, string> = { ...a, [k]: "mockup" }, covered = new Set(Object.values(a).filter((v) => v.startsWith("loc:")).map((v) => v.slice(4)));
          for (const pk of Object.values(a)) { const pr = help.prints.find((q) => q.key === pk); if (pr) covered.add(pr.location); }
          const order = pieces.map((x, m) => ({ x, m })).sort((p1, p2) => p2.x.pc.widthIn * p2.x.pc.heightIn - p1.x.pc.widthIn * p1.x.pc.heightIn);
          for (const { x, m } of order) {
            const back = x.pc.side === "back", open = locs.filter((l) => !covered.has(l));
            const loc = open.find((l) => /back|yoke|shoulder|nape/i.test(l) === back);
            if (!loc) continue;
            n[`P${k}:${m}`] = `loc:${loc}`; covered.add(loc);
          }
          return n;
        });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [as, old, aiG, sheets]);
  useEffect(() => {
    for (const [i, f] of (old || []).entries()) {
      const k = `O${i}`;
      if (k in sheets || f.d === undefined) continue;
      // the old job's purchase order and work order: the customer's new ones replace them (Oct 23, Nick: "you've got to
      // ignore that old purchase order by default. The new one overrides it")
      // "Same thing with the work order too": both are replaced by the new ones on this email or job
      if (/purchase[\s_-]*order|work[\s_-]*order|(^|[^a-z])[pw]\.?o\.?[\s_#-]*\d/i.test(f.name)) { autoNone.current.add(k); setAs((a) => (a[k] ? a : { ...a, [k]: "none" })); }
      // a supplier's order for the blanks (S&S, SanMar order confirmation): made for that old job, never needed again
      // (Oct 24, Nick: "learn to ignore these on previous orders… those are manufactured")
      if (/order[\s_-]*confirm|ss[\s_-]*activewear|s&s[\s_-]*(order|invoice)|sanmar[\s_-]*(order|invoice)/i.test(f.name)) { autoNone.current.add(k); setAs((a) => (a[k] ? a : { ...a, [k]: "none" })); }
      if (!f.d?.raw || !pdfLike({ name: f.name, type: f.d.raw.type })) { setSheets((x) => ({ ...x, [k]: null })); continue; }
      // a supplier's blank order (S&S / SanMar order confirmation), read from the PDF's own words: left out, never asked
      // (Oct 24, Nick: "it's still asking me… I told it to ignore these in reorders")
      void f.d.raw.arrayBuffer().then((b) => pdfText(b, 2)).then((t) => {
        if (supplierPaper(t)) { autoNone.current.add(k); setAs((a) => (a[k] && a[k] !== "none" ? a : { ...a, [k]: "none" })); }
      }).catch(() => null);
      setSheets((x) => ({ ...x, [k]: "reading" }));
      void f.d.raw.arrayBuffer().then((b) => sizesOnSheet(b)).then((r) => { const has = Object.keys(r).length > 0; setSheets((x) => ({ ...x, [k]: has ? r : null })); if (has) setAs((a) => (a[k] ? a : { ...a, [k]: "mockup" })); }).catch(() => setSheets((x) => ({ ...x, [k]: null })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [old]);
  const artOf = (pk: string) => { const p = help.prints.find((x) => x.key === pk); return items.find((it) => as[it.key] === pk) || (p ? items.find((it) => as[it.key] === `loc:${p.location}`) : undefined); };
  const given = help.prints.filter((p) => artOf(p.key));
  const olds0 = items.filter((x) => x.where === "old");
  const filesLeft = olds0.filter((x) => !as[x.key]).length, knowLeft = knowLocs.filter((p) => !(p.location in know)).length;
  const unanswered = filesLeft + knowLeft;
  // our sheet covers every print: nothing to ask, it's done here (Oct 23, Nick on HALFF #32997: "once you see this file,
  // you're good… I've got all the color information, all that stuff"): the other files are kept as production files,
  // how it printed comes off the sheet, and the check at the end shows it all
  // (Oct 23, Nick: "I think it's still okay to ask me… say, hey, I'm good to go. I've got all this stuff… 3x0.7 using
  // these PMSs. Good to go"): said in one short card, one click
  const [autoFinish, setAutoFinish] = useState(false), [sheetOff, setSheetOff] = useState(false);
  const sheetKeys = Object.entries(sheets).filter(([, v]) => v && v !== "reading").map(([k]) => k);
  const sheetReady = !sheetOff && !!old && help.prints.length > 0 && !old.some((f) => f.d === undefined) && sheetKeys.length > 0
    && !(old || []).some((_, i) => sheets[`O${i}`] === undefined || sheets[`O${i}`] === "reading")
    && sheetKeys.every((k) => pulls[k] && !pulls[k].busy) && given.length === help.prints.length;
  const goodToGo = () => {
    const keys = sheetKeys;
    setAs((a) => { const n = { ...a }; for (const it of items.filter((x) => x.where === "old")) if (!n[it.key]) n[it.key] = "production"; return n; });
    setKnow((k0) => {
      const n = { ...k0 };
      for (const p of knowLocs) {
        const sd = /sleeve/i.test(p.location) ? (/left/i.test(p.location) ? "left sleeve" : "right sleeve") : /back|yoke|shoulder|nape/i.test(p.location) ? "back" : "front";
        const spec = keys.map((k) => (sheets[k] as Partial<Record<string, SheetSpec>>)[sd]).find(Boolean);
        // the sheet's inks go on the print with its art (not as "you said": #40119 read "You said: printed 2 colors, no
        // underbase" when nobody said it); the underbase is decided later from the paperwork's color count
        n[p.location] = spec?.inks?.length ? null : n[p.location] ?? null;
      }
      return n;
    });
    setMode("details");
    setAutoFinish(true);
  };
  useEffect(() => { if (autoFinish) finish("skip"); }, [autoFinish]); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = async (rest: "skip" | "production") => {
    const out: Record<string, HelpPick> = {}, once = new Map<string, HelpPick | null>(), splits: NonNullable<HelpAns["splits"]> = [];
    const pickOf = (it: Item) => { if (!once.has(it.key)) once.set(it.key, it.pick(!!bgOff[it.key])); return once.get(it.key) || null; };
    for (const p of help.prints) {
      const own = items.find((it) => as[it.key] === p.key);
      const gl = help.lines.filter((l) => l.gi === +p.key.split(":")[0]).map((l) => l.id);
      // the files for this spot, each with the lines it's the art for: the biggest share is this print's art, the rest
      // become groups of their own
      const ents = own ? [{ it: own, ids: gl }] : items.filter((it) => as[it.key] === `loc:${p.location}`).map((it) => ({ it, ids: effLines(it.key, p.location).filter((x) => gl.includes(x)) })).filter((e) => e.ids.length).sort((a, b) => b.ids.length - a.ids.length);
      const main = ents[0];
      out[p.key] = (main && pickOf(main.it)) || (rest === "production" ? { kind: "production", note: prodNote.trim() } : { kind: "skip" });
      for (const e of ents.slice(1)) { const pk = pickOf(e.it); if (pk) splits.push({ pk: p.key, lineIds: e.ids, pick: pk }); }
    }
    // the old job's files for the new order's Production files: art, mockups and production files (one not answered
    // stays in, as before); "Not needed" ones out
    const files = old === null ? null : olds0.filter((x) => as[x.key] !== "none").map((x) => {
      const role = (as[x.key] === "mockup" ? "mockup" : as[x.key] === "production" || !as[x.key] ? "production" : "art") as "art" | "mockup" | "production";
      return { path: x.path!, name: x.name, role, kind: role === "mockup" ? "old_mockup" : role === "art" ? "print_art" : kindOf[x.key] ?? (aiKind(x.path) || guessProdKind(x.name)), note: (noteOf[x.key] || "").trim() };
    });
    // art for a spot the old job didn't print: a new print with it
    const adds = items.filter((it) => (as[it.key] || "").startsWith("new:")).map((it) => ({ location: as[it.key].slice(4), pick: pickOf(it) })).filter((a): a is { location: string; pick: HelpPick } => !!a.pick);
    // files brought in from "Not here?" marked Customer mockup or Production file: saved with the order's files too
    // (Oct 24, Nick: "I want to like set this as a customer mockup")
    if (files) for (const it of items.filter((x) => brought.includes(x.key) && (as[x.key] === "mockup" || as[x.key] === "production"))) {
      const pk = pickOf(it), f = pk && "file" in pk ? (pk as { file: File }).file : null;
      if (!f) continue;
      const path = `reorder-files/${uid()}/${(f.name || it.name).replace(/[^\w.\-]+/g, "_").slice(-100)}`;
      const up = await createClient().storage.from("proofs").upload(path, f, { contentType: f.type || undefined }).catch(() => ({ error: true }));
      if (up && !("error" in up && up.error)) files.push({ path, name: it.name, role: as[it.key] as "mockup" | "production", kind: as[it.key] === "mockup" ? "customer_mockup" : kindOf[it.key] ?? guessProdKind(it.name), note: (noteOf[it.key] || "").trim() });
    }
    help.resolve({ adds, picks: out, splits, know, mode: help.archivedId ? mode : undefined, place, files, skipped: olds0.filter((x) => as[x.key] === "none").length });
  };
  async function searchFilm(q: string) {
    setElseOpen(true); setFilms({ busy: true, list: [] });
    const j = await fetch(`/api/dropbox/film?${new URLSearchParams({ customer: help.customerId, q })}`).then((x) => x.json()).catch(() => null) as { films?: { id: string; name: string }[]; folder?: string | null } | null;
    const list = (j?.films || []).filter((f) => /\.(ai|pdf)$/i.test(f.name)).slice(0, 8);
    setFilms({ list, note: !j ? "Dropbox couldn't be searched." : !j.folder ? "No film folder is linked for this customer (link it on the customer page)." : list.length ? `Film in ${j.folder.replace(/^\/FBS Film Folder\//i, "")}:` : `Nothing in ${j.folder.replace(/^\/FBS Film Folder\//i, "")} matches "${q}".` });
  }
  async function openFilm(f: { id: string; name: string }) {
    setFilms((x) => (x ? { ...x, busy: true } : x));
    const c = await fetch("/api/dropbox/film", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }) }).then((z) => z.json()).catch(() => null) as { url?: string } | null;
    let got: { name: string; file: File; url: string; size: string }[] = [];
    try { if (c?.url) got = (await measureFilm(await (await fetch(c.url)).arrayBuffer(), true, f.name)).filter((p) => p.file).map((p) => ({ name: f.name, file: p.file!, url: URL.createObjectURL(p.file!), size: `${p.widthIn}" × ${p.heightIn}"` })); } catch { /* not readable */ }
    setPieces((x) => [...x, ...got]);
    setFilms((x) => (x ? { ...x, busy: false, note: got.length ? `Added the art from ${f.name} below.` : `${f.name} couldn't be read (save it PDF-compatible in Illustrator).` } : x));
  }
  async function askAi(text: string) {
    setSay(""); setThinking(true);
    const r = await fetch("/api/art/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: help.customerId, job: help.job, print: help.prints.map((p) => p.label).join(", "), files: (old || []).map((f) => ({ name: f.name, path: f.path })), messages: [{ role: "staff", text }] }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the AI." }));
    setThinking(false); setAiSaid(r.error || r.reply || "…");
  }

  const Card = (it: Item) => {
    const v = as[it.key] || "", bg = !!bgOff[it.key], pic = bg && it.canCut ? it.cutUrl : it.asIsUrl || it.cutUrl;
    const isArt = isPrintVal(v);
    const perStyle = !!v && !v.startsWith("loc:") && isArt;
    return (
      <div key={it.key} className={"arc-card" + (isArt ? " art" : v ? " set" : "")}>
        <span className={"arc-pic" + (bg && it.canCut ? " clear" : "")}>{pic ? <img src={pic} alt="" /> : <span className="faint">{it.ready ? (it.name.split(".").pop() || "file").toUpperCase() : "Opening…"}</span>}</span>
        <span className="arc-name" title={it.title || it.name}>{it.tag}{it.open && <> · <a href={it.open} target="_blank" rel="noreferrer">Open full size</a></>}</span>
        <div className="arc-chips" role="radiogroup" aria-label={`What ${it.name} is`}>
          {!it.only && locs.map((l) => { const n = help.prints.filter((p) => p.location === l && !p.design).length; return <button key={l} type="button" role="radio" aria-checked={v === `loc:${l}`} className={"chip" + (v === `loc:${l}` ? " on" : "")} disabled={!it.ready} onClick={() => answer(it.key, `loc:${l}`)}>{n > 1 ? `${l}, all styles` : `${l} art`}</button>; })}
          {help.prints.filter((p) => (it.only ? p.key === it.only : perStyle && help.prints.filter((q) => q.location === p.location && !q.design).length > 1)).map((p) => <button key={p.key} type="button" role="radio" aria-checked={v === p.key} className={"chip" + (v === p.key ? " on" : "")} disabled={!it.ready} onClick={() => answer(it.key, p.key)}>{it.only ? `Use for the ${p.label}` : `Only ${p.label}`}</button>)}
          {!it.only && (() => {
            const other = (help.spots || LOCATIONS).filter((l) => !locs.includes(l) && !help.prints.some((p) => p.location === l));
            const nv = v.startsWith("new:") ? v.slice(4) : "";
            return <select className={"chip arc-spot" + (nv ? " on" : "")} aria-label="Art for another spot" value={nv} disabled={!it.ready} onChange={(e) => { if (e.target.value) answer(it.key, `new:${e.target.value}`); else if (nv) answer(it.key, v); }}>
              <option value="">{nv ? "" : "Art for another spot…"}</option>
              {other.map((l) => <option key={l} value={l}>{l} art</option>)}
            </select>;
          })()}
          {(it.where === "old" || brought.includes(it.key)) && <button type="button" role="radio" aria-checked={v === "mockup"} className={"chip" + (v === "mockup" ? " on" : "")} onClick={() => answer(it.key, "mockup")}>{brought.includes(it.key) ? "Customer mockup" : "Mockup"}</button>}
          {(it.where === "old" || brought.includes(it.key)) && <button type="button" role="radio" aria-checked={v === "production"} className={"chip" + (v === "production" ? " on" : "")} onClick={() => answer(it.key, "production")} title="Goes in this order's Production files (barcodes, labels, film, separations…)">Production file</button>}
          {!it.only && <button type="button" role="radio" aria-checked={v === "none"} className={"chip" + (v === "none" ? " on" : "")} onClick={() => answer(it.key, "none")}>Not needed</button>}
        </div>
        {v.startsWith("loc:") && linesAt(v.slice(4)).length > 1 && (() => {
          const loc = v.slice(4), all0 = linesAt(loc), mine = effLines(it.key, loc), some = !!lineSel[it.key];
          return (
            <div className="arc-items">
              <span className="arc-items-q">The {loc} on:</span>
              <span className="arc-chips">
                <button type="button" className={"chip" + (!some ? " on" : "")} onClick={() => setLineSel((s0) => { const y = { ...s0 }; delete y[it.key]; return y; })}>All items</button>
                <button type="button" className={"chip" + (some ? " on" : "")} onClick={() => setLineSel((s0) => ({ ...s0, [it.key]: effLines(it.key, loc) }))}>Only some</button>
              </span>
              {some && <span className="arc-lines">{all0.map((l) => <label key={l.id} className="check"><input type="checkbox" checked={mine.includes(l.id)} onChange={() => toggleLine(it.key, loc, l.id)} /> {l.label}</label>)}</span>}
            </div>
          );
        })()}
        {!v && pulls[it.key]?.busy ? <span className="arc-hint">Looks like a mockup: checking it with the Mockup Helper…</span> : !v && (it.path && aiG[it.path]?.kind && aiG[it.path].kind !== "?" ? <span className="arc-hint">I think: <b>{prodKindLabel(aiG[it.path].kind)}</b>{aiG[it.path].why ? ` (${aiG[it.path].why})` : ""}. Right?</span> : it.hint ? <span className="arc-hint">{it.hint}?</span> : it.where === "old" && it.path && !aiG[it.path] ? <span className="arc-hint">Looking at it…</span> : null)}
        {it.where === "old" && v === "production" && (
          <label className="arc-kind">What it is
            <select value={kindOf[it.key] ?? (aiKind(it.path) || guessProdKind(it.name))} onChange={(e) => setKindOf((x) => ({ ...x, [it.key]: e.target.value }))}>
              <option value="">Not labeled</option>
              {PROD_KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
            </select>
          </label>
        )}
        {it.where === "old" && v && v !== "none" && <input className="arc-note" value={noteOf[it.key] || ""} onChange={(e) => setNoteOf((x) => ({ ...x, [it.key]: e.target.value }))} placeholder={v === "production" ? 'A note, e.g. "Amazon barcodes for The Bottles"' : "A note for production (optional)"} aria-label="Note on this file" />}
        {it.where === "old" && v && v !== "none" && <span className="arc-hint ok">{v === "mockup" ? (() => { const pu = pulls[it.key]; return pu?.busy ? "Kept as the old mockup. Pulling the art off it with the Mockup Helper…" : pu && pu.pieces.length ? `The art is still in this mockup, so the order is made from it: the Mockup Helper pulled ${pu.pieces.map((x) => `the ${x.pc.side} (${x.pc.widthIn}" wide)`).join(" and ")}. Next ›` : pu ? "Kept as the old mockup. The Mockup Helper couldn't find art on a shirt in it: upload the art below, or skip for now" : "Kept in Production files as the old mockup"; })() : v === "production" ? "Goes in this order's Production files" : "The art; the original also goes in Production files"}</span>}

        {isArt && it.canCut && <label className="arc-bg"><input type="checkbox" checked={bg} onChange={(e) => setBgOff((b) => ({ ...b, [it.key]: e.target.checked }))} /> Remove background</label>}
      </div>
    );
  };
  const olds = [...items.filter((x) => x.where === "old" || x.where === "kept" || x.where === "pulled"), ...brought.map((k) => items.find((x) => x.key === k)).filter((x): x is Item => !!x)], elses = items.filter((x) => x.where === "else" && !brought.includes(x.key));
  const opening = old === null || (old || []).some((f) => f.d === undefined);
  // our sheet has it all: this screen is only that, one button to go on (Oct 23, Nick: "an account manager is not going to
  // know what to do… do I click good to go or do I click next?"); the file-by-file screen only when they ask for it
  if (sheetReady) {
    const k0 = sheetKeys[0], f0 = (old || [])[+k0.slice(1)];
    const specs = sheetKeys.flatMap((k) => Object.entries(sheets[k] as Partial<Record<string, SheetSpec>>).map(([side, v]) => ({ side, v: v! })));
    const arts = sheetKeys.flatMap((k) => pulls[k]?.pieces || []);
    const skipped = (old || []).map((f, i) => ({ f, k: `O${i}` })).filter(({ k }) => as[k] === "none" && autoNone.current.has(k)).map(({ f }) => f.name);
    // any other file (barcodes, other art…): the only thing asked (Oct 23, Nick: "if you see any other files, that's the
    // only time you should ask. Like, if you see a barcode, what do I do with this barcode?")
    const others = (old || []).map((f, i) => ({ f, k: `O${i}` })).filter(({ k }) => !sheetKeys.includes(k) && !(as[k] === "none" && autoNone.current.has(k)));
    const left = others.filter(({ k }) => !as[k]).length;
    const job = help.job.replace(/^(#\d+).*/, "$1");
    return (
      <div className="ap arc" role="group" aria-label="Our mockup sheet">
        <p className="ap-q">{job} has our FBS mockup sheet. Here&apos;s what I&apos;ll do:</p>
        <ul className="arc-sheet-l">
          {specs.map((x, i) => { const pc = arts.find((a) => a.pc.side === (x.side === "back" ? "back" : "front"))?.pc, w = x.v.w || pc?.widthIn || 0, h = x.v.w ? x.v.h : pc?.heightIn; return <li key={i} data-notranslate>Use its <b>{x.side}</b> art at <b>{w}&quot;{h ? ` × ${h}"` : ""}</b>{!x.v.w && pc ? <span className="faint"> (measured off the sheet)</span> : null}{x.v.inks?.length ? <> in <b>{x.v.inks.map(stockName).join(" and ")}</b></> : null}{x.v.halftones || x.v.ub ? <>, with {[x.v.halftones ? "halftones" : "", x.v.ub ? "a white underbase" : ""].filter(Boolean).join(" and ")}</> : null}{x.v.notes?.length ? <span className="faint"> ({x.v.notes.join("; ")})</span> : null}</li>; })}
          {skipped.length > 0 && <li data-notranslate>Ignore the old {skipped.length === 1 ? "paperwork" : "work order and purchase order"} ({skipped.join(", ")}): the new ones on this job replace {skipped.length === 1 ? "it" : "them"}</li>}
        </ul>
        <div className="arc-sheet">
          <figure><span className="ap-pic big">{f0?.d?.asIsUrl ? <img src={f0.d.asIsUrl} alt="" /> : null}</span><figcaption data-notranslate>Our mockup sheet · {f0?.name}</figcaption></figure>
          {arts.map((x, i) => <figure key={i}><span className="ap-pic big ap-check"><img src={x.url} alt="" /></span><figcaption>The art, pulled off it</figcaption></figure>)}
        </div>
        {others.length > 0 && <div className="arc-others">
          <p className="ap-q">{others.length === 1 ? "There's one more file on it. What do I do with it?" : `There are ${others.length} more files on it. What do I do with them?`}</p>
          {others.map(({ f, k }) => (
            <div key={k} className="arc-other">
              <span className="ap-pic">{f.d?.asIsUrl ? <img src={f.d.asIsUrl} alt="" /> : null}</span>
              <span className="arc-other-n"><span data-notranslate>{f.name}</span>{aiG[f.path]?.kind && aiG[f.path].kind !== "?" ? <span className="faint">Looks like {prodKindLabel(aiG[f.path].kind).toLowerCase()}</span> : null}</span>
              <span className="arc-chips">
                <button type="button" className={"chip" + (as[k] === "production" ? " on" : "")} onClick={() => setAs((a) => ({ ...a, [k]: "production" }))}>Keep in Production files</button>
                <button type="button" className={"chip" + (as[k] === "none" ? " on" : "")} onClick={() => setAs((a) => ({ ...a, [k]: "none" }))}>Not needed</button>
              </span>
            </div>
          ))}
        </div>}
        <div className="ap-foot">
          <span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel reorder</button><button type="button" className="ap-link" onClick={() => setSheetOff(true)}>Something&apos;s wrong: go through the files myself</button></span>
          <button type="button" className="btn primary" disabled={left > 0} onClick={goodToGo}>{left > 0 ? `Say what ${left === 1 ? "the other file is" : `the ${left} other files are`}` : "Go ahead ›"}</button>
        </div>
      </div>
    );
  }
  const need = locs.map((l) => { const ps = help.prints.filter((p) => p.location === l && !p.design); return `${l}${ps.length > 1 ? ` (${ps.length} styles)` : ""}${ps[0]?.colors > 1 ? `, ${ps[0].colors} colors` : ""}`; }).join("; ");
  return (
    <div className="ap arc" role="group" aria-label="What are these files">
      {help.settled?.length ? <p className="ap-q">You&apos;re using the email&apos;s art for {help.settled.join(", ")}. {olds0.length === 1 ? "This file is" : `These ${olds0.length} files are`} on {help.job} too: keep any you still need?</p> : null}
      {!help.settled?.length && <p className="ap-q">{stage === "details" ? <>How did {help.job.replace(/^(#\d+).*/, "$1")} print?</> : old === null ? `Opening ${help.job}…` : olds0.length ? `I found ${olds0.length === 1 ? "this file" : `these ${olds0.length} files`} on ${help.job}. What ${olds0.length === 1 ? "is it" : "are they"}?` : `There are no files on ${help.job}. Where's the art?`}{help.jobUrl && <> <a className="arc-job" href={help.jobUrl} target="_blank" rel="noreferrer">View {help.job.replace(/^(#\d+).*/, "$1")} ↗</a></>}</p>}
      <p className="ap-why">{help.settled?.length ? "Barcodes, labels, packing sheets…: mark them Production file and they go with this order. The old art they replaced: Not needed (or Production file to keep it for reference)." : stage === "details" ? "Tell me what you know. Leave it on \"Don't know\" when you're not sure." : <>Say what each one is: the art (and which items it&apos;s on), a mockup, a production file, or not needed. Next, how it printed.</>}</p>
      {leftOut.length > 0 && stage !== "details" && <p className="ap-why ap-left" data-notranslate>Left out: {leftOut.map(({ f }) => f.name).join(", ")} (the old job&apos;s paperwork: blank orders, PO, work order).</p>}
      {stage === "details" && (() => {
        const spots = [...new Map(help.prints.map((p) => [p.location, p])).values()];
        // one line per question (Oct 20, Nick: "once you click I know, put it on the right instead of below where it
        // moves everything"): the question, Don't know / I know, and what you know to the right on the same line
        const Seg = ({ on, labels, pick }: { on: 0 | 1 | -1; labels: [string, string]; pick: (i: 0 | 1) => void }) => (
          <span className="arc-seg" role="radiogroup">
            {labels.map((t, i) => <button key={t} type="button" role="radio" aria-checked={on === i} className={on === i ? "on" : ""} onClick={() => pick(i as 0 | 1)}>{t}</button>)}
          </span>
        );
        return (
          <div className="arc-det">
            {help.archivedId && <div className="arc-tip">A reorder and you don&apos;t know the details? Leave everything on <b>Don&apos;t know</b> and make a <b>visual only mockup</b>. Production fills in the colors, size and placement when they print it.</div>}
            {spots.map((p) => {
              const ps = help.prints.filter((q) => q.location === p.location), pl = place[ps[0].key] || { location: p.location, size: "" };
              const setPl = (patch: Partial<{ location: string; size: string }>) => setPlace((x) => { const y = { ...x }; for (const q of ps) y[q.key] = { ...(y[q.key] || { location: q.location, size: q.size }), ...patch }; return y; });
              const dark = ps.some((q) => q.dark), v = know[p.location], set = p.location in know, asks = knowLocs.some((q) => q.location === p.location);
              const sizeOn = sizeKnown[p.location] ?? !!pl.size;
              const moving = spotOpen === p.location;
              return (
                <section key={p.location} className="arc-det-card">
                  <div className="arc-det-h">
                    <b>{pl.location || p.location}</b>
                    {moving
                      ? <select autoFocus value={pl.location || p.location} onChange={(e) => { setPl({ location: e.target.value }); setSpotOpen(""); }} onBlur={() => setSpotOpen("")} aria-label="Where it prints">{(help.spots || LOCATIONS).map((l) => <option key={l} value={l}>{l}</option>)}</select>
                      : <button type="button" className="ap-link arc-spot" onClick={() => setSpotOpen(p.location)}>Change spot</button>}
                  </div>
                  {asks && (
                    <div className="arc-q">
                      <span className="arc-q-l">Colors</span>
                      <Seg on={!set ? -1 : v ? 1 : 0} labels={[`Don't know${p.colors ? ` (old job: ${p.colors})` : ""}`, "I know"]} pick={(i) => setKnow((x) => ({ ...x, [p.location]: i === 0 ? null : x[p.location] || { colors: dark && p.colors > 1 ? p.colors - 1 : p.colors, ub: dark && p.colors > 1 } }))} />
                      <span className="arc-q-k">{v ? <><input type="number" min={1} max={14} value={v.colors} onChange={(e) => setKnow((x) => ({ ...x, [p.location]: { ...v, colors: Math.max(1, +e.target.value || 1) } }))} aria-label="Colors" /> colors <label className="check"><input type="checkbox" checked={v.ub} onChange={(e) => setKnow((x) => ({ ...x, [p.location]: { ...v, ub: e.target.checked } }))} /> + underbase</label><span className="faint">= {v.colors + (v.ub ? 1 : 0)} screens</span></> : set ? <span className="faint">production confirms the colors on the run</span> : null}</span>
                    </div>
                  )}
                  <div className="arc-q">
                    <span className="arc-q-l">Print size</span>
                    <Seg on={sizeOn ? 1 : 0} labels={["Don't know", "I know"]} pick={(i) => { setSizeKnown((x) => ({ ...x, [p.location]: i === 1 })); if (i === 0) setPl({ size: "" }); }} />
                    <span className="arc-q-k">{sizeOn ? <><input type="number" min={1} max={16} step={0.25} value={pl.size || ""} autoFocus onChange={(e) => setPl({ size: e.target.value })} aria-label="Printed width in inches" /> inches wide</> : <span className="faint">production measures it on the run</span>}</span>
                  </div>
                </section>
              );
            })}
            {help.archivedId && (
              <section className="arc-det-card">
                <b className="arc-mk-q">What kind of mockup should we make?</b>
                <div className="arc-mk" role="radiogroup" aria-label="The mockup">
                  <button type="button" role="radio" aria-checked={mode === "visual"} className={"arc-mk-o" + (mode === "visual" ? " on" : "")} onClick={() => setMode("visual")}><b>Visual only mockup</b><span>Just shows the art on the shirts. No colors, sizes or placement. Production fills those in when they print it.</span></button>
                  <button type="button" role="radio" aria-checked={mode === "details"} className={"arc-mk-o" + (mode === "details" ? " on" : "")} onClick={() => setMode("details")}><b>Full mockup</b><span>Colors, size and placement filled in from our best guess. The customer and staff see them.</span></button>
                </div>
              </section>
            )}
          </div>
        );
      })()}
      {stage === "files" && olds.length > 0 && (() => {
        const i = Math.min(at, olds.length - 1), it = olds[i];
        return (
          <div className="arc-step">
            <div className="arc-nav">
              <button type="button" className="arc-arrow" disabled={i === 0} onClick={() => setAt(i - 1)} aria-label="Previous file">‹</button>
              <b>{i + 1} of {olds.length}</b>
              <button type="button" className="arc-arrow" disabled={i === olds.length - 1} onClick={() => setAt(i + 1)} aria-label="Next file">›</button>
              <span className="arc-dots">
                {olds.map((x, k) => {
                  const v = as[x.key] || "", art = isPrintVal(v);
                  return <button key={x.key} type="button" className={"arc-dot" + (k === i ? " on" : "") + (art ? " art" : v ? " set" : "")} onClick={() => setAt(k)} title={`${k + 1}. ${x.name}${v ? `: ${art ? (v.startsWith("loc:") ? `${v.slice(4)}, all styles` : `${help.prints.find((p) => p.key === v)?.label} art`) : v === "none" ? "not needed" : v === "production" ? "production file" : v}` : ": not answered yet"}`} aria-label={`File ${k + 1}`}>{x.asIsUrl || x.cutUrl ? <img src={x.asIsUrl || x.cutUrl} alt="" /> : k + 1}</button>;
                })}
              </span>
            </div>
            <div className="arc-one">{Card(it)}</div>
          </div>
        );
      })()}
      {stage === "files" && opening && <span className="ap-wait">Opening the old job&apos;s files…</span>}
      {stage === "files" && <details className="arc-else" open={elseOpen} onToggle={(e) => setElseOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Not here? Their emails and logos{found ? ` (${elses.filter((x) => x.key.startsWith("E")).length})` : ""}, the film folder, or upload it</summary>
        <div className="arc-tools">
          <label className="ap-link">Upload the art<input ref={upRef} type="file" hidden accept="image/*,application/pdf,.ai,.eps,.svg" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const k = `U${ups.length}`; setUps((x) => [...x, { file: f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : "" }]); const p = help.prints.find((q) => !artOf(q.key)); if (p) assign(k, p.key); e.target.value = ""; }} /></label>
          <button type="button" className="ap-link" disabled={films?.busy} onClick={() => void searchFilm(help.job.replace(/^#\d+\s*/, "").replace(/\s*\(Printavo\)$/, ""))}>Search the film folder</button>
          {films && <span className="faint">{films.busy && !films.list.length ? "Searching the film folder…" : films.note}</span>}
          {films?.list.map((f) => <button key={f.id} type="button" className="ap-link" disabled={films.busy} onClick={() => void openFilm(f)}>{f.name}</button>)}
        </div>
        <div className="arc-grid sm">
          {elses.map((it) => (
            <div key={it.key} className="arc-card arc-bring">
              <span className="arc-pic">{it.asIsUrl || it.cutUrl ? <img src={it.asIsUrl || it.cutUrl} alt="" /> : <span className="faint">{it.ready ? (it.name.split(".").pop() || "file").toUpperCase() : "Opening…"}</span>}</span>
              <span className="arc-name" title={it.title || it.name}>{it.tag}</span>
              <button type="button" className="btn sm" disabled={!it.ready} onClick={() => { setBrought((b) => [...b, it.key]); setAt(olds.length); window.setTimeout(() => document.querySelector(".arc-step")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50); }}>Bring it in</button>
            </div>
          ))}
          {found === null && <span className="ap-wait">Searching their emails and logos…</span>}
          {found !== null && !elses.length && <span className="ap-wait">Nothing in their emails or logos.</span>}
        </div>
        <form className="ap-ask" onSubmit={(e) => { e.preventDefault(); if (say.trim() && !thinking) void askAi(say.trim()); }}>
          <input value={say} onChange={(e) => setSay(e.target.value)} placeholder="Ask the AI about these files" aria-label="Ask the AI about the art" />
        </form>
        {(thinking || aiSaid) && <p className="ap-ai"><span className="ap-ai-i" aria-hidden>✦</span><span>{thinking ? "Looking at the files…" : aiSaid}</span></p>}
      </details>}
      {prodOpen && (
        <form className="ap-ask" onSubmit={(e) => { e.preventDefault(); finish("production"); }}>
          <input autoFocus value={prodNote} onChange={(e) => setProdNote(e.target.value)} placeholder='A note for production, e.g. "on the server under Little Groupies 2023"' aria-label="Note for production" />
          <button type="submit" className="btn sm">Hand it off</button>
        </form>
      )}
      <div className="ap-foot">
        <span className="ap-more">
          <button type="button" className="ap-link ap-cancel" onClick={onCancel} title="Stop: no order, nothing saved">Cancel reorder</button>
          <button type="button" className="ap-link" onClick={() => setProdOpen((x) => !x)}>Hand to production</button>
          <button type="button" className="ap-link" onClick={() => finish("skip")}>Skip for now</button>
        </span>
        {stage === "details" && <button type="button" className="btn ghost" onClick={() => setStage("files")}>‹ Back to the files</button>}
        {stage === "files"
          ? (() => {
            const n = items.filter((x) => x.where === "old" || x.where === "kept" || x.where === "pulled").length, i = Math.min(at, Math.max(0, n - 1));
            if (n > 1 && i < n - 1) return <button type="button" className="btn primary" onClick={() => setAt(i + 1)}>Next file ({i + 2} of {n}) ›</button>;
            if (!help.prints.length) return <button type="button" className="btn primary" disabled={filesLeft > 0} onClick={() => finish("skip")}>{filesLeft > 0 ? `Say what each file is (${filesLeft} left)` : "Done ›"}</button>;
            return <button type="button" className="btn primary" disabled={filesLeft > 0} onClick={() => setStage("details")}>{filesLeft > 0 ? `Say what each file is (${filesLeft} left)` : "Next: how it printed ›"}</button>;
          })()
          : <button type="button" className="btn primary" disabled={knowLeft > 0} onClick={() => finish("skip")}>{knowLeft > 0 ? `Answer the colors (${knowLeft} left)` : !given.length ? "Make it without art for now" : given.length === help.prints.length ? (given.every((p) => as[`K${p.key}`] === p.key) ? "Keep going" : "Make the mockup") : `Keep going (${help.prints.length - given.length} without art)`}</button>}
      </div>
    </div>
  );
}
const realName = (name: string, _path: string) => name.replace(/ mockup(?=\.\w+$)/i, " file");
function trimToArt(c: HTMLCanvasElement) {
  const { width: w, height: h } = c, d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return c;
  const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

/**
 * The art was found, but not on a mockup: which print it is and how big, before the order is made (part of the
 * Printavo Art Resolution Center). "Not this order's art" sends that print to the Resolution Center.
 */
/** the location of a print, by its id */
const y0 = (d: EODraft, id: string) => d.groups.flatMap((g) => g.imprints).find((im) => im.id === id)?.location || "A print";
/** art on a solid box: the box's color, whether it's the shirt's, and the colors left once it's out (the shirt's own color in
 *  the art doesn't print either). Null when the art isn't on a box. */
async function boxOf(path: string, shirt: string): Promise<{ box: { bg: string; bgName: string; sameAsShirt: boolean } | null; inks: { name: string; hex: string }[]; /** the art's height ÷ width */ ratio: number } | null> {
  const url = await picOf({ path });
  if (!url) return null;
  const load = (u: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const img = await load(url);
  // cropped to what's on the page first (a PDF is drawn on white paper): the box, if there is one, is then the edge
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return null;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(img, 0, 0);
  const px = x.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let yy = 0; yy < H; yy += 2) for (let xx = 0; xx < W; xx += 2) { const i = (yy * W + xx) * 4; if (px[i + 3] > 200 && !(px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235)) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; } }
  if (x1 <= x0 || y1 <= y0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, c2 = document.createElement("canvas"); c2.width = cw; c2.height = ch;
  c2.getContext("2d")!.drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
  const cropped = await load(c2.toDataURL("image/png"));
  let k = knockOut(cropped, { keepInside: true });
  // white is the paper, not a box
  if (k?.bg) { const v = parseInt(k.bg.replace("#", ""), 16); if (((v >> 16) & 255) > 235 && ((v >> 8) & 255) > 235 && (v & 255) > 235) k = null; }
  const plan = planPrint(pxOfImage(k?.bg ? await load(k.url) : cropped, 800), { garment: shirt });
  const rgb = (h: string) => { const v = parseInt(h.replace("#", ""), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const near = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 70; };
  // the art's colors that print: not the shirt's own, not the paper (white paper on a white-shirt PDF is left to the Mockup Creator)
  const inks = [...new Map(plan.inks.filter((x) => !near(x.hex, shirt)).map((x) => [x.name, { name: x.name, hex: x.hex }])).values()];
  const ratio = k?.bg && k.w ? k.h / k.w : ch / cw;
  if (!k?.bg) return { box: null, inks, ratio };
  const bg = k.bg.startsWith("#") ? k.bg : `#${k.bg}`;
  return { box: { bg, bgName: inkName(bg), sameAsShirt: near(bg, shirt) }, inks, ratio };
}
/** the shop's usual size for a print with nothing to go on (Oct 23, Nick: "we know a circle is going to be 10. I know a
 *  fullback's probably going to be 11 and a half or 12"); ratio = the art's height ÷ width */
function sizeRule(location: string, ratio?: number): { w: number; why: string } {
  const round = !!ratio && ratio > 0.85 && ratio < 1.18, loc = location.toLowerCase();
  if (/full back/.test(loc)) return round ? { w: 10, why: `A round logo on a full back: usually 10"` } : { w: 12, why: `A full back: usually 11.5–12"` };
  if (/full front/.test(loc)) return round ? { w: 10, why: `A round logo on a full front: usually 10"` } : { w: 11, why: `A full front: usually 11"` };
  if (/left chest|right chest/.test(loc)) return { w: 3.5, why: `A left chest: usually 3.5"` };
  return { w: spotFor(location).defW, why: `Our standard ${location}: ${spotFor(location).defW}"` };
}
/** our stock ink for a name written on a sheet ("Scarlet Red" → Scarlet), else the name as written */
const stockName = (n: string) => {
  // a PMS written any way ("Pms 534c", "PMS534 C", "Pantone 2178"): "PMS 534 C"
  const pms = n.trim().match(/^(?:pms|pantone)\s*#?\s*(\d{3,4})\s*([cu])?$/i);
  if (pms) return `PMS ${pms[1]} ${(pms[2] || "C").toUpperCase()}`;
  if (colorHex(n)) return n;
  const w = n.split(/\s+/);
  for (let i = w.length - 1; i >= 1; i--) { const a = w.slice(0, i).join(" "); if (colorHex(a)) return a; }
  for (let i = 1; i < w.length; i++) { const b = w.slice(i).join(" "); if (colorHex(b)) return b; }
  return n;
};
/** a picture of a file (a page of a PDF or AI file, or a picture) or of a logo on file, for the check */
const picCache = new Map<string, Promise<string>>();
function picOf(o: { path?: string; design?: string; page?: number }): Promise<string> {
  const key = `${o.design || ""}|${o.path || ""}|${o.page || 1}`;
  if (!picCache.has(key)) picCache.set(key, (async () => {
    const sb = createClient();
    let path = o.path || "";
    if (o.design) { const { data } = await sb.from("designs").select("preview_path, file_path").eq("id", o.design).maybeSingle(); path = (data?.preview_path || data?.file_path || "") as string; }
    if (!path) return "";
    const { data: su } = await sb.storage.from("proofs").createSignedUrl(path, 3600);
    const url = su?.signedUrl || "";
    if (!url || !/\.(pdf|ai)$/i.test(path)) return url;
    const buf = await (await fetch(url)).arrayBuffer();
    const c = await pdfPicture(buf, 700, o.page || 1);
    const b = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    return b ? URL.createObjectURL(b) : "";
  })().catch(() => ""));
  return picCache.get(key)!;
}
function Pic({ path, design, page, big }: { path?: string; design?: string; page?: number; big?: boolean }) {
  const [u, setU] = useState<string | null>(null);
  useEffect(() => { let live = true; setU(null); void picOf({ path, design, page }).then((x) => { if (live) setU(x); }); return () => { live = false; }; }, [path, design, page]);
  return <span className={"rv-pic" + (big ? " big" : "")}>{u ? <img src={u} alt="" /> : <span className="faint">{u === null ? "…" : "No picture"}</span>}</span>;
}
const sameName = (a?: string, b?: string) => { const n = (x?: string) => (x || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return !!n(a) && !!n(b) && (n(a) === n(b) || n(a).startsWith(n(b)) || n(b).startsWith(n(a))); };

/** where a print sits, for showing them in order: the front, then the back, then sleeves, then anything else */
const spotRank = (loc: string) => { const i = LOCATIONS.indexOf(loc); return (/sleeve/i.test(loc) ? 2000 : /back|yoke|shoulder|nape/i.test(loc) ? 1000 : 0) + (i < 0 ? 99 : i); };
/** what a file is, the way staff say it */
const fileLabel = (f: { name: string; role: string }) => (/purchase[\s_-]*order|(^|[^a-z])p\.?o\.?[\s_#-]*\d/i.test(f.name) ? "Purchase order" : /work[\s_-]*order/i.test(f.name) ? "Work order" : /invoice/i.test(f.name) ? "Invoice" : f.role === "art" ? "Art" : f.role === "mockup" ? "Mockup" : f.role === "sheet" ? "Size sheet" : "Other");

/**
 * The check before it's made (Oct 23, Nick: "you don't ask until you get to the end and you've read all the data…
 * maybe it would be more visual"; then: "it should say something like, here's the files identified. For variation one,
 * do I use this logo or that logo? For variation two, this logo or that logo?"). The files and what each one is; then
 * each group: its shirts, and for each print the logo it gets, picked from the art files by picture (the one I picked
 * already on). Anything else that doesn't add up is asked on the card it's about.
 */
function ReviewConfirm({ a, onCancel }: { a: ReviewAsk; onCancel: () => void }) {
  const d = a.d;
  const files = d.files.filter((f) => f.role !== "signature");
  const arts = files.filter((f) => f.role === "art");
  // the logo per print: the art file picked for it (or the logo already on it)
  const [art, setArt] = useState<Record<string, string>>(() => Object.fromEntries(d.groups.flatMap((g) => g.imprints.map((im) => [im.id, d.art?.[im.id] || (im.design_id ? `design:${im.design_id}` : "")]))));
  // each print's size and inks (filled with how they were arrived at), and one set of inks per garment group by default
  const [sp, setSp] = useState<Record<string, Spec>>(() => JSON.parse(JSON.stringify(d.specs || {})));
  const [sameInks, setSameInks] = useState<Record<string, boolean>>(() => Object.fromEntries(d.groups.filter((g) => g.imprints.length > 1).map((g) => [g.id, true])));
  const setSize = (id: string, v: number) => setSp((x) => ({ ...x, [id]: { ...x[id], size: v, sizeWhy: "You set it" } }));
  const setInks = (g: Group, id: string, v: string) => setSp((x) => {
    const y = { ...x };
    for (const im of sameInks[g.id] ? g.imprints : g.imprints.filter((q) => q.id === id)) y[im.id] = { ...y[im.id], inks: v, inksWhy: im.id === id ? "You set it" : `Same as the ${g.imprints.find((q) => q.id === id)?.location || "other print"}` };
    return y;
  });
  // a question whose answer is one of the files is the logo picker's job when there's a picker
  const checks = (d.check || []).filter((c) => !(arts.length > 1 && c.choices?.some((x) => x.path)));
  // extras questions carry a No charge box, ticked to start (Oct 23, Nick: "yes, we print them sometimes for clients,
  // but no, we don't charge for them… sometimes people supply extras, those would be printed, we do charge for")
  const [rows, setRows] = useState(checks.map(() => ({ pick: 0, text: "", remember: false, free: true })));
  const set = (i: number, ch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...ch } : x)));
  const groupOf = (about?: string) => (about ? d.groups.findIndex((g) => sameName(g.name, about)) : -1);
  const answerOf = (i: number) => { const r = rows[i], c = checks[i]; if (c.local?.startsWith("xt:") && !r.text.trim()) return `${c.choices?.[r.pick]?.label || "Yes, printed extras"}${r.free ? " · no charge" : " · charged"}`; if (r.text.trim()) return r.text.trim(); if (r.pick > 0 && c.choices?.[r.pick]) { const ch = c.choices[r.pick]; return `${ch.label}${ch.name ? ` (${ch.name})` : ""}`; } return ""; };
  const answered = checks.some((c, i) => !c.local && !!answerOf(i));
  // a plain function, not a component: typing in its box keeps the focus
  const Q = (i: number) => {
    const c = checks[i], r = rows[i], mine = !!answerOf(i);
    return (
      <div key={i} className="rv-q">
        <p className="rv-qq">{c.q}</p>
        <div className="rv-ch" role="radiogroup" aria-label={c.q}>
          {(c.choices?.length ? c.choices : [{ label: c.guess || "My guess" }]).map((ch, k) => (
            <button key={k} type="button" role="radio" aria-checked={r.pick === k && !r.text.trim()} className={"rv-c" + (r.pick === k && !r.text.trim() ? " on" : "")} onClick={() => set(i, { pick: k, text: "" })}>
              <span>{ch.label}{k === 0 ? <i className="faint"> (my guess)</i> : null}</span>
            </button>
          ))}
          {c.local?.startsWith("xt:") && <label className="rv-c rv-chk"><input type="checkbox" checked={r.free} onChange={(e) => set(i, { free: e.target.checked })} /> No charge</label>}
          <input type="text" className="rv-txt" aria-label={`Something else: ${c.q}`} placeholder="Or say what to do…" value={r.text} onChange={(e) => set(i, { text: e.target.value })} />
        </div>
        {mine && !c.local && <label className="qc-rem"><input type="checkbox" checked={r.remember} onChange={(e) => set(i, { remember: e.target.checked })} /> Remember this for {a.customer}</label>}
      </div>
    );
  };
  const loose = checks.map((c, i) => ({ c, i })).filter(({ c }) => groupOf(c.about) < 0);
  const pcs = (g: Group) => g.lines.reduce((n, l) => n + Object.values(l.sizes || {}).reduce((m, v) => m + (+v || 0), 0), 0);
  const nameOf = (v: string) => (v.startsWith("design:") ? "Logo from a past order" : files.find((f) => f.path === v)?.name || "Art");
  return (
    <div className="ap rv" role="group" aria-label="Check the order before it's made">
      <p className="ap-q">Here&apos;s what I found. Check it, then make it.</p>
      {files.length > 0 && <section className="rv-files" aria-label="The files">
        <div className="rv-k">The files</div>
        <div className="rv-fl">{files.map((f) => <figure key={f.path}><Pic path={f.path} /><figcaption><b>{fileLabel(f)}</b><span data-notranslate>{f.name}</span></figcaption></figure>)}</div>
      </section>}
      {loose.length > 0 && <section className="rv-g ask"><div className="rv-h"><b>The whole order</b></div>{loose.map(({ i }) => Q(i))}</section>}
      {d.groups.map((g, gi) => {
        const qs = checks.map((c, i) => ({ c, i })).filter(({ c }) => groupOf(c.about) === gi);
        const gname = g.name || g.lines.map((l) => [l.style, l.color].filter(Boolean).join(" ")).join(", ") || `Group ${gi + 1}`;
        return (
          <section key={g.id} className={"rv-g" + (qs.length ? " ask" : "")}>
            <div className="rv-h"><b data-notranslate>{gname}</b><span className="faint">{pcs(g).toLocaleString("en-US")} pcs</span></div>
            {g.lines.map((l) => (
              <div key={l.id} className="rv-shirt">
                <span className="rv-sw" style={{ background: shirtBg(l.color || "White", guessHex(lineColor(l) || "White")) }} aria-hidden />
                <span data-notranslate><b>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}</b> · {l.color || "no color"}</span>
                <span className="faint" data-notranslate>{Object.entries(l.sizes || {}).filter(([, q]) => +q).sort(([a], [b]) => sizeRank(a) - sizeRank(b)).map(([z, q]) => `${z} ${q}`).join(" · ")}</span>
              </div>
            ))}
            {/* front first, then the back, then sleeves (Oct 23, Nick: "can you do the front first and the back second?") */}
            {[...g.imprints].sort((x, y) => spotRank(x.location) - spotRank(y.location)).map((im) => {
              const cur = art[im.id] || "";
              // art pulled off our own mockup sheet (the files step already said "I'll use its art"): that's the logo, not
              // asked again (Oct 23, Nick: "you already have the mockup. You said, I'm good to go. And then you ask their
              // logo on file, or use the file in the email. It's ambiguous")
              const ourSheet = cur.startsWith("design:") && /From our mockup sheet /.test(im.notes || "") ? (im.notes || "").match(/From our mockup sheet ([^:]+):/)?.[1] || "" : null;
              const opts = ourSheet != null ? [cur] : [...new Set([...(cur && !arts.some((f) => f.path === cur) ? [cur] : []), ...arts.map((f) => f.path)])];
              return (
                <div key={im.id} className="rv-print">
                  <p className="rv-qq">{opts.length > 1 ? `${gname} · ${im.location}: which logo?` : `${im.location}${parseFloat(String(im.size || "")) > 0 ? `, ${parseFloat(String(im.size))}" wide` : ""}`}</p>
                  <div className="rv-ch" role="radiogroup" aria-label={`The logo for ${gname}, ${im.location}`}>
                    {(opts.length ? opts : [""]).map((v) => (
                      <button key={v || "none"} type="button" role="radio" aria-checked={cur === v} className={"rv-c pic" + (cur === v ? " on" : "")} disabled={!v || opts.length < 2} onClick={() => setArt((x) => ({ ...x, [im.id]: v }))}>
                        {v ? <Pic path={v.startsWith("design:") ? undefined : v} design={v.startsWith("design:") ? v.slice(7) : undefined} /> : <span className="rv-pic"><span className="faint">No logo yet</span></span>}
                        <span data-notranslate>{v ? (ourSheet != null ? "Pulled from our mockup sheet" : nameOf(v)) : "Add it on the order"}{v && v === (d.art?.[im.id] || (im.design_id ? `design:${im.design_id}` : "")) && opts.length > 1 ? <i className="faint"> (my pick)</i> : null}</span>
                      </button>
                    ))}
                    {im.sameAs && <figure className="rv-same"><Pic path={im.sameAs.pic} /><figcaption>Printed like <b data-notranslate>{im.sameAs.label}</b></figcaption></figure>}
                  </div>
                  {/* how it prints, and how I got there (Oct 23, Nick: "say something about how you got there… last time on the
                      mockup we used these dimensions, or the PO says this… it says best fit, I'm thinking 10 inches") */}
                  {(() => {
                    const s0 = sp[im.id] || {}, sws = (s0.inks || "").split(/\s*,\s*/).filter(Boolean);
                    return (
                      <div className="rv-spec">
                        {s0.last && <p className="rv-last" data-notranslate>{s0.last}</p>}
                        <div className="rv-fields">
                          <label className="rv-f"><span>Size</span><input type="number" step={0.25} min={1} max={spotFor(im.location).maxW} value={s0.size ?? ""} onChange={(e) => setSize(im.id, +e.target.value)} aria-label={`${im.location} width in inches`} /><em>in wide</em></label>
                          <label className="rv-f rv-f-inks"><span>Inks</span>{sws.length > 0 && <span className="rv-sws" aria-hidden>{sws.map((n) => <i key={n} style={{ background: colorHex(stockName(n)) || "transparent" }} />)}</span>}<input value={s0.inks || ""} onChange={(e) => setInks(g, im.id, e.target.value)} placeholder="White, Scarlet" aria-label={`${im.location} inks`} /></label>
                        </div>
                        <p className="rv-why">{s0.sizeWhy ? <>Size: {s0.sizeWhy}</> : null}{s0.sizeWhy && s0.inksWhy ? " · " : ""}{s0.inksWhy ? <>Inks: {s0.inksWhy}</> : null}</p>
                        {s0.ubWhy && <p className="rv-why" data-notranslate>{s0.ub ? <>{s0.ubWhy}. </> : <>No underbase. </>}<button type="button" className="ap-link" onClick={() => setSp((x) => ({ ...x, [im.id]: { ...x[im.id], ub: !x[im.id]?.ub } }))}>{s0.ub ? "No underbase" : "Put the underbase back"}</button></p>}
                        {s0.flag && s0.size !== s0.flag.size && <p className="rv-flag">{s0.flag.text} <button type="button" className="ap-link" onClick={() => setSize(im.id, s0.flag!.size)}>Make it {s0.flag.size}&quot;</button></p>}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            {g.imprints.length > 1 && <label className="rv-same-inks"><input type="checkbox" checked={!!sameInks[g.id]} onChange={(e) => setSameInks((x) => ({ ...x, [g.id]: e.target.checked }))} /> Same inks on all its prints</label>}
            {qs.map(({ i }) => Q(i))}
          </section>
        );
      })}
      <div className="rv-sum"><span className="faint">I&apos;ll make</span>{d.groups.map((g) => <div key={g.id} data-notranslate>{[...g.imprints].sort((p0, p1) => spotRank(p0.location) - spotRank(p1.location)).map((im) => `${im.location} ${sp[im.id]?.size ? `${sp[im.id]!.size}"` : ""}${sp[im.id]?.inks ? ` · ${sp[im.id]!.inks}` : ""}${sp[im.id]?.extra ? " + halftones" : ""}${sp[im.id]?.ub ? " + white underbase" : ""}`).join("  ·  ")}{d.groups.length > 1 ? ` (${g.name || g.lines.map((l) => l.color).join(", ")})` : ""}</div>)}</div>
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
        <button type="button" className="btn primary" onClick={() => a.resolve({ answers: checks.map((c, i) => ({ q: c.q, answer: answerOf(i), remember: rows[i].remember && !!answerOf(i) })), art, specs: sp })}>{answered && !a.again ? "Use my answers" : "Make the order"}</button></div>
    </div>
  );
}
/** a customer's mockup sheet: the art cut off it, their shirt page and the specs read off it, to confirm */
function SheetConfirm({ a, onCancel }: { a: SheetAsk; onCancel: () => void }) {
  return (
    <div className="ap" role="group" aria-label={a.onShirt ? "Art on a shirt" : "Their mockup sheet"}>
      {a.onShirt ? <>
        <p className="ap-q">The art in this file is on {a.onShirt === "drawn" ? "drawn shirts" : "a shirt"}. Use the art pulled off it?</p>
        <p className="ap-why"><b>{a.name}</b> is a mockup, not the print file, so I pulled the art off it with the Mockup Creator&apos;s Helper and measured it on the shirt. Their file becomes the customer mockup, stamped and in Production files.</p>
      </> : <>
        <p className="ap-q">This is their mockup sheet, with the sizing. Use it like this?</p>
        <p className="ap-why">From the email: <b>{a.name}</b>. I took the art off the top{a.background ? <> and took out its background <i className="ap-sw" style={{ background: a.background }} /> (it doesn&apos;t print)</> : ""}. Their shirt page becomes the customer mockup, stamped and in Production files with the PDF.</p>
      </>}
      <div className="ap-sent">
        {[a.art, ...(a.more || [])].map((u, i) => <figure key={u} className="ap-sent-i"><span className="ap-pic big ap-check"><img src={u} alt="" /></span><figcaption><b>{i ? "More art" : "The art"}</b><span className="faint">{a.onShirt ? "Pulled off the shirt" : "Cut off their sheet"}</span></figcaption></figure>)}
        {a.mockup && <figure className="ap-sent-i"><span className="ap-pic big"><img src={a.mockup} alt="" /></span><figcaption><b>Their mockup</b><span className="faint">Saved as the customer mockup</span></figcaption></figure>}
      </div>
      {a.specs.length > 0 && <ul className="ap-specs">{a.specs.map((t, i) => <li key={i}>{t}</li>)}</ul>}
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
        <button type="button" className="btn" onClick={() => a.resolve("art")}>{a.onShirt ? "No, use the file as it is" : <>No, it&apos;s just art</>}</button>
        <button type="button" className="btn primary" onClick={() => a.resolve("sheet")}>{a.onShirt ? "Yes, use the pulled art" : <>Yes, that&apos;s right</>}</button></div>
    </div>
  );
}
/** the customer's art with a reorder: drawn large, theirs or the old job's */
function SentArt({ a, onCancel }: { a: ArtAsk; onCancel: () => void }) {
  const [pics, setPics] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    (async () => {
      for (const it of a.items) {
        let url = it.file.url;
        if (!url && it.file.path) url = (await createClient().storage.from("proofs").createSignedUrl(it.file.path, 3600)).data?.signedUrl || "";
        if (!url) continue;
        const dr = await drawFile(url, it.file.name, it.file.type).catch(() => null);
        if (live && dr?.asIsUrl) setPics((p) => ({ ...p, [it.key]: dr.asIsUrl }));
      }
      for (const [i, f] of (a.old || []).entries()) {
        if (!f.url) continue;
        const dr = await drawFile(f.url, f.name, f.type).catch(() => null);
        if (live && dr?.asIsUrl) setPics((p) => ({ ...p, [`old${i}`]: dr.asIsUrl }));
      }
    })();
    return () => { live = false; };
  }, [a]);
  return (
    <div className="ap" role="group" aria-label="Their art or the old art">
      <p className="ap-q">Here&apos;s everything on the original order, {a.job}, and the art in the email. Which art are we using?</p>
      <p className="ap-why">Nothing is cut or changed yet. Using the email&apos;s art: next you say which of {a.job}&apos;s files to keep (barcodes, labels…) and which to drop, then I show you what I read in the email&apos;s art.</p>
      {!!a.old?.length && <>
        <h4 className="ap-src">On {a.job} (Printavo)<span className="faint"> · {a.old.length} file{a.old.length === 1 ? "" : "s"}</span></h4>
        <div className="ap-sent ap-sent-old">
          {a.old.map((f, i) => (
            <figure key={i} className="ap-sent-i">
              <span className="ap-pic">{pics[`old${i}`] ? <img src={pics[`old${i}`]} alt="" /> : <span className="faint">{f.url ? "Loading…" : "No preview"}</span>}</span>
              <figcaption><span className="faint">{f.name}</span>{f.url && <a href={f.url} target="_blank" rel="noreferrer">Open</a>}</figcaption>
            </figure>
          ))}
        </div>
      </>}
      <h4 className="ap-src">Attached to the email{a.from?.length ? <span className="faint"> · {a.from.join(", ")}</span> : null}</h4>
      <div className="ap-sent">
        {a.items.map((it) => (
          <figure key={it.key} className="ap-sent-i">
            <span className="ap-pic big">{pics[it.key] ? <img src={pics[it.key]} alt="" /> : <span className="faint">{it.file.url ? "Loading…" : "No preview"}</span>}</span>
            <figcaption><b>{it.label}</b><span className="faint">{it.file.name}</span>{it.file.url && <a href={it.file.url} target="_blank" rel="noreferrer">Open</a>}</figcaption>
          </figure>
        ))}
      </div>
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel reorder</button></span>
        <button type="button" className="btn" onClick={() => a.resolve("old")}>Use the art on {a.job.replace(/^(#\d+).*/, "$1")}</button>
        <button type="button" className="btn primary" onClick={() => a.resolve("theirs")}>Use the art from the email</button></div>
    </div>
  );
}

function ArtConfirm({ c, onCancel }: { c: Confirm; onCancel: () => void }) {
  const [rows, setRows] = useState(c.items.map((x) => ({ ...x })));
  const [pics, setPics] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    (async () => {
      const sb = createClient();
      const { data } = await sb.from("designs").select("id, preview_path, file_path").in("id", c.items.map((x) => x.design));
      const paths = (data || []).map((x) => ({ id: x.id as string, p: (x.preview_path || x.file_path) as string })).filter((x) => x.p);
      const { data: s } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths.map((x) => x.p), 900) : { data: [] };
      if (live) setPics(Object.fromEntries(paths.map((x, i) => [x.id, s?.[i]?.signedUrl || ""])));
    })();
    return () => { live = false; };
  }, [c]);
  // the usual spots first, then the rest
  const spots = c.spots || LOCATIONS;
  const COMMON = spots === LOCATIONS ? ["Full Front", "Full Back", "Left Chest", "Center Chest", "Upper Back (Yoke)", "Left Sleeve", "Right Sleeve"].filter((l) => LOCATIONS.includes(l)) : spots;
  const set = (k: number, patch: Partial<ConfirmItem>) => setRows((x) => x.map((y, yi) => (yi === k ? { ...y, ...patch } : y)));
  return (
    <div className="ap" role="group" aria-label="What is this art">
      <p className="ap-q">I found {rows.length === 1 ? "this art" : "these"} in {c.job}. What {rows.length === 1 ? "is it" : "are they"}?</p>
      <p className="ap-why">It isn&apos;t on a mockup, so I can&apos;t tell where it goes or how big it printed. Then I&apos;ll make the mockup.</p>
      {rows.map((r, k) => (
        <div key={k} className="ap-conf">
          <span className="ap-pic big">{pics[r.design] ? <img src={pics[r.design]} alt="" /> : <span className="faint">Art</span>}</span>
          <div className="ap-conf-f">
            <div className="ap-chips" role="radiogroup" aria-label="Where it goes">
              {[...COMMON, ...(COMMON.includes(r.location) ? [] : [r.location])].map((l) => <button key={l} type="button" role="radio" aria-checked={r.location === l} className={"chip" + (r.location === l ? " on" : "")} onClick={() => set(k, { location: l })}>{l}</button>)}
              <select className="ap-other" value="" aria-label="Another location" onChange={(e) => e.target.value && set(k, { location: e.target.value })}>
                <option value="">Other…</option>
                {spots.filter((l) => !COMMON.includes(l)).map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <button type="button" role="radio" aria-checked={r.location === "none"} className={"chip" + (r.location === "none" ? " on" : "")} onClick={() => set(k, { location: "none" })}>Not the art</button>
            </div>
            {r.location !== "none" && <label className="ap-w">Printed width <input type="number" min={1} max={16} step={0.25} value={r.size} placeholder="standard" onChange={(e) => set(k, { size: e.target.value })} /> in <span className="faint">(leave blank for the standard size; production confirms it)</span></label>}
          </div>
        </div>
      ))}
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel reorder</button></span><button type="button" className="btn primary" onClick={() => c.resolve(rows.map((r) => ({ gi: r.gi, ii: r.ii, location: r.location, size: r.location === "none" ? "" : String(r.size || "").trim() })))}>{rows.some((r) => r.location === "none") ? "Keep going" : "Use it & make the mockup"}</button></div>
    </div>
  );
}
