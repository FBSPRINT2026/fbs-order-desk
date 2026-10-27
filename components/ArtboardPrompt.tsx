"use client";
import { useEffect, useState } from "react";
import { onArtboard, type ArtboardAsk } from "@/lib/artboards";

/** "Which logo are you using?" for a file with several artboards (lib/artboards.ts), wherever a logo is uploaded. */
export default function ArtboardPrompt() {
  const [ask, setAsk] = useState<ArtboardAsk | null>(null);
  useEffect(() => onArtboard((a) => setAsk(a)), []);
  if (!ask) return null;
  const done = (n: number | null) => { ask.resolve(n); setAsk(null); };
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Which logo" onClick={() => done(null)}>
      <div className="dla abp" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={() => done(null)}>×</button>
        <h3>Which logo are you using?</h3>
        <p className="dla-sub"><span data-notranslate>{ask.fileName}</span> has {ask.pages.length} artboards. Pick the one for this print; only that one is saved.</p>
        <div className="abp-grid">
          {ask.pages.map((u, i) => (
            <button key={i} type="button" className="abp-c" onClick={() => done(i + 1)} autoFocus={i === 0}>
              <span className="abp-pic">{u ? <img src={u} alt="" /> : <span className="faint">No preview</span>}</span>
              <span>Artboard {i + 1}</span>
            </button>
          ))}
        </div>
        <div className="dla-acts"><button type="button" className="btn ghost" onClick={() => done(null)}>Cancel</button></div>
      </div>
    </div>
  );
}
