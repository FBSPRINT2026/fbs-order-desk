"use client";
import { useEffect, useRef, useState } from "react";
import type { Group } from "@/lib/pricing";
import type { EODraft, EOPart, PastJob } from "@/lib/emailOrderShared";
import { createClient } from "@/lib/supabase/client";
import { stampOrderMockups } from "@/lib/mockupStamp";
import { attachFilms, pullReorderArt } from "@/lib/reorderArt";
import { applyColors, checkColors } from "@/components/ColorCheck";
import { LOCATIONS } from "@/lib/pricing";
import { uploadDesign } from "@/lib/designs";
import { makePreview } from "@/lib/artPrep";
import { handOffArt } from "@/app/shop/ai-actions";
import { discardDraftArt } from "@/app/shop/draft-art-actions";
import { PROD_KINDS, guessProdKind, prodKindLabel } from "@/lib/productionFileKinds";
import { pdfPicture } from "@/lib/printavoArt";
import { drawPic } from "@/lib/pdfPic";
import { knockOutBackground, measureFilm } from "@/lib/printavoArt";
import type { OrderStart } from "@/components/OrderStartPick";

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
type Loaded = { files?: { name: string; role?: string }[]; emails?: number; draft: EODraft | null; past: PastJob[]; created: string | null; customer: { id: string; price_type: string } | null; fees?: { screen: number | null; remake: number | null } };
type Made = { id: string; number: number; label: string; pcs: number; url: string; kind: "new" | "reorder"; did: string[]; ask: string[]; mockup: boolean };
type HelpPick = { kind: "keep" } | { kind: "file"; file: File; name: string } | { kind: "upload"; file: File } | { kind: "design"; id: string; name: string } | { kind: "production"; note: string } | { kind: "skip" };
type Help = { job: string; customerId: string; /** the old Printavo job (archived id): all its files are listed */ archivedId: string; /** the old job in the new system, to look at */ jobUrl: string; prints: { key: string; label: string; colors: number; location: string; method?: string; /** a dark garment in its group (an underbase is likely) */ dark?: boolean; /** printed width, inches ("" = standard) */ size: string; /** art already pulled for it */ design?: string }[]; /** what went wrong bringing it in */ why: string[]; files: { path: string; name: string }[]; resolve: (a: HelpAns) => void };
/** each print's art, and the old job's files for the new order's Production files (null: leave them as they were) */
type HelpAns = { picks: Record<string, HelpPick>; /** per location: the old job's screens included a white underbase ("ub") or not ("none") */ know?: Record<string, { colors: number; ub: boolean } | null>; /** visual: a mockup only, the details wait for production on the print run; details: the mockup with our details */ mode?: "visual" | "details"; place?: Record<string, { location: string; size: string }>; files: { path: string; name: string; role: "art" | "mockup" | "production"; /** its label in Production files */ kind: string; note?: string }[] | null; skipped?: number };
type ConfirmItem = { gi: number; ii: number; design: string; location: string; size: string; colors: number };
type ConfirmAns = { gi: number; ii: number; location: string; size: string }[];
type Confirm = { job: string; items: ConfirmItem[]; resolve: (a: ConfirmAns) => void };
type Step = { label: string; state: "doing" | "done" | "error"; note?: string };

/** Cancel clicked: stop where it is and take back what it made */
class Cancelled extends Error {}
/** garment colors that usually print without an underbase (a first guess for the question, never decided by it) */
const LIGHTISH = /white|natural|cream|ivory|ash\b|light|pink|mauve|stone|sand|silver|yellow|bone|oatmeal|heather gr[ae]y|athletic heather|sport gr[ae]y|columbia blue|baby|pastel|mint|lavender|peach/i;
const pcsOf = (gs: Group[]) => gs.reduce((n, g) => n + g.lines.reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, v) => a + (+v || 0), 0), 0), 0);

export default function QuickOrder({ activityId, start, onClose, onCreated, onReview }: { activityId: string; start: OrderStart; onClose: () => void;
  /** each order made (for the email's notes) */ onCreated: (id: string, number: number, label: string) => void;
  /** open the full form instead (check every detail before it's made) */ onReview: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [made, setMade] = useState<Made[]>([]);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [help, setHelp] = useState<Help | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
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

  async function one(part: EOPart | null, of: string): Promise<Made | null> {
    const qs = `activity=${encodeURIComponent(activityId)}${part ? `&part=${encodeURIComponent(part.key)}` : ""}`;
    step(`${of}Reading the email${part ? ` for ${part.label}` : ""}…`);
    const g = await fetch(`/api/inbox/order?${qs}`).then((r) => r.json()).catch(() => null) as Loaded & { error?: string } | null;
    guard();
    if (!g || g.error) throw new Error(g?.error || "Couldn't load the email.");
    let d = !start.told && !start.job ? g.draft : null;
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
      const r = await fetch("/api/inbox/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, told: part ? "" : start.told || "", job: part ? part.job : start.job || null, reorderOk: !!(part ? part.job : start.job), ...(part ? { part: part.key } : {}) }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
      stop(); guard();
      if (!r?.ok || !j.draft) throw new Error(j.error || "The AI couldn't read this email.");
      d = j.draft as EODraft; g.past = j.past || g.past;
    }
    { const pcs = pcsOf(d.groups), lines = d.groups.reduce((n, x) => n + x.lines.length, 0); note(`Found ${lines} garment line${lines === 1 ? "" : "s"}, ${pcs.toLocaleString("en-US")} pcs${d.kind === "reorder" ? ", a reorder" : ""}`); }
    const did: string[] = [];
    const job = d.reorderOf ? (g.past || []).find((p) => p.ref === d!.reorderOf) : null;
    const jobLabel = (job?.label || part?.jobLabel || "").replace(/\s*\(Printavo\)$/, "");
    // the shirt colors: the style's real color names (the closest one when not an exact match)
    step(`${of}Checking the shirt colors…`);
    const cc = await checkColors(d.groups).catch(() => ({ rows: [], ask: [] }));
    guard();
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
    if (!pvAll && d.kind === "reorder" && d.reorderOf && g.customer?.id && d.groups.some((x) => x.imprints.some((im) => !im.design_id))) {
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
    const missing = d.kind === "reorder" && g.customer?.id ? all.filter(({ im }) => !im.design_id) : [];
    const targets = isPv && g.customer?.id ? all : missing;
    const replaced: string[] = [];
    const files = [...new Map(d.groups.flatMap((x) => [...(x.pvRef || []), ...(x.pvArt || [])]).map((f) => [f.path, f])).values()];
    if (targets.length && (missing.length || (isPv && files.length))) {
      if (pvAll) step(`${of}Asking you about the files on ${jobLabel || "the old job"}…`);
      note(pvAll ? "Waiting for you: what each file is" : "Couldn't tell which file is the art: asking you");
      const prints = targets.map(({ gi, ii, im, grp }) => ({ key: `${gi}:${ii}`, label: `${im.location}${d!.groups.length > 1 ? ` (${grp.lines.map((l) => [l.style, l.color].filter(Boolean).join(" ")).slice(0, 2).join(", ")})` : ""}`, colors: im.colors || 1, location: im.location, size: String(im.size || "").replace(/"\s*wide/, "").trim(), method: im.method, dark: grp.lines.some((l) => l.color && !LIGHTISH.test(l.color)), ...(im.design_id ? { design: im.design_id } : {}) }));
      const ans = await waitFor<HelpAns>((resolve) => setHelp({ customerId: g.customer!.id, job: jobLabel || "the old job", archivedId: isPv ? d!.reorderOf!.slice(2) : "", jobUrl: isPv ? `/shop/archive/${d!.reorderOf!.slice(2)}` : d!.reorderOf?.startsWith("o:") ? `/shop/orders/${d!.reorderOf.slice(2)}` : "", prints, files, why, resolve }));
      setHelp(null);
      const made = new Map<File, string>();
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
          const file = picked.file;
          let id = made.get(file);
          if (!id) {
            // a print file (PDF, AI, EPS, SVG) keeps a picture of it, so the Mockup Creator can use it right away
            const vector = picked.kind === "upload" && !/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name);
            const preview = vector ? await makePreview(/\.ai$/i.test(file.name) ? new File([file], file.name, { type: "application/pdf" }) : file).catch(() => null) : null;
            const dsg = await uploadDesign(createClient(), { draft: true, file, ...(preview ? { preview } : {}), customer_id: g.customer!.id, name: d.nickname || "Art", colors: im.colors || 1, inks: im.inks || "", notes: `For the reorder of ${jobLabel}`, method: im.method });
            id = dsg.id; made.set(file, id); made0.current.add(id);
            guard();
          }
          setIm({ design_id: id }, picked.kind === "upload" ? "Art uploaded when the reorder was made" : `Art from ${picked.name}`);
          did.push(`${im.location}: art ${picked.kind === "upload" ? "uploaded by you" : `from ${picked.name}`}`);
        } catch (e) { if (e instanceof Cancelled) throw e; did.push(`${im.location}: the art couldn't be saved (${e instanceof Error ? e.message : String(e)}): add it on the order`); }
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
    guard();
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
            setConfirm(null); setHelp(null);
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
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Creating the order">
      <div className={"dla qo" + (help || confirm ? " wide" : "")}>
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
type Item = { key: string; /** the file as it is, to open full size */ open?: string; where: "old" | "kept" | "else"; /** the print it can only be (art already pulled) */ only?: string; path?: string; hint?: string; tag: string; name: string; title?: string; cutUrl: string; asIsUrl: string; canCut: boolean; ready: boolean; pick: (bg: boolean) => HelpPick | null };
type Drawn = { cut: Blob | null; cutUrl: string; asIs: Blob | null; asIsUrl: string; raw: Blob | null };
async function drawFile(url: string, name: string, type: string): Promise<Drawn | null> {
  const r = await fetch(url); if (!r.ok) return null;
  const b = await r.blob();
  const pdfish = /pdf|illustrator/i.test(b.type || type) || /\.(pdf|ai)$/i.test(name);
  const c = pdfish ? await pdfPicture(await b.arrayBuffer(), 1400).catch(() => null) : /^image\/(png|jpe?g|gif|webp)/i.test(b.type) || /\.(png|jpe?g|gif|webp)$/i.test(name) ? await drawPic(URL.createObjectURL(b), 1400) : null;
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
  const [split, setSplit] = useState<Record<string, boolean>>({});
  // per location with a multi-color screen print: were the old job's screens counting an underbase?
  // what you know about each print location (an old Printavo job): colors and underbase, or "don't know", and the width
  const knowLocs = !help.archivedId ? [] : [...new Map(help.prints.filter((p) => (p.method || "screen") === "screen").map((p) => [p.location, p])).values()];
  const [know, setKnow] = useState<Record<string, { colors: number; ub: boolean } | null>>({});
  const [mode, setMode] = useState<"visual" | "details">("visual");
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
  const assign = (key: string, v: string) => setAs((a) => {
    const n: Record<string, string> = {};
    const mine = isPrintVal(v) ? new Set([v, ...(v.startsWith("loc:") ? printsOf(v).map((p) => p.key) : [])]) : new Set<string>();
    for (const [k, x] of Object.entries(a)) if (!(k !== key && mine.has(x))) n[k] = x;
    if (a[key] === v) delete n[key]; else n[key] = v;
    return n;
  });
  const artOf = (pk: string) => { const p = help.prints.find((x) => x.key === pk); return items.find((it) => as[it.key] === pk) || (p ? items.find((it) => as[it.key] === `loc:${p.location}`) : undefined); };
  const given = help.prints.filter((p) => artOf(p.key));
  const olds0 = items.filter((x) => x.where === "old");
  const unanswered = olds0.filter((x) => !as[x.key]).length + knowLocs.filter((p) => !(p.location in know)).length;
  const finish = (rest: "skip" | "production") => {
    const out: Record<string, HelpPick> = {}, once = new Map<string, HelpPick | null>();
    for (const p of help.prints) {
      const it = artOf(p.key);
      if (it && !once.has(it.key)) once.set(it.key, it.pick(!!bgOff[it.key]));
      const pk = it ? once.get(it.key) || null : null;
      out[p.key] = pk || (rest === "production" ? { kind: "production", note: prodNote.trim() } : { kind: "skip" });
    }
    // the old job's files for the new order's Production files: art, mockups and production files (one not answered
    // stays in, as before); "Not needed" ones out
    const files = old === null ? null : olds0.filter((x) => as[x.key] !== "none").map((x) => {
      const role = (as[x.key] === "mockup" ? "mockup" : as[x.key] === "production" || !as[x.key] ? "production" : "art") as "art" | "mockup" | "production";
      return { path: x.path!, name: x.name, role, kind: role === "mockup" ? "old_mockup" : role === "art" ? "print_art" : kindOf[x.key] ?? (aiKind(x.path) || guessProdKind(x.name)), note: (noteOf[x.key] || "").trim() };
    });
    help.resolve({ picks: out, know, mode: help.archivedId ? mode : undefined, place, files, skipped: olds0.filter((x) => as[x.key] === "none").length });
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
    const isArt = isPrintVal(v), p0 = isArt ? printsOf(v)[0] : undefined;
    const setPl = (patch: Partial<{ location: string; size: string }>) => setPlace((x) => { const y = { ...x }; for (const p of printsOf(v)) y[p.key] = { ...y[p.key], ...patch }; return y; });
    const perStyle = !!split[it.key] || (!!v && !v.startsWith("loc:") && isArt);
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
        {!it.only && !perStyle && help.prints.length > locs.length && <button type="button" className="ap-link arc-split" onClick={() => setSplit((x) => ({ ...x, [it.key]: true }))}>Different art for each style…</button>}
        {!v && (it.path && aiG[it.path]?.kind && aiG[it.path].kind !== "?" ? <span className="arc-hint">I think: <b>{prodKindLabel(aiG[it.path].kind)}</b>{aiG[it.path].why ? ` (${aiG[it.path].why})` : ""}. Right?</span> : it.hint ? <span className="arc-hint">{it.hint}?</span> : it.where === "old" && it.path && !aiG[it.path] ? <span className="arc-hint">Looking at it…</span> : null)}
        {it.where === "old" && v === "production" && (
          <label className="arc-kind">What it is
            <select value={kindOf[it.key] ?? (aiKind(it.path) || guessProdKind(it.name))} onChange={(e) => setKindOf((x) => ({ ...x, [it.key]: e.target.value }))}>
              <option value="">Not labeled</option>
              {PROD_KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
            </select>
          </label>
        )}
        {it.where === "old" && v && v !== "none" && <input className="arc-note" value={noteOf[it.key] || ""} onChange={(e) => setNoteOf((x) => ({ ...x, [it.key]: e.target.value }))} placeholder={v === "production" ? 'A note, e.g. "Amazon barcodes for The Bottles"' : "A note for production (optional)"} aria-label="Note on this file" />}
        {it.where === "old" && v && v !== "none" && <span className="arc-hint ok">{v === "mockup" ? "Kept in Production files as the old mockup" : v === "production" ? "Goes in this order's Production files" : "The art; the original also goes in Production files"}</span>}
        {isArt && (
          <div className="arc-place">
            <select value={(p0 && place[p0.key]?.location) || ""} onChange={(e) => setPl({ location: e.target.value })} aria-label="Where it prints">{LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}</select>
            {!help.archivedId && <label><input type="number" min={1} max={16} step={0.25} value={(p0 && place[p0.key]?.size) || ""} placeholder="std" onChange={(e) => setPl({ size: e.target.value })} aria-label="Printed width in inches" /> in wide</label>}
          </div>
        )}
        {isArt && it.canCut && <label className="arc-bg"><input type="checkbox" checked={bg} onChange={(e) => setBgOff((b) => ({ ...b, [it.key]: e.target.checked }))} /> Remove background</label>}
      </div>
    );
  };
  const olds = items.filter((x) => x.where === "old" || x.where === "kept"), elses = items.filter((x) => x.where === "else");
  const opening = old === null || (old || []).some((f) => f.d === undefined);
  const need = locs.map((l) => { const ps = help.prints.filter((p) => p.location === l && !p.design); return `${l}${ps.length > 1 ? ` (${ps.length} styles)` : ""}${ps[0]?.colors > 1 ? `, ${ps[0].colors} colors` : ""}`; }).join("; ");
  return (
    <div className="ap arc" role="group" aria-label="What are these files">
      <p className="ap-q">{old === null ? `Opening ${help.job}…` : olds0.length ? `I found ${olds0.length === 1 ? "this file" : `these ${olds0.length} files`} on ${help.job}. What ${olds0.length === 1 ? "is it" : "are they"}?` : `There are no files on ${help.job}. Where's the art?`}{help.jobUrl && <> <a className="arc-job" href={help.jobUrl} target="_blank" rel="noreferrer">View {help.job.replace(/^(#\d+).*/, "$1")} ↗</a></>}</p>
      <p className="ap-why">{need ? <>This reorder needs art for: <b>{need}</b>. Pick which file is the art; Tick Remove background if it&apos;s on one; then I&apos;ll make the mockup. </> : <>I pulled the art already (first card). </>}Say what every file is: the ones you keep go in this order&apos;s Production files.</p>
      {knowLocs.length > 0 && (
        <div className="arc-ub">
          <b className="arc-ub-h">What do you know about how it printed?</b>
          {knowLocs.map((p) => {
            const dark = help.prints.some((q) => q.location === p.location && q.dark), v = know[p.location], set = p.location in know;
            const ps = help.prints.filter((q) => q.location === p.location), w = place[ps[0].key]?.size || "";
            const setW = (val: string) => setPlace((x) => { const y = { ...x }; for (const q of ps) y[q.key] = { ...y[q.key], size: val }; return y; });
            return (
              <div key={p.location} className="arc-ub-r">
                <span className="arc-ub-l"><b>{p.location}</b> <span className="faint">{help.job.replace(/^(#\d+).*/, "$1")} says {p.colors} color{p.colors === 1 ? "" : "s"}</span></span>
                <span className="arc-chips" role="radiogroup" aria-label={`${p.location} colors`}>
                  <button type="button" role="radio" aria-checked={set && v === null} className={"chip" + (set && v === null ? " on" : "")} onClick={() => setKnow((x) => ({ ...x, [p.location]: null }))}>Don&apos;t know: guess {p.colors}</button>
                  <button type="button" role="radio" aria-checked={!!v} className={"chip" + (v ? " on" : "")} onClick={() => setKnow((x) => ({ ...x, [p.location]: x[p.location] || { colors: dark && p.colors > 1 ? p.colors - 1 : p.colors, ub: dark && p.colors > 1 } }))}>I know</button>
                  {v && <><input type="number" min={1} max={14} value={v.colors} onChange={(e) => setKnow((x) => ({ ...x, [p.location]: { ...v, colors: Math.max(1, +e.target.value || 1) } }))} aria-label="Colors" /> colors <label className="check"><input type="checkbox" checked={v.ub} onChange={(e) => setKnow((x) => ({ ...x, [p.location]: { ...v, ub: e.target.checked } }))} /> + underbase</label><span className="faint">= {v.colors + (v.ub ? 1 : 0)} screens</span></>}
                </span>
                <label className="arc-ub-w">Width <input type="number" min={1} max={16} step={0.25} value={w} placeholder="?" onChange={(e) => setW(e.target.value)} aria-label="Printed width in inches" /> in <span className="faint">{w ? "" : "(blank: don't know)"}</span></label>
              </div>
            );
          })}
          <div className="arc-ub-r arc-mode" role="radiogroup" aria-label="The mockup">
            <span className="arc-ub-l"><b>The mockup</b></span>
            <label className="check"><input type="radio" name="arcmode" checked={mode === "visual"} onChange={() => setMode("visual")} /> Visual only: production confirms the details on the print run <span className="faint">(the customer sees just the mockup, no guessed details)</span></label>
            <label className="check"><input type="radio" name="arcmode" checked={mode === "details"} onChange={() => setMode("details")} /> With these details</label>
          </div>
        </div>
      )}
      {olds.length > 0 && (() => {
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
      {opening && <span className="ap-wait">Opening the old job&apos;s files…</span>}
      <details className="arc-else" open={elseOpen} onToggle={(e) => setElseOpen((e.target as HTMLDetailsElement).open)}>
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
      </details>
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
        {(() => { const n = items.filter((x) => x.where === "old" || x.where === "kept").length, i = Math.min(at, Math.max(0, n - 1)); return n > 1 && i < n - 1 ? <button type="button" className="btn primary" onClick={() => setAt(i + 1)}>Next file ({i + 2} of {n}) ›</button> : null; })() ?? <button type="button" className="btn primary" disabled={!given.length || unanswered > 0} onClick={() => finish("skip")}>{unanswered > 0 ? `Answer the questions (${unanswered} left)` : !given.length ? "Pick the art" : given.length === help.prints.length ? (given.every((p) => as[`K${p.key}`] === p.key) ? "Keep going" : "Use it & make the mockup") : `Keep going (${help.prints.length - given.length} without art)`}</button>}
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
