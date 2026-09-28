"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtDateLong, money } from "@/lib/format";

export type ArchiveItem = { id: string; kind: "invoice" | "quote"; visual_id: string; nickname: string; status_name: string; status_color: string; order_date: string | null; due_date: string | null; total: number; paid: number; balance: number; qty: number; files_total: number; files_copied: number };

/** A customer's old Printavo invoices and quotes (read-only archive). */
export default function ArchiveList({ items }: { items: ArchiveItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase().replace(/^#/, "");
  const rows = items.filter((o) => !t || [o.visual_id, o.nickname, o.status_name].some((x) => (x || "").toLowerCase().includes(t)));
  const inv = items.filter((o) => o.kind === "invoice");
  const owed = inv.reduce((a, o) => a + Math.max(0, +o.balance || 0), 0);
  return (
    <>
      <div className="aa-bar">
        <div className="aa-bar-l"><h2>Printavo archive</h2>
          <span className="aa-sum">{inv.length} invoice{inv.length === 1 ? "" : "s"}{items.length > inv.length ? ` · ${items.length - inv.length} quote${items.length - inv.length === 1 ? "" : "s"}` : ""} · Total <b>{money(inv.reduce((a, o) => a + (+o.total || 0), 0))}</b>{owed > 0.004 && <> · Balance <b className="aa-due">{money(owed)}</b></>}</span>
        </div>
        <label className="aa-search"><input type="search" placeholder="Search by number, name or status" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="aa-card aa-tblcard">
        <table className="aa-tbl">
          <thead><tr><th>#</th><th>Job</th><th>Status</th><th>Created</th><th>Due</th><th className="r">Paid</th><th className="r">Balance</th><th className="r">Total</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} onClick={() => router.push(`/shop/archive/${o.id}`)}>
                <td className="num"><Link href={`/shop/archive/${o.id}`} onClick={(e) => e.stopPropagation()}>{o.visual_id}</Link></td>
                <td><div className="aa-t">{o.nickname || (o.kind === "quote" ? "Quote" : "Invoice")}</div><div className="aa-s">{o.kind === "quote" ? "Quote · " : ""}{o.qty} pcs{o.files_total > o.files_copied ? ` · ${o.files_total - o.files_copied} file${o.files_total - o.files_copied === 1 ? "" : "s"} not copied yet` : ""}</div></td>
                <td>{o.status_name && <span className="pv-dot" style={{ ["--sc" as string]: o.status_color || "#888" }}>{o.status_name}</span>}</td>
                <td>{o.order_date ? fmtDateLong(o.order_date) : "—"}</td>
                <td>{o.due_date ? fmtDateLong(o.due_date) : "—"}</td>
                <td className="r num">{o.kind === "quote" ? "—" : money(o.paid)}</td>
                <td className={"r num" + (o.kind === "invoice" && +o.balance > 0.004 ? " aa-due" : "")}>{o.kind === "quote" ? "—" : money(Math.max(0, +o.balance || 0))}</td>
                <td className="r num b">{money(o.total)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}><div className="aa-empty">{items.length ? `No matches for “${q}”.` : "No archived orders."}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
