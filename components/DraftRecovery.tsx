"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * Drafts left behind (Oct 24, Nick: "a little temporary recovery mode where it goes like, oh, I saw you were making this
 * order… do you want to bring it back up?"): the quotes and orders started on the shop side in the last two weeks and
 * never saved, to pick back up or throw away.
 */
type D = { id: string; nickname: string; updated_at: string; customer: { company: string | null; name: string | null } | null };
export default function DraftRecovery() {
  const sb = useMemo(() => createClient(), []);
  const [list, setList] = useState<D[]>([]);
  useEffect(() => {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    void sb.from("orders").select("id, nickname, updated_at, customer:customers(company, name)").eq("draft", true).is("discarded_at", null).or("source.is.null,source.neq.portal").gte("updated_at", since).order("updated_at", { ascending: false }).limit(5)
      .then(({ data }) => setList((data || []) as unknown as D[]));
  }, [sb]);
  if (!list.length) return null;
  const ago = (t: string) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago`; };
  return (
    <div className="draft-rec" role="status">
      <b>Pick it back up?</b><span className="faint">Started and not saved</span>
      {list.map((d) => (
        <span key={d.id} className="aa-draft">
          <Link href={`/shop/orders/${d.id}`}>{d.nickname || d.customer?.company || d.customer?.name || "Untitled quote"}</Link>
          <small className="faint">{[d.nickname && (d.customer?.company || d.customer?.name), ago(d.updated_at)].filter(Boolean).join(" · ")}</small>
          <button type="button" className="linkbtn" onClick={async () => { setList((l) => l.filter((x) => x.id !== d.id)); await sb.rpc("order_discard", { p_id: d.id }); }}>Discard</button>
        </span>
      ))}
    </div>
  );
}
