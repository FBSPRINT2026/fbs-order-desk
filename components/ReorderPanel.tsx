"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { METHODS, type Group, type Imprint, type Order } from "@/lib/pricing";
import { needsDetails, type DetailsInput } from "@/lib/productionDetails";
import { applySpec, latestSpecs, reorderLabel, type DesignSpecs, type SpecEntry } from "@/lib/designSpecs";
import { confirmDetails } from "@/app/shop/details-actions";
import { confirmReorderPricing } from "@/app/shop/reorder-actions";

/**
 * The order's Reorder section (Oct 14, Nick: "pop open a reorder section… confirm pricing, the specs greyed out or a way
 * to fill in what we think, then production confirms and that's the Bible"). Nothing here stops the order: specs we
 * don't know stay greyed as "awaiting production confirmation".
 *  1. The mockup: the old one is kept; a reorder never gets a new mockup.
 *  2. Pricing: staff check it once (an entry in the order's history).
 *  3. Print specs, each print saying where its specs came from: our guess (greyed), filled in by staff (still a
 *     guess), or confirmed by production. Production confirms here or on Production Details; that saves the specs on
 *     the customer's design (lib/designSpecs.ts), and the next reorder of the job takes them automatically.
 *     Specs production confirmed before for this customer can be used in one click.
 */
type Cand = { design: string; name: string; e: SpecEntry };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const blankForm = (im: Imprint): DetailsInput => ({ id: im.id, size: "", inks: "", colors: im.colors || 1, underbase: "", drop: "", screensOnFile: !!im.remake, notes: "" });
const filledForm = (im: Imprint): DetailsInput => ({ id: im.id, size: im.size || "", inks: im.inks || "", colors: im.colors || 1, underbase: im.underbase === true ? "yes" : im.underbase === false ? "no" : "", drop: im.drop || "", screensOnFile: !!im.remake, notes: "" });
const specLine = (x: { size?: string; drop?: string; inks?: string; colors?: number; underbase?: boolean }) =>
  [x.size, x.drop ? `${x.drop}" drop` : "", x.inks, x.colors ? `${x.colors} color${x.colors === 1 ? "" : "s"}` : "", x.underbase === true ? "underbase" : x.underbase === false ? "no underbase" : ""].filter(Boolean).join(" · ");

export function isReorder(o: Pick<Order, "notes" | "groups">) {
  return !!reorderLabel(o.notes) || (o.groups || []).some((g) => (g.imprints || []).some((im) => needsDetails(im) || !!im.confirmed?.from));
}

export default function ReorderPanel({ o, total, patch, save, onReload }: {
  o: Order; total: number;
  patch: (fn: (d: Order) => void) => void;
  save: () => Promise<void>;
  /** production confirmed on the server: the order's prints as saved */ onReload: (groups: Group[]) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  const { role, staffName, email } = useRole();
  const me = staffName || (email || "").split("@")[0] || "staff";
  const canConfirm = !role || ["owner", "admin", "production"].includes(role);
  const job = reorderLabel(o.notes);
  const prints = o.groups.flatMap((g, gi) => g.imprints.map((im) => ({ g, gi, im })));
  const waiting = prints.filter((p) => needsDetails(p.im));
  const [priced, setPriced] = useState<{ by: string; at: string } | null>(null);
  const [cands, setCands] = useState<Cand[]>([]);
  const [thumbs, setThumbs] = useState<{ url: string; name: string }[]>([]);
  const [edit, setEdit] = useState<Record<string, DetailsInput>>({});
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: ev } = await sb.from("order_events").select("actor, created_at").eq("order_id", o.id).eq("kind", "reorder_pricing").order("created_at", { ascending: false }).limit(1);
      if (live && ev?.[0]) setPriced({ by: ev[0].actor, at: ev[0].created_at });
      // specs production confirmed before for this customer, to use in one click
      if (o.customer_id) {
        const { data: ds } = await sb.from("designs").select("id, name, specs").eq("customer_id", o.customer_id).not("specs->history", "is", null).limit(300);
        const c: Cand[] = [];
        for (const d of (ds || []) as { id: string; name: string; specs: DesignSpecs }[]) for (const e of latestSpecs(d.specs)) c.push({ design: d.id, name: d.name, e });
        if (live) setCands(c.sort((a, b) => b.e.at.localeCompare(a.e.at)));
      }
      // the mockup we keep: the customer's own, or the old job's
      const paths = o.groups.flatMap((g) => [...(g.customerMockups || []), ...(g.pvRef || [])]).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.path)).slice(0, 4);
      if (paths.length) {
        const { data: su } = await sb.storage.from("proofs").createSignedUrls(paths.map((p) => p.path), 3600);
        if (live) setThumbs(paths.map((p, i) => ({ url: su?.[i]?.signedUrl || "", name: p.name })).filter((t) => t.url));
      }
    })().catch(() => null);
    return () => { live = false; };
  }, [o.id, o.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (id: string, p: Partial<DetailsInput>) => setEdit((f) => ({ ...f, [id]: { ...f[id], ...p } }));
  // blank, with our guesses shown greyed in each box: nothing is confirmed just by clicking through (Oct 14, Nick:
  // "I'm wary of guesses becoming set in stone"); "Copy in our guesses" fills them in on purpose
  const open = (im: Imprint) => setEdit((f) => ({ ...f, [im.id]: blankForm(im) }));
  const close = (id: string) => setEdit((f) => { const n = { ...f }; delete n[id]; return n; });

  /** what we think: on the order, still a guess (greyed, awaiting production) */
  function saveGuess(im: Imprint) {
    const f = edit[im.id]; if (!f) return;
    patch((d) => {
      for (const g of d.groups) for (const x of g.imprints) if (x.id === im.id) {
        if (f.size.trim()) x.size = f.size.trim();
        if (f.inks.trim()) x.inks = f.inks.trim();
        if (f.colors >= 1 && f.colors <= 20) x.colors = Math.round(f.colors);
        if (f.drop.trim()) x.drop = f.drop.trim();
        if (f.underbase === "yes") x.underbase = true; else if (f.underbase === "no") x.underbase = false;
        x.confirm = { ...(x.confirm || { size: true, ink: true, why: "" }), filled: { by: me, at: new Date().toISOString() } };
      }
    });
    close(im.id);
    setMsg({ t: "Saved as our guess. Still greyed out until production confirms." });
  }
  /** production confirms: on the order and the customer's design, for every reorder after this */
  async function confirm(im: Imprint) {
    const f = edit[im.id] || filledForm(im);
    setBusy(im.id); setMsg(null);
    await save();
    const r = await confirmDetails(o.id, [f]);
    if (!r.ok) { setBusy(""); setMsg({ t: r.error, bad: true }); return; }
    const { data } = await sb.from("orders").select("groups").eq("id", o.id).maybeSingle();
    if (data?.groups) onReload(data.groups as Group[]);
    setBusy(""); close(im.id);
    setMsg({ t: "Confirmed. These specs are saved on the customer's design, and the next reorder uses them." });
  }
  function useSpec(im: Imprint, c: Cand) {
    patch((d) => { for (const g of d.groups) for (const x of g.imprints) if (x.id === im.id) applySpec(x, c.e, c.design); });
    setMsg({ t: `Using what production confirmed on ${day(c.e.at)} (#${c.e.order_number}).` });
  }
  async function pricingOk() {
    setBusy("price");
    const r = await confirmReorderPricing(o.id, `$${total.toFixed(2)}${o.use_program ? " (program pricing)" : ""}`);
    setBusy("");
    if (r.ok) setPriced({ by: r.by, at: r.at }); else setMsg({ t: r.error, bad: true });
  }

  const allDone = !waiting.length;
  return (
    <section className="panel ro" aria-label="Reorder">
      <div className="ro-h">
        <span className="ro-tag">Reorder</span>
        <b>{job ? <>Repeats {job}</> : "Repeats an earlier job"}</b>
        <span className={"ro-state" + (allDone ? " ok" : "")}>{allDone ? "Specs confirmed by production" : `Awaiting production confirmation · ${waiting.length} print${waiting.length === 1 ? "" : "s"}`}</span>
      </div>

      <div className="ro-steps">
        <div className="ro-step">
          <span className="ro-n">1</span>
          <div className="ro-b">
            <div className="ro-t">Mockup</div>
            <div className="ro-mock">
              {thumbs.map((t, i) => <a key={i} href={t.url} target="_blank" rel="noreferrer" title={t.name}><img src={t.url} alt={t.name} /></a>)}
              <span className="faint">{thumbs.length ? "Same mockup as last time. A reorder doesn't get a new mockup." : "No new mockup for a reorder. The old job's files are in Production files."}</span>
            </div>
          </div>
        </div>

        <div className="ro-step">
          <span className="ro-n">2</span>
          <div className="ro-b">
            <div className="ro-t">Pricing</div>
            <div className="ro-row">
              <span><b>${total.toFixed(2)}</b>{o.use_program ? <span className="faint"> · program pricing</span> : null}</span>
              {priced ? <span className="ro-ok">✓ Checked by {priced.by} · {day(priced.at)}</span>
                : <button type="button" className="btn sm" disabled={busy === "price"} onClick={pricingOk}>{busy === "price" ? "Saving…" : "Pricing is right"}</button>}
            </div>
          </div>
        </div>

        <div className="ro-step">
          <span className="ro-n">3</span>
          <div className="ro-b">
            <div className="ro-t">Print specs <span className="faint">· production confirms these once, then every reorder uses them</span></div>
            {prints.map(({ g, im }) => {
              const guess = needsDetails(im), f = edit[im.id];
              const garment = [...new Set(g.lines.map((l) => [l.style, l.color].filter(Boolean).join(" ")))].filter(Boolean).join(", ");
              const mine = guess ? cands.filter((c) => c.e.location.toLowerCase().replace(/[^a-z]/g, "") === im.location.toLowerCase().replace(/[^a-z]/g, "")).slice(0, 3) : [];
              return (
                <div key={im.id} className={"ro-print" + (guess ? " guess" : " done")}>
                  <div className="ro-ph">
                    <b>{im.location || "Print"}</b>
                    <span className="faint">{METHODS[im.method] || im.method}{garment ? ` on ${garment}` : ""}</span>
                    <span className="spacer" />
                    {guess ? <span className="ro-chip wait">{im.confirm?.filled ? "Filled in · awaiting production" : "Awaiting production confirmation"}</span>
                      : im.confirmed ? <span className="ro-chip ok">✓ Confirmed by {im.confirmed.by} · {day(im.confirmed.at)}{im.confirmed.from ? ` (${im.confirmed.from})` : ""}</span>
                        : <span className="ro-chip">From the order</span>}
                  </div>
                  <div className={"ro-spec" + (guess ? " grey" : "")}>{specLine(im) || "No specs yet"}</div>
                  {guess && im.confirm?.why && !im.confirm.filled && <div className="ro-why faint">Our guess: {im.confirm.why}.</div>}
                  {mine.map((c, i) => (
                    <div key={i} className="ro-cand">
                      <span>Production confirmed <b>{c.name}</b> on {day(c.e.at)} (#{c.e.order_number}): {specLine(c.e)}</span>
                      <button type="button" className="btn sm" onClick={() => useSpec(im, c)}>Use these specs</button>
                    </div>
                  ))}
                  {guess && !f && <div className="ro-acts">
                    <button type="button" className="btn sm ghost" onClick={() => open(im)}>{im.confirm?.filled ? "Change what we think" : "Fill in what we think"}</button>
                    {canConfirm && <button type="button" className="btn sm" onClick={() => open(im)}>Confirm as production</button>}
                  </div>}
                  {f && <div className="ro-form">
                    <label className="field"><span>Print size</span><input value={f.size} placeholder={im.size ? `Guess: ${im.size}` : 'e.g. 11" wide'} onChange={(e) => set(im.id, { size: e.target.value })} /></label>
                    <label className="field"><span>Drop (in.)</span><input value={f.drop} placeholder={im.drop ? `Guess: ${im.drop}` : "Standard"} onChange={(e) => set(im.id, { drop: e.target.value })} /></label>
                    <label className="field ro-wide"><span>Inks (by name)</span><input value={f.inks} placeholder={im.inks ? `Guess: ${im.inks}` : "e.g. White, PMS 186 C"} onChange={(e) => set(im.id, { inks: e.target.value })} /></label>
                    <label className="field"><span>Colors</span><input type="number" min={1} max={20} value={f.colors} onChange={(e) => set(im.id, { colors: +e.target.value || 1 })} /></label>
                    <label className="field"><span>Underbase</span><select value={f.underbase} onChange={(e) => set(im.id, { underbase: e.target.value as DetailsInput["underbase"] })}><option value="">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                    <div className="ro-form-a">
                      {(im.size || im.inks || im.drop) && !(f.size || f.inks || f.drop) && <button type="button" className="linkbtn" onClick={() => set(im.id, { ...filledForm(im), notes: f.notes })}>Copy in our guesses</button>}
                      <span className="spacer" />
                      <button type="button" className="btn sm ghost" onClick={() => close(im.id)}>Cancel</button>
                      <button type="button" className="btn sm" onClick={() => saveGuess(im)}>Save as our guess</button>
                      {canConfirm && <button type="button" className="btn sm primary" disabled={busy === im.id} onClick={() => confirm(im)}>{busy === im.id ? "Confirming…" : "Confirm as production"}</button>}
                    </div>
                  </div>}
                </div>
              );
            })}
            {!canConfirm && waiting.length > 0 && <div className="faint ro-note">Production confirms these on <Link href={`/shop/details?order=${o.id}`}>Production Details</Link>.</div>}
          </div>
        </div>
      </div>
      {msg && <div className={msg.bad ? "err" : "ro-msg"} role="status">{msg.t}</div>}
    </section>
  );
}
