"use client";
import { useEffect, useState } from "react";
import { onSameArt, type SameArtMatch } from "@/lib/sameArt";

/** "We already have this logo" (lib/sameArt.ts), shown wherever a logo is uploaded (portal and shop layouts). */
export default function SameArtPrompt() {
  const [ask, setAsk] = useState<{ match: SameArtMatch; fileName: string; preview: string; resolve: (use: boolean) => void } | null>(null);
  useEffect(() => onSameArt((a) => setAsk(a)), []);
  if (!ask) return null;
  const c = ask.match.cand, no = c.number ? `D-${c.number}` : c.name;
  const done = (use: boolean) => { ask.resolve(use); setAsk(null); };
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Already on file" onClick={() => done(false)}>
      <div className="dla same-art" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={() => done(false)}>×</button>
        <h3>{ask.match.why === "looks" ? "We already have this logo" : `You already have a logo named “${c.name}”`}</h3>
        <p className="dla-sub">{ask.match.why === "looks"
          ? <>This looks like <b>{no}</b>{c.name ? ` (${c.name})` : ""}. Use that one so your orders and reorders stay on one art number, or keep this as a new logo if it&apos;s different.</>
          : <>Is this a new version of <b>{no}</b>, or the same logo? Using the one on file keeps your orders on one art number.</>}</p>
        <div className="same-art-pics">
          <figure><div>{ask.preview ? <img src={ask.preview} alt="" /> : null}</div><figcaption>What you&apos;re uploading<br /><small>{ask.fileName}</small></figcaption></figure>
          <figure><div>{c.url ? <img src={c.url} alt="" /> : null}</div><figcaption><b>{no}</b><br /><small>{c.name}</small></figcaption></figure>
        </div>
        <div className="dla-acts">
          <button type="button" className="btn" onClick={() => done(false)}>It&apos;s different: add it as a new logo</button>
          <button type="button" className="btn primary" autoFocus onClick={() => done(true)}>Use {no}</button>
        </div>
      </div>
    </div>
  );
}
