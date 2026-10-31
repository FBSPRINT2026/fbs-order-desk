"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Imprint } from "@/lib/pricing";

/**
 * Customer supplied transfers (Oct 27, Nick: "you should be able to just upload the placement reference… you can even put
 * in there where it came from, like DTF Dallas… the order number"): who made them, their order number, and the
 * placement reference (their mockup). A PDF's first page is made into the picture the order and the work order show.
 *
 * On the order's Goods panel with their transfers' tracking (Oct 31, Nick: "It should be on the goods page. And if Peter
 * supplies the order number, we should just put it in there"); the print keeps the tick and a one-line note.
 */
export default function SuppliedBox({ d, onChange, url }: { d: Imprint; onChange: (fn: (im: Imprint) => void) => void; url: (path: string) => string }) {
  const sup = d.supplied || {};
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const inRef = useRef<HTMLInputElement>(null);
  const made = useRef(false);
  async function put(file: Blob, name: string, pdf: boolean, keepFile?: string) {
    const sb = createClient(), key = `designs/placement-${crypto.randomUUID().slice(0, 8)}`;
    const safe = name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-90) || "placement";
    let file0 = keepFile || "";
    if (!keepFile) { const up = await sb.storage.from("proofs").upload(`${key}/${safe}`, file, { contentType: file.type || undefined }); if (up.error) throw new Error(up.error.message); file0 = `${key}/${safe}`; }
    let pic = pdf ? "" : file0;
    if (pdf) {
      const { pdfPicture } = await import("@/lib/printavoArt");
      const c = await pdfPicture(await file.arrayBuffer(), 1600);
      const png = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (png) { const up = await sb.storage.from("proofs").upload(`${key}/${safe.replace(/\.[^.]+$/, "")}.png`, png, { contentType: "image/png" }); if (!up.error) pic = `${key}/${safe.replace(/\.[^.]+$/, "")}.png`; }
    }
    onChange((im) => { im.supplied = { ...(im.supplied || {}), picture: { path: pic, name, file: file0 } }; });
  }
  async function upload(f: File) {
    setBusy("Uploading the placement reference…"); setErr("");
    try { await put(f, f.name, /\.pdf$/i.test(f.name) || f.type === "application/pdf"); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't upload it."); }
    finally { setBusy(""); }
  }
  // made by Create order from their PDF: its first page made into the picture, once
  useEffect(() => {
    const pr = sup.picture;
    if (made.current || !pr?.file || pr.path) return;
    made.current = true;
    void (async () => {
      setBusy("Making a picture of their placement reference…");
      try {
        const { data } = await createClient().storage.from("proofs").download(pr.file!);
        if (data) await put(data, pr.name, true, pr.file);
      } catch { /* the PDF stays; upload a picture by hand */ }
      setBusy("");
    })();
  }, [sup.picture?.file, sup.picture?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const pic = sup.picture?.path ? url(sup.picture.path) : "";
  return (
    <div className="imp-sup">
      <div className="imp-sup-f">
        <label><span className="imp-l">Supplied by</span><input type="text" placeholder="Who made them" value={sup.by || ""} onChange={(e) => onChange((im) => { im.supplied = { ...(im.supplied || {}), by: e.target.value.slice(0, 60) }; })} /></label>
        <label><span className="imp-l">Their order #</span><input type="text" placeholder="When they give it" value={sup.ref || ""} onChange={(e) => onChange((im) => { im.supplied = { ...(im.supplied || {}), ref: e.target.value.slice(0, 60) }; })} /></label>
        <label><span className="imp-l">Where they go</span><input type="text" placeholder="Front, back…" value={sup.where || ""} onChange={(e) => onChange((im) => { im.supplied = { ...(im.supplied || {}), where: e.target.value.slice(0, 60) }; })} /></label>
      </div>
      <span className="imp-l">Placement reference</span>
      <div className="imp-sup-ref">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {pic ? <img src={pic} alt="Placement reference" /> : <div className="imp-sup-none">{sup.picture?.file ? "Their PDF" : "None yet"}</div>}
        <div>
          {sup.picture?.name && <div className="imp-sup-n">{sup.picture.name}</div>}
          <div className="faint">Their mockup of where the transfers go. Shown on the order and the work order; not priced.</div>
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => inRef.current?.click()}>{sup.picture ? "Replace" : "Upload the placement reference"}</button>
          <input ref={inRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          {busy && <div className="faint">{busy}</div>}
          {err && <div className="err">{err}</div>}
        </div>
      </div>
    </div>
  );
}
