"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtStamp } from "@/lib/format";
import { approveArtAnotherWay, remindProof, restoreVersion, sendProofVersion } from "@/app/shop/proof-actions";
import { PROOF_COLS, versionState, type ProofRow } from "@/components/ProofHistory";

/**
 * Beside the Proof history on the Art & production tab (Oct 16, Nick):
 *  - Mockup history: every Mockup Creator save, which one is current, which were sent (as which version), going back
 *    to an earlier one, and sending the current one to the customer as the next version.
 *  - Customer approval: the proof out with the customer, whether they've opened it, and what to do: remind them, or
 *    "approved another way", which overrides every other approval.
 */
type Mk = { id: string; title: string; file_path: string; group_id: string | null; created_at: string; created_by: string; archived_at: string | null; snapshot: { imprints?: { location?: string; size?: string }[] } | null };

const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
};

export default function ProofSide({ orderId, bump, onChanged, customer, email }: { orderId: string; bump?: number; onChanged: () => void; customer: string; email: string }) {
  const sb = useMemo(() => createClient(), []);
  const [mocks, setMocks] = useState<Mk[]>([]);
  const [proofs, setProofs] = useState<ProofRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<"" | "send" | "remind" | "approve" | string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    (async () => {
      const [{ data: ms }, { data: pr }] = await Promise.all([
        sb.from("mockups").select("id, title, file_path, group_id, created_at, created_by, archived_at, snapshot").eq("order_id", orderId).order("created_at", { ascending: false }).limit(60),
        sb.from("proofs").select(PROOF_COLS).eq("order_id", orderId).not("version", "is", null),
      ]);
      const ml = (ms || []) as Mk[];
      setMocks(ml); setProofs((pr || []) as unknown as ProofRow[]);
      const paths = ml.map((m) => m.file_path.replace(/\.png$/, "-thumb.png"));
      if (paths.length) {
        const { data } = await sb.storage.from("proofs").createSignedUrls([...paths, ...ml.map((m) => m.file_path)], 3600);
        const u: Record<string, string> = {};
        ml.forEach((m, i) => { u[m.id] = data?.[i]?.signedUrl || ""; u[m.id + ":full"] = data?.[ml.length + i]?.signedUrl || ""; });
        setUrls(u);
      }
    })();
  }, [sb, orderId, bump, n]);

  const live = proofs.filter((p) => !p.archived_at);
  const liveV = live.length ? live[0].version : 0;
  const nextV = (proofs.length ? Math.max(...proofs.map((p) => p.version)) : 0) + 1;
  const current = mocks.filter((m) => !m.archived_at);
  const sentAs = (m: Mk) => proofs.filter((p) => p.mockup_id === m.id).sort((a, b) => a.version - b.version);
  const unsentCurrent = current.some((m) => !live.some((p) => p.mockup_id === m.id));
  const st = live.length ? versionState(live) : null;
  const first = (customer || "The customer").split(/\s+/)[0];

  const done = (t: string) => { setMsg(t); setAsk(""); setNote(""); setN((x) => x + 1); onChanged(); };
  const act = async (k: string, f: () => Promise<{ ok: boolean; error?: string; emailed?: boolean; version?: number }>, ok: (r: { emailed?: boolean; version?: number }) => string) => {
    setBusy(k); setErr(""); setMsg("");
    const r = await f();
    setBusy("");
    if (!r.ok) return setErr(r.error || "Something went wrong.");
    done(ok(r));
  };
  const goBack = (m: Mk) => act("back" + m.id, () => restoreVersion("", "ours", m.id), () => "That mockup is the current one again. Send it when it's ready.");

  return (
    <>
      <section className="panel mkh-panel">
        <div className="panel-h"><h2>Mockup history</h2><span className="faint">every save</span></div>
        <div className="panel-b">
          {!mocks.length && <p className="faint" style={{ margin: 0 }}>No mockups saved yet. Make one in the Mockup Creator.</p>}
          {mocks.map((m) => {
            const v = sentAs(m), im = m.snapshot?.imprints?.[0];
            return (
              <div className={"mkh-row" + (m.archived_at ? " old" : "")} key={m.id}>
                <a className="mkh-pic" href={urls[m.id + ":full"] || undefined} target="_blank" rel="noreferrer" title="Open full size">
                  {urls[m.id] ? <img src={urls[m.id]} alt="" onError={(e) => { const t = e.currentTarget; if (urls[m.id + ":full"] && t.src !== urls[m.id + ":full"]) t.src = urls[m.id + ":full"]; }} /> : null}
                </a>
                <div className="mkh-body">
                  <b>{m.title.replace(/^Group \d+ — /, "")}</b>
                  <small>{[im?.location, im?.size].filter(Boolean).join(" · ")}{im?.location ? " · " : ""}{fmtStamp(m.created_at)}{m.created_by ? ` · ${m.created_by.split("@")[0]}` : ""}</small>
                  {m.archived_at && m.snapshot && (ask === "back" + m.id
                    ? <div className="mkh-q"><span>Make this the current mockup again?</span><button type="button" className="btn sm primary" disabled={!!busy} onClick={() => goBack(m)}>{busy ? "…" : "Yes"}</button><button type="button" className="btn sm ghost" onClick={() => setAsk("")}>Cancel</button></div>
                    : <button type="button" className="linkbtn mkh-back" onClick={() => setAsk("back" + m.id)}>↶ Go back to this</button>)}
                </div>
                <span className={"mkh-pill " + (v.length ? "sent" : m.archived_at ? "draft" : "cur")}>{v.length ? `${v.some((p) => p.sent_at) ? "Sent" : "Approved"} as v${v.map((p) => p.version).join(", v")}` : m.archived_at ? "Not sent" : "Current · not sent"}</span>
              </div>
            );
          })}
          {current.length > 0 && unsentCurrent && (ask === "send"
            ? <div className="ca-confirm"><div>Email <b>{email || "the customer"}</b> “Artwork proof ready for your order” with a link to review <b>Version {nextV}</b>?</div>
                <div className="row"><button type="button" className="btn sm primary" disabled={!!busy} onClick={() => act("send", () => sendProofVersion(orderId), (r) => r.emailed ? `Version ${r.version} sent to ${email}.` : `Version ${r.version} is in their portal. Email is off, so send them the portal link.`)}>{busy === "send" ? "Sending…" : `Send Version ${nextV}`}</button><button type="button" className="btn sm ghost" onClick={() => setAsk("")}>Cancel</button></div></div>
            : <div className="mkh-foot"><button type="button" className="btn primary" onClick={() => setAsk("send")} disabled={!email}>Send to customer as Version {nextV}</button>{!email && <span className="faint">The customer has no email address.</span>}</div>)}
        </div>
      </section>

      <section className="panel ca-panel">
        <div className="panel-h"><h2>Customer approval</h2></div>
        <div className="panel-b">
          {err && <div className="err">{err}</div>}
          {msg && <div className="ca-msg">{msg}</div>}
          {st ? (
            <>
              <div className="ca-rows">
                <div><span>Proof</span><b>Version {liveV}{st.sent ? ` · sent ${fmtStamp(st.sent)}` : ""}</b></div>
                {st.sent && <div><span>Opened</span><b className={st.viewed ? "ok" : "wait"}>{st.viewed ? `${fmtStamp(st.viewed)}${st.views > 1 ? ` · ${st.views} views` : ""}` : "Not yet"}</b></div>}
                {st.reminded && <div><span>Reminded</span><b>{fmtStamp(st.reminded)}</b></div>}
                <div><span>Decision</span><b className={st.tone}>{st.tone === "wait" ? "Waiting" : st.text}</b></div>
              </div>
              {st.tone === "ok" && <div className="ca-call ok">{st.staff ? "Approved another way" : "Approved"} by <b>{st.dec?.decided_name || "the customer"}</b>{st.dec?.decided_at ? `, ${fmtStamp(st.dec.decided_at)}` : ""}.{unsentCurrent ? " A newer mockup is saved; send it if the customer should see it." : ""}</div>}
              {st.tone === "bad" && <div className="ca-call bad">{first} asked for changes. Make them in the Mockup Creator, then send the next version.</div>}
              {st.tone === "wait" && <div className="ca-call wait">{st.viewed ? `${first} opened the proof ${ago(st.last || st.viewed)} but hasn't answered yet.` : `${first} hasn't opened the proof link yet (sent ${st.sent ? ago(st.sent) : ""}).`}</div>}
            </>
          ) : <div className="ca-call">{current.length ? "No proof sent to the customer yet." : "No mockup yet."}</div>}

          <div className="ca-acts">
            {st?.tone === "wait" && (ask === "remind"
              ? <div className="ca-confirm"><div>Email <b>{email}</b> “Reminder: your artwork proof” with the link to review Version {liveV}?</div>
                  <div className="row"><button type="button" className="btn sm primary" disabled={!!busy} onClick={() => act("remind", () => remindProof(orderId), (r) => r.emailed ? `Reminder sent to ${email}.` : "Reminder saved. Email is off, so send them the portal link.")}>{busy === "remind" ? "Sending…" : "Send reminder"}</button><button type="button" className="btn sm ghost" onClick={() => setAsk("")}>Cancel</button></div></div>
              : <button type="button" className="btn primary" onClick={() => setAsk("remind")} disabled={!email}>Remind them to review the proof</button>)}
            {st?.tone !== "ok" && (ask === "approve"
              ? <div className="ca-confirm">
                  <label>How did {first} approve the art?<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Approved by email, Oct 16" autoFocus /></label>
                  <div className="row"><button type="button" className="btn sm primary" disabled={note.trim().length < 4 || !!busy} onClick={() => act("approve", () => approveArtAnotherWay(orderId, note), () => "Marked approved. The proof history, Separations and the customer's portal all show it.")}>{busy === "approve" ? "Saving…" : "Mark art approved"}</button><button type="button" className="btn sm ghost" onClick={() => setAsk("")}>Cancel</button></div>
                </div>
              : (current.length > 0 || live.length > 0) && <button type="button" className="btn" onClick={() => setAsk("approve")}>Customer approved another way…</button>)}
          </div>
          {st?.tone !== "ok" && (current.length > 0 || live.length > 0) && <p className="faint ca-foot">Approved another way (a call, an email, in person) overrides everything else: the proof, Separations and the customer&apos;s portal all show it approved.</p>}
        </div>
      </section>
    </>
  );
}
