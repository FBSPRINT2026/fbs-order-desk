"use client";
/**
 * One gang sheet as a card, like a mockup or logo card (Oct 26, Nick: "the little cards, just like you do on artwork and
 * mockup, the little preview"): its first logos, name, customer and jobs, pieces, status; Open, Reorder sheet, and a
 * delete that takes two clicks. Used on the Gang sheets page and on a customer's page.
 */
export type GangRow = {
  id: string; name: string; owner: string; status: string; updated_at: string; ordered_at?: string | null; supplier_order: string | null; expected?: string | null; customer_id: string | null;
  data: { logos?: { name: string; path?: string; src?: string; vers: { qty: number }[] }[]; jobs?: { job: string }[]; files?: { length: number; at?: string }[] };
};
export const gangPcs = (r: GangRow) => (r.data?.logos || []).reduce((a, l) => a + l.vers.reduce((b, v) => b + (+v.qty || 0), 0), 0);
export const gangJobs = (r: GangRow) => [...new Set((r.data?.jobs || []).map((j) => j.job).filter(Boolean))];
export const gangWho = (e: string) => { const n = (e || "").split("@")[0]; return n ? n[0].toUpperCase() + n.slice(1) : ""; };
/** the first few logos' storage paths, to sign for the pictures */
export const gangThumbPaths = (rs: GangRow[]) => [...new Set(rs.flatMap((r) => (r.data?.logos || []).slice(0, 4).map((l) => l.path).filter(Boolean) as string[]))];

export default function GangSheetCard({ r, thumbs, customer, armed, onDelete, onReorder }: { r: GangRow; thumbs: Record<string, string>; /** the customer's name; leave out on the customer's own page */ customer?: string | null; armed: boolean; onDelete: () => void; onReorder: () => void }) {
  const lgs = r.data?.logos || [], js = gangJobs(r), href = `/shop/gang-sheet/builder?sheet=${r.id}`;
  const sub = [customer === undefined ? null : customer || "No customer", js.length ? js.map((j) => `#${j}`).join(", ") : null].filter(Boolean).join(" · ");
  return (
    <div className="design-card gang-gc">
      <a className="dc-img gang-gc-img" href={href} aria-label={`Open ${r.name}`}>
        {lgs.length ? lgs.slice(0, 4).map((l, i) => { const u = l.path ? thumbs[l.path] : l.src; return <span key={i} className="gang-gc-t">{u ? <img src={u} alt="" /> : <span className="faint">{l.name.replace(/\.[^.]+$/, "").slice(0, 12)}</span>}</span>; }) : <span className="faint">No art yet</span>}
      </a>
      <div className="dc-b">
        <a className="gang-gc-n" href={href} data-notranslate>{r.name || "Gang sheet"}</a>
        {sub && <span className="faint" data-notranslate>{sub}</span>}
        <span className="faint num">{lgs.length} logo{lgs.length === 1 ? "" : "s"} · {gangPcs(r)} pcs · {gangWho(r.owner)} · {new Date(r.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <span className={"gang-gc-s" + (r.status === "ordered" ? " ord" : "")}>{r.status === "ordered" ? `Ordered${r.supplier_order ? ` #${r.supplier_order}` : ""}${r.expected ? ` · ${r.expected}` : ""}` : "Open"}</span>
        <span className="dc-acts gang-gc-acts">
          <a className="btn sm" href={href}>Open</a>
          {lgs.length > 0 && <button type="button" className="btn sm" onClick={onReorder}>Reorder sheet</button>}
          <span className="spacer" />
          <button type="button" className={"gang-del" + (armed ? " armed" : "")} aria-label={armed ? `Click again to delete ${r.name}` : `Delete ${r.name}`} title={armed ? "Click again to delete" : "Delete (click twice)"} onClick={onDelete}>{armed ? "Delete?" : "×"}</button>
        </span>
      </div>
    </div>
  );
}
