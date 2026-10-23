"use client";
import { useEffect, useRef, useState } from "react";
import type { Group } from "@/lib/pricing";
import type { EODraft, EOPart, PastJob } from "@/lib/emailOrderShared";
import { createClient } from "@/lib/supabase/client";
import { stampOrderMockups } from "@/lib/mockupStamp";
import { attachFilms, pullReorderArt } from "@/lib/reorderArt";
import ColorCheck, { applyColors, checkColors, type ColorRow } from "@/components/ColorCheck";
import { rememberOrderNote } from "@/app/shop/ai-actions";
import { LOCATIONS } from "@/lib/pricing";
import { uploadDesign } from "@/lib/designs";
import { uid } from "@/lib/pricing";
import { makePreview } from "@/lib/artPrep";
import { looksLikeSheet, measureDrop, splitSheet } from "@/lib/setupSheet";
import { mockupNamed, pagePicture, pdfLike, pieceFor, pullOffMockup, type Pulled } from "@/lib/mockupPull";
import type { ArtPiece } from "@/lib/printavoArt";
import { handOffArt } from "@/app/shop/ai-actions";
import { discardDraftArt } from "@/app/shop/draft-art-actions";
import { PROD_KINDS, guessProdKind, prodKindLabel } from "@/lib/productionFileKinds";
import { pdfPicture, sizesOnSheet } from "@/lib/printavoArt";
import { isPsd, psdPicture } from "@/lib/psdPic";
import { drawPic } from "@/lib/pdfPic";
import { knockOutBackground, measureFilm } from "@/lib/printavoArt";
import type { OrderStart } from "@/components/OrderStartPick";
import { guessHex, isHeather, shirtBg, spotFor } from "@/lib/mockup";
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
type HelpPick = { kind: "keep" } | { kind: "file"; file: File; name: string; /** art the Helper pulled off a mockup: its size and drop */ pc?: ArtPiece; from?: string; how?: Pulled["kind"] } | { kind: "upload"; file: File } | { kind: "design"; id: string; name: string } | { kind: "production"; note: string } | { kind: "skip" };
type Help = { job: string; customerId: string; /** the old Printavo job (archived id): all its files are listed */ archivedId: string; /** the old job in the new system, to look at */ jobUrl: string; /** every garment line, for "which items get this art" */ lines: { id: string; gi: number; label: string }[]; prints: { key: string; label: string; colors: number; location: string; method?: string; /** a dark garment in its group (an underbase is likely) */ dark?: boolean; /** printed width, inches ("" = standard) */ size: string; /** art already pulled for it */ design?: string }[]; /** what went wrong bringing it in */ why: string[]; /** prints already covered by the art they sent: only the old job's other files are asked about */ settled?: string[]; files: { path: string; name: string }[]; resolve: (a: HelpAns) => void };
/** each print's art, and the old job's files for the new order's Production files (null: leave them as they were) */
type HelpAns = { picks: Record<string, HelpPick>; /** art for only some of a group's lines: those lines become a group of their own with this art */ splits?: { pk: string; lineIds: string[]; pick: HelpPick }[]; /** per location: the old job's screens included a white underbase ("ub") or not ("none") */ know?: Record<string, { colors: number; ub: boolean } | null>; /** visual: a mockup only, the details wait for production on the print run; details: the mockup with our details */ mode?: "visual" | "details"; place?: Record<string, { location: string; size: string }>; files: { path: string; name: string; role: "art" | "mockup" | "production"; /** its label in Production files */ kind: string; note?: string }[] | null; skipped?: number };
type ConfirmItem = { gi: number; ii: number; design: string; location: string; size: string; colors: number };
type ConfirmAns = { gi: number; ii: number; location: string; size: string }[];
type Confirm = { job: string; items: ConfirmItem[]; resolve: (a: ConfirmAns) => void };
type Step = { label: string; state: "doing" | "done" | "error"; note?: string };
/** a reorder email that came with art: theirs, or the old job's (Oct 22, Nick: "he actually attached all the art. We
 *  could have just used it, but you ignored it because you treated it as a reorder") */
/** a customer's mockup sheet: what was read off it, to confirm (Oct 22, Nick: "you just ask me, what is this?… or you
 *  confirm it: hey, this is a customer mockup with sizing and information") */
/** what doesn't add up, asked before the order is made (Oct 22, Nick): each question with the AI's guess, your answer,
 *  and whether to remember it for this customer */
type ReviewAns = { answers: { q: string; answer: string; remember: boolean }[]; /** the logo per print: an art file path, or "design:<id>" */ art: Record<string, string> };
type ReviewAsk = { d: EODraft; customer: string; again: boolean; resolve: (a: ReviewAns) => void };
type SheetAsk = { name: string; art: string; mockup: string; background: string | null; specs: string[]; resolve: (a: "sheet" | "art") => void;
  /** the art was on a shirt (a photo, a person, a mockup, drawn shirts) and the Helper pulled it off; more = the other prints pulled */ onShirt?: "photos" | "drawn"; more?: string[] };
type ArtAsk = { job: string; /** the old job's files */ old?: { name: string; url: string; type: string }[]; /** the email's files they sent */ from?: string[]; items: { key: string; label: string; file: { name: string; url: string; type: string; path?: string } }[]; resolve: (a: "theirs" | "old") => void };

/** Cancel clicked: stop where it is and take back what it made */
class Cancelled extends Error {}
/** garment colors that usually print without an underbase (a first guess for the question, never decided by it) */
const LIGHTISH = /white|natural|cream|ivory|ash\b|light|pink|mauve|stone|sand|silver|yellow|bone|oatmeal|heather gr[ae]y|athletic heather|sport gr[ae]y|columbia blue|baby|pastel|mint|lavender|peach/i;
const pcsOf = (gs: Group[]) => gs.reduce((n, g) => n + g.lines.reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, v) => a + (+v || 0), 0), 0), 0);

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

  async function one(part: EOPart | null, of: string, again: string[] = []): Promise<Made | null> {
    const qs = `activity=${encodeURIComponent(activityId)}${part ? `&part=${encodeURIComponent(part.key)}` : ""}`;
    step(`${of}Reading the email${part ? ` for ${part.label}` : ""}…`);
    const g = await fetch(`/api/inbox/order?${qs}`).then((r) => r.json()).catch(() => null) as Loaded & { error?: string } | null;
    guard();
    if (!g || g.error) throw new Error(g?.error || "Couldn't load the email.");
    let d = !start.told && !start.job && !again.length ? g.draft : null;
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
      const r = await fetch("/api/inbox/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, told: [part ? "" : start.told || "", ...again].filter(Boolean).join("\n"), job: part ? part.job : start.job || null, jobs: part ? [] : start.jobs || [], reorderOk: !!(part ? part.job : start.job), ...(part ? { part: part.key } : {}) }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
      stop(); guard();
      if (!r?.ok || !j.draft) throw new Error(j.error || "The AI couldn't read this email.");
      d = j.draft as EODraft; g.past = j.past || g.past;
    }
    { const pcs = pcsOf(d.groups), lines = d.groups.reduce((n, x) => n + x.lines.length, 0); note(`Found ${lines} garment line${lines === 1 ? "" : "s"}, ${pcs.toLocaleString("en-US")} pcs${d.kind === "reorder" ? ", a reorder" : ""}`); }
    const did: string[] = [];
    if (again.length) did.push(...again.map((x) => `You said: ${x}`));
    const job = d.reorderOf ? (g.past || []).find((p) => p.ref === d!.reorderOf) : null;
    // several past jobs in one order (Hutchins T10A + T11A): all of them
    const jobs = (d.reorderJobs || []).map((ref) => (g.past || []).find((p) => p.ref === ref)).filter(Boolean) as PastJob[];
    const jobLabel = (jobs.length > 1 ? jobs.map((j) => j.label.replace(/\s*\(Printavo\)$/, "").replace(/^(#\d+).*/, "$1")).join(" and ") : (job?.label || part?.jobLabel || "")).replace(/\s*\(Printavo\)$/, "");
    // the shirt colors: the style's real color names (the closest one when not an exact match)
    step(`${of}Checking the shirt colors…`);
    const cc = await checkColors(d.groups).catch(() => ({ rows: [] as ColorRow[], ask: [] as ColorRow[] }));
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
      const ans = await waitFor<ConfirmAns>((resolve) => setConfirm({ job: jobLabel || "the old job", items: unsure.map(({ gi, ii, im }) => ({ gi, ii, design: im.design_id!, location: im.location, size: (im.size || "").replace(/"\s*wide/, ""), colors: im.colors || 1 })), resolve }));
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
      const ans = await waitFor<HelpAns>((resolve) => setHelp({ customerId: g.customer!.id, job: jobLabel || "the old job", archivedId: isPv ? d!.reorderOf!.slice(2) : "", jobUrl: isPv ? `/shop/archive/${d!.reorderOf!.slice(2)}` : d!.reorderOf?.startsWith("o:") ? `/shop/orders/${d!.reorderOf.slice(2)}` : "", prints, files, why, ...(othersOnly ? { settled: sentArt.map((z) => `${z.x.name ? `${z.x.name} · ` : ""}${z.im.location}`) } : {}), lines: d!.groups.flatMap((x, gi) => x.lines.map((l) => ({ id: l.id, gi, label: [l.style, l.color].filter(Boolean).join(" ") || "Garment" }))), resolve }));
      setHelp(null);
      const made = new Map<File, string>();
      // a file that's a mockup (the art on a shirt, a person, our old mockup or theirs): the Helper pulls the art off it,
      // the art for that print's side becomes the logo, with the size and drop measured off the shirt (Oct 22, Nick: "if
      // you see it in Printavo, any way, shape, and form… you've got to go in and use the helper and pull it out")
      const pulledOf = new Map<File, Pulled | null>(), usedOf = new Map<File, Set<ArtPiece>>();
      const pulledFor = new Map<string, { pc: ArtPiece; from: string; kind: Pulled["kind"] }>();
      // a picked file or upload saved as their logo (once per file, or per print pulled off it)
      const designFor = async (picked: HelpPick, im: (typeof targets)[number]["im"]): Promise<string | null> => {
        if (picked.kind === "design") return picked.id;
        if (picked.kind !== "file" && picked.kind !== "upload") return null;
        const file = picked.file;
        if (pdfLike(file) && !pulledOf.has(file)) {
          note(`Is the art in ${file.name} on a shirt? Checking with the Helper…`);
          pulledOf.set(file, await pullOffMockup(file, file.name, { drawn: mockupNamed(file.name) }).catch(() => null));
          guard();
        }
        const pl = pulledOf.get(file) || null;
        const used = usedOf.get(file) || new Set<ArtPiece>(); usedOf.set(file, used);
        const pc = pl ? pieceFor(pl, im.location, used) || pieceFor(pl, "front", used) || pieceFor(pl, "back", used) : undefined;
        if (pc) used.add(pc);
        const src = pc ? pc.file : file;
        let id = made.get(src);
        if (!id) {
          // a print file (PDF, AI, EPS, SVG) keeps a picture of it, so the Mockup Creator can use it right away
          const vector = !pc && picked.kind === "upload" && !/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name);
          const preview = vector ? await makePreview(/\.ai$/i.test(file.name) ? new File([file], file.name, { type: "application/pdf" }) : file).catch(() => null) : null;
          const dsg = await uploadDesign(createClient(), { draft: true, file: src, ...(preview ? { preview } : {}), customer_id: g.customer!.id, name: d!.nickname || "Art", colors: im.colors || 1, inks: im.inks || "", notes: pc ? `Pulled off ${file.name} with the Helper, for the reorder of ${jobLabel}` : `For the reorder of ${jobLabel}`, method: im.method });
          id = dsg.id; made.set(src, id); made0.current.add(id);
          guard();
        }
        if (pc && pl) pulledFor.set(id, { pc, from: file.name, kind: pl.kind });
        else if (picked.kind === "file" && picked.pc) pulledFor.set(id, { pc: picked.pc, from: picked.from || file.name, kind: picked.how || "photos" });
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
          if (pu) {
            setIm({ design_id: id, ...(parseFloat(String(im.size || "")) > 0 ? {} : { size: `${pu.pc.widthIn}" wide` }), ...(im.drop ? {} : { drop: String(pu.pc.dropIn) }) }, `Art pulled off ${pu.from} with the Helper: ${pu.pc.widthIn}" × ${pu.pc.heightIn}", ${pu.pc.dropIn}" below the collar${pu.kind === "drawn" ? " (read off a drawn shirt: close, not exact)" : ""}`);
            did.push(`${im.location}: the art in ${pu.from} was on a shirt, so the Helper pulled it off (${pu.pc.widthIn}" wide, ${pu.pc.dropIn}" down)`);
            continue;
          }
          setIm({ design_id: id }, picked.kind === "upload" ? "Art uploaded when the reorder was made" : `Art from ${picked.name}`);
          did.push(`${im.location}: art ${picked.kind === "upload" ? "uploaded by you" : `from ${picked.name}`}`);
        } catch (e) { if (e instanceof Cancelled) throw e; did.push(`${im.location}: the art couldn't be saved (${e instanceof Error ? e.message : String(e)}): add it on the order`); }
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
        if (k && im.method === "screen") Object.assign(patch, { colors: Math.max(1, k.colors), underbase: k.ub });
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
    if (d.kind !== "reorder" || theirs.size || !sentArt.length) {
      const used = new Set([...Object.values(d.art || {}), ...Object.values(d.mockups || {}).flat()]);
      const sb0 = createClient();
      for (const f of d.files.filter((x) => used.has(x.path) && (/pdf/i.test(x.type) || /\.pdf$/i.test(x.name)))) {
        guard();
        const { data: blob } = await sb0.storage.from("proofs").download(f.path);
        if (!blob) continue;
        const buf = await blob.arrayBuffer();
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
        const got: Pulled | null = await pullOffMockup(blob, f.name, { drawn: f.role === "mockup" || mockupNamed(f.name) || Object.values(d.mockups || {}).flat().includes(f.path) }).catch(() => null);
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
          return { ...im, ...(sized ? {} : { size: `${pc.widthIn}" wide` }), drop: im.drop || String(pc.dropIn), ...(!im.inks && pc.ink ? { inks: pc.ink } : {}),
            notes: [im.notes, `Art pulled off ${f.name} with the Helper: ${pc.widthIn}" × ${pc.heightIn}", ${pc.dropIn}" below the collar${got.kind === "drawn" ? " (read off a drawn shirt: close, not exact)" : ""}`].filter(Boolean).join(". ").slice(0, 300) };
        }) })), files: [
          ...d.files.map((x) => (x.path === f.path ? { ...x, role: "other" as const, kind: "customer_mockup" } : x)),
          ...added,
          ...(upM.error ? [] : [{ path: mockPath, name: `${base} mockup.png`, type: "image/png", size: page!.size, role: "mockup" as const, what: `their mockup (${f.name})` }]),
        ] };
        did.push(`${f.name}: the art was on ${got.kind === "drawn" ? "drawn shirts" : "a shirt"}, so the Helper pulled it off (${plan.map(({ im, pc }) => `${im.location} ${pc.widthIn}" wide`).join(", ")}); their file is the customer mockup, in Production files`);
      }
    }
    guard();
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
            if (said) break;
          }
          if (said) {
            w = said.w;
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
            if (pc && pc.widthIn <= spotFor(im.location).maxW) { w = pc.widthIn; dropIn = pc.dropIn; }
          }
        } catch { /* asked below */ }
        guard();
      }
      const id = im.id;
      if (w > 0) {
        const how = dropIn >= 0 ? "measured" : "written on it";
        d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, size: `${w}" wide`, ...(dropIn >= 0 ? { drop: String(dropIn) } : {}), notes: [z.notes, `Size from ${im.sameAs!.label}'s mockup: ${w}" wide${dropIn >= 0 ? `, ${dropIn}" below the collar` : ""} (${how})`].filter(Boolean).join(". ").slice(0, 300) })) })) };
        did.push(`${im.location}: ${w}" wide, ${how} on ${im.sameAs.label}'s mockup`);
      } else {
        d = { ...d, check: [...(d.check || []), { q: `${im.location}: what size? ${im.sameAs.label} didn't keep one`, guess: "Standard size", about: x.name, choices: [{ label: "Standard size" }, { label: "Production measures it" }] }] };
      }
    }
    // art on a solid box (Oct 23, Nick on Tongue in Cheek: "do I remove the background and make it a two-color print?
    // Because it's on a black shirt"): the box found on the art's picture, its other colors counted without the shirt's,
    // and asked at the check, with taking it out as the guess
    const boxedOut: { group: string; location: string }[] = [], artInks = new Map<string, { name: string; hex: string }[]>();
    for (const x of d.groups) {
      const shirt = guessHex(x.lines.find((l) => l.color)?.color || "White"), shirtName = x.lines.find((l) => l.color)?.color || "white";
      for (const im of x.imprints) {
        const path = d.art?.[im.id];
        if (!path || im.method === "dtf" || (d.check || []).some((c) => c.local === `bg:${im.id}`)) continue;
        const b0 = await boxOf(path, shirt).catch(() => null);
        guard();
        if (!b0) continue;
        artInks.set(im.id, b0.inks);
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
      }
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
      for (const a of rv.answers.filter((x) => localOf.has(x.q))) {
        const [key, n0, list, bgName] = localOf.get(a.q)!.split("|"), id = key.slice(3), n = +n0 || 1;
        const keep = /print the box/i.test(a.answer);
        d = { ...d, groups: d.groups.map((y) => ({ ...y, imprints: y.imprints.map((z) => (z.id !== id ? z : { ...z, colors: keep ? n + 1 : n, notes: [z.notes, keep ? `Their ${bgName.toLowerCase()} box prints too` : `The ${bgName.toLowerCase()} box behind the art is taken out: the shirt shows through, ${n} color${n === 1 ? "" : "s"}`].filter(Boolean).join(". ").slice(0, 300) })) })) };
        did.push(`${y0(d, id)}: ${keep ? `the ${bgName.toLowerCase()} box prints too (${n + 1} colors)` : `${bgName.toLowerCase()} box taken out, ${n} color${n === 1 ? "" : "s"}${list ? ` (${list})` : ""}`}`);
      }
      const ans = rv.answers.filter((x) => !localOf.has(x.q));
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
    setCommitting(true);
    step(`${of}Creating the order…`);
    note(d.kind === "reorder" ? "Copying the job with the new sizes as a quote…" : "Saving it as a quote…");
    const r = await fetch("/api/inbox/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, draft: d, status: "quote" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!r?.ok || !j.id) { setCommitting(false); throw new Error(j.error || "Couldn't create the order."); }
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
      const first = gs.find((x) => x.imprints.some((im) => im.design_id) && !(x.mockupThumbs || []).some(Boolean));
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
            setConfirm(null); setHelp(null); setArtAsk(null); setSheetAsk(null);
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
  return (
    <div className={"dla-bg" + (dock ? " dock" + (help || confirm || review ? " wide" : "") : "")} role="dialog" aria-modal={dock ? undefined : true} aria-label="Creating the order">
      <div className={"dla qo" + (help || confirm || review ? " wide" : "")}>
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
          const go = () => { if (m) window.open(m.url, "_blank", "noopener"); if (last) onClose(); else pause.resolve(); };
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
        </> : <h3>{made.length ? `${made.length === 1 ? "Order" : `${made.length} orders`} created` : "The order wasn't made"}</h3>}
        {!done && <ol className="qo-steps">{steps.map((s, i) => <li key={i} className={s.state}><i aria-hidden>{s.state === "done" ? "✓" : s.state === "error" ? "!" : ""}</i><span>{s.label}{s.note && s.state === "doing" && <small className="qo-note" aria-live="polite">{s.note}</small>}</span></li>)}</ol>}
        {sheetAsk && <SheetConfirm a={sheetAsk} onCancel={cancel} />}
        {review && <ReviewConfirm a={review} onCancel={cancel} />}
        {colorAsk && <ColorCheck rows={colorAsk.rows} onDone={(r) => colorAsk.done(r)} onCancel={cancel} />}
        {artAsk && <SentArt a={artAsk} onCancel={cancel} />}
        {confirm && <ArtConfirm c={confirm} onCancel={cancel} />}
        {help && <ArtHelp help={help} onCancel={cancel} />}
        {!many && made.map((m) => (
          <div key={m.id} className="qo-made">
            <div className="qo-made-h"><b>#{m.number}</b><span>{m.label}</span><span className="faint">{m.pcs.toLocaleString("en-US")} pcs · Quote</span></div>
            {m.did.length > 0 && <ul className="qo-did">{m.did.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {m.ask.length > 0 && <details className="qo-ask"><summary>{m.ask.length} question{m.ask.length === 1 ? "" : "s"} for the customer (saved in the order&apos;s notes)</summary><ul>{m.ask.map((q, i) => <li key={i}>{q}</li>)}</ul></details>}
            {done && made.length > 1 && <a className="qo-open" href={m.url} target="_blank" rel="noreferrer">{m.mockup ? "Make the mockup & open #" : "Open #"}{m.number} ›</a>}
          </div>
        ))}
        {err && <div className="err">{err}</div>}
        {done && (
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
  type Found = { source: "library" | "email"; name: string; label: string; date: string; type: string; url?: string; design_id?: string };
  const [old, setOld] = useState<null | (Old & { d?: Drawn | null })[]>(null);
  const [found, setFound] = useState<null | (Found & { d?: Drawn | null })[]>(null);
  const [pieces, setPieces] = useState<{ name: string; file: File; url: string; size: string }[]>([]);
  const [ups, setUps] = useState<{ file: File; url: string }[]>([]);
  // a file marked Mockup: the Helper pulls the art off it right away, each piece shown as a file of its own and given to
  // the print it's for (Oct 23, Nick, reordering #33728 from Printavo with only Peticolas_Velvet_Hammer_Mockup_Red.pdf:
  // "it asks me what this file is and I say mockup. And then it goes, well, I don't have the art then. A lot of times
  // this is all you're going to have. And you can easily use the mockup helper to pull the art")
  const [pulls, setPulls] = useState<Record<string, { busy: boolean; from: string; how?: Pulled["kind"]; pieces: { pc: ArtPiece; url: string }[] }>>({});
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
        const d = await drawFile(f.url, f.name, f.type).catch(() => null);
        if (!live) return;
        setOld((x) => (x ? x.map((y, yi) => (yi === k ? { ...y, d } : y)) : x));
      }
      for (const [k, f] of (j.found || []).entries()) {
        if (!f.url || f.source === "library") continue;
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
  const items: Item[] = [
    ...help.prints.filter((p) => p.design).map((p) => ({ key: `K${p.key}`, where: "kept" as const, only: p.key, tag: `Pulled for the ${p.label}`, name: "Art pulled from the old job", cutUrl: kept[p.design!] || "", asIsUrl: kept[p.design!] || "", canCut: false, ready: true, pick: () => ({ kind: "keep" as const }) })),
    ...(old || []).map((f, i) => ({ key: `O${i}`, open: f.url, where: "old" as const, path: f.path, hint: hintOf(f.name), tag: f.name, name: f.name, cutUrl: f.d?.cutUrl || "", asIsUrl: f.d?.asIsUrl || "", canCut: !!f.d?.cut, ready: f.d !== undefined, pick: (bg: boolean) => fromDrawn(f.d, f.name, bg, `${f.name} on ${help.job}`) })),
    ...Object.entries(pulls).filter(([k]) => as[k] === "mockup").flatMap(([k, pu]) => pu.pieces.map((x, n) => ({ key: `P${k}:${n}`, where: "pulled" as const, tag: `Pulled off ${pu.from} · ${x.pc.side === "back" ? "Back" : "Front"}, ${x.pc.widthIn}" × ${x.pc.heightIn}"`, name: `${pu.from} ${x.pc.side} art`, cutUrl: x.url, asIsUrl: x.url, canCut: false, ready: true,
      pick: () => ({ kind: "file" as const, file: x.pc.file, name: `the art pulled off ${pu.from}`, pc: x.pc, from: pu.from, how: pu.how }) }))),
    ...ups.map((u, i) => ({ key: `U${i}`, where: "else" as const, tag: `Uploaded · ${u.file.name}`, name: u.file.name, cutUrl: u.url, asIsUrl: u.url, canCut: false, ready: true, pick: () => ({ kind: "upload" as const, file: u.file }) })),
    ...pieces.map((p, i) => ({ key: `M${i}`, where: "else" as const, tag: `Film · ${p.size}`, name: p.name, cutUrl: p.url, asIsUrl: p.url, canCut: false, ready: true, pick: () => ({ kind: "file" as const, file: p.file, name: `the film ${p.name}` }) })),
    ...(found || []).map((f, i) => ({ key: `E${i}`, where: "else" as const, tag: f.source === "library" ? `Their logo · ${f.name}` : `Email ${f.date.slice(0, 7)} · ${f.name}`, title: `${f.label} · ${f.date}`, name: f.name,
      cutUrl: f.source === "library" ? f.url || "" : f.d?.cutUrl || "", asIsUrl: f.source === "library" ? f.url || "" : f.d?.asIsUrl || "", canCut: !!f.d?.cut, ready: f.source === "library" || f.d !== undefined,
      pick: (bg: boolean) => (f.source === "library" && f.design_id ? { kind: "design" as const, id: f.design_id, name: f.name } : fromDrawn(f.d, f.name, bg, `${f.name} (${f.label}, ${f.date})`)) })),
  ];
  // one file per print: giving a print to a file takes it off the one that had it
  // one file at a time, 1 of N, back and forth (Oct 20, Nick: "we may reorder something and I don't remember
  // everything about this job… click through all the different arts")
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
    void fetch("/api/production/guess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: old.map((f) => ({ path: f.path, name: f.name })) }) }).then((r) => r.json()).then((j: { guesses?: Record<string, { kind: string; why: string }> }) => setAiG(j.guesses || {})).catch(() => null);
  }, [old]);
  const aiKind = (path?: string) => { const g = path ? aiG[path] : undefined; return g && g.kind !== "?" ? g.kind : ""; };
  // no jumping ahead by itself (Oct 20, Nick: "when I clicked production file it immediately took me to the next
  // screen… we need a Next file button on the bottom right"): a label and a note get typed after the answer
  const answer = (key: string, v: string) => assign(key, v);
  // "Full Front, all styles" (Oct 20, Nick: "if you have just one artwork and multiple lines and products in Printavo,
  // that's going to be the same art for all the products… unless you had individual arts for each line"): one answer
  // gives a file to every print at that location ("loc:<location>"); a style's own answer still wins for that style
  const isPrintVal = (v: string) => v.startsWith("loc:") || help.prints.some((p) => p.key === v);
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
      const looks = !as[k] && (mockupNamed(f.name) || /mock/i.test(aiG[f.path]?.kind || ""));
      if ((as[k] !== "mockup" && !looks) || pulls[k] || !f.d?.raw || !pdfLike({ name: f.name, type: f.d.raw.type })) continue;
      const raw = f.d.raw instanceof File ? f.d.raw : new File([f.d.raw], f.name, { type: f.d.raw.type || "application/pdf" });
      setPulls((x) => ({ ...x, [k]: { busy: true, from: f.name, pieces: [] } }));
      void pullOffMockup(raw, f.name, { drawn: true }).catch(() => null).then((got) => {
        const pieces = (got?.pieces || []).filter((pc) => pc.widthIn * pc.heightIn >= 1).map((pc) => ({ pc, url: URL.createObjectURL(pc.file) }));
        setPulls((x) => ({ ...x, [k]: { busy: false, from: f.name, how: got?.kind, pieces } }));
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
  }, [as, old, aiG]);
  const artOf = (pk: string) => { const p = help.prints.find((x) => x.key === pk); return items.find((it) => as[it.key] === pk) || (p ? items.find((it) => as[it.key] === `loc:${p.location}`) : undefined); };
  const given = help.prints.filter((p) => artOf(p.key));
  const olds0 = items.filter((x) => x.where === "old");
  const filesLeft = olds0.filter((x) => !as[x.key]).length, knowLeft = knowLocs.filter((p) => !(p.location in know)).length;
  const unanswered = filesLeft + knowLeft;
  const finish = (rest: "skip" | "production") => {
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
    help.resolve({ picks: out, splits, know, mode: help.archivedId ? mode : undefined, place, files, skipped: olds0.filter((x) => as[x.key] === "none").length });
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
          {it.where === "old" && <button type="button" role="radio" aria-checked={v === "mockup"} className={"chip" + (v === "mockup" ? " on" : "")} onClick={() => answer(it.key, "mockup")}>Mockup</button>}
          {it.where === "old" && <button type="button" role="radio" aria-checked={v === "production"} className={"chip" + (v === "production" ? " on" : "")} onClick={() => answer(it.key, "production")} title="Goes in this order's Production files (barcodes, labels, film, separations…)">Production file</button>}
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
  const olds = items.filter((x) => x.where === "old" || x.where === "kept" || x.where === "pulled"), elses = items.filter((x) => x.where === "else");
  const opening = old === null || (old || []).some((f) => f.d === undefined);
  const need = locs.map((l) => { const ps = help.prints.filter((p) => p.location === l && !p.design); return `${l}${ps.length > 1 ? ` (${ps.length} styles)` : ""}${ps[0]?.colors > 1 ? `, ${ps[0].colors} colors` : ""}`; }).join("; ");
  return (
    <div className="ap arc" role="group" aria-label="What are these files">
      {help.settled?.length ? <p className="ap-q">You&apos;re using the email&apos;s art for {help.settled.join(", ")}. {olds0.length === 1 ? "This file is" : `These ${olds0.length} files are`} on {help.job} too: keep any you still need?</p> : null}
      {!help.settled?.length && <p className="ap-q">{stage === "details" ? <>How did {help.job.replace(/^(#\d+).*/, "$1")} print?</> : old === null ? `Opening ${help.job}…` : olds0.length ? `I found ${olds0.length === 1 ? "this file" : `these ${olds0.length} files`} on ${help.job}. What ${olds0.length === 1 ? "is it" : "are they"}?` : `There are no files on ${help.job}. Where's the art?`}{help.jobUrl && <> <a className="arc-job" href={help.jobUrl} target="_blank" rel="noreferrer">View {help.job.replace(/^(#\d+).*/, "$1")} ↗</a></>}</p>}
      <p className="ap-why">{help.settled?.length ? "Barcodes, labels, packing sheets…: mark them Production file and they go with this order. The old art they replaced: Not needed (or Production file to keep it for reference)." : stage === "details" ? "Tell me what you know. Leave it on \"Don't know\" when you're not sure." : <>Say what each one is: the art (and which items it&apos;s on), a mockup, a production file, or not needed. Next, how it printed.</>}</p>
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
                      ? <select autoFocus value={pl.location || p.location} onChange={(e) => { setPl({ location: e.target.value }); setSpotOpen(""); }} onBlur={() => setSpotOpen("")} aria-label="Where it prints">{LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}</select>
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
        <summary>Not here? Their emails and logos{found ? ` (${found.length})` : ""}, the film folder, or upload it</summary>
        <div className="arc-tools">
          <label className="ap-link">Upload the art<input ref={upRef} type="file" hidden accept="image/*,application/pdf,.ai,.eps,.svg" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const k = `U${ups.length}`; setUps((x) => [...x, { file: f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : "" }]); const p = help.prints.find((q) => !artOf(q.key)); if (p) assign(k, p.key); e.target.value = ""; }} /></label>
          <button type="button" className="ap-link" disabled={films?.busy} onClick={() => void searchFilm(help.job.replace(/^#\d+\s*/, "").replace(/\s*\(Printavo\)$/, ""))}>Search the film folder</button>
          {films && <span className="faint">{films.busy && !films.list.length ? "Searching the film folder…" : films.note}</span>}
          {films?.list.map((f) => <button key={f.id} type="button" className="ap-link" disabled={films.busy} onClick={() => void openFilm(f)}>{f.name}</button>)}
        </div>
        <div className="arc-grid sm">
          {elses.map(Card)}
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
async function boxOf(path: string, shirt: string): Promise<{ box: { bg: string; bgName: string; sameAsShirt: boolean } | null; inks: { name: string; hex: string }[] } | null> {
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
  if (!k?.bg) return { box: null, inks };
  const bg = k.bg.startsWith("#") ? k.bg : `#${k.bg}`;
  return { box: { bg, bgName: inkName(bg), sameAsShirt: near(bg, shirt) }, inks };
}
/** our stock ink for a name written on a sheet ("Scarlet Red" → Scarlet), else the name as written */
const stockName = (n: string) => {
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
  // a question whose answer is one of the files is the logo picker's job when there's a picker
  const checks = (d.check || []).filter((c) => !(arts.length > 1 && c.choices?.some((x) => x.path)));
  const [rows, setRows] = useState(checks.map(() => ({ pick: 0, text: "", remember: false })));
  const set = (i: number, ch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...ch } : x)));
  const groupOf = (about?: string) => (about ? d.groups.findIndex((g) => sameName(g.name, about)) : -1);
  const answerOf = (i: number) => { const r = rows[i], c = checks[i]; if (r.text.trim()) return r.text.trim(); if (r.pick > 0 && c.choices?.[r.pick]) { const ch = c.choices[r.pick]; return `${ch.label}${ch.name ? ` (${ch.name})` : ""}`; } return ""; };
  const answered = checks.some((_, i) => !!answerOf(i));
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
          <input type="text" className="rv-txt" aria-label={`Something else: ${c.q}`} placeholder="Or say what to do…" value={r.text} onChange={(e) => set(i, { text: e.target.value })} />
        </div>
        {mine && <label className="qc-rem"><input type="checkbox" checked={r.remember} onChange={(e) => set(i, { remember: e.target.checked })} /> Remember this for {a.customer}</label>}
      </div>
    );
  };
  const loose = checks.map((c, i) => ({ c, i })).filter(({ c }) => groupOf(c.about) < 0);
  const pcs = (g: Group) => g.lines.reduce((n, l) => n + Object.values(l.sizes || {}).reduce((m, v) => m + (+v || 0), 0), 0);
  const nameOf = (v: string) => (v.startsWith("design:") ? "Their logo on file" : files.find((f) => f.path === v)?.name || "Art");
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
                <span className="rv-sw" style={{ background: shirtBg(l.color || "White") }} aria-hidden />
                <span data-notranslate><b>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}</b> · {l.color || "no color"}</span>
                <span className="faint" data-notranslate>{Object.entries(l.sizes || {}).filter(([, q]) => +q).map(([z, q]) => `${z} ${q}`).join(" · ")}</span>
              </div>
            ))}
            {/* front first, then the back, then sleeves (Oct 23, Nick: "can you do the front first and the back second?") */}
            {[...g.imprints].sort((x, y) => spotRank(x.location) - spotRank(y.location)).map((im) => {
              const cur = art[im.id] || "";
              const opts = [...new Set([...(cur && !arts.some((f) => f.path === cur) ? [cur] : []), ...arts.map((f) => f.path)])];
              return (
                <div key={im.id} className="rv-print">
                  <p className="rv-qq">{opts.length > 1 ? `${gname} · ${im.location}: which logo?` : `${im.location}${parseFloat(String(im.size || "")) > 0 ? `, ${parseFloat(String(im.size))}" wide` : ""}`}</p>
                  <div className="rv-ch" role="radiogroup" aria-label={`The logo for ${gname}, ${im.location}`}>
                    {(opts.length ? opts : [""]).map((v) => (
                      <button key={v || "none"} type="button" role="radio" aria-checked={cur === v} className={"rv-c pic" + (cur === v ? " on" : "")} disabled={!v || opts.length < 2} onClick={() => setArt((x) => ({ ...x, [im.id]: v }))}>
                        {v ? <Pic path={v.startsWith("design:") ? undefined : v} design={v.startsWith("design:") ? v.slice(7) : undefined} /> : <span className="rv-pic"><span className="faint">No logo yet</span></span>}
                        <span data-notranslate>{v ? nameOf(v) : "Add it on the order"}{v && v === (d.art?.[im.id] || (im.design_id ? `design:${im.design_id}` : "")) && opts.length > 1 ? <i className="faint"> (my pick)</i> : null}</span>
                      </button>
                    ))}
                    {im.sameAs && <figure className="rv-same"><Pic path={im.sameAs.pic} /><figcaption>Printed like <b data-notranslate>{im.sameAs.label}</b>{im.colors ? ` · ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}{im.inks ? ` (${im.inks})` : ""}</figcaption></figure>}
                  </div>
                </div>
              );
            })}
            {qs.map(({ i }) => Q(i))}
          </section>
        );
      })}
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
        <button type="button" className="btn primary" onClick={() => a.resolve({ answers: checks.map((c, i) => ({ q: c.q, answer: answerOf(i), remember: rows[i].remember && !!answerOf(i) })), art })}>{answered && !a.again ? "Use my answers" : "Make the order"}</button></div>
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
  const COMMON = ["Full Front", "Full Back", "Left Chest", "Center Chest", "Upper Back (Yoke)", "Left Sleeve", "Right Sleeve"].filter((l) => LOCATIONS.includes(l));
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
                {LOCATIONS.filter((l) => !COMMON.includes(l)).map((l) => <option key={l} value={l}>{l}</option>)}
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
