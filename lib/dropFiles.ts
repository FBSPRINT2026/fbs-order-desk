"use client";
/**
 * What's dragged onto a drop box, as files (Nov 1, Nick: "if I'm like in my email or ClickUp… I can drag onto it just
 * an attachment"). One reader for every drop box on the site (the AI order helper, the Mockup Creator's Helper):
 *  - files from the computer, Outlook or Explorer, as they are; an Outlook email (.msg) can be opened into its
 *    attachments (the little pictures in a signature left out);
 *  - a file dragged off another site's page (ClickUp's attachments, Dropbox, Google Drive) comes only as its link:
 *    it's fetched through /api/files/from-url (ClickUp's own files with our ClickUp key).
 */
export const canDrop = (dt: DataTransfer) => { const t = dt.types; return t.includes("Files") || t.includes("text/uri-list") || t.includes("text/html"); };

const isMsg = (f: File) => /\.msg$/i.test(f.name) || /ms-outlook/i.test(f.type);
const sigPic = (name: string, n: number) => n < 15_000 && /image0\d+|outlook|logo/i.test(name);

/** a zip's files beside it, each named after the zip ("DH-WS-Forged-Tee-Char-410pcs › S&S…pdf"), the same as an email's
 *  zipped attachments on the server (lib/mail/zipAttachments.ts; Nov 10, Dear Heart's sizes came zipped) */
export async function withZipsOpened(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    out.push(f);
    if (!(/\.zip$/i.test(f.name) || /zip/i.test(f.type))) continue;
    const { unzip } = await import("@/lib/unzip");
    const inner = await unzip(f).catch(() => [] as File[]);
    const label = f.name.replace(/\.zip$/i, "");
    for (const x of inner.slice(0, 20)) if (x.size && !/^\./.test(x.name)) out.push(new File([x], `${label} › ${x.name.replace(/\.pdf\.pdf$/i, ".pdf")}`, { type: x.type || (/\.pdf$/i.test(x.name) ? "application/pdf" : "") }));
  }
  return out;
}

/** an Outlook email's attachments, as files */
export async function msgFiles(f: File): Promise<File[]> {
  const { readMsg } = await import("@/lib/outlookMsg");
  return withZipsOpened(readMsg(await f.arrayBuffer()).attachments.filter((a) => !sigPic(a.name, a.data.length)).map((a) => new File([a.data as BlobPart], a.name, { type: a.type || "" })));
}

/** an Outlook email as everything in it that can be read (Nov 3, Nick: Fossil's reorder email had the counts in its
 *  words, not an attachment, and the reorder's drop box said "no PDF or picture"): its words as a text file (who it's
 *  from, the subject and the message), then its attachments (signature pictures left out) */
export async function msgAsFiles(f: File): Promise<File[]> {
  const { readMsg } = await import("@/lib/outlookMsg");
  const m = readMsg(await f.arrayBuffer());
  const out: File[] = [];
  const words = [`From: ${m.from}${m.fromEmail ? ` <${m.fromEmail}>` : ""}`, `Subject: ${m.subject}`, "", m.body].join("\n").trim();
  if (m.body.trim()) out.push(new File([words], `${(m.subject || "Email").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80)} (email).txt`, { type: "text/plain" }));
  for (const a of m.attachments) if (!sigPic(a.name, a.data.length)) out.push(new File([a.data as BlobPart], a.name, { type: a.type || "" }));
  return withZipsOpened(out);
}
export const isTextFile = (f: File) => /^text\/plain/i.test(f.type) || /\.txt$/i.test(f.name);

/** a file dragged off a web page: its link, fetched (the first link that gives a file; ClickUp's files first) */
export async function filesFromLinks(dt: DataTransfer): Promise<{ files: File[]; error?: string }> {
  const html = dt.getData("text/html"), list = dt.getData("text/uri-list") || dt.getData("text/plain");
  const urls = [...new Set([...(list.match(/https:\/\/[^\s"'<>]+/g) || []), ...[...html.matchAll(/(?:href|src)=["'](https:\/\/[^"']+)["']/g)].map((m) => m[1].replace(/&amp;/g, "&"))])]
    .sort((a, b) => Number(/clickup-attachments/.test(b)) - Number(/clickup-attachments/.test(a))).slice(0, 3);
  if (!urls.length) return { files: [] };
  let error = "";
  for (const u of urls) {
    const r = await fetch("/api/files/from-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u }) }).catch(() => null);
    if (!r || !r.ok) { if (!error) error = r ? ((await r.json().catch(() => ({}))) as { error?: string }).error || "" : ""; continue; }
    const name = decodeURIComponent(r.headers.get("X-File-Name") || "file");
    return { files: [new File([await r.blob()], name, { type: r.headers.get("Content-Type") || "" })] };
  }
  return { files: [], error: error || "Couldn't get that file. Download it and drop it in." };
}

/** everything dropped, as files; with openEmails, an Outlook email becomes its attachments */
export async function filesFromDrop(dt: DataTransfer, o: { openEmails?: boolean } = {}): Promise<{ files: File[]; error?: string }> {
  const fs = [...dt.files];
  if (!fs.length) return filesFromLinks(dt);
  const out: File[] = [];
  for (const f of fs) {
    if (o.openEmails && isMsg(f)) { try { out.push(...(await msgFiles(f))); } catch { /* not an email after all */ } }
    else out.push(f);
  }
  return out.length ? { files: await withZipsOpened(out) } : { files: [], error: "That email has no attachments." };
}
