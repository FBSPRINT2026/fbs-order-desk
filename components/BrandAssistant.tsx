"use client";
import { createContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { useSticky } from "@/lib/useSticky";
import { fmtStamp } from "@/lib/format";
import type { BrandFile, BrandMsg } from "@/lib/brandStandards";

/**
 * "Set up with AI" on a customer's Brand standards (Oct 16, Nick: "talk through it and you can set it up… any admin
 * should be able to do it"). Owners and admins describe the standards or attach the brand guide; the AI proposes the
 * changes and nothing is saved until Apply. Wraps the editors so they reload with what was applied.
 */
const post = async (body: Record<string, unknown>) => {
  const r = await fetch("/api/ai/brand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: "No answer from the server." }))) as { ok: boolean; error?: string; off?: boolean; messages?: BrandMsg[] };
};
const OP = { "+": "add", "~": "chg", "-": "del" } as const;
/**
 * Whether Brand standards is being edited, and where "+ Add" goes on its title line (Oct 21, Nick: "all you should show
 * in there is just the tags… no other brand standards"): the sections read it to show only what's on file when locked.
 * Outside Brand standards it reads as editing, so the editors work as before.
 */
export const BrandEdit = createContext<{ editing: boolean; setEditing: (v: boolean) => void; slot: HTMLElement | null }>({ editing: true, setEditing: () => {}, slot: null });

export default function BrandAssistant({ customerId, customerName, children, onApplied }: { customerId: string; customerName: string; children: ReactNode; onApplied?: () => void }) {
  const { role, realRole } = useRole();
  const can = ["owner", "admin"].includes(realRole || role);
  // a pane on the right of Brand standards, opened from the button on its title line (Oct 16, Nick); remembered
  const [open, setOpen] = useSticky("brand.aiOpen", false);
  const [msgs, setMsgs] = useState<BrandMsg[] | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ver, setVer] = useState(0);
  // locked unless Edit is clicked (Oct 16, Nick: "you can just X delete something easily… locked, click to edit");
  // starts locked every visit on purpose
  const [editing, setEditing] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || msgs) return;
    post({ customerId, action: "thread" }).then((r) => (r.ok ? setMsgs(r.messages || []) : setErr(r.error || "Couldn't load the conversation.")));
  }, [open, msgs, customerId]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  async function send() {
    if (busy || (!text.trim() && !files.length)) return;
    setErr("");
    let up: BrandFile[] = [];
    if (files.length) {
      setBusy("Uploading…");
      const sb = createClient();
      for (const f of files) {
        const path = `brand-guides/${customerId}/${Date.now().toString(36)}-${f.name.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
        const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
        if (error) { setBusy(""); return setErr(`${f.name}: ${error.message}`); }
        up.push({ path, name: f.name, type: f.type });
      }
    }
    const said = text;
    // show it right away while the AI reads
    setMsgs((m) => [...(m || []), { role: "staff", text: said, at: new Date().toISOString(), files: up.length ? up : undefined }]);
    setText(""); setFiles([]);
    setBusy(up.some((f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) ? "Reading the brand guide… (can take a minute)" : "Thinking…");
    const r = await post({ customerId, action: "chat", text: said, files: up });
    setBusy("");
    if (!r.ok) { setErr(r.error || "Something went wrong."); setMsgs((m) => (m || []).slice(0, -1)); setText(said); up = []; return; }
    setMsgs(r.messages || []);
  }
  async function decide(i: number, action: "apply" | "dismiss") {
    setBusy(action === "apply" ? "Applying…" : ""); setErr("");
    const r = await post({ customerId, action, index: i });
    setBusy("");
    if (!r.ok) return setErr(r.error || "Couldn't do that.");
    setMsgs(r.messages || []);
    if (action === "apply") { setVer((v) => v + 1); onApplied?.(); }
  }

  const showTime = (k: number) => { const l = msgs || []; return k === 0 || new Date(l[k].at).getTime() - new Date(l[k - 1].at).getTime() > 30 * 60_000; };
  return (
    <div className={"bai" + (open ? " open" : "")}>
      {/* even with the Brand standards title, at the right (Oct 16, Nick) */}
      <div className="bai-btns">
        <span ref={setSlot} className="bai-slot" />
        <button type="button" className={"bai-edit" + (editing ? " on" : "")} onClick={() => setEditing((x) => !x)} aria-pressed={editing} title={editing ? "Lock brand standards again" : "Brand standards are locked. Click to change them."}>{editing ? "✓ Done" : "✎ Edit"}</button>
        {can && <button type="button" className={"bai-btn" + (open ? " on" : "")} onClick={() => setOpen((x) => !x)} aria-expanded={open}>✦ {open ? "Close AI" : "Set up with AI"}</button>}
      </div>
      <div className="bai-wrap">
        <div className="bai-ed" key={ver}><BrandEdit.Provider value={{ editing, setEditing, slot }}><fieldset className="bs-lock" disabled={!editing} data-locked={!editing || undefined}>{children}</fieldset></BrandEdit.Provider></div>
        {can && open && (
          // looks like Apple Messages (Oct 16, Nick): blue bubbles for us, gray for the AI, a rounded message field
          <section className="im" aria-label="Set up brand standards with AI">
            <div className="im-h">
              <span className="im-av" aria-hidden="true">✦</span>
              <span className="im-who"><b>Brand standards AI</b><small>{customerName}</small></span>
              <button type="button" className="im-done" onClick={() => setOpen(false)}>Done</button>
            </div>
            <div className="im-msgs">
              {msgs && !msgs.length && (
                <div className="im-row them"><div className="im-b them">Tell me their standards the way you&apos;d say them, or tap + to attach their brand guide. Like: &quot;Their navy is 289 C and gray is Cool Gray 5 C. Distressed logos are a fashion hit with soft hand. On navy shirts the logos print white.&quot; I&apos;ll show you the changes first; nothing is saved until you tap Apply.</div></div>
              )}
              {!msgs && !err && <div className="im-time">Loading…</div>}
              {(msgs || []).map((m, i) => (
                <div key={i} className="im-grp">
                  {showTime(i) && <div className="im-time">{fmtStamp(m.at)}</div>}
                  {m.role === "staff" ? (
                    <>
                      {m.files?.map((f) => <div key={f.path} className="im-row me"><div className="im-file">📄 <span>{f.name}</span></div></div>)}
                      {m.text && <div className="im-row me"><div className="im-b me">{m.text}</div></div>}
                      {m.by && <div className="im-by me">{m.by.split("@")[0]}</div>}
                    </>
                  ) : (
                    <>
                      {m.text && <div className="im-row them"><div className="im-b them">{m.text}</div></div>}
                      {m.lines?.length ? (
                        <div className="im-row them">
                          <div className={"im-card " + (m.status || "")}>
                            <div className="im-card-h">{m.status === "applied" ? "✓ Applied" : m.status === "dismissed" ? "Not applied" : "Changes to make"}</div>
                            {m.lines.map((l, k) => (
                              <div key={k} className="im-line"><span className={"op " + OP[l.op]}>{l.op === "-" ? "−" : l.op}</span><span className="what">{l.what}</span><span className="txt">{l.hex && <i className="dot" style={{ background: l.hex }} />}{l.text}</span></div>
                            ))}
                            {m.status === "open" ? (
                              <div className="im-acts"><button type="button" className="im-apply" disabled={!!busy} onClick={() => decide(i, "apply")}>{busy === "Applying…" ? "Applying…" : "Apply"}</button><button type="button" className="im-later" disabled={!!busy} onClick={() => decide(i, "dismiss")}>Not yet</button></div>
                            ) : m.done_at ? <div className="im-card-f">{m.status === "applied" ? "Applied" : "Set aside"} by {(m.done_by || "").split("@")[0]} · {fmtStamp(m.done_at)}</div> : null}
                          </div>
                        </div>
                      ) : null}
                      {m.question && <div className="im-row them"><div className="im-b them">{m.question}</div></div>}
                    </>
                  )}
                </div>
              ))}
              {busy && busy !== "Applying…" && (
                <div className="im-row them"><div className="im-b them typing" title={busy} aria-label={busy}><i /><i /><i /></div>{/pdf|guide/i.test(busy) && <span className="im-note">{busy}</span>}</div>
              )}
              <div ref={end} />
            </div>
            {err && <div className="im-err">{err}</div>}
            {files.length > 0 && <div className="im-staged">{files.map((f, i) => <span key={i}>📄 {f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>✕</button></span>)}</div>}
            <div className="im-in">
              <label className="im-plus" title="Attach their brand guide (PDF) or pictures" aria-label="Attach files">+<input type="file" hidden multiple accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const l = Array.from(e.target.files || []) as File[]; setFiles((x) => [...x, ...l].slice(0, 4)); e.target.value = ""; }} /></label>
              <div className="im-field">
                <textarea rows={1} value={text} placeholder="Message" aria-label="Message" onChange={(e) => { setText(e.target.value); const t = e.target; t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight) + "px"; }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <button type="button" className="im-send" aria-label="Send" disabled={!!busy || (!text.trim() && !files.length)} onClick={send}>↑</button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
