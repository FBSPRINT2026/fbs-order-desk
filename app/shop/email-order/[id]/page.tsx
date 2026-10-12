"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import EmailOrderPanel from "@/components/EmailOrderPanel";
import { createClient } from "@/lib/supabase/client";
import { noteEmailChat } from "@/app/shop/ai-actions";

/**
 * Create an order from one customer email, on its own page (Oct 12, Nick: from a searched conversation, Create order
 * "just went to the next email"): it doesn't depend on which emails a list happens to show. After it's made, the order
 * opens.
 */
export default function EmailOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [a, setA] = useState<{ subject: string; from: string; customer: string } | null>(null);
  useEffect(() => {
    void createClient().from("activities").select("subject, from_email, meta, customers(company, name)").eq("id", id).maybeSingle().then(({ data }) => {
      const d = data as { subject: string | null; from_email: string | null; meta: { from_name?: string } | null; customers: { company: string | null; name: string | null } | null } | null;
      if (d) setA({ subject: d.subject || "(no subject)", from: d.meta?.from_name || d.from_email || "", customer: d.customers?.company || d.customers?.name || "" });
    });
  }, [id]);
  return (
    <div className="eop">
      <div className="page-head">
        <div>
          <button type="button" className="md-link" onClick={() => router.back()}>‹ Back</button>
          <h1>Create order</h1>
          {a && <p className="faint" style={{ margin: "4px 0 0" }}>From {a.customer ? `${a.customer} · ` : ""}{a.from}: “{a.subject}”</p>}
        </div>
      </div>
      <EmailOrderPanel activityId={id} onClose={() => router.back()}
        onCreated={(oid, n) => { void noteEmailChat(id, `Order #${n} created from this email.`, `/shop/orders/${oid}`).catch(() => null); router.push(`/shop/orders/${oid}`); }} />
    </div>
  );
}
