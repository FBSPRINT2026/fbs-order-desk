"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cardFontCss, cardItemName, printPdf, proofPng, sideSvg, startValues, type CardFill, type PrintTemplate } from "@/lib/printTemplates";

/**
 * Business cards from a template (Nov 18 2026, Nick: "when you go to print order… click mock-up… open a template… change
 * the name and address"). Opened from a paper printing item only (never an apparel order): pick the customer's card
 * template, type the lines, and Use this card makes the item's picture (the proof the customer approves: front and back
 * side by side) and its print-ready PDF (the file the printer gets). What was typed is kept on the item, so the card
 * opens again as it was.
 */
export default function BusinessCardTool({ customerId, fill, onClose, onDone }: {
  customerId: string | null;
  /** the item's card as last made, to start from */ fill?: CardFill;
  onClose: () => void;
  /** the made card: its print PDF, its proof picture and what was typed */
  onDone: (r: { pdf: File; proof: File; fill: CardFill; itemName: string }) => Promise<void>;
}) {
  const sb = createClient();
  const [list, setList] = useState<PrintTemplate[] | null>(null);
  const [pick, setPick] = useState<string>(fill?.template || "");
  const [values, setValues] = useState<Record<string, string>>(fill?.values || {});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    void sb.from("print_templates").select("id, name, customer_id, kind, data").is("archived_at", null).order("name").then(({ data, error }) => {
      if (!live) return;
      if (error) { setErr(error.message); setList([]); return; }
      // the customer's own templates first
      const l = ((data || []) as PrintTemplate[]).sort((a, b) => Number(b.customer_id === customerId) - Number(a.customer_id === customerId));
      setList(l);
      if (!pick && l.length) { const first = l.find((t) => t.customer_id === customerId) || l[0]; setPick(first.id); setValues(startValues(first.data)); }
    });
    return () => { live = false; };
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = list?.find((x) => x.id === pick) || null;
  const choose = (id: string) => { const n = list?.find((x) => x.id === id); setPick(id); if (n) setValues({ ...startValues(n.data), ...keepSame(values, n) }); };
  const fields = useMemo(() => t ? t.data.sides.flatMap((s) => s.fields.map((f) => ({ ...f, side: s.name }))) : [], [t]);
  const fontCss = useMemo(() => cardFontCss(), []);
  const mine = list?.filter((x) => x.customer_id === customerId) || [];
  const others = list?.filter((x) => x.customer_id !== customerId) || [];

  async function make() {
    if (!t) return;
    setBusy("Making the card…"); setErr("");
    try {
      await document.fonts.ready;
      const [pdf, png] = await Promise.all([printPdf(t.data, values), proofPng(t.data, values)]);
      const itemName = cardItemName(t, values);
      const base = itemName.replace(/^Business cards:\s*/, "").replace(/[^\w.-]+/g, "_") || "card";
      await onDone({
        pdf: new File([pdf as BlobPart], `${base}-business-card-print.pdf`, { type: "application/pdf" }),
        proof: new File([png], `${base}-business-card.png`, { type: "image/png" }),
        fill: { template: t.id, name: t.name, values },
        itemName,
      });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }

  return (
    <div className="dla-bg dock wide" role="dialog" aria-label="Business card">
      <style>{fontCss}</style>
      <div className="dla bct">
        <div className="bct-head">
          <div><h2>Business card</h2><div className="faint">Pick the template, type the lines, and the card is the item&apos;s proof and print file.</div></div>
          <button type="button" className="btn ghost bct-x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        {err && <p className="err">{err}</p>}
        {!list ? <p className="faint">Loading the templates…</p> : !list.length ? <p className="faint">No card templates yet. Send Claude the customer&apos;s card (the PDF) and it&apos;s made into one.</p> : <>
          <label className="bct-pick"><span>Template</span>
            <select value={pick} onChange={(e) => choose(e.target.value)}>
              {mine.length > 0 && <optgroup label="This customer's">{mine.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label={mine.length ? "Other templates" : "Templates"}>{others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
            </select>
          </label>
          {t && <>
            <div className="bct-cards">
              {t.data.sides.map((s) => (
                <figure key={s.name} className="bct-card">
                  <div className="bct-svg" dangerouslySetInnerHTML={{ __html: sideSvg(s, t.data, values, s.png) }} />
                  <figcaption className="faint">{s.name}{s.fields.length ? "" : " · stays the same"}</figcaption>
                </figure>
              ))}
            </div>
            {t.data.note && <p className="faint bct-note">{t.data.note}</p>}
            <div className="bct-fields">
              {fields.map((f) => (
                <label key={f.key}><span>{f.label}</span>
                  <input value={values[f.key] ?? f.text} placeholder="Leave empty to leave it off" onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                </label>
              ))}
            </div>
            <div className="bct-foot">
              <button type="button" className="btn ghost" onClick={() => setValues(startValues(t.data))}>Start over</button>
              <span className="spacer" />
              <button type="button" className="btn" disabled={!!busy} onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={!!busy} onClick={() => void make()}>{busy || "Use this card"}</button>
            </div>
          </>}
        </>}
      </div>
    </div>
  );
}

/** switching templates keeps what was typed for lines both have (a name stays a name) */
function keepSame(values: Record<string, string>, t: PrintTemplate): Record<string, string> {
  const keys = new Set(t.data.sides.flatMap((s) => s.fields.map((f) => f.key)));
  return Object.fromEntries(Object.entries(values).filter(([k]) => keys.has(k) && ["name", "title", "email", "phone"].includes(k)));
}
