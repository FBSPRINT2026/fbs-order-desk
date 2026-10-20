"use client";
import { useEffect, useRef, useState } from "react";
import type { Group } from "@/lib/pricing";
import type { EODraft, EOPart, PastJob } from "@/lib/emailOrderShared";
import { createClient } from "@/lib/supabase/client";
import { stampOrderMockups } from "@/lib/mockupStamp";
import { attachFilms, pullReorderArt } from "@/lib/reorderArt";
import { applyColors, checkColors } from "@/components/ColorCheck";
import { uploadDesign } from "@/lib/designs";
import { makePreview } from "@/lib/artPrep";
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
type HelpPick = { kind: "file"; file: File; name: string } | { kind: "upload"; file: File } | { kind: "skip" };
type Help = { job: string; print: string; customerId: string; /** what went wrong bringing it in */ why: string[]; files: { path: string; name: string }[]; resolve: (p: HelpPick) => void };
type Step = { label: string; state: "doing" | "done" | "error"; note?: string };

const pcsOf = (gs: Group[]) => gs.reduce((n, g) => n + g.lines.reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, v) => a + (+v || 0), 0), 0), 0);

export default function QuickOrder({ activityId, start, onClose, onCreated, onReview }: { activityId: string; start: OrderStart; onClose: () => void;
  /** each order made (for the email's notes) */ onCreated: (id: string, number: number, label: string) => void;
  /** open the full form instead (check every detail before it's made) */ onReview: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [made, setMade] = useState<Made[]>([]);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [help, setHelp] = useState<Help | null>(null);
  const ran = useRef(false);

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
      stop();
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
        const n = ims.reduce((a, im) => a + Math.max(1, +im.colors || 1), 0);
        d = { ...d, groups: d.groups.map((x) => ({ ...x, imprints: x.imprints.map((im) => (im.method === "screen" ? { ...im, remake: true } : im)) })) };
        did.push(`Reprint screen fee: ${n} screen${n === 1 ? "" : "s"} at $${g.fees.remake} instead of $${g.fees.screen}`);
      }
    }
    // an old Printavo job: its art from the job's files and the film
    let films: { id: string; name: string }[] = [];
    const why: string[] = [];
    if (d.kind === "reorder" && d.reorderOf && g.customer?.id && d.groups.some((x) => x.imprints.some((im) => !im.design_id))) {
      step(`${of}Pulling the art from ${jobLabel || "the old job"}…`);
      try {
        const r = await pullReorderArt(d, { customerId: g.customer.id, jobLabel: job?.label, jobDate: job?.date, onStep: note });
        d = r.draft; films = r.films;
        const got = d.groups.flatMap((x) => x.imprints).filter((im) => im.design_id).length;
        did.push(got ? `Art pulled from ${jobLabel || "the old job"}${films.length ? `, size from the film ${films.map((f) => f.name).join(", ")}` : ""}` : "No art could be pulled from the old job: add it on the order");
        for (const n of r.notes) { did.push(n); why.push(n); }
      } catch (e) { const m = `The art couldn't be pulled (${e instanceof Error ? e.message : String(e)})`; did.push(m); why.push(m); }
    }
    // a print still without art: stop and ask (Oct 20, Nick: "give us some sort of error… I tried to bring in the art
    // but I couldn't do it… and then some sort of help me out. Every time we create an order from a Printavo invoice
    // there's probably going to be some issue we have to walk through"). Pick one of the old job's files, upload the
    // art, or make the order without it for now.
    for (const [gi, grp] of d.groups.entries()) for (const [ii, im] of grp.imprints.entries()) {
      if (im.design_id || /sleeve/i.test(im.location) || !g.customer?.id || d.kind !== "reorder") continue;
      note("Couldn't bring in the art for this print: waiting for you");
      const files = [...(grp.pvRef || []), ...(grp.pvArt || [])];
      const picked = await new Promise<HelpPick>((resolve) => setHelp({ customerId: g.customer!.id, job: jobLabel || "the old job", print: `${im.location}${im.colors ? `, ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}${d!.groups.length > 1 ? ` (${grp.lines.map((l) => [l.style, l.color].filter(Boolean).join(" ")).slice(0, 2).join(", ")})` : ""}`, files, why, resolve }));
      setHelp(null);
      if (picked.kind === "skip") { did.push(`${im.location}: made without art for now (add it on the order: Upload logo)`); continue; }
      note("Saving the art as their logo…");
      try {
        const file = picked.file;
        // a print file (PDF, AI, EPS, SVG) keeps a picture of it, so the Mockup Creator can use it right away
        const vector = picked.kind === "upload" && !/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name);
        const preview = vector ? await makePreview(/\.ai$/i.test(file.name) ? new File([file], file.name, { type: "application/pdf" }) : file).catch(() => null) : null;
        const dsg = await uploadDesign(createClient(), { draft: true, file, ...(preview ? { preview } : {}), customer_id: g.customer.id, name: d.nickname || "Art", colors: im.colors || 1, inks: im.inks || "", notes: `For the reorder of ${jobLabel}`, method: im.method });
        d = { ...d, groups: d.groups.map((x, xi) => (xi !== gi ? x : { ...x, imprints: x.imprints.map((y, yi) => (yi === ii ? { ...y, design_id: dsg.id, notes: [y.notes, picked.kind === "upload" ? "Art uploaded when the reorder was made" : `Art from ${picked.name}`].filter(Boolean).join(". ").slice(0, 300) } : y)) })) };
        did.push(`${im.location}: art ${picked.kind === "upload" ? "uploaded by you" : `from ${picked.name}`}`);
      } catch (e) { did.push(`${im.location}: the art couldn't be saved (${e instanceof Error ? e.message : String(e)}): add it on the order`); }
    }
    step(`${of}Creating the order…`);
    note(d.kind === "reorder" ? "Copying the job with the new sizes as a quote…" : "Saving it as a quote…");
    const r = await fetch("/api/inbox/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, draft: d, status: "quote" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!r?.ok || !j.id) throw new Error(j.error || "Couldn't create the order.");
    await attachFilms(j.id, films);
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
        try {
          const m = await one(p, parts.length > 1 ? `${i + 1} of ${parts.length} · ` : "");
          if (m) setMade((x) => [...x, m]);
        } catch (e) {
          finishSteps("error");
          setErr(`${p ? `${p.label}: ` : ""}${e instanceof Error ? e.message : String(e)}`);
          if (parts.length === 1) { setDone(true); return; }
        }
      }
      finishSteps(); setDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Creating the order">
      <div className="dla qo">
        {!done ? <>
          <h3>Reading the email and creating the order{start.parts && start.parts.length > 1 ? "s" : ""}…</h3>
          <p className="dla-sub">This takes about a minute{start.parts && start.parts.length > 1 ? " per order" : ""}. Nothing is sent to the customer.</p>
        </> : <h3>{made.length ? `${made.length === 1 ? "Order" : `${made.length} orders`} created` : "The order wasn't made"}</h3>}
        {!done && <ol className="qo-steps">{steps.map((s, i) => <li key={i} className={s.state}><i aria-hidden>{s.state === "done" ? "✓" : s.state === "error" ? "!" : ""}</i><span>{s.label}{s.note && s.state === "doing" && <small className="qo-note" aria-live="polite">{s.note}</small>}</span></li>)}</ol>}
        {help && <ArtHelp help={help} />}
        {made.map((m) => (
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
      </div>
    </div>
  );
}

/**
 * Printavo Art Resolution Center (Oct 20, Nick): when a reorder's art can't be brought in, the old job's files (each
 * drawn as it is and with its flat background taken off) and a talk with the AI about them. The AI looks at the files
 * and offers steps: use a file (with or without its background), search the Dropbox film folder (each film's art to
 * pick from), upload the art, or make the order without it for now.
 */
type Act = { kind: "use_file"; file: number; background: boolean; label: string } | { kind: "search_film"; query: string; label: string } | { kind: "upload"; label: string } | { kind: "skip"; label: string };
type Pic = { name: string; i: number; cut: Blob | null; cutUrl: string; asIs: Blob | null; asIsUrl: string };
function ArtHelp({ help }: { help: Help }) {
  const [pics, setPics] = useState<Pic[]>([]);
  const [left, setLeft] = useState(help.files.length);
  const [chat, setChat] = useState<{ role: "staff" | "ai"; text: string; actions?: Act[] }[]>([]);
  const [say, setSay] = useState(""), [thinking, setThinking] = useState(false);
  const [films, setFilms] = useState<null | { busy?: boolean; note?: string; list: { id: string; name: string }[] }>(null);
  const [pieces, setPieces] = useState<{ name: string; file: File; url: string; size: string }[]>([]);
  const upRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const sb = createClient();
      for (const [i, f] of help.files.entries()) {
        const { data } = await sb.storage.from("proofs").createSignedUrl(f.path, 900);
        const c = data?.signedUrl ? await drawPic(data.signedUrl, 1600) : null;
        if (!live) return;
        if (c) {
          const asIs = await new Promise<Blob | null>((res) => trimToArt(c).toBlob(res, "image/png"));
          knockOutBackground(c);
          const cut = await new Promise<Blob | null>((res) => trimToArt(c).toBlob(res, "image/png"));
          if (!live) return;
          setPics((p) => [...p, { name: realName(f.name, f.path), i: i + 1, cut, cutUrl: cut ? URL.createObjectURL(cut) : "", asIs, asIsUrl: asIs ? URL.createObjectURL(asIs) : "" }]);
        }
        setLeft((n) => n - 1);
      }
    })();
    return () => { live = false; };
  }, [help]);
  async function ask(text: string, film?: string) {
    const next = text ? [...chat, { role: "staff" as const, text }] : chat;
    setChat(next); setSay(""); setThinking(true);
    const r = await fetch("/api/art/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: help.customerId, job: help.job, print: help.print, files: help.files, messages: next.map(({ role, text: t }) => ({ role, text: t })), ...(film ? { film } : {}) }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the AI." }));
    setThinking(false);
    setChat((c) => [...c, r.error ? { role: "ai" as const, text: r.error } : { role: "ai" as const, text: r.reply || "…", actions: r.actions || [] }]);
  }
  // the AI looks first, by itself
  const opened = useRef(false);
  useEffect(() => { if (!opened.current) { opened.current = true; void ask(""); } }); // eslint-disable-line react-hooks/exhaustive-deps
  const useFile = (n: number, background: boolean) => {
    const p = pics.find((x) => x.i === n); const blob = p ? (background ? p.cut : p.asIs) : null;
    if (!p || !blob) return setChat((c) => [...c, { role: "ai", text: `F${n} isn't open yet: give it a second, or pick it from the pictures.` }]);
    help.resolve({ kind: "file", file: new File([blob], `${p.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" }), name: p.name });
  };
  async function searchFilm(q: string) {
    setFilms({ busy: true, list: [] });
    const j = await fetch(`/api/dropbox/film?${new URLSearchParams({ customer: help.customerId, q })}`).then((x) => x.json()).catch(() => null) as { films?: { id: string; name: string }[]; folder?: string | null; error?: string } | null;
    const list = (j?.films || []).filter((f) => /\.(ai|pdf)$/i.test(f.name)).slice(0, 8);
    setFilms({ list, note: !j ? "Dropbox couldn't be searched." : !j.folder ? "No film folder is linked for this customer (link it on the customer page)." : list.length ? `In ${j.folder.replace(/^\/FBS Film Folder\//i, "")}` : `Nothing in ${j.folder.replace(/^\/FBS Film Folder\//i, "")} matches "${q}".` });
  }
  async function openFilm(f: { id: string; name: string }) {
    setFilms((x) => (x ? { ...x, busy: true } : x));
    const c = await fetch("/api/dropbox/film", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }) }).then((z) => z.json()).catch(() => null) as { url?: string } | null;
    let got: { name: string; file: File; url: string; size: string }[] = [];
    try { if (c?.url) got = (await measureFilm(await (await fetch(c.url)).arrayBuffer(), true, f.name)).filter((p) => p.file).map((p) => ({ name: f.name, file: p.file!, url: URL.createObjectURL(p.file!), size: `${p.widthIn}" × ${p.heightIn}"` })); } catch { /* not readable */ }
    setPieces(got);
    setFilms((x) => (x ? { ...x, busy: false, note: got.length ? `The art on ${f.name}: pick the print` : `${f.name} couldn't be read (save it PDF-compatible in Illustrator).` } : x));
  }
  const act = (a: Act) => { if (a.kind === "use_file") useFile(a.file, a.background); else if (a.kind === "search_film") void searchFilm(a.query); else if (a.kind === "upload") upRef.current?.click(); else help.resolve({ kind: "skip" }); };
  return (
    <div className="qo-help arc" role="group" aria-label="Printavo Art Resolution Center">
      <div className="arc-h"><b>Printavo Art Resolution Center</b><span className="faint">{help.job} · {help.print}</span></div>
      <span>I couldn&apos;t bring this print&apos;s art in by myself. Old Printavo jobs keep their art in all kinds of ways: let&apos;s sort it out. Click a picture, upload the art from your computer, or talk it through with me below.</span>
      {help.why.length > 0 && <ul className="arc-why">{help.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      <div className="qo-help-grid">
        {pics.map((p) => (
          <div key={p.i} className="qo-help-it arc-it">
            <span className="arc-f">F{p.i}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.cutUrl || p.asIsUrl} alt="" />
            <span>{p.name}</span>
            <div className="arc-use"><button type="button" className="btn sm" onClick={() => useFile(p.i, true)} title="The flat background taken off">Use, no background</button><button type="button" className="btn sm ghost" onClick={() => useFile(p.i, false)}>As it is</button></div>
          </div>
        ))}
        {left > 0 && <span className="faint qo-help-wait">Opening {left} file{left === 1 ? "" : "s"} from the old job…</span>}
        {!help.files.length && <span className="faint">The old job has no files to pick from.</span>}
      </div>
      <div className="arc-chat" aria-live="polite">
        {chat.map((m, i) => (
          <div key={i} className={"arc-m " + m.role}>
            <span>{m.text}</span>
            {m.actions && m.actions.length > 0 && <div className="arc-acts">{m.actions.map((a, k) => <button key={k} type="button" className={"btn sm" + (k === 0 ? " primary" : "")} onClick={() => act(a)}>{a.label}</button>)}</div>}
          </div>
        ))}
        {thinking && <div className="arc-m ai"><span className="faint">Looking at the old job&apos;s files…</span></div>}
      </div>
      {films && (
        <div className="arc-films">
          {films.busy && !films.list.length ? <span className="faint">Searching the film folder…</span> : <span className="faint">{films.note}</span>}
          <div className="arc-acts">{films.list.map((f) => <button key={f.id} type="button" className="btn sm ghost" disabled={films.busy} onClick={() => void openFilm(f)}>{f.name}</button>)}</div>
          {pieces.length > 0 && <div className="qo-help-grid">{pieces.map((p, i) => (
            <button key={i} type="button" className="qo-help-it" onClick={() => help.resolve({ kind: "file", file: p.file, name: `the film ${p.name}` })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" /><span>{p.size}</span>
            </button>
          ))}</div>}
        </div>
      )}
      <form className="arc-say" onSubmit={(e) => { e.preventDefault(); if (say.trim() && !thinking) void ask(say.trim()); }}>
        <input value={say} onChange={(e) => setSay(e.target.value)} placeholder={'Tell me about it, e.g. "the art is the second PDF" or "check the film for Bottles Onesie"'} aria-label="Talk to the AI about the art" />
        <button type="submit" className="btn sm" disabled={!say.trim() || thinking}>Send</button>
      </form>
      <div className="qo-help-acts">
        <label className="btn sm primary">Upload the art<input ref={upRef} type="file" hidden accept="image/*,application/pdf,.ai,.eps,.svg" onChange={(e) => { const f = e.target.files?.[0]; if (f) help.resolve({ kind: "upload", file: f }); }} /></label>
        <button type="button" className="btn sm ghost" onClick={() => void searchFilm(help.job.replace(/^#\d+\s*/, ""))}>Search the film folder</button>
        <button type="button" className="btn sm ghost" onClick={() => help.resolve({ kind: "skip" })}>Make the order without it for now</button>
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
