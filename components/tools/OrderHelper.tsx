"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { activityFiles, addActivityFile, setRequestFileKinds } from "@/app/shop/order-helper-actions";
import type { OrderStart } from "@/components/OrderStartPick";

/**
 * The Order helper, a choice on the Create order panel (components/OrderStartPick.tsx) beside Make the order and Other
 * options (Nov 6, Nick: "a guided order… read the request… where are the sizes… what are the other files… then make the
 * order… that's what I wanted to go when you create this order"). For anything Create order opens on (an email, a
 * request, a ClickUp job), any customer: what we read, which file has the sizes (or their message), what every other
 * file is (one dropdown each), then Make the order. The answers go to the reader with the order (told), and on a request
 * they're also saved on its files (art_files category), so Production files keep the names. The ONE Create order tool
 * makes the order; nothing here is a second order maker.
 */
type Kind = "sizes" | "supplier_order" | "film" | "customer_mockup" | "art" | "order_sheet" | "other" | "not_needed";
const KINDS: [Kind, string][] = [
  ["sizes", "Has the sizes"], ["supplier_order", "Vendor order confirmation"], ["film", "Customer separations"],
  ["customer_mockup", "Mockup"], ["art", "Art"], ["order_sheet", "Work order / PO"], ["other", "Other production file"], ["not_needed", "Not needed"],
];
const KIND_NOTE: Partial<Record<Kind, string>> = {
  supplier_order: "Kept with the order: who, when and the order number. Never used for sizes.",
  film: "Printed as sent from Their separations.",
};
/** a first guess from the file itself (its saved label, else its name and type) */
type HF = { name: string; path: string; type: string; kind: string };
const guess = (f: HF): Kind => {
  if (f.kind === "po") return "order_sheet";
  if (["supplier_order", "film", "customer_mockup", "art", "not_needed"].includes(f.kind)) return f.kind as Kind;
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
  const [sizesIn, setSizesIn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement | null>(null);
  const about = src?.about || "";
  const inText = useMemo(() => (about.match(SZ) || []).length, [about]);
  useEffect(() => {
    void activityFiles(activityId).then((r) => {
      if (!r.ok) { setErr(r.error); setSrc({ files: [], about: "", orderId: null }); return; }
      setSrc(r); setFiles(r.files);
      setKinds(Object.fromEntries(r.files.map((f) => [f.path, guess(f)])));
      // where the sizes are: their PO when it isn't a vendor's paper, else their message when it has sizes
      const n = (r.about.match(SZ) || []).length;
      setSizesIn(r.files.find((f) => guess(f) === "order_sheet")?.path || (n >= 2 ? "message" : ""));
    });
  }, [activityId]);
  const kindOf = (p: string): Kind => (p === sizesIn ? "sizes" : kinds[p] || "other");
  const setKind = (p: string, k: Kind) => {
    if (k === "sizes") { setSizesIn(p); return; }
    if (p === sizesIn) setSizesIn("");
    setKinds((x) => ({ ...x, [p]: k }));
  };

  async function upload(list: FileList | null, asSizes: boolean) {
    if (!list?.length) return;
    setErr("");
    for (const f of Array.from(list)) {
      setBusy(`Adding ${f.name}…`);
      const path = `${src?.orderId ? `requests/${src.orderId}` : `helper/${activityId}`}/helper-${crypto.randomUUID().slice(0, 8)}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { setErr(`${f.name} didn't upload: ${up.error.message}`); continue; }
      const row = { name: f.name, path, type: f.type || "", kind: "" };
      const r = await addActivityFile(activityId, { ...row, size: f.size });
      if (!r.ok) { setErr(r.error || `${f.name} didn't add.`); continue; }
      setFiles((a) => [...a, row]);
      setKinds((x) => ({ ...x, [path]: guess(row) }));
      if (asSizes) setSizesIn(path);
    }
    setBusy("");
  }

  async function make() {
    setErr("");
    if (src?.orderId) {
      setBusy("Saving what each file is…");
      const r = await setRequestFileKinds(src.orderId, files.map((f) => { const k = kindOf(f.path); return { path: f.path, name: f.name, type: f.type, kind: k === "sizes" ? "order_sheet" : k }; }), { sizesIn, note });
      setBusy("");
      if (!r.ok) { setErr(r.error || "Couldn't save."); return; }
    }
    // what staff said about each file, word for word to the reader (the same words simpleOrderActivity uses)
    const say: Record<Kind, string> = {
      sizes: "has THE SIZES: take every size and quantity from it", supplier_order: "is a vendor order confirmation: read it only for who the blanks were ordered from, when they arrive and the vendor's order number; it can cover several orders, so NEVER take sizes or quantities from it",
      film: "is the customer's own separations (films), printed as sent: not art to separate", customer_mockup: "is their mockup", art: "is the art", order_sheet: "is their work order / PO",
      other: "is a production file to keep with the order", not_needed: "is not needed: ignore it",
    };
    const told = [
      "Staff went through the Order helper; follow it exactly.",
      sizesIn === "message" ? "The sizes and quantities are in their message, not in a file." : !sizesIn ? "" : "",
      ...files.map((f) => `The file "${f.name}" ${say[kindOf(f.path)]}.`),
    ].filter(Boolean).join(" ");
    onMake({ orderType, told, note: note.trim() || undefined });
  }

  const sizesFile = files.find((f) => f.path === sizesIn);
  const vendor = files.filter((f) => kindOf(f.path) === "supplier_order").length;
  const counts = KINDS.map(([k, l]) => [l, files.filter((f) => kindOf(f.path) === k).length] as const).filter(([, n]) => n);
  if (!src) return <div className="ohp"><p className="ohp-p ohp-wait">Reading what they sent…</p></div>;
  return (
    <section className="ohp" aria-label="Order helper">
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
            <div className="ohp-row">
              <select className="ohp-sel" aria-label="Where the sizes are" value={sizesIn} onChange={(e) => { const p = e.target.value; if (p === sizesIn) return; if (sizesIn && sizesIn !== "message") setKinds((x) => ({ ...x, [sizesIn]: x[sizesIn] === "supplier_order" ? "order_sheet" : x[sizesIn] || "order_sheet" })); setSizesIn(p); }}>
                <option value="">Pick where they are</option>
                {inText > 0 && <option value="message">In their message</option>}
                {files.map((f) => <option key={f.path} value={f.path} data-notranslate>{f.name}</option>)}
              </select>
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => { if (pick.current) { pick.current.dataset.sizes = "1"; pick.current.click(); } }}>Add the sizes file</button>
            </div>
            {sizesFile && kinds[sizesFile.path] === "supplier_order" && <p className="ohp-warn">That one looks like a vendor order confirmation. It may cover several orders, so its sizes may not be this order&apos;s.</p>}
            {!sizesIn && <p className="ohp-p">Not sure? Leave it and the AI looks through everything.</p>}
          </div>
        </li>
        <li className="ohp-st">
          <span className="ohp-no">3</span>
          <div className="ohp-b">
            <b>What are the other files?</b>
            {files.length ? <ul className="ohp-files">{files.map((f) => { const k = kindOf(f.path); return (
              <li key={f.path} className="ohp-f">
                <a className="ohp-fn" href={`/api/files/open?${new URLSearchParams({ p: f.path, n: f.name })}`} target="_blank" rel="noreferrer" title={f.name} data-notranslate>{f.name}</a>
                <select className="ohp-sel" aria-label={`What ${f.name} is`} value={k} onChange={(e) => setKind(f.path, e.target.value as Kind)}>
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {KIND_NOTE[k] && <span className="ohp-fnote">{KIND_NOTE[k]}</span>}
              </li>); })}</ul> : <p className="ohp-p">No files.</p>}
            <button type="button" className="linkbtn" disabled={!!busy} onClick={() => { if (pick.current) { pick.current.dataset.sizes = ""; pick.current.click(); } }}>Add a file</button>
            <input ref={pick} type="file" multiple hidden onChange={(e) => { void upload(e.target.files, e.currentTarget.dataset.sizes === "1"); e.target.value = ""; }} />
          </div>
        </li>
        <li className="ohp-st">
          <span className="ohp-no">4</span>
          <div className="ohp-b">
            <b>Make the order</b>
            <p className="ohp-p">Sizes from {sizesIn === "message" ? "their message" : sizesFile ? <span data-notranslate>{sizesFile.name}</span> : "wherever the AI finds them"}{counts.filter(([l]) => l !== "Has the sizes").map(([l, n]) => ` · ${n} ${l.toLowerCase()}`).join("")}.{vendor ? " The vendor confirmation stays with the order for who and when." : ""}</p>
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
