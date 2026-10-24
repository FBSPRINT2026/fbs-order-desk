"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { POP_KINDS, POP_USES, type PopKind, type PopUse } from "@/lib/popularGarments";
import { popularGarments, type PopularCard } from "@/app/popular-garments-actions";

/** "Need help picking garments?": our most popular garments by type, narrowed by what it's for; Use puts one on the mockup. */
export default function PopularGarments({ onPick, onClose, askHref }: { onPick: (g: PopularCard) => void; onClose: () => void; askHref?: string }) {
  const [list, setList] = useState<PopularCard[] | null>(null);
  const [err, setErr] = useState("");
  const [use, setUse] = useState<"" | PopUse>("");
  const [kind, setKind] = useState<PopKind>("tees");
  const [sel, setSel] = useState("");
  useEffect(() => { popularGarments().then((r) => { if (r.ok) setList(r.list); else setErr(r.error || "Couldn't load the garments."); }); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const kinds = useMemo(() => POP_KINDS.filter((k) => (list || []).some((g) => g.kind === k.k && (!use || g.uses.includes(use)))), [list, use]);
  const kindNow = kinds.some((k) => k.k === kind) ? kind : kinds[0]?.k || "tees";
  const shown = (list || []).filter((g) => g.kind === kindNow && (!use || g.uses.includes(use)));
  const picked = shown.find((g) => g.style === sel) || shown[0] || null;
  const key = (g: PopularCard) => g.style;
  return createPortal(
    <div className="dla-bg pg-bg" role="dialog" aria-modal="true" aria-label="Our most popular garments" onClick={onClose}>
      <div className="dla pg" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={onClose}>×</button>
        <h3>Our most popular garments</h3>
        <p className="dla-sub">What our customers order most. Pick one to put it on your mockup.</p>
        <div className="pg-k">What&apos;s it for?</div>
        <div className="pg-uses">
          <button type="button" className={"pg-use" + (!use ? " on" : "")} onClick={() => setUse("")}>Anything</button>
          {POP_USES.map((u) => <button key={u.k} type="button" className={"pg-use" + (use === u.k ? " on" : "")} onClick={() => setUse(u.k)}>{u.label}</button>)}
        </div>
        <div className="toolbar aa-otabs pg-kinds" data-toolbar><div className="chips">{kinds.map((k) => <button key={k.k} type="button" className={"chip" + (kindNow === k.k ? " on" : "")} onClick={() => { setKind(k.k); setSel(""); }}>{k.label}</button>)}</div></div>
        {err ? <div className="err">{err}</div> : !list ? <div className="faint" style={{ padding: 12 }}>Loading…</div> : !shown.length ? <div className="faint" style={{ padding: 12 }}>Nothing here for that. Try Anything.</div> : (
          <div className="pg-grid">
            {shown.map((g) => (
              <button key={key(g)} type="button" className={"pg-card" + (picked && key(picked) === key(g) ? " on" : "")} onClick={() => setSel(g.style)} onDoubleClick={() => onPick(g)}>
                <span className="pg-pic">{g.image ? <img src={g.image} alt="" loading="lazy" /> : null}</span>
                <span className="pg-t">
                  {g.tag && <small className="pg-tag">{g.tag}</small>}
                  <b>{g.brand} {g.style}</b>
                  <span className="pg-why">{g.why || g.garment}</span>
                  <small className="pg-meta">{"$".repeat(g.tier)}{g.colors ? ` · ${g.colors >= 10 ? `${Math.floor(g.colors / 10) * 10}+` : g.colors} colors` : ""}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="pg-foot">
          <span className="faint">{askHref ? "Still not sure? Ask us and we'll suggest something." : "Double-click a garment to use it."}</span>
          {askHref && <a className="btn" href={askHref}>Ask FBS</a>}
          <button type="button" className="btn primary" disabled={!picked} onClick={() => picked && onPick(picked)}>{picked ? `Use ${picked.brand} ${picked.style}` : "Use"}</button>
        </div>
      </div>
    </div>, document.body);
}
