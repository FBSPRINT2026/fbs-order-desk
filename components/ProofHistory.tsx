"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtStamp } from "@/lib/format";
import { restoreVersion } from "@/app/shop/proof-actions";

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
  useEffect(() => {
    (async () => {
      const { data: pr } = await sb.from("proofs").select(PROOF_COLS).eq("order_id", orderId).not("version", "is", null).order("version", { ascending: false }).order("created_at");
      const list = (pr || []) as unknown as ProofRow[];
      setRows(list);
      const paths = [...new Set(list.flatMap((r) => [r.file_path, ...(r.customer_change?.mockups || [])]).filter(Boolean))];
      if (paths.length) {
        const { data } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
        setUrls(Object.fromEntries(paths.map((p, i) => [p, data?.[i]?.signedUrl || ""])));
      }
    })();
  }, [sb, orderId, bump]);

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

  return (
    <section className="panel ph-panel">
      <div className="panel-h"><h2>Proof history</h2><span className="faint">{versions.length ? `${versions.length} version${versions.length === 1 ? "" : "s"} sent` : "what the customer was sent"}</span></div>
      <div className="panel-b ph-list">
        {err && <div className="err">{err}</div>}
        {!versions.length && <p className="faint" style={{ margin: 0 }}>Nothing sent to the customer yet. Save a mockup in the Mockup Creator, then send it from Mockup history.</p>}
        {versions.map(([v, ps], i) => {
          const s = versionState(ps);
          const theirs = ps.find((p) => p.customer_change?.imprints && p.customer_change.imprints.length);
          return (
            <div className={"ph-row" + (s.old ? " old" : "")} key={v}>
              <div className="ph-pics">
                {ps.map((r) => (
                  <a key={r.id} className="ph-pic" href={urls[r.file_path] || undefined} target="_blank" rel="noreferrer" title={`${r.title}: open full size`}>
                    {r.file_type.startsWith("image/") && urls[r.file_path] ? <img src={urls[r.file_path]} alt="" /> : <span>{r.file_type.includes("pdf") ? "PDF" : "File"}</span>}
                  </a>
                ))}
              </div>
              <div className="ph-body">
                <div className="ph-top"><b>Version {v}</b>{i === 0 && !s.old && <span className="ph-cur">Current</span>}</div>
                <div className="faint ph-sent">{s.sent ? <>Sent {fmtStamp(s.sent)}{s.to ? ` to ${s.to}` : ""}</> : "Not emailed: approved another way"}</div>
                <div className="ph-title">{ps.map((p) => p.title).join(" · ")}</div>
                {s.sent && (
                  <div className="ph-chips">
                    {s.viewed ? <span className="ph-chip seen">Opened {fmtStamp(s.viewed)}</span> : <span className="ph-chip unseen">Not opened</span>}
                    {s.views > 1 && <span className="ph-chip">Viewed {s.views} times{s.last ? `, last ${fmtStamp(s.last)}` : ""}</span>}
                    {s.reminded && <span className="ph-chip">Reminder sent {fmtStamp(s.reminded)}</span>}
                  </div>
                )}
                <div className={"ph-st " + s.tone}>{s.text}{s.dec?.decided_at ? <> · <b>{s.dec.decided_name || "customer"}</b> · {fmtStamp(s.dec.decided_at)}</> : null}</div>
                {ps.filter((p) => p.customer_comment).map((p) => <div className="ph-note" key={p.id}>{p.customer_comment}</div>)}
                {ps.map((p) => (p.customer_change?.mockups || []).length ? <div className="ph-own" key={p.id}><span>Their version:</span>{(p.customer_change?.mockups || []).map((m) => urls[m] ? <a key={m} href={urls[m]} target="_blank" rel="noreferrer"><img src={urls[m]} alt="The customer's mockup" /></a> : null)}</div> : null)}
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
