"use client";
import { useEffect } from "react";
import { dragFile } from "@/lib/dragFile";

/**
 * Every link to a stored file, on every page, drags out as the file itself (lib/dragFile.ts; Nov 1, Nick: dragging an
 * email's PDF to the desktop made a ".url" shortcut). A link says its file's name with data-file-name or download, or
 * the ?n= the file opener takes; links to our file openers and to storage are files, other links drag as links.
 * Mounted once for the whole site (app/layout.tsx).
 */
const FILE_LINK = /\/api\/(files\/open|mail\/box\?[^#]*do=(attachment|ewsatt)|jobs\/talk\?[^#]*att=)|\/storage\/v1\/object\//;
export default function FileDrag() {
  useEffect(() => {
    const on = (e: DragEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !e.dataTransfer || e.dataTransfer.types.includes("DownloadURL")) return;
      const href = a.href;
      if (!FILE_LINK.test(href) && !a.dataset.fileName && !a.hasAttribute("download")) return;
      let name = a.dataset.fileName || a.getAttribute("download") || "";
      if (!name) { try { name = new URL(href).searchParams.get("n") || ""; } catch { /* none */ } }
      if (!name) name = decodeURIComponent((new URL(href).pathname.split("/").pop() || "file").replace(/^[\w-]{6,}-/, ""));
      dragFile(e, { name, href, type: a.dataset.fileType || null });
    };
    document.addEventListener("dragstart", on, true);
    return () => document.removeEventListener("dragstart", on, true);
  }, []);
  return null;
}
