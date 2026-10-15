"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtStamp } from "@/lib/format";

/**
 * Every proof this order has had, newest first, current or replaced (Oct 15, Nick: "how are you keeping track of the
 * history and what was approved and by whom"): the picture, what the customer decided, the name they typed, the login
 * that clicked, when, their note, and their own version when they changed it themselves.
 */
type Row = {
  id: string; title: string; file_path: string; file_type: string; status: "pending" | "approved" | "changes"; customer_comment: string;
  decided_at: string | null; decided_name: string | null; created_at: string; archived_at: string | null;
  customer_change: { mockups?: string[] } | null;
};
type Ev = { kind: string; actor: string; detail: string; created_at: string };

export default function ProofHistory({ orderId, bump }: { orderId: string; bump?: number }) {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [evs, setEvs] = useState<Ev[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const [{ data: pr }, { data: ev }] = await Promise.all([
        sb.from("proofs").select("id,title,file_path,file_type,status,customer_comment,decided_at,decided_name,created_at,archived_at,customer_change").eq("order_id", orderId).order("created_at", { ascending: false }),
        sb.from("order_events").select("kind,actor,detail,created_at").eq("order_id", orderId).in("kind", ["proof_approved", "proof_changes"]),
      ]);
      const list = (pr || []) as Row[];
      setRows(list);
      setEvs((ev || []) as Ev[]);
      const paths = [...new Set(list.flatMap((r) => [r.file_path, ...(r.customer_change?.mockups || [])]).filter(Boolean))];
      if (paths.length) {
        const { data } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
        setUrls(Object.fromEntries(paths.map((p, i) => [p, data?.[i]?.signedUrl || ""])));
      }
    })();
  }, [sb, orderId, bump]);

  if (!rows.length) return null;
  const n = rows.length;
  // the login that clicked: the activity entry logged with the decision (within a couple of minutes of it)
  const who = (r: Row) => {
    if (!r.decided_at) return "";
    const t = new Date(r.decided_at).getTime();
    return evs.find((e) => Math.abs(new Date(e.created_at).getTime() - t) < 120_000 && (e.detail || "").startsWith(r.title))?.actor || "";
  };
  return (
    <section className="panel ph-panel">
      <div className="panel-h"><h2>Proof history</h2><span className="faint">{n} version{n === 1 ? "" : "s"}</span></div>
      <div className="panel-b ph-list">
        {rows.map((r, i) => {
          const st = r.status === "approved" ? (r.customer_comment ? "Approved with changes" : "Approved") : r.status === "changes" ? "Changes requested" : r.archived_at ? "Replaced before a decision" : "Waiting on the customer";
          const tone = r.status === "approved" ? "ok" : r.status === "changes" ? "bad" : r.archived_at ? "off" : "wait";
          const own = r.customer_change?.mockups || [];
          const login = who(r);
          return (
            <div className={"ph-row" + (r.archived_at ? " old" : "")} key={r.id}>
              <a className="ph-pic" href={urls[r.file_path] || undefined} target="_blank" rel="noreferrer" title="Open full size">
                {r.file_type.startsWith("image/") && urls[r.file_path] ? <img src={urls[r.file_path]} alt="" /> : <span>{r.file_type.includes("pdf") ? "PDF" : "File"}</span>}
              </a>
              <div className="ph-body">
                <div className="ph-top"><b>Version {n - i}</b>{!r.archived_at && <span className="ph-cur">Current</span>}<span className="faint">sent {fmtStamp(r.created_at)}</span></div>
                <div className="ph-title">{r.title}</div>
                <div className={"ph-st " + tone}>{st}{r.decided_at ? <> · <b>{r.decided_name || "customer"}</b> · {fmtStamp(r.decided_at)}</> : null}</div>
                {login && <div className="faint ph-login">Clicked from {login}</div>}
                {r.customer_comment && <div className="ph-note">{r.customer_comment}</div>}
                {own.length > 0 && <div className="ph-own"><span>Their version:</span>{own.map((p) => urls[p] ? <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="The customer's mockup" /></a> : null)}</div>}
                {r.archived_at && <div className="faint ph-login">Replaced by a newer version {fmtStamp(r.archived_at)}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
