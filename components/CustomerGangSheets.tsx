"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import GangReorder from "@/components/GangReorder";
import GangSheetCard, { gangThumbPaths, type GangRow } from "@/components/GangSheetCard";

/**
 * A customer's DTF gang sheets, under Artwork on their page, staff only (Oct 26, Nick: "just like we save mockups, we
 * should have gang sheets be there so that we can see them by customer… only viewable by staff"), as cards with a
 * picture like the logos and mockups ("the little cards, just like you do on artwork and mockup"). Each opens in the
 * Gang sheet builder; Reorder sheet asks which logos and how many, done the same way as last time.
 */
export default function CustomerGangSheets({ customerId }: { customerId: string }) {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<GangRow[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [reorder, setReorder] = useState("");
  // delete takes two clicks; the sheet is archived, never erased
  const [armed, setArmed] = useState("");
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(""), 4000); return () => clearTimeout(t); }, [armed]);
  useEffect(() => {
    void (async () => {
      const { data } = await sb.from("gang_sheets").select("id, name, owner, status, updated_at, ordered_at, supplier_order, expected, customer_id, data").eq("customer_id", customerId).is("archived_at", null).order("updated_at", { ascending: false }).limit(30);
      const rs = (data || []) as GangRow[];
      setRows(rs);
      const paths = gangThumbPaths(rs);
      if (paths.length) {
        const { data: su } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
        setThumbs(Object.fromEntries((su || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])));
      }
    })();
  }, [sb, customerId]);
  const del = async (id: string) => {
    if (armed !== id) { setArmed(id); return; }
    setArmed("");
    const { error } = await sb.from("gang_sheets").update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (!error) setRows((rs) => (rs || []).filter((r) => r.id !== id));
  };
  if (!rows || !rows.length) return null;
  return (
    <div className="aa-card aa-gang">
      <div className="aa-sec-h"><h3>Gang sheets</h3><span className="faint">DTF transfers, staff only</span></div>
      <div className="design-grid aa-grid6">
        {rows.map((r) => <GangSheetCard key={r.id} r={r} thumbs={thumbs} armed={armed === r.id} onDelete={() => void del(r.id)} onReorder={() => setReorder(r.id)} />)}
      </div>
      {reorder && <GangReorder sheetId={reorder} customerId={customerId} onClose={() => setReorder("")} />}
    </div>
  );
}
