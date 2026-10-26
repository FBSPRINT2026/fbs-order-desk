"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";

/**
 * Reorder a gang sheet (Oct 26, Nick: "click on it and say re-order… here's all the logos on this one which logos are
 * re-ordering… how many of each… also… select other sheets… find an additional logo on another sheet"; and "keeping
 * all those savings from before… we knocked out the white… at this size… a place where you went overwrite it").
 *
 * Every logo comes back exactly as it was done (art, size, knocked-out colors, the trim); Change alters it for this
 * reorder only. Make the sheet saves a new sheet for the customer and opens it in the Gang sheet builder. The old
 * sheets are never touched.
 */
type Ver = { id: string; wIn: number; qty: number; knock: string[]; label: string; hIn?: number; box?: [number, number, number, number] };
type Logo = { id: string; name: string; src?: string; srcW: number; srcH: number; colors: string[]; vers: Ver[]; hIn?: number; path?: string; job?: string };
type Sheet = { id: string; name: string; customer_id: string | null; data: { logos?: Logo[]; gap?: string; sheetW?: string; maxLen?: string; plan?: unknown } };
/** one size of one logo, as it'll be reordered */
type Line = { key: string; sheet: Sheet; logo: Logo; ver: Ver; on: boolean; qty: number; wIn: number; knock: string[]; open: boolean };

const uid = () => Math.random().toString(36).slice(2, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const shortName = (n: string) => n.replace(/\.[^.]+$/, "");
const heightOf = (lg: Logo, v: Ver, wIn: number, knock: string[]) => {
  if (!lg.src && !lg.path) return r2((wIn * (v.hIn || lg.hIn || 3)) / Math.max(0.01, v.wIn));
  const b = knock.length && v.box && knock.join() === v.knock.join() ? v.box : [0, 0, 1, 1];
  return r2((wIn * (b[3] - b[1]) * lg.srcH) / Math.max(1, (b[2] - b[0]) * lg.srcW));
};
const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

export default function GangReorder({ sheetId, customerId, onClose }: { sheetId: string; customerId: string; onClose: () => void }) {
  const sb = useMemo(() => createClient(), []);
  const { email, staffName } = useRole();
  const me = (email || "").toLowerCase();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [other, setOther] = useState(""), [picking, setPicking] = useState(false);
  const [job, setJob] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");

  const linesOf = (s: Sheet, on: boolean): Line[] => (s.data?.logos || []).flatMap((lg) => lg.vers.map((v) => ({ key: `${s.id}|${lg.id}|${v.id}`, sheet: s, logo: lg, ver: v, on, qty: +v.qty || 0, wIn: v.wIn, knock: [...(v.knock || [])], open: false })));
  const sign = async (ss: Sheet[]) => {
    const paths = [...new Set(ss.flatMap((s) => (s.data?.logos || []).map((l) => l.path).filter(Boolean) as string[]))].filter((p) => !thumbs[p]);
    if (!paths.length) return;
    const { data } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
    setThumbs((m) => ({ ...m, ...Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])) }));
  };
  useEffect(() => {
    void (async () => {
      const { data } = await sb.from("gang_sheets").select("id, name, customer_id, data").eq("customer_id", customerId).is("archived_at", null).order("updated_at", { ascending: false }).limit(40);
      const ss = (data || []) as Sheet[];
      setSheets(ss);
      const s0 = ss.find((s) => s.id === sheetId);
      if (s0) setLines(linesOf(s0, true));
      void sign(ss);
    })();
  }, [sb, sheetId, customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const src = sheets.find((s) => s.id === sheetId);
  const others = sheets.filter((s) => s.id !== sheetId && (s.data?.logos || []).length);
  const otherSheet = others.find((s) => s.id === other) || others[0];
  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const pull = (s: Sheet, lg: Logo) => setLines((ls) => [...ls, ...linesOf(s, true).filter((l) => l.logo.id === lg.id && !ls.some((x) => x.key === l.key))]);
  const picked = lines.filter((l) => l.on && l.qty > 0);
  const pcs = picked.reduce((a, l) => a + l.qty, 0);

  async function make() {
    if (!picked.length) { setErr("Check at least one logo and how many."); return; }
    setBusy(true); setErr("");
    // the logos as they were, one per logo, with the sizes being reordered
    const byLogo = new Map<string, Logo>();
    for (const l of picked) {
      const k = `${l.sheet.id}|${l.logo.id}`;
      if (!byLogo.has(k)) { const { src: s0, job: _j, ...rest } = l.logo; byLogo.set(k, { ...rest, ...(rest.path ? {} : s0 ? { src: s0 } : {}), id: uid(), vers: [] }); }
      const changed = l.wIn !== l.ver.wIn || !same(l.knock, l.ver.knock);
      byLogo.get(k)!.vers.push({ ...l.ver, id: uid(), qty: l.qty, wIn: l.wIn, knock: l.knock, ...(l.ver.hIn ? { hIn: r2((l.wIn * l.ver.hIn) / Math.max(0.01, l.ver.wIn)) } : {}), ...(changed && !same(l.knock, l.ver.knock) ? { box: undefined } : {}) });
    }
    const logos = [...byLogo.values()];
    const j = job.replace(/\D/g, "");
    const first = (staffName || me.split("@")[0] || "").split(" ")[0];
    const day = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const d = src?.data || {};
    const data = { logos, jobs: j ? [{ id: uid(), job: j, logos: logos.map((x) => x.id), note: "" }] : [], gap: d.gap, sheetW: d.sheetW, maxLen: d.maxLen, plan: d.plan, reorderOf: [...new Set(picked.map((l) => l.sheet.id))] };
    const name = `${first ? first[0].toUpperCase() + first.slice(1) + "'s" : "A"} reorder · ${day}`;
    const { data: row, error } = await sb.from("gang_sheets").insert({ name, owner: me, data, customer_id: customerId }).select("id").single();
    if (error || !row) { setBusy(false); setErr(error?.message || "Couldn't make the sheet."); return; }
    window.location.href = `/shop/gang-sheet?sheet=${row.id}`;
  }

  const card = (l: Line) => {
    const lg = l.logo, changed = l.wIn !== l.ver.wIn || !same(l.knock, l.ver.knock);
    const th = lg.path ? thumbs[lg.path] : lg.src;
    return (
      <div key={l.key} className={"grd-card" + (l.on ? "" : " off")}>
        <div className="grd-top">
          <input type="checkbox" checked={l.on} aria-label={`Reorder ${lg.name}`} onChange={(e) => patch(l.key, { on: e.target.checked })} />
          <span className="grd-th">{th ? <img src={th} alt="" /> : <span className="faint">{l.wIn}&quot;</span>}</span>
          <div className="grd-nm">
            <b data-notranslate>{shortName(lg.name)}{l.ver.label ? ` (${l.ver.label})` : ""}</b>
            <div className="grd-tags">
              <span className="grd-tag num">{r2(l.wIn)}&quot; × {heightOf(lg, l.ver, l.wIn, l.knock)}&quot;</span>
              <span className="grd-tag">{l.knock.length ? <>{l.knock.map((h) => <i key={h} className="grd-dot" style={{ background: h }} />)} knocked out</> : "Nothing knocked out"}</span>
              <span className="grd-tag num">{l.ver.qty} last time</span>
              {l.sheet.id !== sheetId && <span className="grd-tag" data-notranslate>From {l.sheet.name}</span>}
              {changed && <span className="grd-tag ch">Changed</span>}
            </div>
          </div>
          <div className="grd-rt">
            <input type="number" min="0" value={l.qty || ""} aria-label="How many" onChange={(e) => patch(l.key, { qty: Math.max(0, Math.round(+e.target.value || 0)) })} />
            <button type="button" className="linkish" onClick={() => patch(l.key, { open: !l.open })}>{l.open ? "Done" : "Change"}</button>
          </div>
        </div>
        {l.open && (
          <div className="grd-ed">
            <div className="field"><label htmlFor={`w-${l.key}`}>Width (in)</label><input id={`w-${l.key}`} type="number" min="0.25" step="0.25" value={l.wIn} onChange={(e) => patch(l.key, { wIn: Math.max(0.25, +e.target.value || l.wIn) })} /></div>
            {lg.colors.length > 0 && (
              <div className="field"><label>Knock out</label>
                <span className="gang-ko">{lg.colors.map((h) => <button key={h} type="button" className={"gang-dot" + (l.knock.includes(h) ? " off" : "")} style={{ background: h }} aria-pressed={l.knock.includes(h)} title={l.knock.includes(h) ? `${h} knocked out: click to print it` : `Knock out ${h}`} onClick={() => patch(l.key, { knock: l.knock.includes(h) ? l.knock.filter((x) => x !== h) : [...l.knock, h] })} />)}</span>
              </div>
            )}
            {changed && <button type="button" className="linkish" onClick={() => patch(l.key, { wIn: l.ver.wIn, knock: [...l.ver.knock] })}>Back to how we did it</button>}
            <span className="faint grd-only">Only this reorder. The old sheet stays as it was.</span>
          </div>
        )}
      </div>
    );
  };

  const mine = lines.filter((l) => l.sheet.id === sheetId), pulled = lines.filter((l) => l.sheet.id !== sheetId);
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Reorder transfers" onClick={onClose}>
      <div className="dla grd" onClick={(e) => e.stopPropagation()}>
        <div className="panel-h gang-ph">
          <div className="gang-pt"><h2>Reorder transfers</h2><span className="faint">Done the same way as last time. Check what you need and how many.</span></div>
          <span className="spacer" />
          <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="grd-b">
          {!src ? <p className="faint">Loading…</p> : (
            <>
              <div className="grd-sec" data-notranslate>From {src.name}</div>
              {mine.map(card)}
              {pulled.length > 0 && <div className="grd-sec">From other sheets</div>}
              {pulled.map(card)}
              {others.length > 0 && (picking ? (
                <div className="grd-pick">
                  <div className="field"><label htmlFor="grd-o">Another sheet for this customer</label>
                    <select id="grd-o" value={otherSheet?.id || ""} onChange={(e) => setOther(e.target.value)}>{others.map((s) => <option key={s.id} value={s.id}>{s.name} ({(s.data?.logos || []).length} logo{(s.data?.logos || []).length === 1 ? "" : "s"})</option>)}</select>
                  </div>
                  <div className="grd-pl">{(otherSheet?.data?.logos || []).map((lg) => {
                    const inIt = lines.some((l) => l.sheet.id === otherSheet!.id && l.logo.id === lg.id);
                    const th = lg.path ? thumbs[lg.path] : lg.src;
                    return <button key={lg.id} type="button" className="btn sm" disabled={inIt} onClick={() => pull(otherSheet!, lg)}>{th ? <img src={th} alt="" /> : null}<span data-notranslate>{shortName(lg.name)}</span></button>;
                  })}</div>
                </div>
              ) : <button type="button" className="btn sm grd-add" onClick={() => setPicking(true)}>+ Add a logo from another sheet</button>)}
            </>
          )}
          {err && <p className="gang-warn">{err}</p>}
        </div>
        <div className="grd-f">
          <div className="field"><label htmlFor="grd-j">For job (optional)</label><input id="grd-j" inputMode="numeric" placeholder="40188" value={job} onChange={(e) => setJob(e.target.value)} /></div>
          <span className="spacer" />
          <span className="faint num">{picked.length} logo{picked.length === 1 ? "" : "s"} · {pcs} pcs</span>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void make()}>{busy ? "Making…" : "Make the sheet"}</button>
        </div>
      </div>
    </div>
  );
}
