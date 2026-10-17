"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
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

export default function BrandAssistant({ customerId, customerName, children, onApplied }: { customerId: string; customerName: string; children: ReactNode; onApplied?: () => void }) {
  const { role, realRole } = useRole();
  const can = ["owner", "admin"].includes(realRole || role);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<BrandMsg[] | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ver, setVer] = useState(0);
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

  if (!can) return <>{children}</>;
  return (
    <div className={"bai" + (open ? " open" : "")}>
      <div className="bai-top"><button type="button" className={"bai-btn" + (open ? " on" : "")} onClick={() => setOpen((x) => !x)} aria-expanded={open}>✦ {open ? "Close the AI" : "Set up with AI"}</button></div>
      <div className="bai-wrap">
        <div className="bai-ed" key={ver}>{children}</div>
        {open && (
          <section className="bai-chat" aria-label="Brand standards assistant">
            <div className="bai-h"><b>✦ Brand standards assistant</b><span className="faint">{customerName} · owners and admins</span></div>
            <div className="bai-msgs">
              {msgs && !msgs.length && <div className="bai-hint">Tell me their standards in your own words, or attach their brand guide (PDF or pictures). For example: <i>&quot;Their navy is 289 C and gray is Cool Gray 5 C. Distressed logos are a fashion hit with soft hand. On navy shirts the logos print white.&quot;</i> I&apos;ll propose the setup; nothing changes until you click Apply.</div>}
              {!msgs && !err && <div className="faint">Loading…</div>}
              {(msgs || []).map((m, i) => m.role === "staff" ? (
                <div key={i} className="bai-me">{m.text}{m.files?.length ? <div className="bai-files">{m.files.map((f) => <span key={f.path}>📄 {f.name}</span>)}</div> : null}<small>{m.by ? m.by.split("@")[0] + " · " : ""}{fmtStamp(m.at)}</small></div>
              ) : (
                <div key={i} className="bai-ai">
                  <div>{m.text}</div>
                  {m.lines?.length ? (
                    <div className={"bai-prop " + (m.status || "")}>
                      <b className="t">{m.status === "applied" ? "Applied" : m.status === "dismissed" ? "Not applied" : "Changes"}</b>
                      {m.lines.map((l, k) => (
                        <div key={k} className="bai-line"><span className={"op " + OP[l.op]}>{l.op === "-" ? "−" : l.op}</span><span className="what">{l.what}</span><span className="txt">{l.hex && <i className="dot" style={{ background: l.hex }} />}{l.text}</span></div>
                      ))}
                      {m.status === "open" ? (
                        <div className="bai-acts"><button type="button" className="btn sm primary" disabled={!!busy} onClick={() => decide(i, "apply")}>{busy === "Applying…" ? "Applying…" : "Apply these changes"}</button><button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => decide(i, "dismiss")}>Not yet</button></div>
                      ) : m.done_at ? <small className="faint">{m.status === "applied" ? "Applied" : "Set aside"} by {(m.done_by || "").split("@")[0]}, {fmtStamp(m.done_at)}</small> : null}
                    </div>
                  ) : null}
                  {m.question && <div className="bai-q">{m.question}</div>}
                </div>
              ))}
              {busy && busy !== "Applying…" && <div className="bai-ai busy">{busy}</div>}
              <div ref={end} />
            </div>
            {err && <div className="err" style={{ margin: "0 12px" }}>{err}</div>}
            {files.length > 0 && <div className="bai-staged">{files.map((f, i) => <span key={i}>📄 {f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>✕</button></span>)}</div>}
            <div className="bai-in">
              <label className="bai-clip" title="Attach their brand guide (PDF) or pictures">📎<input type="file" hidden multiple accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const l = Array.from(e.target.files || []) as File[]; setFiles((x) => [...x, ...l].slice(0, 4)); e.target.value = ""; }} /></label>
              <textarea rows={2} value={text} placeholder="Describe their standards, or attach a brand guide…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button type="button" className="btn primary" disabled={!!busy || (!text.trim() && !files.length)} onClick={send}>Send</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
