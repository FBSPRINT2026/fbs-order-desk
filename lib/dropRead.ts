"use client";
/**
 * What staff drop or paste into the AI order helper (Nov 1, Nick: "if I take like a PDF or snipping… or an email from
 * Outlook… and just drop it in"): pictures made small enough to send, a PDF's pages as pictures (only the pages it has),
 * and an Outlook email (.msg) read into its words plus its attachments' pictures. One reader for every drop box.
 */
export type DropPic = { media_type: "image/jpeg"; data: string; url: string };
export type DropRead = { pics: DropPic[]; names: string[]; /** an Outlook email's words, for the AI */ text?: string; /** what the chat shows for it */ label?: string };

/** a picture made small enough to send (longest side 2000px, JPEG on white) */
export async function shrinkPic(f: Blob): Promise<DropPic | null> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("bad image")); i.src = url; });
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    const d = c.toDataURL("image/jpeg", 0.85);
    return { media_type: "image/jpeg", data: d.split(",")[1], url: d };
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** a PDF's pages (up to 3, only the ones it has) as pictures */
export async function pdfPics(f: Blob): Promise<DropPic[]> {
  try {
    const { pdfPictures } = await import("@/lib/printavoArt");
    return (await pdfPictures(await f.arrayBuffer(), 1800, 3)).map((c) => { const d = c.toDataURL("image/jpeg", 0.85); return { media_type: "image/jpeg" as const, data: d.split(",")[1], url: d }; });
  } catch { return []; }
}

const isPdf = (f: Blob, name: string) => /pdf/i.test(f.type) || /\.pdf$/i.test(name);
const isPic = (f: Blob, name: string) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(name);

export async function readDrop(fs: (File | Blob)[]): Promise<DropRead> {
  const msg = fs.find((f) => /\.msg$/i.test((f as File).name || "") || /ms-outlook/i.test(f.type));
  if (msg) {
    const { readMsg } = await import("@/lib/outlookMsg");
    const m = readMsg(await msg.arrayBuffer());
    const pics: DropPic[] = [], other: string[] = [];
    for (const a of m.attachments.slice(0, 6)) {
      const b = new Blob([a.data as BlobPart], { type: a.type || (/\.pdf$/i.test(a.name) ? "application/pdf" : "") });
      if (isPdf(b, a.name)) pics.push(...(await pdfPics(b)));
      // the little pictures in a signature aren't attachments anyone sent on purpose
      else if (isPic(b, a.name)) { if (a.data.length < 15_000 && /image0\d+|outlook|logo/i.test(a.name)) continue; const p = await shrinkPic(b); if (p) pics.push(p); }
      else other.push(a.name);
    }
    const text = [`Dropped an email from Outlook.`, `From: ${m.from}${m.fromEmail ? ` <${m.fromEmail}>` : ""}`, m.to ? `To: ${m.to}` : "", m.cc ? `Cc: ${m.cc}` : "", `Subject: ${m.subject}`, "", m.body.slice(0, 5000),
      m.attachments.length ? `\nAttachments: ${m.attachments.map((a) => a.name).join(", ")}${other.length ? ` (${other.join(", ")} can't be shown here)` : ""}` : "\nNo attachments."].filter((x) => x !== "").join("\n");
    return { pics: pics.slice(0, 6), names: [m.subject || "Email"], text, label: `Dropped an email: ${m.subject || "(no subject)"}${m.attachments.length ? ` · ${m.attachments.length} attachment${m.attachments.length === 1 ? "" : "s"}` : ""}` };
  }
  const pics: DropPic[] = [], names: string[] = [];
  for (const f of fs.slice(0, 4)) {
    const nm = (f as File).name || "";
    if (isPdf(f, nm)) { const ps = await pdfPics(f); if (ps.length) { pics.push(...ps); names.push(nm || "PDF"); } }
    else if (isPic(f, nm)) { const p = await shrinkPic(f); if (p) { pics.push(p); names.push(nm || "Snip"); } }
  }
  return { pics: pics.slice(0, 6), names };
}
