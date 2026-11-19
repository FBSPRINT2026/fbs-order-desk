"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { trackingLink, type Shipment } from "@/lib/shipping";
import { myPrinter } from "@/lib/labelPrinter";

/**
 * How the order left, under its Delivery method (Nick, Nov 19 2026: "once it's marked completed… the tracking should just go
 * underneath that"). Each shipment shipped (labels bought here, or tracking added by hand): when, the carrier and service,
 * each box's tracking number linked to the carrier, where it is now (the tracker), and who shipped it. A pickup or a
 * delivery: when it went and who handed it over (the order's log). Nothing shows until something has left.
 */
type Row = Shipment & { track_status?: string | null; track_detail?: string | null; delivered_at?: string | null };
type Went = { at: string; actor: string };
const STATUS: Record<string, string> = { pre_transit: "Label made", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered", available_for_pickup: "At the carrier", return_to_sender: "Returning to us", failure: "Problem", cancelled: "Canceled", error: "Problem", unknown: "" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function OrderShipments({ orderId, method, status }: { orderId: string; method: string | null; status: string }) {
  const [ships, setShips] = useState<Row[] | null>(null), [went, setWent] = useState<Went | null>(null);
  useEffect(() => {
    const sb = createClient();
    void sb.from("shipments").select("*").eq("order_id", orderId).in("status", ["shipped", "labeled"]).order("shipped_at", { ascending: true }).then(({ data }) => setShips((data || []) as Row[]));
    if (status === "completed" && method !== "ship") void sb.from("order_events").select("at:created_at, actor").eq("order_id", orderId).eq("kind", "status").eq("detail", "completed").order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => setWent(((data || [])[0] as Went) || null));
  }, [orderId, method, status]);
  const [msg, setMsg] = useState<Record<string, string>>({});
  async function reprint(id: string) {
    setMsg((m) => ({ ...m, [id]: "Sending to the Zebra…" }));
    const r = await fetch("/api/shipping/reprint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shipmentId: id, printer: myPrinter() }) }).then((x) => x.json()).catch(() => ({ error: "Offline. Try again." }));
    setMsg((m) => ({ ...m, [id]: r.error || r.message || "Sent." }));
  }
  const list = (ships || []).filter((s) => s.boxes?.some((b) => (b.tracking || "").trim()) || s.status === "shipped");
  if (!list.length && !went) return null;
  return (
    <div className="osh">
      {list.map((s) => {
        const st = (s.track_status || "") as string, word = STATUS[st] ?? st;
        const boxes = (s.boxes || []).filter((b) => (b.tracking || "").trim());
        const bad = ["return_to_sender", "failure", "error"].includes(st);
        return (
          <div key={s.id} className={"osh-s" + (st === "delivered" ? " done" : bad ? " bad" : "")}>
            <div className="osh-h">
              <b>{s.status === "shipped" ? "Shipped" : "Label made"}{s.shipped_at ? ` ${when(s.shipped_at)}` : ""} · {boxes.length || s.boxes.length} box{(boxes.length || s.boxes.length) === 1 ? "" : "es"}</b>
              <span>{[s.carrier, s.service].filter(Boolean).join(" ")}</span>
              {word && <em>{st === "delivered" && s.delivered_at ? `Delivered ${when(s.delivered_at)}` : word}</em>}
            </div>
            {boxes.map((b, i) => (
              <div key={b.n + ":" + i} className="osh-b"><span>Box {i + 1}</span><a href={trackingLink(b.tracking!)} target="_blank" rel="noreferrer" data-notranslate>{b.tracking}</a>{(b.label_url || b.ep_id || b.zpl_url) && <a className="osh-l" href={`/api/shipping/label?s=${s.id}&b=${i + 1}`} target="_blank" rel="noreferrer" title="The label as a 4×6 PDF">Label 4×6</a>}</div>
            ))}
            {s.track_detail && st !== "delivered" && <div className="osh-n">{s.track_detail}</div>}
            {s.boxes.some((b) => b.zpl_url || b.ep_id) && <div className="osh-n"><button type="button" className="linkbtn" onClick={() => void reprint(s.id)}>Reprint labels</button>{msg[s.id] ? ` · ${msg[s.id]}` : ""}</div>}
            <div className="osh-n">{[s.created_by && `By ${s.created_by}`, s.note].filter(Boolean).join(" · ")}</div>
          </div>
        );
      })}
      {went && <div className="osh-s done"><div className="osh-h"><b>{method === "deliver" ? "Delivered" : "Picked up"} {when(went.at)}</b><span>{went.actor.replace(/^Picked up · /, "Handed out by ")}</span></div></div>}
    </div>
  );
}
