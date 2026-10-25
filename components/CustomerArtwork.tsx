"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { designLabel, LOCATIONS, newImprint, uid, type Group, type Imprint } from "@/lib/pricing";

/**
 * Customer artwork (Oct 24, Nick: "a button under create mockups to pull in other mockups… go find the artwork in their
 * account and bring it in… if you go and bring in a mockup, it's, let's say, on a Gildan… you should ask in there, hey,
 * change mockup to current job"). A mockup saved on any of the customer's orders (or a logo from their library) is
 * brought onto this garment group: its prints (art, location, size, inks, placement) come with it, and the picture is
 * either used as it is (the same garments) or made again on this group's garments in the Mockup Creator.
 */
type Snap = { lines?: { brand?: string; style?: string; color?: string }[]; imprints?: Imprint[]; mockupThumbs?: string[] };
type Row = { id: string; order_id: string | null; group_id: string | null; title: string; file_path: string; snapshot: Snap | null; created_at: string; design_ids: string[] | null; customer_id: string };
type Save = { key: string; rows: Row[]; snap: Snap; order?: { id: string; number: number; nickname: string; offsets?: Record<string, { dx: number; dy: number }> }; when: string };
export type ArtPick = { imprints: Imprint[]; offsets: Record<string, { dx: number; dy: number }>; thumbs: string[] | null; remake: boolean; label: string };

const thumbOf = (p: string) => p.replace(/(\.[a-z]+)$/i, "-thumb.png");
const garments = (s?: Snap) => [...new Set((s?.lines || []).map((l) => [l.style, l.color].filter(Boolean).join(" ")).filter(Boolean))];
const gkey = (style?: string, color?: string) => `${String(style || "").trim().toLowerCase()}|${String(color || "").trim().toLowerCase()}`;

export default function CustomerArtwork({ customerId, orderId, group, onClose, onPick }: { customerId: string; orderId: string; group: Group; onClose: () => void; onPick: (p: ArtPick) => Promise<void> | void }) {
  const sb = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<"mockups" | "logos">("mockups");
  const [q, setQ] = useState("");
  const [saves, setSaves] = useState<Save[] | null>(null);
  const [logos, setLogos] = useState<{ id: string; number: number; name: string; preview_path: string | null }[] | null>(null);
  const [pics, setPics] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Save | null>(null);
  const [logo, setLogo] = useState<{ id: string; label: string } | null>(null), [loc, setLoc] = useState("Full Front");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await sb.from("mockups").select("id, order_id, group_id, title, file_path, snapshot, created_at, design_ids, customer_id").eq("customer_id", customerId).is("archived_at", null).order("created_at", { ascending: false }).limit(300);
      const rows = ((data || []) as Row[]).filter((r) => !(r.order_id === orderId && r.group_id === group.id));
      // one card per save: the mockups of one group (a picture per garment color) together
      const by = new Map<string, Row[]>();
      for (const r of rows) { const k = r.order_id && r.group_id ? `${r.order_id}:${r.group_id}` : r.id; by.set(k, [...(by.get(k) || []), r]); }
      const oids = [...new Set(rows.map((r) => r.order_id).filter(Boolean) as string[])];
      const { data: os } = oids.length ? await sb.from("orders").select("id, number, nickname, groups").in("id", oids) : { data: [] };
      const list: Save[] = [...by.entries()].map(([key, rs]) => {
        const r0 = rs[0], o = (os || []).find((x) => x.id === r0.order_id) as { id: string; number: number; nickname: string; groups: Group[] } | undefined;
        const g = o?.groups?.find((x) => x.id === r0.group_id);
        return { key, rows: rs, snap: r0.snapshot || {}, when: r0.created_at, ...(o ? { order: { id: o.id, number: o.number, nickname: o.nickname || "", offsets: g?.mockupOffsets } } : {}) };
      }).filter((s) => (s.snap.imprints || []).some((im) => im.design_id));
      if (!live) return;
      setSaves(list);
      const paths = list.slice(0, 60).map((s) => thumbOf(s.rows[0].file_path));
      if (paths.length) { const { data: su } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); if (live) setPics((x) => ({ ...x, ...Object.fromEntries(paths.map((p, i) => [p, su?.[i]?.signedUrl || ""])) })); }
    })();
    void (async () => {
      const { data } = await sb.from("designs").select("id, number, name, preview_path").eq("customer_id", customerId).is("archived_at", null).eq("draft", false).order("created_at", { ascending: false }).limit(200);
      if (!live) return;
      const ds = (data || []) as { id: string; number: number; name: string; preview_path: string | null }[];
      setLogos(ds);
      const paths = ds.slice(0, 80).map((d) => d.preview_path).filter(Boolean) as string[];
      if (paths.length) { const { data: su } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); if (live) setPics((x) => ({ ...x, ...Object.fromEntries(paths.map((p, i) => [p, su?.[i]?.signedUrl || ""])) })); }
    })();
    return () => { live = false; };
  }, [sb, customerId, orderId, group.id]);

  const t = q.trim().toLowerCase();
  const shown = (saves || []).filter((s) => !t || [s.order?.nickname, s.order?.number, s.rows[0].title, ...garments(s.snap)].join(" ").toLowerCase().includes(t));
  const shownLogos = (logos || []).filter((d) => !t || `${d.number} ${d.name}`.toLowerCase().includes(t));
  const here = new Set(group.lines.filter((l) => (l.style || "").trim()).map((l) => gkey(l.style, l.color)));
  const diff = (s: Save) => { const there = new Set((s.snap.lines || []).map((l) => gkey(l.style, l.color))); return here.size > 0 && [...here].some((k) => !there.has(k)); };
  const prints = (s: Save) => (s.snap.imprints || []).map((im) => [im.location, im.size, im.inks].filter(Boolean).join(" · "));

  async function useSave(s: Save, remake: boolean) {
    setBusy(true); setErr("");
    try {
      const ids = new Map<string, string>();
      const imps = (s.snap.imprints || []).map((im) => {
        const id = uid(); ids.set(im.id, id);
        // this order's run: production confirms it again (Order type), nothing carried as already confirmed
        const { confirmed: _c, confirm: _f, ...rest } = im as Imprint & { confirmed?: unknown; confirm?: unknown };
        return { ...(JSON.parse(JSON.stringify(rest)) as Imprint), id };
      });
      const offsets: Record<string, { dx: number; dy: number }> = {};
      for (const [k, v] of Object.entries(s.order?.offsets || {})) { const n = ids.get(k); if (n) offsets[n] = v; }
      let thumbs: string[] | null = null;
      if (!remake) {
        // the same pictures on this order: the mockup rows copied (the files are shared), the group's old ones archived
        const { data: u } = await sb.auth.getUser();
        await sb.from("mockups").update({ archived_at: new Date().toISOString() }).eq("order_id", orderId).eq("group_id", group.id).is("archived_at", null);
        for (const r of [...s.rows].reverse()) await sb.from("mockups").insert({ customer_id: r.customer_id, order_id: orderId, group_id: group.id, proof_id: null, title: r.title, file_path: r.file_path, design_ids: r.design_ids || [], created_by: u.user?.email || "", snapshot: { ...(r.snapshot || {}), imprints: imps } });
        thumbs = (s.snap.mockupThumbs || []).length ? s.snap.mockupThumbs! : s.rows.map((r) => thumbOf(r.file_path));
      }
      await onPick({ imprints: imps, offsets, thumbs, remake, label: s.order ? `#${s.order.number}${s.order.nickname ? ` ${s.order.nickname}` : ""}` : s.rows[0].title });
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't bring it in."); setBusy(false); }
  }
  async function useLogo() {
    if (!logo) return;
    setBusy(true);
    const im = { ...newImprint(loc), design_id: logo.id };
    await onPick({ imprints: [...group.imprints, im], offsets: {}, thumbs: null, remake: true, label: logo.label });
  }

  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Customer artwork" onClick={onClose}>
      <div className="dla ca" onClick={(e) => e.stopPropagation()}>
        <div className="ca-h"><h3>Customer artwork</h3><button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>×</button></div>
        <p className="dla-sub">Bring a mockup from another of their orders, or one of their logos, onto this group.</p>
        <div className="toolbar"><div className="chips">
          <button type="button" className={"chip" + (tab === "mockups" ? " on" : "")} onClick={() => { setTab("mockups"); setLogo(null); }}>Mockups</button>
          <button type="button" className={"chip" + (tab === "logos" ? " on" : "")} onClick={() => { setTab("logos"); setPick(null); }}>Logos</button>
        </div><input type="search" className="ca-q" placeholder="Find: name or order #" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find their artwork" /></div>
        {tab === "mockups" ? (saves === null ? <p className="faint">Loading their mockups…</p> : !shown.length ? <p className="faint">{q ? "Nothing matches." : "No saved mockups on their account yet."}</p> : (
          <div className="ca-grid">
            {shown.slice(0, 60).map((s) => (
              <button key={s.key} type="button" className={"ca-card" + (pick?.key === s.key ? " on" : "")} onClick={() => setPick(s)}>
                <span className="ca-pic">{pics[thumbOf(s.rows[0].file_path)] ? <img src={pics[thumbOf(s.rows[0].file_path)]} alt="" /> : null}</span>
                <b>{s.order?.nickname || s.rows[0].title.replace(/^.*? — /, "")}</b>
                <span className="faint">{s.order ? `#${s.order.number} · ` : ""}{garments(s.snap).slice(0, 2).join(", ")}</span>
              </button>
            ))}
          </div>
        )) : (logos === null ? <p className="faint">Loading their logos…</p> : !shownLogos.length ? <p className="faint">{q ? "Nothing matches." : "No logos on their account yet."}</p> : (
          <div className="ca-grid">
            {shownLogos.slice(0, 80).map((d) => (
              <button key={d.id} type="button" className={"ca-card" + (logo?.id === d.id ? " on" : "")} onClick={() => setLogo({ id: d.id, label: designLabel(d) })}>
                <span className="ca-pic logo">{d.preview_path && pics[d.preview_path] ? <img src={pics[d.preview_path]} alt="" /> : null}</span>
                <b>{d.name || "Logo"}</b><span className="faint">D-{d.number}</span>
              </button>
            ))}
          </div>
        ))}
        {pick && tab === "mockups" && (
          <div className="ca-use">
            <b>Bring in {pick.order?.nickname || "this mockup"}{pick.order ? ` from #${pick.order.number}` : ""}</b>
            <span className="faint">{prints(pick).join("  |  ") || "Its prints"}. They replace this group&apos;s prints.</span>
            {diff(pick) && <span className="ca-warn">That mockup is on {garments(pick.snap).join(", ") || "other garments"}. This group has {[...new Set(group.lines.filter((l) => (l.style || "").trim()).map((l) => [l.style, l.color].filter(Boolean).join(" ")))].join(", ")}.</span>}
            {err && <span className="err">{err}</span>}
            <div className="ca-acts">
              <button type="button" className={"btn" + (diff(pick) ? "" : " primary")} disabled={busy} onClick={() => void useSave(pick, false)}>Use the picture as it is</button>
              <button type="button" className={"btn" + (diff(pick) ? " primary" : "")} disabled={busy} onClick={() => void useSave(pick, true)}>{busy ? "Bringing it in…" : "Remake on this order's garments"}</button>
            </div>
          </div>
        )}
        {logo && tab === "logos" && (
          <div className="ca-use">
            <b>Add {logo.label}</b>
            <div className="ca-acts">
              <div className="field"><label htmlFor="ca-loc">Where it prints</label><select id="ca-loc" value={loc} onChange={(e) => setLoc(e.target.value)}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select></div>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void useLogo()}>{busy ? "Bringing it in…" : "Add and make the mockup"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
