"use client";
import { useEffect, useMemo, useState } from "react";
import FileThumb from "@/components/FileThumb";
import { createClient } from "@/lib/supabase/client";
import { fmtStamp } from "@/lib/format";
import { bringBackVersion, restoreVersion } from "@/app/shop/proof-actions";
import SendProofTool from "@/components/tools/SendProofTool";

/**
 * Proof history (rebuilt Oct 16, Nick): only the versions the customer was sent, Version 1 being the first. Each
 * version: its mockups, when and to whom it went, whether they opened it (and how often), reminders, and what they
 * decided (or the shop's "approved another way"). Mockup Creator saves are in the Mockup history beside it.
 */
export type ProofRow = {
  id: string; title: string; file_path: string; file_type: string; status: "pending" | "approved" | "changes"; customer_comment: string;
  decided_at: string | null; decided_name: string | null; created_at: string; archived_at: string | null;
  customer_change: { mockups?: string[]; imprints?: unknown[] } | null;
  version: number; sent_at: string | null; sent_to: string | null; viewed_at: string | null; last_viewed_at: string | null; view_count: number;
  reminded_at: string | null; approved_via: string | null; mockup_id: string | null;
};
export const PROOF_COLS = "id,title,file_path,file_type,status,customer_comment,decided_at,decided_name,created_at,archived_at,customer_change,version,sent_at,sent_to,viewed_at,last_viewed_at,view_count,reminded_at,approved_via,mockup_id";

/** A version's state, from its proofs: changes asked wins, then approved (all), then waiting / replaced. */
export function versionState(ps: ProofRow[]) {
  const old = ps.every((p) => p.archived_at);
  const ch = ps.find((p) => p.status === "changes"), ap = ps.length > 0 && ps.every((p) => p.status === "approved");
  const dec = ch || (ap ? ps.slice().sort((a, b) => (b.decided_at || "").localeCompare(a.decided_at || ""))[0] : null);
  const staff = ap && ps.some((p) => p.approved_via === "staff");
  const text = ch ? "Changes asked" : ap ? (staff ? "Approved another way" : ps.some((p) => p.customer_comment) ? "Approved with changes" : "Approved") : old ? "Replaced before a decision" : "Waiting on the customer";
  const tone = ch ? "bad" : ap ? "ok" : old ? "off" : "wait";
  const viewed = ps.map((p) => p.viewed_at).filter(Boolean).sort()[0] || null;
  const last = ps.map((p) => p.last_viewed_at).filter(Boolean).sort().pop() || null;
  const views = Math.max(0, ...ps.map((p) => p.view_count || 0));
  const reminded = ps.map((p) => p.reminded_at).filter(Boolean).sort().pop() || null;
  return { text, tone, dec, staff, viewed, last, views, reminded, sent: ps[0]?.sent_at || null, to: ps[0]?.sent_to || null, old };
}

export default function ProofHistory({ orderId, bump }: { orderId: string; bump?: number }) {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ProofRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  // the current mockups (one not sent yet is the next version), and the order's messages (shown under the version
  // that was out when they were written)
  const [cur, setCur] = useState<{ id: string; file_path: string }[]>([]);
  const [msgs, setMsgs] = useState<{ id: string; author_type: string; author_name: string; body: string; created_at: string }[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    (async () => {
      const [{ data: pr }, { data: ms }, { data: mm }] = await Promise.all([
        sb.from("proofs").select(PROOF_COLS).eq("order_id", orderId).not("version", "is", null).order("version", { ascending: false }).order("created_at"),
        sb.from("mockups").select("id, file_path").eq("order_id", orderId).is("archived_at", null).order("created_at"),
        sb.from("messages").select("id, author_type, author_name, body, created_at").is("hidden_at", null).eq("order_id", orderId).neq("topic", "goods").order("created_at").limit(300),
      ]);
      const list = (pr || []) as unknown as ProofRow[];
      setRows(list);
      const cm = (ms || []) as { id: string; file_path: string }[];
      setCur(cm);
      setMsgs((mm || []) as { id: string; author_type: string; author_name: string; body: string; created_at: string }[]);
      const paths = [...new Set([...list.flatMap((r) => [r.file_path, ...(r.customer_change?.mockups || [])]), ...cm.map((m) => m.file_path)].filter(Boolean))];
      if (paths.length) {
        const { data } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
        setUrls(Object.fromEntries(paths.map((p, i) => [p, data?.[i]?.signedUrl || ""])));
      }
    })();
  }, [sb, orderId, bump, n]);

  const versions = useMemo(() => {
    const m = new Map<number, ProofRow[]>();
    for (const r of rows) m.set(r.version, [...(m.get(r.version) || []), r]);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [rows]);

  const useTheirs = async (id: string) => {
    setBusy(id); setErr("");
    const r = await restoreVersion(id, "theirs");
    setBusy(""); setAsk("");
    if (!r.ok) return setErr(r.error);
    if (r.open) window.location.href = r.open; else window.location.reload();
  };

  // Version N again (Nov 2, Nick: "I want a version one back again"): its mockups become the current ones, not sent
  const again = async (v: number) => {
    setBusy("v" + v); setErr("");
    const r = await bringBackVersion(orderId, v);
    setBusy(""); setAsk("");
    if (!r.ok) return setErr(r.error);
    setN((x) => x + 1);
  };
  const live = rows.filter((r) => !r.archived_at);
  const unsent = cur.filter((m) => !live.some((p) => p.mockup_id === m.id));
  const nextV = (rows.length ? Math.max(...rows.map((r) => r.version)) : 0) + 1;
  // when each version went out: its messages are the ones from then until the next version
  const startOf = (ps: ProofRow[]) => ps.map((p) => p.sent_at || p.created_at).sort()[0] || "";
  const msgsFor = (i: number) => { const from = startOf(versions[i][1]); const to = i > 0 ? startOf(versions[i - 1][1]) : "9999"; return msgs.filter((m) => m.created_at >= from && m.created_at < to); };

  return (
    <section className="panel ph-panel">
      <div className="panel-h"><h2>Versions</h2><span className="faint">{versions.length ? `${versions.length} sent to the customer, newest first` : "nothing sent yet"}</span></div>
      <div className="panel-b ph-list pvr-list">
        {err && <div className="err">{err}</div>}
        {/* the current mockup, when it isn't the version out with the customer: the next version */}
        {unsent.length > 0 && (
          <div className="ph-row ph-next">
            <div className="ph-pics">{unsent.map((m) => <a key={m.id} className="ph-pic" href={urls[m.file_path] || undefined} target="_blank" rel="noreferrer">{urls[m.file_path] ? <img src={urls[m.file_path]} alt="" /> : null}</a>)}</div>
            <div className="ph-body">
              <div className="ph-top"><b>Version {nextV}</b><span className="ph-cur ph-cur-new">Current · not sent</span></div>
              <div className="ph-st wait">The mockup as it is now. The customer hasn&apos;t seen it.</div>
              <div className="ph-acts"><SendProofTool target={{ kind: "art", orderId }} label={`Send as Version ${nextV}`} onDone={() => setN((x) => x + 1)} /><span className="faint" style={{ fontSize: 12.5 }}>or mark it approved in Customer approval</span></div>
            </div>
          </div>
        )}
        {!versions.length && !unsent.length && <p className="faint" style={{ margin: 0 }}>Nothing sent to the customer yet. Save a mockup in the Mockup Creator, then send it.</p>}
        {versions.map(([v, ps], i) => {
          const s = versionState(ps);
          const theirs = ps.find((p) => p.customer_change?.imprints && p.customer_change.imprints.length);
          return (
            <div className={"pvr-row" + (s.old ? " old" : "")} key={v}>
              <div className="pvr-pics">
                {ps.map((r) => (
                  <a key={r.id} className="ph-pic" href={urls[r.file_path] || undefined} target="_blank" rel="noreferrer" title={`${r.title}: open full size`}>
                    {r.file_type.startsWith("image/") && urls[r.file_path] ? <img src={urls[r.file_path]} alt="" /> : <FileThumb name={r.file_path.split("/").pop() || "file"} url={urls[r.file_path]} mime={r.file_type} />}
                  </a>
                ))}
              </div>
              <div className="ph-body">
                {/* one line per version, the same four things in the same place every time (Nov 3, Nick: "hard to read…
                    version, status, viewed"): which version, where it stands, when it went, whether they've seen it */}
                <div className="pvr-head">
                  <div className="pvr-c"><span>Version</span><b>Version {v}{i === 0 && !s.old && !unsent.length && <em className="ph-cur">Current</em>}</b><small>{ps.map((p) => p.title).join(" · ")}</small></div>
                  <div className="pvr-c"><span>Status</span><b className={"pvr-st " + s.tone}>{s.text}</b>{s.dec?.decided_at ? <small>{s.dec.decided_name || "customer"} · {fmtStamp(s.dec.decided_at)}</small> : null}</div>
                  <div className="pvr-c"><span>Sent</span>{s.sent ? <><b>{fmtStamp(s.sent)}</b>{s.to ? <small>to {s.to}</small> : null}</> : <><b>Not emailed</b><small>Approved another way</small></>}</div>
                  <div className="pvr-c"><span>Viewed</span>{!s.sent ? <b className="pvr-st off">—</b> : s.viewed ? <><b>{s.views > 1 ? `${s.views} times` : "Opened"}</b><small>{s.views > 1 && s.last ? `Last ${fmtStamp(s.last)}` : fmtStamp(s.viewed)}</small></> : <b className="pvr-st wait">Not opened</b>}{s.reminded ? <small>Reminder sent {fmtStamp(s.reminded)}</small> : null}</div>
                </div>
                {ps.filter((p) => p.customer_comment).map((p) => <div className="ph-note" key={p.id}>{p.customer_comment}</div>)}
                {ps.map((p) => (p.customer_change?.mockups || []).length ? <div className="ph-own" key={p.id}><span>Their version:</span>{(p.customer_change?.mockups || []).map((m) => urls[m] ? <a key={m} href={urls[m]} target="_blank" rel="noreferrer"><img src={urls[m]} alt="The customer's mockup" /></a> : null)}</div> : null)}
                {/* what was said while this version was out */}
                {(() => { const ms = msgsFor(i); return ms.length ? <div className="ph-msgs">{ms.slice(-6).map((m) => <div key={m.id} className={"ph-msg " + (m.author_type === "customer" ? "c" : "s")}><b>{m.author_type === "customer" ? m.author_name || "Customer" : "We"}</b> {m.body}<small>{fmtStamp(m.created_at)}</small></div>)}</div> : null; })()}
                {/* bring it back as the current mockup */}
                {(s.old || unsent.length > 0) && (ask === "v" + v
                  ? <div className="ph-acts"><span className="ph-q">Make Version {v} the current mockup again? Nothing is sent; you send it or mark it approved next.</span><button className="btn sm primary" type="button" disabled={!!busy} onClick={() => void again(v)}>{busy === "v" + v ? "Working…" : "Yes, use it again"}</button><button className="btn sm ghost" type="button" onClick={() => setAsk("")}>Cancel</button></div>
                  : <div className="ph-acts"><button className="btn sm" type="button" onClick={() => setAsk("v" + v)}>Use this version again</button></div>)}
                {theirs && (
                  <div className="ph-acts">
                    {ask === theirs.id
                      ? <><span className="ph-q">Put the customer&apos;s version on the order and open the Mockup Creator to check it and save it?</span><button className="btn sm primary" type="button" disabled={!!busy} onClick={() => useTheirs(theirs.id)}>{busy ? "Opening…" : "Yes, use it"}</button><button className="btn sm ghost" type="button" onClick={() => setAsk("")}>Cancel</button></>
                      : <button className="btn sm" type="button" onClick={() => setAsk(theirs.id)}>Use their version</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
