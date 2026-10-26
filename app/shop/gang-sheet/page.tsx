"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { useSticky } from "@/lib/useSticky";
import SearchInput from "@/components/SearchInput";
import GangReorder from "@/components/GangReorder";

/**
 * Gang sheets: every DTF gang sheet made, like the Artwork page (Oct 26, Nick: "when you click gang sheets, it opens to
 * like the portfolio. Just like when you click artwork… you can see all the gang sheets there… a new that says new gang
 * sheet on the top right, and then that takes you to the builder"). The builder itself is a Shop Tool
 * (/shop/gang-sheet/builder). Each card opens its sheet, reorders it, or puts it away (two clicks; archived, never erased).
 */
type Row = {
  id: string; name: string; owner: string; status: string; updated_at: string; supplier_order: string | null; expected: string | null; customer_id: string | null;
  data: { logos?: { name: string; path?: string; src?: string; vers: { qty: number }[] }[]; jobs?: { job: string }[]; files?: { length: number }[] };
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
      const { data } = await sb.from("gang_sheets").select("id, name, owner, status, updated_at, supplier_order, expected, customer_id, data").is("archived_at", null).order("updated_at", { ascending: false }).limit(300);
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
          {list.map((r) => {
            const lgs = r.data?.logos || [], js = jobs(r);
            return (
              <div key={r.id} className="design-card gang-gc">
                <a className="dc-img gang-gc-img" href={`/shop/gang-sheet/builder?sheet=${r.id}`} aria-label={`Open ${r.name}`}>
                  {lgs.length ? lgs.slice(0, 4).map((l, i) => { const u = l.path ? thumbs[l.path] : l.src; return <span key={i} className="gang-gc-t">{u ? <img src={u} alt="" /> : <span className="faint">{l.name.replace(/\.[^.]+$/, "").slice(0, 12)}</span>}</span>; }) : <span className="faint">No art yet</span>}
                </a>
                <div className="dc-b">
                  <a className="gang-gc-n" href={`/shop/gang-sheet/builder?sheet=${r.id}`} data-notranslate>{r.name || "Gang sheet"}</a>
                  <span className="faint">{cust[r.customer_id || ""] ? <span data-notranslate>{cust[r.customer_id || ""]}</span> : "No customer"}{js.length ? ` · ${js.map((j) => `#${j}`).join(", ")}` : ""}</span>
                  <span className="faint num">{lgs.length} logo{lgs.length === 1 ? "" : "s"} · {pcs(r)} pcs · {who(r.owner)} · {new Date(r.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <span className={"gang-gc-s" + (r.status === "ordered" ? " ord" : "")}>{r.status === "ordered" ? `Ordered${r.supplier_order ? ` #${r.supplier_order}` : ""}${r.expected ? ` · ${r.expected}` : ""}` : "Open"}</span>
                  <span className="dc-acts gang-gc-acts">
                    <a className="btn sm" href={`/shop/gang-sheet/builder?sheet=${r.id}`}>Open</a>
                    {lgs.length > 0 && <button type="button" className="btn sm" onClick={() => setReorder(r)}>Reorder sheet</button>}
                    <span className="spacer" />
                    <button type="button" className={"gang-del" + (armed === r.id ? " armed" : "")} aria-label={armed === r.id ? `Click again to delete ${r.name}` : `Delete ${r.name}`} title={armed === r.id ? "Click again to delete" : "Delete (click twice)"} onClick={() => void del(r.id)}>{armed === r.id ? "Delete?" : "×"}</button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {reorder && <GangReorder sheetId={reorder.id} customerId={reorder.customer_id} onClose={() => setReorder(null)} />}
    </>
  );
}
