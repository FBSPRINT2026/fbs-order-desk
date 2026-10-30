"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SearchInput from "@/components/SearchInput";
import CustomerPick from "@/components/CustomerPick";
import CreateOrderTool from "@/components/tools/CreateOrderTool";
import { AI_TOOLS, type AiTool } from "@/lib/aiTools";
import { uploadTarget } from "@/app/shop/ai/actions";
import { orderSources, sourceFromFiles, type OrderSource } from "@/app/shop/ai/tool-actions";
import { heldFiles } from "@/lib/heldFiles";

/**
 * AI Workbench → Tools (Oct 23, Nick: "have the tools also available as a button in the AI workbench… start thinking of
 * each of these as an individual tool that just gets applied multiple places in the site"). Every AI tool on the site,
 * with where it shows up and a button to use it from here: the same tool every button opens (lib/aiTools.ts).
 */
const GROUPS: AiTool["group"][] = ["Orders", "Art & mockups", "Email", "Production", "Goods", "Search"];

export default function AiTools() {
  const [open, setOpen] = useState<AiTool | null>(null);
  const go = (t: AiTool) => {
    if ("here" in t.open) return setOpen(t);
    if (t.open.href === "#ask") {
      const box = document.querySelector<HTMLInputElement>('input[aria-label^="Ask AI or search"]');
      if (box) { box.focus(); box.scrollIntoView({ block: "center" }); }
      return;
    }
    location.href = t.open.href;
  };
  return (
    <div className="ait">
      <p className="faint ait-intro">Each tool is one tool, the same wherever its button shows up. Use it from here, or from the places listed on it.</p>
      {GROUPS.map((g) => {
        const list = AI_TOOLS.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="panel ait-g">
            <div className="panel-h"><h2>{g}</h2><span className="faint">{list.length} tool{list.length === 1 ? "" : "s"}</span></div>
            <div className="panel-b ait-grid">
              {list.map((t) => (
                <div key={t.id} className="ait-card">
                  <b className="ait-n">{t.name}</b>
                  <p className="ait-w">{t.what}</p>
                  <div className="ait-p"><span className="ait-l">Used in</span>{t.places.join(" · ")}</div>
                  <button type="button" className={"btn sm" + ("here" in t.open ? " primary" : "")} onClick={() => go(t)}>{"here" in t.open ? `Open ${t.name.split(" /")[0]}` : t.open.label}</button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {open?.id === "create-order" && <CreateOrderLauncher onClose={() => setOpen(null)} />}
    </div>
  );
}

type Up = { id: string; name: string; type: string; size: number; path: string; busy: boolean; err?: string };

/** Create order from the Workbench: an email or ClickUp job already here, or files dropped in for a customer */
function CreateOrderLauncher({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"mail" | "files">("mail");
  const [q, setQ] = useState(""), [list, setList] = useState<OrderSource[] | null>(null), [err, setErr] = useState("");
  const [run, setRun] = useState<{ id: string; text: string } | null>(null);
  const [made, setMade] = useState<{ id: string; number: number } | null>(null);
  const [cust, setCust] = useState<{ id: string; label: string } | null>(null), [note, setNote] = useState(""), [files, setFiles] = useState<Up[]>([]), [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (tab !== "mail") return;
    const t = setTimeout(async () => { const r = await orderSources(q); if (r.ok) { setList(r.list); setErr(""); } else setErr(r.error); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, tab]);
  async function add(fs: FileList | File[]) {
    for (const f of Array.from(fs).slice(0, 12)) {
      const u: Up = { id: Math.random().toString(36).slice(2), name: f.name, type: f.type, size: f.size, path: "", busy: true };
      setFiles((x) => [...x, u]);
      const t = await uploadTarget(f.name, f.size);
      const up = t.ok ? await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined }) : null;
      setFiles((x) => x.map((y) => (y.id === u.id ? { ...y, busy: false, path: t.ok && up && !up.error ? t.path : "", err: !t.ok ? t.error : up?.error ? up.error.message : undefined } : y)));
    }
  }
  async function startFiles() {
    if (!cust) return setErr("Pick the customer first.");
    setBusy(true); setErr("");
    const r = await sourceFromFiles({ customerId: cust.id, note, files: files.filter((f) => f.path).map((f) => ({ name: f.name, path: f.path, type: f.type, size: f.size })) });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setRun({ id: r.id, text: `${r.text} ${note}` });
  }
  if (run) return (
    <CreateOrderTool activityId={run.id} text={run.text} onClose={() => { setRun(null); if (made) onClose(); }}
      onCreated={(id, number) => setMade({ id, number })} />
  );
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Create order" onClick={onClose}>
      <div className="dla ait-launch" onClick={(e) => e.stopPropagation()}>
        <h3>Create order / reorder</h3>
        <p className="dla-sub">The same Create order as on emails and ClickUp jobs. Pick what to make it from.</p>
        {made && <p className="ait-made">Order <b>#{made.number}</b> made. <a href={`/shop/orders/${made.id}`}>Open it</a></p>}
        <div className="toolbar"><div className="chips">
          <button type="button" className={"chip" + (tab === "mail" ? " on" : "")} onClick={() => setTab("mail")}>An email or ClickUp job</button>
          <button type="button" className={"chip" + (tab === "files" ? " on" : "")} onClick={() => setTab("files")}>Files (PO, work order, art)</button>
        </div></div>
        {tab === "mail" ? <>
          <SearchInput autoFocus placeholder="Find by subject or sender" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="tbl-wrap ait-src"><table className="tbl"><tbody>
            {(list || []).map((s) => (
              <tr key={s.id} onClick={() => setRun({ id: s.id, text: s.subject })} style={{ cursor: "pointer" }}>
                <td><div data-notranslate>{s.subject}</div><div className="sub" data-notranslate>{[s.customer || s.from, s.kind === "clickup" ? "ClickUp job" : s.kind === "files" ? "Workbench files" : "Email", s.files ? `${s.files} file${s.files === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</div></td>
                <td className="r" style={{ whiteSpace: "nowrap" }}>{fmt(s.when)}</td>
              </tr>
            ))}
            {list && !list.length && <tr><td className="faint">Nothing matches.</td></tr>}
            {!list && <tr><td className="faint">Loading…</td></tr>}
          </tbody></table></div>
        </> : <div className="ait-files"
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void add(e.dataTransfer.files); }}>
          <div className="mk-f"><span>Customer</span><CustomerPick field value={cust?.id || null} label={cust?.label} onPick={(id, label) => setCust(id ? { id, label } : null)} /></div>
          <button type="button" className="btn sm" onClick={() => pick.current?.click()}>Add files…</button> <span className="faint">or drop them here</span>
          <input ref={pick} type="file" multiple hidden onChange={(e) => { if (heldFiles(e.target.files)) void add(heldFiles(e.target.files)); e.target.value = ""; }} />
          {files.length > 0 && <ul className="ait-fl">{files.map((f) => <li key={f.id}><span data-notranslate>{f.name}</span> <span className={f.err ? "err" : "faint"}>{f.err || (f.busy ? "Uploading…" : "Ready")}</span> <button type="button" className="lc-link" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>Remove</button></li>)}</ul>}
          <label className="mk-f"><span>Anything to know first (optional)</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder='e.g. "Reorder of 31174" or "Same as last time but navy"' /></label>
        </div>}
        {err && <p className="err">{err}</p>}
        <div className="dla-acts">
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          {tab === "files" && <button type="button" className="btn primary" disabled={busy || files.some((f) => f.busy) || !cust || (!files.some((f) => f.path) && !note.trim())} onClick={() => void startFiles()}>{busy ? "Starting…" : "Read them and make the order"}</button>}
        </div>
      </div>
    </div>
  );
}
