"use client";
import { matchWord, suggestInk } from "@/lib/inkColors";

/**
 * Suggested colors for a color from the art: the closest standard (Wilflex RFU) ink and the closest PMS, how close
 * each is, and which one we'd use (a stock ink when it's very close, a PMS when only the PMS is). Pick either.
 * Used by the mockup builder and the Separation Studio.
 */
export default function InkMatch({ hex, cur, onPick, onHover, title = "SUGGESTED COLORS" }: {
  hex: string; cur?: { name: string; hex: string };
  onPick: (v: { name: string; hex: string }) => void;
  onHover?: (v: { name: string; hex: string } | null) => void;
  title?: string;
}) {
  const s = suggestInk(hex);
  const opt = (label: string, c: { name: string; hex: string; dE: number }, rec: boolean) => (
    <button type="button" className={"mk-near" + (cur?.name === c.name ? " on" : "") + (rec ? " rec" : "")} title={`${c.name}: ${matchWord(c.dE)} (ΔE ${c.dE})`} onClick={() => onPick({ name: c.name, hex: c.hex })}
      onMouseEnter={() => onHover?.({ name: c.name, hex: c.hex })} onMouseLeave={() => onHover?.(null)}>
      <span className="k">{label}</span><span className="sw" style={{ background: c.hex }} /><span className="n" data-notranslate>{c.name}</span>
      <span className={"q q-" + matchWord(c.dE).replace(/ /g, "-")}>{matchWord(c.dE)}</span>
      {rec && <span className="mk-rec">Suggested</span>}
    </button>
  );
  return (
    <div className="mk-match">
      <div className="mk-match-h"><span>{title}</span><span className="mono">{hex.toUpperCase()}</span></div>
      {opt("Standard", s.standard, s.rec === "standard")}
      {opt("PMS", s.pms, s.rec === "pms")}
      <div className="mk-match-why">{s.why}</div>
    </div>
  );
}
