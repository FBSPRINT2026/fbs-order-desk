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

/** an Outlook email's attachments, as files */
export async function msgFiles(f: File): Promise<File[]> {
  const { readMsg } = await import("@/lib/outlookMsg");
  return readMsg(await f.arrayBuffer()).attachments.filter((a) => !sigPic(a.name, a.data.length)).map((a) => new File([a.data as BlobPart], a.name, { type: a.type || "" }));
}

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
  return out.length ? { files: out } : { files: [], error: "That email has no attachments." };
}
