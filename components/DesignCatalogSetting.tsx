"use client";
import { useEffect, useState } from "react";

/**
 * Customer details → Design catalog (Oct 20, Nick: "be able to enable design finding on a client… through the customer
 * settings… the same thing we did for Dear Heart… it finds the designs, how many times we've ordered… makes a little
 * thumbnail… uses their site"). On: the customer gets the Designs tab (their orders grouped by design, every time each
 * was printed), with a picture of each from their website when it can be found, else from the job's own files.
 */
export default function DesignCatalogSetting({ customerId, on, onChange, portalOn = false, onPortal }: { customerId: string; on: boolean; onChange: (v: boolean) => void; /** shown to the customer in their portal too */ portalOn?: boolean; onPortal?: (v: boolean) => void }) {
  const [site, setSite] = useState(""), [guess, setGuess] = useState(""), [saved, setSaved] = useState(""), [msg, setMsg] = useState("");
  useEffect(() => {
    fetch(`/api/designs?customer=${customerId}&site=1`).then((r) => r.json()).then((j) => { setSite(j.site || ""); setSaved(j.site || ""); setGuess(j.guess || ""); }).catch(() => {});
  }, [customerId]);
  async function saveSite() {
    if (site.trim() === saved) return;
    const j = await fetch("/api/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: customerId, op: "site", site: site.trim() }) }).then((r) => r.json()).catch(() => null);
    if (j?.ok) { setSite(j.site || ""); setSaved(j.site || ""); setMsg(j.site ? "Saved." : "Cleared: we'll use their email's website."); }
    else setMsg(j?.error || "That didn't save.");
  }
  return (
    <div className="field dcs">
      <label className="check"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> <b>Design catalog</b></label>
      <span className="faint" style={{ fontSize: 12 }}>Their orders grouped by design: every time we&apos;ve printed each one, on what, and how many, with a picture of each. Shows as a Design catalog tab on this customer, next to Artwork.</span>
      {on && onPortal && <label className="check dcs-portal"><input type="checkbox" checked={portalOn} onChange={(e) => onPortal(e.target.checked)} /> Show it in their portal <span className="faint" style={{ fontSize: 12 }}>(Artwork → Design catalog, to look at and search)</span></label>}
      {on && (
        <div className="dcs-site">
          <label htmlFor="dcs-site">Their website (where design pictures come from)</label>
          <input id="dcs-site" type="text" placeholder={guess ? guess.replace(/^https?:\/\//, "") : "e.g. shoplittlegroupies.com"} value={site.replace(/^https?:\/\//, "")}
            onChange={(e) => { setSite(e.target.value); setMsg(""); }} onBlur={saveSite} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveSite(); } }} />
          <span className="faint" style={{ fontSize: 11.5 }}>{msg || (saved ? "" : guess ? `Blank: we use ${guess.replace(/^https?:\/\//, "")} (from their email).` : "Blank: pictures come from the job files only.")}</span>
        </div>
      )}
    </div>
  );
}
