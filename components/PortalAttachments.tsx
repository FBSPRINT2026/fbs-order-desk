"use client";
import { useState } from "react";
import FileThumb from "@/components/FileThumb";
import { canQuickLook, QuickLook, type MailFile } from "@/components/MailFolders";

/**
 * The files a customer sent with an order, as pictures; a click opens the same quick look as ClickUp and order entry (Nov 2,
 * Nick: "when the customer clicks… that same little preview pop-up thing that we built for ClickUp and for order entry").
 * Ctrl/⌘-click still opens a tab; a phone opens the file itself.
 */
export default function PortalAttachments({ files }: { files: { path: string; name: string; kind?: string; url: string }[] }) {
  const [look, setLook] = useState<number | null>(null);
  const mf: MailFile[] = files.map((f) => ({ key: f.path, name: f.name, href: f.url || undefined }));
  const can = mf.filter(canQuickLook);
  if (!files.length) return <div className="faint">No attachments.</div>;
  return (<>
    <div className="pod-att">{files.map((f, i) => (
      <a key={f.path} className="pod-att-t" href={f.url || undefined} target="_blank" rel="noreferrer"
        onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !canQuickLook(mf[i]) || window.innerWidth < 760) return; e.preventDefault(); setLook(i); }}>
        <span className="pod-att-i"><FileThumb name={f.name} url={f.url || undefined} /></span>
        <span className="pod-att-c"><b>{f.name}</b><small>{f.kind === "po" ? "PO" : f.kind === "art" ? "Art" : "File"}</small></span>
      </a>))}</div>
    {look != null && mf[look] && <QuickLook files={can} at={can.indexOf(mf[look])} onClose={() => setLook(null)} />}
  </>);
}
