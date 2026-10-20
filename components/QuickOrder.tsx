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
import { knockOutBackground } from "@/lib/printavoArt";
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
type Help = { job: string; print: string; files: { path: string; name: string }[]; resolve: (p: HelpPick) => void };
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
    if (d.kind === "reorder" && d.reorderOf && g.customer?.id && d.groups.some((x) => x.imprints.some((im) => !im.design_id))) {
      step(`${of}Pulling the art from ${jobLabel || "the old job"}…`);
      try {
        const r = await pullReorderArt(d, { customerId: g.customer.id, jobLabel: job?.label, jobDate: job?.date, onStep: note });
        d = r.draft; films = r.films;
        const got = d.groups.flatMap((x) => x.imprints).filter((im) => im.design_id).length;
        did.push(got ? `Art pulled from ${jobLabel || "the old job"}${films.length ? `, size from the film ${films.map((f) => f.name).join(", ")}` : ""}` : "No art could be pulled from the old job: add it on the order");
        for (const n of r.notes) did.push(n);
      } catch (e) { did.push(`The art couldn't be pulled (${e instanceof Error ? e.message : String(e)})`); }
    }
    // a print still without art: stop and ask (Oct 20, Nick: "give us some sort of error… I tried to bring in the art
    // but I couldn't do it… and then some sort of help me out. Every time we create an order from a Printavo invoice
    // there's probably going to be some issue we have to walk through"). Pick one of the old job's files, upload the
    // art, or make the order without it for now.
    for (const [gi, grp] of d.groups.entries()) for (const [ii, im] of grp.imprints.entries()) {
      if (im.design_id || /sleeve/i.test(im.location) || !g.customer?.id || d.kind !== "reorder") continue;
      note("Couldn't bring in the art for this print: waiting for you");
      const files = [...(grp.pvRef || []), ...(grp.pvArt || [])];
      const picked = await new Promise<HelpPick>((resolve) => setHelp({ job: jobLabel || "the old job", print: `${im.location}${im.colors ? `, ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}${d!.groups.length > 1 ? ` (${grp.lines.map((l) => [l.style, l.color].filter(Boolean).join(" ")).slice(0, 2).join(", ")})` : ""}`, files, resolve }));
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
            {done && <a className="btn primary sm" href={m.url} target="_blank" rel="noreferrer">{m.mockup ? "Make the mockup & view order" : "View order"}</a>}
          </div>
        ))}
        {err && <div className="err">{err}</div>}
        {done && (
          <div className="dla-acts">
            {!made.length && <button type="button" className="btn ghost" onClick={onReview}>Check the details by hand</button>}
            <button type="button" className="btn" onClick={onClose}>Back to the email</button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "I couldn't bring in the art": the old job's files, each drawn (a PDF's first page) with its background taken off as
 * the art would be, to pick from; or upload the art; or make the order without it for now.
 */
function ArtHelp({ help }: { help: Help }) {
  const [pics, setPics] = useState<{ name: string; url: string; png: Blob | null; src: string }[]>([]);
  const [left, setLeft] = useState(help.files.length);
  useEffect(() => {
    let live = true;
    (async () => {
      const sb = createClient();
      for (const f of help.files) {
        const { data } = await sb.storage.from("proofs").createSignedUrl(f.path, 900);
        const c = data?.signedUrl ? await drawPic(data.signedUrl, 1600) : null;
        if (!live) return;
        if (c) {
          // the background off from the edges in, then trimmed to the art
          knockOutBackground(c);
          const t = trimToArt(c);
          const png = await new Promise<Blob | null>((res) => t.toBlob(res, "image/png"));
          if (!live) return;
          if (png) setPics((p) => [...p, { name: realName(f.name, f.path), url: URL.createObjectURL(png), png, src: f.path }]);
        }
        setLeft((n) => n - 1);
      }
    })();
    return () => { live = false; };
  }, [help]);
  return (
    <div className="qo-help" role="group" aria-label="Help with the art">
      <b>I couldn&apos;t bring in the art for the {help.print} print from {help.job}.</b>
      <span>Old Printavo jobs keep their art in all kinds of ways. Pick the picture that&apos;s the print, upload the art, or make the order without it for now.</span>
      <div className="qo-help-grid">
        {pics.map((p) => (
          <button key={p.src} type="button" className="qo-help-it" onClick={() => p.png && help.resolve({ kind: "file", file: new File([p.png], `${p.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" }), name: p.name })} title="Use this as the print's art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" />
            <span>{p.name}</span>
          </button>
        ))}
        {left > 0 && <span className="faint qo-help-wait">Opening {left} file{left === 1 ? "" : "s"} from the old job…</span>}
        {!help.files.length && <span className="faint">The old job has no files to pick from.</span>}
      </div>
      <div className="qo-help-acts">
        <label className="btn sm primary">Upload the art<input type="file" hidden accept="image/*,application/pdf,.ai,.eps,.svg" onChange={(e) => { const f = e.target.files?.[0]; if (f) help.resolve({ kind: "upload", file: f }); }} /></label>
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
