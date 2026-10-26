"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { useSticky } from "@/lib/useSticky";
import SearchInput from "@/components/SearchInput";
import GangReorder from "@/components/GangReorder";
import GangSheetCard from "@/components/GangSheetCard";
import { DTF_DALLAS, sheetFor } from "@/lib/dtfDallas";

/**
 * Gang sheets: every DTF gang sheet made, like the Artwork page (Oct 26, Nick: "when you click gang sheets, it opens to
 * like the portfolio. Just like when you click artwork… you can see all the gang sheets there… a new that says new gang
 * sheet on the top right, and then that takes you to the builder"). The builder itself is a Shop Tool
 * (/shop/gang-sheet/builder). Each card opens its sheet, reorders it, or puts it away (two clicks; archived, never erased).
 */
type Row = {
  id: string; name: string; owner: string; status: string; updated_at: string; ordered_at: string | null; supplier_order: string | null; expected: string | null; customer_id: string | null;
  data: { logos?: { name: string; path?: string; src?: string; vers: { qty: number }[] }[]; jobs?: { job: string }[]; files?: { length: number; at?: string }[] };
};
type Show = "all" | "mine" | "open" | "ordered";

export default function GangSheets() {
  const sb = useMemo(() => createClient(), []);
  const { email } = useRole();
  const me = (email || "").toLowerCase();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cust, setCust] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [show, setShow] = useSticky<Show>("gang.list.show", "all");
  const [armed, setArmed] = useState("");
  const [reorder, setReorder] = useState<Row | null>(null);

  useEffect(() => {
    // an old link to a sheet (/shop/gang-sheet?sheet=…) opens it in the builder
    const old = new URLSearchParams(window.location.search).get("sheet");
    if (old) { window.location.replace(`/shop/gang-sheet/builder?sheet=${old}`); return; }
    void (async () => {
      const { data } = await sb.from("gang_sheets").select("id, name, owner, status, updated_at, ordered_at, supplier_order, expected, customer_id, data").is("archived_at", null).order("updated_at", { ascending: false }).limit(300);
      const rs = (data || []) as Row[];
      setRows(rs);
      const ids = [...new Set(rs.map((r) => r.customer_id).filter(Boolean) as string[])];
      if (ids.length) {
        const { data: cs } = await sb.from("customers").select("id, company, name").in("id", ids);
        setCust(Object.fromEntries((cs || []).map((c) => [c.id as string, String(c.company || c.name || "")])));
      }
      // the first few logos of each sheet, for its picture
      const paths = [...new Set(rs.flatMap((r) => (r.data?.logos || []).slice(0, 4).map((l) => l.path).filter(Boolean) as string[]))];
      for (let i = 0; i < paths.length; i += 100) {
        const { data: su } = await sb.storage.from("proofs").createSignedUrls(paths.slice(i, i + 100), 3600);
        setThumbs((m) => ({ ...m, ...Object.fromEntries((su || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])) }));
      }
    })();
  }, [sb]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(""), 4000); return () => clearTimeout(t); }, [armed]);

  const who = (e: string) => { const n = (e || "").split("@")[0]; return n ? n[0].toUpperCase() + n.slice(1) : ""; };
  const pcs = (r: Row) => (r.data?.logos || []).reduce((a, l) => a + l.vers.reduce((b, v) => b + (+v.qty || 0), 0), 0);
  const jobs = (r: Row) => [...new Set((r.data?.jobs || []).map((j) => j.job).filter(Boolean))];
  const list = (rows || []).filter((r) => {
    if (show === "mine" && r.owner !== me) return false;
    if (show === "open" && r.status === "ordered") return false;
    if (show === "ordered" && r.status !== "ordered") return false;
    const t = q.trim().toLowerCase();
    return !t || [r.name, cust[r.customer_id || ""], who(r.owner), ...jobs(r), r.supplier_order, ...(r.data?.logos || []).map((l) => l.name)].some((x) => String(x || "").toLowerCase().includes(t));
  });
  const n = (k: Show) => (rows || []).filter((r) => (k === "all" ? true : k === "mine" ? r.owner === me : k === "open" ? r.status !== "ordered" : r.status === "ordered")).length;

  // this month's numbers (Oct 26, Nick: "total spend this month, total film used, average cost per transfer"): the sheets
  // ordered this month, each priced by its last download (the film sizes bought)
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const ordered = (rows || []).filter((r) => r.status === "ordered" && new Date(r.ordered_at || r.updated_at) >= month);
  const lastFiles = (r: Row) => { const fs = r.data?.files || []; if (!fs.length) return []; const t = Math.max(...fs.map((f) => new Date(f.at || 0).getTime())); return fs.filter((f) => t - new Date(f.at || 0).getTime() < 120000); };
  const spend = ordered.reduce((a, r) => a + lastFiles(r).reduce((b, f) => b + sheetFor(f.length).price, 0), 0);
  const filmIn = ordered.reduce((a, r) => a + lastFiles(r).reduce((b, f) => b + sheetFor(f.length).length, 0), 0);
  const priced = ordered.filter((r) => lastFiles(r).length);
  const transfers = priced.reduce((a, r) => a + pcs(r), 0);
  const openN = (rows || []).filter((r) => r.status !== "ordered").length;
  const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const monthName = month.toLocaleDateString("en-US", { month: "long" });

  async function del(id: string) {
    if (armed !== id) { setArmed(id); return; }
    setArmed("");
    const { error } = await sb.from("gang_sheets").update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (!error) setRows((rs) => (rs || []).filter((r) => r.id !== id));
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Gang sheets</h1><div className="eyebrow">Heat press: every DTF gang sheet made, for any customer or job</div></div>
        <div className="row"><a className="btn primary" href="/shop/gang-sheet/builder?new=1">+ New gang sheet</a></div>
      </div>
      <div className="stats">
        <button type="button" className="stat" onClick={() => setShow("ordered")} title={`${DTF_DALLAS.name} sheets ordered in ${monthName}, at their price before tax`}><span className="v">{money(spend)}</span><span className="k">Spent in {monthName}</span></button>
        <button type="button" className="stat" onClick={() => setShow("ordered")} title="22-inch film bought this month"><span className="v">{filmIn ? `${filmIn.toLocaleString("en-US")}"` : "—"}</span><span className="k">Film bought ({(filmIn / 12).toFixed(1)} ft)</span></button>
        <button type="button" className="stat" onClick={() => setShow("ordered")}><span className="v">{transfers.toLocaleString("en-US")}</span><span className="k">Transfers ordered</span></button>
        <button type="button" className="stat" onClick={() => setShow("ordered")}><span className="v">{transfers ? money(spend / transfers) : "—"}</span><span className="k">Per transfer, average</span></button>
        <button type="button" className="stat" onClick={() => setShow("open")} title="Sheets not ordered yet"><span className="v">{openN}</span><span className="k">Open sheets</span></button>
      </div>
      <div className="toolbar art-tools">
        <label className="aa-search"><SearchInput placeholder="Search sheets, customers, jobs, logos" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="chips">
          {(["all", "mine", "open", "ordered"] as Show[]).map((k) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{k === "all" ? "All" : k === "mine" ? "Mine" : k === "open" ? "Open" : "Ordered"} <span className="pill-n">{n(k)}</span></button>)}
        </div>
      </div>
      {rows === null ? <p className="faint">Loading…</p> : !list.length ? (
        <div className="gang-empty">{rows.length ? "No sheets match." : <>No gang sheets yet. <a href="/shop/gang-sheet/builder?new=1">Make the first one</a>.</>}</div>
      ) : (
        <div className="design-grid gang-grid">
          {list.map((r) => <GangSheetCard key={r.id} r={r} thumbs={thumbs} customer={cust[r.customer_id || ""] || null} armed={armed === r.id} onDelete={() => void del(r.id)} onReorder={() => setReorder(r)} />)}
        </div>
      )}
      {reorder && <GangReorder sheetId={reorder.id} customerId={reorder.customer_id} onClose={() => setReorder(null)} />}
    </>
  );
}
