"use client";
import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setRequestFileKinds } from "@/app/shop/order-helper-actions";
import type { DeskRequest } from "@/app/shop/actions";
import type { OrderStart } from "@/components/OrderStartPick";

/**
 * The Order helper (Nov 6, Nick: "a guided order… read the request… where are the sizes… what are the other files… then
 * make the order"). Four steps on the request itself, for any customer: what we read, which file has the sizes (or their
 * message), what every other file is (one dropdown each), then Make the order. The answers are saved on the request's
 * files (art_files category, setRequestFileKinds) and read with it, then the ONE Create order tool
 * (components/tools/CreateOrderTool.tsx) makes the order, so nothing here is a second order maker.
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
const guess = (f: DeskRequest["files"][number]): Kind => {
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

export default function OrderHelper({ job, onMake, onCancel, onChanged }: { job: DeskRequest;
  /** made with the one Create order tool, straight to making it */ onMake: (begin: OrderStart) => void; onCancel: () => void; onChanged?: () => void }) {
  const sb = useMemo(() => createClient(), []);
  const [added, setAdded] = useState<DeskRequest["files"]>([]);
  const files = [...job.files, ...added];
  const inText = useMemo(() => (job.about.match(SZ) || []).length, [job.about]);
  const [kinds, setKinds] = useState<Record<string, Kind>>(() => Object.fromEntries(job.files.map((f) => [f.path, guess(f)])));
  // where the sizes are: their PO when it isn't a vendor's paper, else their message when it has sizes
  const [sizesIn, setSizesIn] = useState<string>(() => job.files.find((f) => guess(f) === "order_sheet")?.path || (inText >= 2 ? "message" : ""));
  const [type, setType] = useState<"new" | "reorder" | "reorder_changes">("new");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement | null>(null);
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
      const path = `requests/${job.id}/helper-${crypto.randomUUID().slice(0, 8)}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { setErr(`${f.name} didn't upload: ${up.error.message}`); continue; }
      const row = { name: f.name, path, type: f.type || "", kind: "", size: f.size };
      setAdded((a) => [...a, row]);
      setKinds((x) => ({ ...x, [path]: guess(row) }));
      if (asSizes) setSizesIn(path);
    }
    setBusy("");
  }

  async function make() {
    setErr(""); setBusy("Saving what each file is…");
    const r = await setRequestFileKinds(job.id, files.map((f) => {
      const k = kindOf(f.path);
      return { path: f.path, name: f.name, type: f.type, kind: k === "sizes" ? "order_sheet" : k };
    }), { sizesIn, note });
    setBusy("");
    if (!r.ok) { setErr(r.error || "Couldn't save."); return; }
    onChanged?.();
    onMake({ orderType: type, told: "Staff went through the Order helper: the request says where the sizes are and what each file is. Follow it exactly.", note: note.trim() || undefined });
  }

  const sizesFile = files.find((f) => f.path === sizesIn);
  const vendor = files.filter((f) => kindOf(f.path) === "supplier_order").length;
  const counts = KINDS.map(([k, l]) => [l, files.filter((f) => kindOf(f.path) === k).length] as const).filter(([, n]) => n);
  return (
    <section className="ohp" aria-label="Order helper">
      <div className="ohp-h"><b>Order helper</b><button type="button" className="linkbtn" onClick={onCancel}>Close</button></div>
      <ol className="ohp-steps">
        <li className="ohp-st">
          <span className="ohp-no">1</span>
          <div className="ohp-b">
            <b>What they sent</b>
            <p className="ohp-p">{files.length} file{files.length === 1 ? "" : "s"}{job.about ? " and a message" : ""}. {inText >= 2 ? `Their message has sizes in it (${inText} found).` : "No sizes in their message."}</p>
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
              <select className="ohp-sel ohp-type" aria-label="Order type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="new">New order</option><option value="reorder">Reorder</option><option value="reorder_changes">Reorder with changes</option>
              </select>
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
