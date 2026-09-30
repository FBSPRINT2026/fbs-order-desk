"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orderGroups, type Order } from "@/lib/pricing";
import { SEP_STATUS, type SepRow } from "@/components/SeparationStudio";

/**
 * On an order, once it's approved (Approved / Art & Proofs / Blanks Ordered / In Production): each screen-print
 * imprint with a "Request Separation" button, or where its separation is. Requests land in Production → Separations.
 */
const READY = ["approved", "art", "blanks", "production"];

export default function OrderSeparations({ o }: { o: Pick<Order, "id" | "number" | "status" | "groups" | "lines" | "customer_id" | "due_date"> }) {
  const sb = useMemo(() => createClient(), []);
  const [seps, setSeps] = useState<SepRow[]>([]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const load = useCallback(async () => { const { data } = await sb.from("separations").select("*").eq("order_id", o.id).neq("status", "cancelled"); setSeps((data || []) as SepRow[]); }, [sb, o.id]);
  useEffect(() => { load(); }, [load]);
  const items = orderGroups(o).flatMap((g) => g.imprints.filter((im) => im.method === "screen").map((im) => ({ g, im, sep: seps.find((s) => s.imprint_id === im.id) })));
  if (!READY.includes(o.status) && !seps.length) return null;
  if (!items.length) return null;
  const missing = items.filter((x) => !x.sep);
  async function request(list: typeof items) {
    setBusy(true); setErr("");
    const { data: { user } } = await sb.auth.getUser(), me = (user?.email || "").toLowerCase();
    const rows = list.map(({ g, im }) => ({ order_id: o.id, group_id: g.id, imprint_id: im.id, location: im.location || "Imprint", design_id: im.design_id || null, customer_id: o.customer_id, garment_color: g.lines.find((l) => l.color)?.color || "", due_date: o.due_date, requested_by: me, settings: { garments: [...new Set(g.lines.map((l) => l.color).filter(Boolean))] } }));
    const r = await sb.from("separations").insert(rows);
    if (r.error) setErr(r.error.message);
    await load(); setBusy(false);
  }
  return (
    <section className="panel sep-op">
      <div className="panel-h"><h2>Separations</h2>{missing.length > 1 && READY.includes(o.status) && <button type="button" className="btn sm primary" disabled={busy} onClick={() => request(missing)}>Request All ({missing.length})</button>}</div>
      <div className="panel-b">
        <ul className="sep-op-l">{items.map(({ g, im, sep }) => {
          const st = sep ? SEP_STATUS[sep.status] : null;
          return (
            <li key={im.id}>
              <span><b>{im.location || "Imprint"}</b><small className="faint"> · {g.lines.map((l) => l.color).filter(Boolean).join(", ") || "—"}{im.colors ? ` · ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}{!im.design_id ? " · no design yet" : ""}</small></span>
              <span className="spacer" />
              {sep ? <><span className="pill" style={{ ["--sc" as string]: st!.c }}>{st!.label}{sep.channels.length ? ` · ${sep.channels.length} screens` : ""}</span><Link className="btn sm" href={`/shop/separations/${sep.id}`}>Open</Link></>
                : <button type="button" className="btn sm" disabled={busy || !READY.includes(o.status)} onClick={() => request([{ g, im, sep }])}>Request Separation</button>}
            </li>
          );
        })}</ul>
        {err && <div className="pv-err">{err}</div>}
      </div>
    </section>
  );
}
