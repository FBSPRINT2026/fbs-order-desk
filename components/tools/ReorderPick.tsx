"use client";
import { openOrderCheck } from "@/components/tools/OrderReview";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadDesign } from "@/lib/designs";
import { newGLine, newImprint, SIZES, type GLine } from "@/lib/pricing";
import type { EODraft } from "@/lib/emailOrderShared";
import type { ReorderFile } from "@/app/api/archive/reorder/route";
import ColorCheck, { applyColors, checkColors, type ColorRow } from "@/components/ColorCheck";
import SizeFitAsk, { applySizeFit, checkSizeFit, type FitRow } from "@/components/SizeFit";
import { QuickLook, type MailFile } from "@/components/MailFolders";
import { dragFile } from "@/lib/dragFile";
import { PROD_KINDS } from "@/lib/productionFileKinds";
import FileThumb from "@/components/FileThumb";

/**
 * Reorder of an old Printavo job, inside THE Create order tool (Nov 1, Nick: "when you click a reorder, you should pop
 * up the create, just like you do in ClickUp and everywhere else… automatically check reorder… just list the goods,
 * list the attachments, everything that's attached… and then a quick picker… what are all these things? what should I
 * do with them? Just sort them to the new order… if I just copy this in Printavo exactly the way it is, my team's
 * gonna know what to do"). Nothing is guessed behind your back: every file on the old job is listed with what it most
 * likely is, you say what each one is, and the order is made from that: art becomes the print at the spot you picked,
 * everything else goes in Production files as what you said it is. The garments and sizes are the old job's; the
 * price is last time's unless you pick today's.
 */
const WHAT: { k: string; label: string; art?: string }[] = [
  // the easy one (Nov 1, Nick: "sometimes I just want to set things generically to production files… the film… the
  // little mock-ups, placement mock-ups. I just want to put all that on production. So easy")
  { k: "production", label: "Production file" },
  { k: "front", label: "Art: front", art: "Full Front" },
  { k: "back", label: "Art: back", art: "Full Back" },
  { k: "left_chest", label: "Art: left chest", art: "Left Chest" },
  { k: "sleeve", label: "Art: sleeve", art: "Left Sleeve" },
  { k: "other_art", label: "Art: another spot", art: "Upper Back (Yoke)" },
  { k: "mockup", label: "Mockup (to look at)" },
  { k: "order_sheet", label: "Their PO / size sheet" },
  { k: "supplier_order", label: "Blank order (S&S, SanMar)" },
  { k: "other", label: "Keep with the job" },
  { k: "skip", label: "Leave it off" },
];
const KIND_OF: Record<string, string> = { mockup: "old_mockup", order_sheet: "order_sheet", supplier_order: "supplier_order", other: "other" };
const href = (f: { path: string; name: string }) => `/api/files/open?${new URLSearchParams({ p: f.path, n: f.name })}`;
/** a production file's label from what the file looked like (a film, a mockup, paperwork) */
const PROD_OF: Record<string, string> = { front: "film", back: "film", left_chest: "embroidery", sleeve: "film", other_art: "film", mockup: "old_mockup", order_sheet: "order_sheet", supplier_order: "supplier_order" };
const styleKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const colorKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameColor = (a: string, b: string) => { const x = colorKey(a), y = colorKey(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
const pcs = (z: Record<string, number>) => Object.values(z).reduce((s, n) => s + (+n || 0), 0);
/** the sizes in the usual order (youth, then S M L XL…), only the ones ordered: "S 50 · M 75 · L 50" */
const sizeText = (z: Record<string, number>) => Object.entries(z).filter(([, n]) => n > 0).sort(([a], [b]) => { const i = (SIZES as readonly string[]).indexOf(a), j = (SIZES as readonly string[]).indexOf(b); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j); }).map(([k, n]) => `${k} ${n}`).join(" · ");
/** "L 225 · M 225 · S 175" → { L: 225, … } */
const sizesOf = (t: string) => Object.fromEntries(t.split("·").map((x) => x.trim().split(/\s+/)).filter((p) => p.length === 2 && +p[1] > 0).map(([k, n]) => [k, +n]));
type Read = { source: string; pieces: number; lines: { style: string; color: string; sizes: Record<string, number> }[]; exact?: boolean };
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type Data = { job: { visual: string; nickname: string; date: string; qty: number; total: number }; customer: { id: string; company: string | null; name: string | null; moved_at: string | null } | null;
  lines: { style: string; brand: string; color: string; garment: string; qty: number; price: number; sizes: string; /** our order's line id */ ref?: string }[]; files: ReorderFile[];
  /** one of our own orders (app/api/orders/reorder) */ own?: boolean;
  /** last time's production and customer notes (Printavo's) */ notes?: { production: string; customer: string } };

export default function ReorderPick({ archivedId = "", orderId = "", onClose, onCreated, into, given }: { archivedId?: string; onClose: () => void; onCreated?: (id: string, number: number, label: string) => void;
  /** one of OUR orders to reorder (Nov 2, Nick: "instead of duplicate… reorder"): the same pop-up, no files to sort */ orderId?: string;
  /** the customer's portal reorder to fill in (keeps its number), and the sizes they gave: shown like a file's, used when you say so (Nov 1) */
  into?: string; given?: { source: string; lines: { style: string; color: string; sizes: Record<string, number> }[] } }) {
  const [d, setD] = useState<Data | null>(null), [err, setErr] = useState(""), [what, setWhat] = useState<Record<string, string>>({});
  const [price, setPrice] = useState<"last" | "today">("last"), [step, setStep] = useState(""), [look, setLook] = useState<number | null>(null);
  const [ask, setAsk] = useState<{ rows: ColorRow[]; done: (r: ColorRow[] | null) => void } | null>(null);
  const [fitAsk, setFitAsk] = useState<{ rows: FitRow[]; done: (r: FitRow[] | null) => void } | null>(null);
  // the sizes first (Nov 1, Nick: "the first thing it should ask is… are we duplicating the sizes and lines?… clear the
  // sizes… or new sizes"): last time's, from a file dropped in Goods (read, shown old → new, used when you say so), or none
  const [sizeMode, setSizeMode] = useState<"same" | "file" | "clear">(given ? "file" : "same");
  const [read, setRead] = useState<Read | null>(given ? { source: given.source, pieces: given.lines.reduce((a, l) => a + pcs(l.sizes), 0), lines: given.lines, exact: true } : null), [readBusy, setReadBusy] = useState(""), [readOk, setReadOk] = useState(!!given);
  const [dropOver, setDropOver] = useState(false), [offOld, setOffOld] = useState<Record<number, boolean>>({}), [addNew, setAddNew] = useState<Record<number, boolean>>({});
  const sizeFile = useRef<HTMLInputElement>(null);
  // the files to read, gathered first (Nov 2, Nick: "drag them in one at a time… there should be a delay… okay, there's
  // all the files, now read"): each drop, paste or pick adds to the list; Read these reads them all together
  const [queued, setQueued] = useState<File[]>([]);
  async function addSizeFiles(fs: (File | Blob)[]) {
    const out: File[] = [];
    for (const f0 of fs) {
      let f = f0 as File; const nm = f.name || `Snip ${queued.length + out.length + 1}.png`;
      if (/\.msg$/i.test(nm) || /ms-outlook/i.test(f.type)) {
        // an email dragged out of Outlook: its PDFs and pictures
        try {
          const { readMsg } = await import("@/lib/outlookMsg");
          const as = readMsg(await f.arrayBuffer()).attachments.filter((x) => /pdf|^image\//i.test(x.type) || /\.(pdf|png|jpe?g)$/i.test(x.name));
          if (!as.length) { setErr("That email has no PDF or picture attached to read sizes from."); continue; }
          for (const a of as) out.push(new File([a.data as BlobPart], a.name, { type: a.type || (/\.pdf$/i.test(a.name) ? "application/pdf" : "image/png") }));
        } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read that email."); }
        continue;
      }
      if (!f.name) f = new File([f0], nm, { type: f0.type || "image/png" });
      if (!/pdf/i.test(f.type) && !/\.pdf$/i.test(f.name) && !/^image\//.test(f.type)) { setErr(`${f.name}: drop a PDF or a picture (a snip works too).`); continue; }
      out.push(f);
    }
    if (out.length) { setSizeMode("file"); setRead(null); setReadOk(false); setErr(""); setQueued((q) => [...q, ...out].slice(0, 8)); }
  }
  async function readSizes(fs: File[]) {
    if (!fs.length) return;
    setSizeMode("file"); setRead(null); setReadOk(false); setErr(""); setReadBusy(fs.length > 1 ? `Reading ${fs.length} files…` : `Reading ${fs[0].name}…`);
    try {
      const images: { media_type: "image/jpeg"; data: string }[] = [], pdfs: string[] = [];
      const pic = (c: HTMLCanvasElement) => images.push({ media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
      const per = Math.max(1, Math.min(3, Math.floor(10 / fs.length)));
      for (const f of fs) {
        if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          const buf = await f.arrayBuffer();
          let bin = ""; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          pdfs.push(btoa(bin));
          const { pdfPictures } = await import("@/lib/printavoArt");
          for (const c of await pdfPictures(buf, 1800, per).catch(() => [] as HTMLCanvasElement[])) pic(c);
        } else {
          const url = URL.createObjectURL(f);
          const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
          const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); pic(c); URL.revokeObjectURL(url);
        }
      }
      const r = await fetch("/api/archive/reorder/sizes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fs.map((f) => f.name).join(", "), count: fs.length, pdfs, images: images.slice(0, 10) }) });
      const j = await r.json().catch(() => ({})) as Read & { error?: string };
      if (!r.ok || j.error) throw new Error(j.error || "Couldn't read the sizes.");
      setRead(j); setOffOld({}); setAddNew({}); setQueued([]);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setReadBusy("");
  }
  // each line of last time against the file: its new sizes, or not on the file
  const match = useMemo(() => {
    if (!d || !read) return null;
    const used = new Set<number>();
    const old = d.lines.map((l) => {
      let k = read.lines.findIndex((r, i) => !used.has(i) && styleKey(r.style) === styleKey(l.style) && sameColor(r.color, l.color));
      if (k < 0) k = read.lines.findIndex((r, i) => !used.has(i) && styleKey(r.style) === styleKey(l.style) && read.lines.filter((z) => styleKey(z.style) === styleKey(l.style)).length === 1 && d.lines.filter((z) => styleKey(z.style) === styleKey(l.style)).length === 1);
      if (k >= 0) used.add(k);
      return { k, was: sizesOf(l.sizes) };
    });
    const extra = read.lines.map((r, i) => ({ r, i })).filter(({ i }) => !used.has(i));
    return { old, extra };
  }, [d, read]);
  useEffect(() => {
    let live = true;
    fetch(orderId ? `/api/orders/reorder?id=${encodeURIComponent(orderId)}` : `/api/archive/reorder?id=${encodeURIComponent(archivedId)}`).then((r) => r.json()).then((j) => {
      if (!live) return;
      if (j.error) { setErr(j.error); return; }
      setD(j as Data);
      setWhat(Object.fromEntries((j as Data).files.map((f) => [f.key, f.guess === "supplier_order" || f.guess === "order_sheet" ? "skip" : (j as Data).own ? (PROD_KINDS.some((k) => k.k === f.guess) ? f.guess : "keep") : "production"])));
    }).catch(() => live && setErr("Couldn't read the old job."));
    return () => { live = false; };
  }, [archivedId, orderId]);
  // last time's notes: brought in unless unticked
  const [keepNote, setKeepNote] = useState<{ production: boolean; customer: boolean }>({ production: true, customer: true });
  const looks: MailFile[] = useMemo(() => (d?.files || []).map((f) => ({ key: f.key, name: f.name, type: f.mime, href: href(f) })), [d]);
  const label = d ? `#${d.job.visual}${d.job.nickname ? ` ${d.job.nickname}` : ""}` : "";
  const lastTotal = d ? d.lines.reduce((s, l) => s + l.qty * l.price, 0) : 0;

  /** our own order: the server copies it with the sizes and price you picked (its art, mockups and files come along) */
  async function makeOwn() {
    if (!d) return;
    setErr(""); setStep("Making the reorder…");
    try {
      const sizes: Record<string, Record<string, number>> = {}, drop: string[] = [], add: { style: string; color: string; sizes: Record<string, number> }[] = [];
      if (sizeMode === "file" && read && match && readOk) {
        d.lines.forEach((l, i) => { const m = match.old[i]; if (!l.ref) return; if (m.k >= 0) sizes[l.ref] = { ...read.lines[m.k].sizes }; else if (offOld[i] !== false) drop.push(l.ref); });
        for (const { r, i } of match.extra) if (addNew[i] !== false) add.push({ style: r.style, color: r.color, sizes: { ...r.sizes } });
      }
      const c = await fetch("/api/orders/reorder", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: orderId, price, mode: sizeMode === "file" && !readOk ? "same" : sizeMode, sizes, drop, add, files: what, carry: (["production", "customer"] as const).filter((k) => d.notes?.[k] && keepNote[k]) }) });
      const k = await c.json().catch(() => ({})) as { id?: string; number?: number; pcs?: number; groups?: number; files?: number; reprint?: boolean; error?: string };
      if (!c.ok || !k.id) throw new Error(k.error || "Couldn't make the reorder.");
      onCreated?.(k.id, k.number || 0, `Reorder of ${label}`);
      setStep("Opening it…");
      openOrderCheck(k.id, [`Made a reorder of ${label}: ${k.groups || 0} group${k.groups === 1 ? "" : "s"}, ${k.pcs || 0} pcs, ${price === "last" ? "last time's prices" : "today's price list"}`, ...(k.files ? [`${k.files} production file${k.files === 1 ? "" : "s"} came with it`] : [])]);
      location.assign(`/shop/orders/${k.id}${k.reprint ? "?reprint=1" : ""}`);
    } catch (e) { setStep(""); setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function make() {
    if (d?.own) return makeOwn();
    if (!d?.customer) return;
    if (!d.customer.moved_at) { setErr("move"); return; }
    setErr("");
    try {
      setStep("Copying the job…");
      const r = await fetch("/api/archive/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: archivedId }) });
      const j = await r.json().catch(() => ({})) as { draft?: EODraft; error?: string };
      if (!r.ok || !j.draft) throw new Error(j.error || "Couldn't copy the job.");
      // only what you chose comes along: the files you sorted (below), the notes you ticked
      let x: EODraft = { ...j.draft, filesChosen: true, carry: (["production", "customer"] as const).filter((k) => d.notes?.[k] && keepNote[k]) };
      // the sizes first: last time's, the file's (when you said Update to these), or none to type in. Then they're
      // checked against the styles, so a youth style's S–XL become YS–YXL whichever sizes they are (Nov 1, Nick: from a
      // file, "It made them all adult": the check ran on last time's sizes, then the file's were laid over it)
      if (sizeMode === "clear") for (const g of x.groups) for (const l of g.lines) l.sizes = {};
      if (sizeMode === "file" && read && match && readOk) {
        const lineOf = (st: string, co: string) => { for (const g of x.groups) for (const l of g.lines) if (styleKey(l.style) === styleKey(st) && sameColor(l.color, co)) return l; return null; };
        d.lines.forEach((ol, i) => {
          const m = match.old[i], l = lineOf(ol.style, ol.color);
          if (!l) return;
          if (m.k >= 0) l.sizes = { ...read.lines[m.k].sizes } as GLine["sizes"];
          else if (offOld[i] !== false) for (const g of x.groups) g.lines = g.lines.filter((z) => z !== l);
        });
        const g0 = x.groups.find((g) => g.lines.length) || x.groups[0];
        for (const { r, i } of match.extra) {
          if (addNew[i] === false || !g0) continue;
          const nl = newGLine(); nl.style = r.style; nl.color = r.color; nl.sizes = { ...r.sizes } as GLine["sizes"];
          g0.lines.push(nl);
        }
        x.groups = x.groups.filter((g) => g.lines.length);
      }
      // sizes a style doesn't come in, and shirt colors that aren't the style's exact name: asked, as everywhere
      setStep("Checking the sizes each style comes in…");
      const sf = await checkSizeFit(x.groups).catch(() => ({ rows: [] as FitRow[], ask: [] as FitRow[] }));
      if (sf.ask.length) { const p = await new Promise<FitRow[] | null>((done) => setFitAsk({ rows: sf.rows, done })); setFitAsk(null); if (!p) { setStep(""); return; } sf.rows = p; }
      if (sf.rows.length) x = { ...x, groups: applySizeFit(x.groups, sf.rows).groups };
      setStep("Checking the shirt colors…");
      const cc = await checkColors(x.groups).catch(() => ({ rows: [] as ColorRow[], ask: [] as ColorRow[] }));
      let rows = cc.rows;
      if (cc.ask.length) { const p = await new Promise<ColorRow[] | null>((done) => setAsk({ rows: cc.rows, done })); setAsk(null); if (!p) { setStep(""); return; } rows = p; }
      if (rows.length) x = { ...x, groups: applyColors(x.groups, rows) };
      // last time's price, or today's list
      for (const g of x.groups) for (const l of g.lines) {
        const pv = (l as { pvPrice?: number }).pvPrice;
        if (price === "last" && pv) l.priceOverride = pv;
        delete (l as { pvPrice?: number }).pvPrice;
      }
      // the art you picked: each file becomes the print at its spot, on the group it came from (art you didn't pick
      // anything for stays as the old job had it: production finds it)
      const sb = createClient();
      const arts = d.files.filter((f) => WHAT.find((w) => w.k === what[f.key])?.art);
      for (const f of arts) {
        const w = WHAT.find((z) => z.k === what[f.key])!;
        setStep(`Bringing in ${f.name}…`);
        const g = x.groups[Math.min(f.group, x.groups.length - 1)] || x.groups[0];
        if (!g) continue;
        const blob = await (await fetch(href(f))).blob();
        let file = new File([blob], f.name, { type: blob.type || f.mime || "application/octet-stream" });
        if (/\.pdf$/i.test(f.path)) {
          const { artFromArtPdf } = await import("@/lib/printavoArt");
          const a = await artFromArtPdf(await blob.arrayBuffer(), f.name.replace(/\.\w+$/, "")).catch(() => null);
          if (a) file = a.file;
        }
        // the print at that spot without art yet, else a new one done the same way as the job's others
        let im = g.imprints.find((p) => !p.design_id && (p.location === w.art || (w.k === "front" && /front/i.test(p.location)) || (w.k === "back" && /back/i.test(p.location))));
        if (!im) {
          const like = g.imprints[0];
          im = newImprint(w.art!);
          im.method = /\.(dst|exp|pes|jef)$/i.test(f.path) ? "embroidery" : like?.method || "screen";
          im.colors = 1;
          im.notes = `From Printavo #${d.job.visual}`;
          g.imprints.push(im);
        }
        const dsg = await uploadDesign(sb, { draft: true, file, customer_id: d.customer.id, name: `${d.job.nickname || "Art"} ${w.art!.toLowerCase()}`, colors: im.colors || 1, inks: im.inks || "", notes: `From Printavo #${d.job.visual}: ${f.name}`, method: im.method });
        im.design_id = dsg.id;
        im.notes = [im.notes, `Art: ${f.name} from Printavo #${d.job.visual}`].filter(Boolean).join(". ").slice(0, 300);
        im.confirm = { size: true, ink: !im.inks, why: `Reorder of Printavo #${d.job.visual}: the art you picked; the size${im.inks ? "" : " and ink"} aren't on file` };
      }
      // a print the old job listed that got no art, when you picked art for that side: it was the same print
      for (const g of x.groups) g.imprints = g.imprints.filter((p, i, all) => p.design_id || !all.some((q) => q !== p && q.design_id && q.location === p.location));
      setStep("Creating the order…");
      const c = await fetch("/api/archive/reorder", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: d.customer.id, draft: x, status: "quote", ...(into ? { into } : {}) }) });
      const k = await c.json().catch(() => ({})) as { id?: string; number?: number; error?: string };
      if (!c.ok || !k.id) throw new Error(k.error || "Couldn't create the order.");
      // every file you kept goes in Production files as what you said it is (the art too, as print art / film)
      setStep("Putting the files on the order…");
      const keep = d.files.filter((f) => what[f.key] !== "skip").map((f) => {
        const w = what[f.key];
        return { order_id: k.id!, name: f.name, file_path: f.path, file_type: f.mime || (/\.pdf$/i.test(f.path) ? "application/pdf" : /\.png$/i.test(f.path) ? "image/png" : "application/octet-stream"),
          category: w === "production" ? (PROD_OF[f.guess] || "other") : WHAT.find((z) => z.k === w)?.art ? (/\.(pdf|ai|eps)$/i.test(f.path) ? "film" : "print_art") : KIND_OF[w] || "other", note: `From Printavo #${d.job.visual} (${WHAT.find((z) => z.k === w)?.label || "kept"})` };
      });
      if (keep.length) await sb.from("art_files").insert(keep);
      onCreated?.(k.id, k.number || 0, `Reorder of ${label}`);
      setStep("Opening it…");
      const first = x.groups.find((g) => g.imprints.some((p) => p.design_id));
      // the AI order helper opens with it, on the right, like a new order from Create order (Nov 1, Nick: "the panel isn't
      // staying open to be like, hey, do I have it right?… open the new file with the AI order helper already open")
      const pcs = x.groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce<number>((c, n) => c + (+(n || 0)), 0), 0), 0);
      openOrderCheck(k.id, [`Made a reorder of ${label}: ${x.groups.length} group${x.groups.length === 1 ? "" : "s"}, ${pcs} pcs, ${price === "last" ? "last time's prices" : "today's price list"}`, ...(keep.length ? [`${keep.length} file${keep.length === 1 ? "" : "s"} from the old job in Production files`] : [])]);
      location.assign(first ? `/shop/artwork/mockup?order=${k.id}&group=${first.id}&auto=1&chat=${k.id}` : `/shop/orders/${k.id}`);
    } catch (e) { setStep(""); setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="dla-bg dock" role="dialog" aria-label="Create reorder">
      <div className="dla osp rop" onClick={(e) => e.stopPropagation()} onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.length && sizeMode === "file") { e.preventDefault(); void addSizeFiles(fs); } }}>
        <h3>Create reorder</h3>
        {!d ? <p className="faint">{err || "Reading the old job…"}</p> : <>
          <div className="osp-card open">
            <div className="osp-card-t"><b>{label}</b><span className="faint">{d.own ? "Our order" : "Printavo"}{d.job.date ? ` · ${new Date(`${d.job.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</span></div>
            <div className="osp-cb-f">
              <div className="field"><label>Order type</label><input value="Reorder" readOnly aria-readonly /></div>
              <div className="field"><label htmlFor="rop-price">Price</label>
                <select id="rop-price" value={price} onChange={(e) => setPrice(e.target.value as "last" | "today")}>
                  <option value="last">Last time&apos;s{lastTotal ? ` (${money(lastTotal)})` : ""}</option>
                  <option value="today">Today&apos;s price list</option>
                </select>
              </div>
            </div>
          </div>

          <section className="rop-sec" aria-label="Goods">
            <div className="rop-h"><b>Goods</b><span className="faint">{d.job.qty ? `${d.job.qty.toLocaleString("en-US")} pcs last time` : ""}</span></div>
            <div className="rop-modes" role="group" aria-label="Sizes">
              {/* three equal parts on one line, short words (Nov 1, Nick: the toolbar "showing two lines and collapsing weird") */}
              {([["same", "Same sizes", "The same sizes as last time"], ["file", "From a file", "New sizes from a confirmation, PO or size sheet"], ["clear", "I'll type", "Clear the sizes and type them"]] as const).map(([k, t, tip]) => <button key={k} type="button" title={tip} className={sizeMode === k ? "on" : ""} aria-pressed={sizeMode === k} onClick={() => { setSizeMode(k); if (k !== "file") setReadOk(false); setPrice(k === "same" ? "last" : "today"); }}>{t}</button>)}
            </div>
            {/* new sizes: the price asked about, recalculated unless unticked (Nov 1, Nick: "do you want me to recalculate the
                price and or keep the price the same as before?… by default… checked, recalculate price") */}
            {sizeMode !== "same" && (
              <label className="check rop-reprice"><input type="checkbox" checked={price === "today"} onChange={(e) => setPrice(e.target.checked ? "today" : "last")} />Recalculate the price for the new sizes<span className="faint">{price === "today" ? "today's price list" : `keeps last time's prices${lastTotal ? ` (${money(lastTotal)})` : ""}`}</span></label>
            )}
            {sizeMode === "file" && !read && (
              <button type="button" className={"rop-drop" + (dropOver ? " over" : "")} onClick={() => sizeFile.current?.click()} disabled={!!readBusy}
                onDragOver={(e) => { e.preventDefault(); setDropOver(true); }} onDragLeave={() => setDropOver(false)} onDrop={(e) => { e.preventDefault(); setDropOver(false); void addSizeFiles([...e.dataTransfer.files]); }}>
                <b>{readBusy || (queued.length ? "Drop or paste another file" : "Drop or paste the S&S / SanMar confirmations, PO or size sheet")}</b>{!readBusy && <span>{queued.length ? "Add every file first, then press Read." : "One or several: PDFs, pictures or snips (Ctrl+V). Nothing is read until you press Read."}</span>}
              </button>
            )}
            {sizeMode === "file" && !read && queued.length > 0 && (
              <div className="rop-q">
                {queued.map((f, k) => <span key={k} className="rop-qf" data-notranslate>{f.name}<button type="button" aria-label={`Take off ${f.name}`} onClick={() => setQueued((q) => q.filter((_, x) => x !== k))}>×</button></span>)}
                <span className="spacer" />
                <button type="button" className="btn sm primary" disabled={!!readBusy} onClick={() => void readSizes(queued)}>{readBusy ? "Reading…" : `Read ${queued.length === 1 ? "this file" : `these ${queued.length} files`}`}</button>
              </div>
            )}
            <input ref={sizeFile} type="file" hidden multiple accept="application/pdf,.pdf,image/*,.msg" onChange={(e) => { void addSizeFiles([...(e.target.files || [])]); e.target.value = ""; }} />
            {read && match && (
              <div className={"rop-read" + (readOk ? " ok" : "")}>
                <div className="rop-read-h"><b data-notranslate>{read.source}</b><span className="faint">{read.pieces.toLocaleString("en-US")} pcs</span></div>
                {d.lines.map((l, i) => { const m = match.old[i], now = m.k >= 0 ? read.lines[m.k].sizes : null; return (
                  <div key={i} className="rop-cmp">
                    <div className="rop-l1"><b data-notranslate>{l.style}</b> <span>{l.color}</span><span className="spacer" />{now ? <span className="rop-n"><b>{pcs(now).toLocaleString("en-US")} pcs</b> <span className="faint">(last time {pcs(m.was).toLocaleString("en-US")})</span></span> : null}</div>
                    {/* the new order's sizes as they are, not old → new (Nov 2, Nick: "just say what they are… it's confusing") */}
                    {now ? <div className="rop-l2" data-notranslate>{sizeText(now) || "None this time"}</div>
                      : <label className="rop-chk"><input type="checkbox" checked={offOld[i] !== false} onChange={(e) => setOffOld((o) => ({ ...o, [i]: e.target.checked }))} /> Not on this file: leave it off this time</label>}
                  </div>); })}
                {match.extra.map(({ r, i }) => (
                  <div key={`n${i}`} className="rop-cmp">
                    <div className="rop-l1"><b data-notranslate>{r.style}</b> <span>{r.color}</span><span className="spacer" /><span className="rop-n"><b>{pcs(r.sizes).toLocaleString("en-US")} pcs</b> <span className="faint">(new)</span></span></div>
                    <div className="rop-l2" data-notranslate>{sizeText(r.sizes)}</div>
                    <label className="rop-chk"><input type="checkbox" checked={addNew[i] !== false} onChange={(e) => setAddNew((o) => ({ ...o, [i]: e.target.checked }))} /> Not on last time&apos;s job: add it</label>
                  </div>
                ))}
                <div className="rop-read-go">
                  {/* once you've said Update to these, it's done: a plain "updated" line, nothing more to answer (Nov 2, Nick:
                      "I already said update the lines. I'm confused"); Undo goes back a step */}
                  {readOk ? <><span className="rop-done">✓ Updated: these sizes go on the reorder.</span><span className="spacer" /><button type="button" className="linkbtn" onClick={() => setReadOk(false)}>Undo</button></>
                    : <><span className="spacer" /><button type="button" className="btn sm" onClick={() => { setRead(null); setReadOk(false); setSizeMode("same"); }}>Keep last time&apos;s</button>
                      <button type="button" className="btn sm primary" onClick={() => setReadOk(true)}>Update to these</button></>}
                </div>
              </div>
            )}
            {(sizeMode !== "file" || !read) && d.lines.map((l, i) => (
              <div key={i} className="rop-line">
                <div className="rop-l1"><b data-notranslate>{l.style}</b> <span>{l.color}</span><span className="spacer" /><span className="rop-n">{sizeMode === "clear" ? "sizes to type" : `${l.qty.toLocaleString("en-US")} × ${money(l.price)}`}</span></div>
                <div className="faint rop-l2" data-notranslate>{l.brand ? `${l.brand} · ` : ""}{sizeMode === "clear" ? "" : l.sizes}</div>
              </div>
            ))}
          </section>

          {d.own && <section className="rop-sec"><div className="rop-h"><b>Art and mockups</b><span className="faint">come with it, as they are on #{d.job.visual}</span></div></section>}
          <section className="rop-sec" aria-label="Files on the old job">
            {/* our own order's Production files are asked about too, each starting as what it is there (Nov 2, Nick, #40359) */}
            <div className="rop-h"><b>{d.own ? "Production files" : "Everything attached"}</b>{d.files.length ? <button type="button" className="linkbtn rop-all" onClick={() => setWhat(Object.fromEntries(d.files.map((f) => [f.key, d.own ? (PROD_KINDS.some((k) => k.k === f.guess) ? f.guess : "keep") : "production"])))}>{d.own ? "Keep them all" : "All to Production files"}</button> : <span className="faint">{d.own ? `No production files on #${d.job.visual}` : "No files on the old job"}</span>}</div>
            {d.files.map((f, i) => (
              <div key={f.key} className={"rop-file" + (what[f.key] === "skip" ? " off" : "")}>
                <button type="button" className="rop-th" onClick={() => setLook(i)} title="Look at it" draggable onDragStart={(e) => dragFile(e, { name: f.name, href: href(f), type: f.mime })}>
                  {f.thumb ? <img src={href({ path: f.thumb, name: f.name })} alt="" loading="lazy" /> : <FileThumb name={f.name} url={href(f)} mime={f.mime} />}
                </button>
                <div className="rop-fi">
                  <button type="button" className="linkbtn rop-fn" onClick={() => setLook(i)} data-notranslate>{f.name}</button>
                  <span className="faint">{[f.where, f.why].filter(Boolean).join(" · ")}</span>
                </div>
                <select className="rop-what" value={what[f.key] || (d.own ? "keep" : "other")} onChange={(e) => setWhat((w) => ({ ...w, [f.key]: e.target.value }))} aria-label={`What ${f.name} is`}>
                  {d.own ? <>{PROD_KINDS.map((w) => <option key={w.k} value={w.k}>{w.label}</option>)}<option value="keep">Production file</option><option value="skip">Leave it off</option></>
                    : WHAT.map((w) => <option key={w.k} value={w.k}>{w.label}</option>)}
                </select>
              </div>
            ))}
          </section>
          {(d.notes?.production || d.notes?.customer) && (
            <section className="rop-sec">
              <div className="rop-h"><b>Notes from last time</b><span className="faint">tick what comes along</span></div>
              {(["production", "customer"] as const).filter((k) => d.notes?.[k]).map((k) => (
                <label key={k} className="rop-note">
                  <input type="checkbox" checked={keepNote[k]} onChange={(e) => setKeepNote((n) => ({ ...n, [k]: e.target.checked }))} />
                  <span><b>{k === "production" ? "Production notes" : "Customer notes"}</b><span className="rop-note-t" data-notranslate>{d.notes![k]}</span></span>
                </label>
              ))}
            </section>
          )}
          {err && <div className="err">{err === "move" ? <>This customer isn&apos;t in the new system yet. <a href={`/shop/customers/${d.customer?.id}`}>Move them first</a>, then Reorder.</> : err}</div>}
        </>}
        {fitAsk && <SizeFitAsk inline rows={fitAsk.rows} onDone={(r) => fitAsk.done(r)} onCancel={() => fitAsk.done(null)} />}
        {ask && <ColorCheck inline rows={ask.rows} onDone={(r) => ask.done(r)} onCancel={() => ask.done(null)} />}
        <div className="dla-acts">{step && <span className="faint rop-step">{step}</span>}<span className="spacer" />{/* a question open above has its own buttons: one set at a time */}{!fitAsk && !ask && <><button type="button" className="btn ghost" onClick={onClose} disabled={!!step}>Cancel</button><button type="button" className="btn primary" disabled={!d || !!step || (sizeMode === "file" && !readOk)} title={sizeMode === "file" && !readOk ? "Drop the file with the new sizes and press Update to these first" : undefined} onClick={() => void make()}>Make the reorder</button></>}</div>
      </div>
      {look != null && looks[look] && <QuickLook files={looks} at={look} strip title={label} onClose={() => setLook(null)} />}
    </div>
  );
}
