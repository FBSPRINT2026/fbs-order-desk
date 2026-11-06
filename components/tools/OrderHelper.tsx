"use client";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { activityFiles, addActivityFile, setRequestFileKinds } from "@/app/shop/order-helper-actions";
import type { OrderStart } from "@/components/OrderStartPick";

/**
 * The Order helper, a choice on the Create order panel (components/OrderStartPick.tsx) beside Make the order and Other
 * options (Nov 6, Nick: "a guided order… read the request… where are the sizes… what are the other files… then make the
 * order… that's what I wanted to go when you create this order"). For anything Create order opens on (an email, a
 * request, a ClickUp job), any customer: what we read, which files have the sizes (any number, or their message; drop, paste or
 * pick more), what every file is (one dropdown each), then Make the order. The answers go to the reader with the order (told), and on a request
 * they're also saved on its files (art_files category), so Production files keep the names. The ONE Create order tool
 * makes the order; nothing here is a second order maker.
 */
type Kind = "supplier_order" | "film" | "customer_mockup" | "art" | "order_sheet" | "other" | "not_needed";
const KINDS: [Kind, string][] = [
  ["order_sheet", "Work order / PO"], ["supplier_order", "Vendor order confirmation"], ["film", "Customer separations"],
  ["customer_mockup", "Mockup"], ["art", "Art"], ["other", "Other production file"], ["not_needed", "Not needed"],
];
const KIND_NOTE: Partial<Record<Kind, string>> = {
  supplier_order: "Kept with the order: who, when and the order number. Its sizes are used only when it's ticked in step 2.",
  film: "Printed as sent from Their separations.",
};
/** a first guess from the file itself (its saved label, else its name and type) */
type HF = { name: string; path: string; type: string; kind: string };
const guess = (f: HF): Kind => {
  if (f.kind === "po") return "order_sheet";
  if (["supplier_order", "film", "customer_mockup", "art", "not_needed", "order_sheet"].includes(f.kind)) return f.kind as Kind;
  if (f.kind === "print_art") return "art";
  const n = f.name.toLowerCase();
  if (/order[\s_-]*confirm|orderdetail|order[\s_-]*detail|sanmar|s&s|ss[\s_-]*activewear|alpha[\s_-]*broder|invoice/.test(n)) return "supplier_order";
  if (/\bseps?\b|separation|film/.test(n)) return "film";
  if (/mock/.test(n)) return "customer_mockup";
  if (/\.(ai|eps|svg|png|jpe?g|psd|tiff?)$/.test(n)) return "art";
  if (/\b(po|order|work[\s_-]*order)\b|_order_|purchase/.test(n)) return "order_sheet";
  return "other";
};
/** sizes written in their message: "S 12, M 24…", "2XL - 6" */
const SZ = /\b(?:y?xs|y?s|y?m|y?l|y?xl|[2-6]x(?:l)?|xxl|xxxl|small|medium|large|x-large)\b\s*[-:=x×]?\s*\(?\d{1,4}\)?/gi;

export default function OrderHelper({ activityId, orderType, onMake }: { activityId: string; /** the panel's Order type */ orderType: "new" | "reorder" | "reorder_changes";
  /** straight to making it, in the same Create order tool */ onMake: (begin: OrderStart) => void }) {
  const sb = useMemo(() => createClient(), []);
  const [src, setSrc] = useState<null | { files: HF[]; about: string; orderId: string | null }>(null);
  const [files, setFiles] = useState<HF[]>([]);
  const [kinds, setKinds] = useState<Record<string, Kind>>({});
  // which files have the sizes: any number of them (Nov 6, Nick: "all 3 of those [S&S order confirmations] might… say has
  // the sizes"), and/or their message
  const [sizes, setSizes] = useState<Set<string>>(new Set());
  const [inMsg, setInMsg] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement | null>(null);
  const about = src?.about || "";
  const inText = useMemo(() => (about.match(SZ) || []).length, [about]);
  useEffect(() => {
    void activityFiles(activityId).then((r) => {
      if (!r.ok) { setErr(r.error); setSrc({ files: [], about: "", orderId: null }); return; }
      setSrc(r); setFiles(r.files);
      setKinds(Object.fromEntries(r.files.map((f) => [f.path, guess(f)])));
      // first guess: their PO, else their message when it has sizes
      const po = r.files.filter((f) => guess(f) === "order_sheet").map((f) => f.path);
      setSizes(new Set(po));
      setInMsg(!po.length && (r.about.match(SZ) || []).length >= 2);
    });
  }, [activityId]);
  const kindOf = (p: string): Kind => kinds[p] || "other";
  const tick = (p: string, on: boolean) => setSizes((x) => { const y = new Set(x); if (on) y.add(p); else y.delete(p); return y; });

  /** files dropped, picked or pasted (a size sheet, an email, a screenshot, copied text); in step 2 they have the sizes */
  async function add(list: File[], asSizes: boolean) {
    if (!list.length) return;
    setErr("");
    for (const f of list) {
      setBusy(`Adding ${f.name}…`);
      const path = `${src?.orderId ? `requests/${src.orderId}` : `helper/${activityId}`}/helper-${crypto.randomUUID().slice(0, 8)}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { setErr(`${f.name} didn't upload: ${up.error.message}`); continue; }
      const row = { name: f.name, path, type: f.type || "", kind: "" };
      const r = await addActivityFile(activityId, { ...row, size: f.size });
      if (!r.ok) { setErr(r.error || `${f.name} didn't add.`); continue; }
      setFiles((a) => [...a, row]);
      setKinds((x) => ({ ...x, [path]: asSizes ? "order_sheet" : guess(row) }));
      if (asSizes) tick(path, true);
    }
    setBusy("");
  }
  const onDrop = (e: DragEvent, asSizes: boolean) => { e.preventDefault(); setOver(false); void add(Array.from(e.dataTransfer.files || []) as File[], asSizes); };
  const onPaste = (e: ClipboardEvent) => {
    const fs = Array.from(e.clipboardData.files || []) as File[];
    const t = e.clipboardData.getData("text/plain");
    if (fs.length) { e.preventDefault(); void add(fs, true); return; }
    if (t.trim()) { e.preventDefault(); void add([new File([t], `Pasted sizes ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/[: ]/g, "")}.txt`, { type: "text/plain" })], true); }
  };

  async function make() {
    setErr("");
    if (src?.orderId) {
      setBusy("Saving what each file is…");
      const r = await setRequestFileKinds(src.orderId, files.map((f) => ({ path: f.path, name: f.name, type: f.type, kind: kindOf(f.path) })), { sizesIn: [...(inMsg ? ["message"] : []), ...sizes].join("|"), note });
      setBusy("");
      if (!r.ok) { setErr(r.error || "Couldn't save."); return; }
    }
    // what staff said about each file, word for word to the reader (the same words simpleOrderActivity uses)
    const say: Record<Kind, string> = {
      supplier_order: "is a vendor order confirmation: who the blanks were ordered from, when they arrive and the vendor's order number", film: "is the customer's own separations (films), printed as sent: not art to separate",
      customer_mockup: "is their mockup", art: "is the art", order_sheet: "is their work order / PO", other: "is a production file to keep with the order", not_needed: "is not needed: ignore it",
    };
    const many = sizes.size + (inMsg ? 1 : 0) > 1;
    const told = [
      "Staff went through the Order helper; follow it exactly.",
      sizes.size || inMsg ? `The sizes and quantities come ONLY from ${[inMsg ? "their message" : "", ...files.filter((f) => sizes.has(f.path)).map((f) => `"${f.name}"`)].filter(Boolean).join(" and ")}${many ? ": add them all up, each one's lines as they are" : ""}; take no sizes from any other file.` : "",
      ...files.map((f) => `The file "${f.name}" ${say[kindOf(f.path)]}${sizes.has(f.path) ? " and HAS THE SIZES" : kindOf(f.path) === "supplier_order" ? "; it can cover several orders, so NEVER take sizes or quantities from it" : ""}.`),
    ].filter(Boolean).join(" ");
    onMake({ orderType, told, note: note.trim() || undefined, roles: Object.fromEntries(files.map((f) => [f.path, kindOf(f.path)])), roleFiles: files.map((f) => ({ path: f.path, name: f.name, type: f.type })) });
  }

  const vendor = files.filter((f) => kindOf(f.path) === "supplier_order").length;
  const counts = KINDS.map(([k, l]) => [l, files.filter((f) => kindOf(f.path) === k).length] as const).filter(([, n]) => n);
  const from = [inMsg ? "their message" : "", ...files.filter((f) => sizes.has(f.path)).map((f) => f.name)].filter(Boolean);
  if (!src) return <div className="ohp"><p className="ohp-p ohp-wait">Reading what they sent…</p></div>;
  return (
    <section className="ohp" aria-label="Order helper" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, false)}>
      <ol className="ohp-steps">
        <li className="ohp-st">
          <span className="ohp-no">1</span>
          <div className="ohp-b">
            <b>What they sent</b>
            <p className="ohp-p">{files.length} file{files.length === 1 ? "" : "s"}{about ? " and a message" : ""}. {inText >= 2 ? `Their message has sizes in it (${inText} found).` : "No sizes in their message."}</p>
          </div>
        </li>
        <li className="ohp-st">
          <span className="ohp-no">2</span>
          <div className="ohp-b">
            <b>Where are the sizes?</b>
            <span className="ohp-p">Tick every one that has sizes. They&apos;re added together.</span>
            <ul className="ohp-szl">
              {about && <li><label className="ohp-ck"><input type="checkbox" checked={inMsg} onChange={(e) => setInMsg(e.target.checked)} /> <span>In their message{inText ? ` (${inText} sizes found)` : ""}</span></label></li>}
              {files.map((f) => <li key={f.path}><label className="ohp-ck"><input type="checkbox" checked={sizes.has(f.path)} onChange={(e) => tick(f.path, e.target.checked)} /> <span data-notranslate>{f.name}</span></label></li>)}
            </ul>
            <div className={"ohp-drop" + (over ? " over" : "")} role="button" tabIndex={0} aria-label="Drop, paste or pick a file with the sizes"
              onClick={() => { if (pick.current) { pick.current.dataset.sizes = "1"; pick.current.click(); } }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.stopPropagation(); onDrop(e, true); }} onPaste={onPaste}>
              <b>Drop, paste or pick the sizes</b>
              <span>A size sheet, an email, a screenshot, or text copied from anywhere (click here, then Ctrl+V)</span>
            </div>
            {!from.length && <p className="ohp-p">Not sure? Leave them unticked and the AI looks through everything.</p>}
          </div>
        </li>
        <li className="ohp-st">
          <span className="ohp-no">3</span>
          <div className="ohp-b">
            <b>What are the files?</b>
            {files.length ? <ul className="ohp-files">{files.map((f) => { const k = kindOf(f.path); return (
              <li key={f.path} className="ohp-f">
                <a className="ohp-fn" href={`/api/files/open?${new URLSearchParams({ p: f.path, n: f.name })}`} target="_blank" rel="noreferrer" title={f.name} data-notranslate>{f.name}{sizes.has(f.path) ? <span className="ohp-sz">has the sizes</span> : null}</a>
                <select className="ohp-sel" aria-label={`What ${f.name} is`} value={k} onChange={(e) => setKinds((x) => ({ ...x, [f.path]: e.target.value as Kind }))}>
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {KIND_NOTE[k] && <span className="ohp-fnote">{KIND_NOTE[k]}</span>}
              </li>); })}</ul> : <p className="ohp-p">No files.</p>}
            <button type="button" className="linkbtn" disabled={!!busy} onClick={() => { if (pick.current) { pick.current.dataset.sizes = ""; pick.current.click(); } }}>Add a file (or drop it anywhere here)</button>
            <input ref={pick} type="file" multiple hidden onChange={(e) => { void add(Array.from(e.target.files || []) as File[], e.currentTarget.dataset.sizes === "1"); e.target.value = ""; }} />
          </div>
        </li>
        <li className="ohp-st">
          <span className="ohp-no">4</span>
          <div className="ohp-b">
            <b>Make the order</b>
            <p className="ohp-p">Sizes from {from.length ? <span data-notranslate>{from.join(" + ")}</span> : "wherever the AI finds them"}{counts.map(([l, n]) => ` · ${n} ${l.toLowerCase()}`).join("")}.{vendor ? " Vendor confirmations stay with the order for who and when." : ""}</p>
            <div className="ohp-row">
              <input className="ohp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to tell the AI? Only the tees, use the 400 sheet" aria-label="Anything to tell the AI" />
            </div>
            <div className="ohp-row">
              <button type="button" className="btn primary" disabled={!!busy} onClick={() => void make()}>Make the order</button>
              {busy && <span className="faint">{busy}</span>}
            </div>
            {err && <div className="err">{err}</div>}
          </div>
        </li>
      </ol>
    </section>
  );
}
