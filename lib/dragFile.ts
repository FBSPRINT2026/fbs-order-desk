/**
 * Dragging a file out of the portal to the desktop (or into another app) drops the FILE, not a shortcut to it (Nov 1,
 * Nick: dragging Dear Heart's PDF out of an email made "DH-WS-COUNT-JOY-PULL-750PCS.pdf92_KB.url"). Chrome and Edge
 * take a DownloadURL ("type:name:url") and save the real file under its own name; other browsers keep the link.
 * Put it on every file tile and link that can be dragged: onDragStart={(e) => dragFile(e, { name, href, type })}.
 */
const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ai: "application/postscript", eps: "application/postscript",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", csv: "text/csv", txt: "text/plain", zip: "application/zip" };
export function dragFile(e: { dataTransfer: DataTransfer | null }, f: { name: string; href?: string | null; type?: string | null }) {
  if (!e.dataTransfer || !f.href) return;
  try {
    const url = new URL(f.href, window.location.href).toString();
    const name = (f.name || "file").replace(/[:\\/\r\n]+/g, " ").trim() || "file";
    const type = f.type || TYPES[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
    e.dataTransfer.setData("DownloadURL", `${type}:${name}:${url}`);
    e.dataTransfer.effectAllowed = "copy";
  } catch { /* the link drags as before */ }
}
