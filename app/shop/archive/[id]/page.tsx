"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ArchivedRow } from "@/lib/archive";
import ArchivedOrderView from "@/components/ArchivedOrderView";

/** An archived Printavo invoice or quote (read-only). Artwork shows from our storage copies, or from Printavo until copied. */
export default function ArchivedOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [row, setRow] = useState<ArchivedRow | null>(null);
  const [company, setCompany] = useState("");
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "missing" | "ok">("loading");

  useEffect(() => {
    const sb = createClient();
    (async () => {
      const { data } = await sb.from("archived_orders").select("*").eq("id", id).maybeSingle();
      if (!data) { setState("missing"); return; }
      const r = data as ArchivedRow;
      setRow(r); setState("ok");
      const { data: c } = await sb.from("customers").select("company, name").eq("id", r.customer_id).maybeSingle();
      setCompany(c?.company || c?.name || "Customer");
      const stored = Object.entries(r.files || {}).filter(([, p]) => p && !["failed", "too-big"].includes(p));
      if (stored.length) {
        const { data: s } = await sb.storage.from("proofs").createSignedUrls(stored.map(([, p]) => p), 3600);
        setSigned(Object.fromEntries(stored.map(([u], i) => [u, s?.[i]?.signedUrl || ""]).filter(([, v]) => v)));
      }
    })();
  }, [id]);

  if (state === "loading") return <div className="empty">Loading…</div>;
  if (!row) return <><Link className="back" href="/shop/customers">← Customers</Link><div className="empty">This archived order doesn&apos;t exist.</div></>;
  return (
    <>
      <Link className="back" href={`/shop/customers/${row.customer_id}?area=archive`}>← {company || "Customer"} · Printavo archive</Link>
      <div style={{ marginTop: 10 }}>
        <ArchivedOrderView o={row.data} importedAt={row.imported_at} customerHref={`/shop/customers/${row.customer_id}`} fileUrl={(u) => signed[u] || u} />
      </div>
    </>
  );
}
