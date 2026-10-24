"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { useCan, useRole } from "@/components/RoleContext";
import { previewUrls } from "@/lib/designs";
import { designLabel, type Design, type Group, type Imprint } from "@/lib/pricing";
import { drawDst, readDst } from "@/lib/dst";
import { takeDigitized, type DigitizedSet } from "@/lib/digitizedFiles";
import { lineName, threadByName } from "@/lib/embroidery";

/**
 * Digitizing (Oct 23, Nick: "instead of separations, under embroidery… it'll say digitizing… once you create an order
 * from a new artwork, you will email the digitizing company and request the file at the size and give them the details,
 * what kind of garment it goes on… they'll give you back an embroidery file and a DST… eventually I'd like to see if you
 * can do a basic digitizing"). Every embroidered logo on an open order:
 *   - Needs digitizing → the request written out for the digitizer (size, garment and fabric, placement, threads,
 *     effects, the files we want back), copied or opened in your mail: nothing is sent by itself
 *   - Requested → waiting on the file; Digitized → its DST is on file (stitches, colors, size read from it), for this
 *     order and every reorder of the logo
 * A DST dropped here is read (lib/dst.ts) and kept on the logo (designs.specs.embroidery.files).
 */
type O = { id: string; number: number; nickname: string | null; status: string; due_date: string | null; groups: Group[] | null; customers?: { company?: string; name?: string } | null };
type EmbFile = DigitizedSet;
type EmbSpecs = { files?: EmbFile[]; request?: { at: string; by: string; size: string } };
type Item = { key: string; o: O; g: Group; im: Imprint; d: Design | null };
type Filter = "need" | "asked" | "done" | "all";
const embOf = (d: Design | null): EmbSpecs => ((d?.specs as { embroidery?: EmbSpecs } | null)?.embroidery) || {};

export default function Digitizing() {
  const canEdit = useCan("digitizing");
  const { email } = useRole();
  const [orders, setOrders] = useState<O[] | null>(null);
  const [designs, setDesigns] = useState<Record<string, Design>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useSticky<Filter>("digitizing.filter", "need");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState("");
  // our digitizer (Oct 23, Nick): Volikes Creative, volikescreative.com
  const [vendor, setVendor] = useSticky<string>("digitizing.vendor", "contact@volikescreative.com");

  async function load() {
    const sb = createClient();
    const { data, error } = await sb.from("orders").select("id, number, nickname, status, due_date, groups, customers(company, name)").not("status", "in", "(completed,request)").order("number", { ascending: false }).limit(400);
    if (error) { setErr(error.message); return; }
    const os = ((data || []) as unknown as O[]).filter((o) => (o.groups || []).some((g) => (g.imprints || []).some((im) => im.method === "embroidery")));
    const ids = [...new Set(os.flatMap((o) => (o.groups || []).flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery" && im.design_id).map((im) => im.design_id!))))];
    const { data: ds } = ids.length ? await sb.from("designs").select("*").in("id", ids) : { data: [] };
    const map = Object.fromEntries(((ds || []) as Design[]).map((d) => [d.id, d]));
    setDesigns(map); setOrders(os);
    void previewUrls(sb, Object.values(map)).then(setUrls).catch(() => null);
  }
  useEffect(() => { void load(); }, []);

  const items: Item[] = useMemo(() => (orders || []).flatMap((o) => (o.groups || []).flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery").map((im) => ({ key: `${o.id}:${im.id}`, o, g, im, d: im.design_id ? designs[im.design_id] || null : null })))), [orders, designs]);
  const stateOf = (it: Item): "need" | "asked" | "done" => { const e = embOf(it.d); return e.files?.length || it.im.emb?.file ? "done" : e.request ? "asked" : "need"; };
  const shown = items.filter((it) => filter === "all" || stateOf(it) === filter);
  const count = (f: Filter) => items.filter((it) => f === "all" || stateOf(it) === f).length;

  /** what the digitizer needs, written out */
  /** what the digitizer needs, written out: Volikes Creative asks for the final size, placement, fabric and colors,
   *  the machine format, what it's for, the due date and the quantity (volikescreative.com) */
  const requestText = (it: Item) => {
    const l = (it.g.lines || [])[0], im = it.im, emb = im.emb || {};
    const threadsTxt = (im.inks || "").split(/\s*,\s*/).filter(Boolean).map((n) => { const t = threadByName(n); return t ? `${t.code} ${t.name}${t.pms.length ? ` (PMS ${t.pms[0].replace(/^PMS\s*/i, "")})` : ""}` : n; });
    const colors = [...new Set((it.g.lines || []).map((x) => x.color).filter(Boolean))];
    const pcs = (it.g.lines || []).reduce((a, x) => a + Object.values(x.sizes || {}).reduce((b, v) => b + (+(v || 0)), 0), 0);
    const due = it.o.due_date ? new Date(it.o.due_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
    return [
      `Digitizing request: ${it.d ? designLabel(it.d) : "logo"} for ${it.o.customers?.company || it.o.customers?.name || "customer"} (FBS order #${it.o.number}${it.o.nickname ? `, ${it.o.nickname}` : ""})`,
      "",
      `Final size: ${im.size || "see art"}${im.stitches && im.emb?.stitchesFrom !== "file" ? ` (we estimate about ${im.stitches.toLocaleString()} stitches)` : ""}`,
      `Placement: ${im.location}${im.drop ? `, ${im.drop}" below the collar` : ""}`,
      `Garment and fabric: ${[l?.brand, l?.style, l?.garment].filter(Boolean).join(" ") || "see order"}${colors.length ? `, ${colors.join(" / ")}` : ""}`,
      `Backing: ${emb.backing || "cutaway"}${emb.topping && emb.topping !== "None" ? `, with ${emb.topping}` : ""}`,
      `Thread colors: ${lineName(emb.line || "Polyneon 40")}${threadsTxt.length ? `: ${threadsTxt.join(", ")}` : ""}`,
      emb.puff ? "Effects: 3D puff (please digitize for 3 mm foam)" : emb.metallic ? "Effects: metallic thread" : "",
      "Machine format: Tajima DST to sew, plus the Wilcom EMB (we edit in Hatch) and the production worksheet PDF (stitch count, size, color stops).",
      `Quantity: ${pcs ? `${pcs} pieces` : "see order"}${due ? ` · needed by ${due}` : ""}`,
      "",
      "Art is attached.",
    ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  };

  async function markAsked(it: Item) {
    if (!it.d) return;
    setBusy(it.key);
    const sb = createClient();
    const sp = (it.d.specs || {}) as Record<string, unknown>;
    const { error } = await sb.from("designs").update({ specs: { ...sp, embroidery: { ...embOf(it.d), request: { at: new Date().toISOString(), by: email || "", size: it.im.size || "" } } } }).eq("id", it.d.id);
    setBusy("");
    if (error) setErr(error.message); else void load();
  }
  // what the digitizer sends back: the zip, or the DST (to sew), EMB (to edit in Hatch) and PDF worksheet
  async function takeFiles(it: Item, list: File[]) {
    if (!it.d) return;
    setBusy(it.key); setErr("");
    try {
      const sb = createClient();
      const { set, info } = await takeDigitized(sb, it.d.id, list);
      if (!set.path) throw new Error("Couldn't save the DST.");
      // the order's print takes the file's stitch count (its price follows)
      const groups = (it.o.groups || []).map((g) => ({ ...g, imprints: (g.imprints || []).map((im) => (im.id === it.im.id ? { ...im, stitches: info.stitches, emb: { ...(im.emb || {}), stitchesFrom: "file" as const, file: set } } : im)) }));
      await sb.from("orders").update({ groups }).eq("id", it.o.id);
      void load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read those files."); }
    setBusy("");
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Digitizing</h1><div className="eyebrow">Embroidered logos on open orders: ask the digitizer, then bring the DST in</div></div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      <section className="panel">
        <div className="panel-b stack" style={{ gap: 10 }}>
          <div className="toolbar">
            <div className="chips" role="tablist">
              {([["need", "Needs digitizing"], ["asked", "Requested"], ["done", "Digitized"], ["all", "All"]] as [Filter, string][]).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} className={"chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l} <span className="pill-n">{orders ? count(k) : "…"}</span></button>
              ))}
            </div>
            <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Digitizer's email" aria-label="The digitizing company's email" style={{ maxWidth: 260 }} />
          </div>
          {!orders ? <div className="faint">Loading…</div> : !shown.length ? <div className="faint">{filter === "need" ? "Nothing waiting to be digitized. An embroidered print on an order shows up here until its DST is in." : "Nothing here."}</div> : (
            <div className="tbl-wrap"><table className="tbl dgz">
              <thead><tr><th>Logo</th><th>Order</th><th>Print</th><th>Stitches</th><th>State</th><th /></tr></thead>
              <tbody>{shown.map((it) => {
                const st = stateOf(it), e = embOf(it.d), f = it.im.emb?.file || e.files?.[0];
                return (
                  <FragmentRow key={it.key} it={it} pic={it.d ? urls[it.d.id] : ""} st={st} f={f} req={e.request} open={open === it.key} toggle={() => setOpen(open === it.key ? null : it.key)}
                    canEdit={canEdit} busy={busy === it.key} text={requestText(it)} vendor={vendor} onAsked={() => void markAsked(it)} onDst={(files) => void takeFiles(it, files)} />
                );
              })}</tbody>
            </table></div>
          )}
          <p className="faint" style={{ fontSize: 12.5 }}>Requests aren&apos;t sent by themselves: copy the request or open it in your mail, attach the art, and send it. Mark it requested so it moves to Requested.</p>
        </div>
      </section>
    </>
  );
}

function FragmentRow({ it, pic, st, f, req, open, toggle, canEdit, busy, text, vendor, onAsked, onDst }: { it: Item; pic: string; st: "need" | "asked" | "done"; f?: EmbFile; req?: EmbSpecs["request"]; open: boolean; toggle: () => void; canEdit: boolean; busy: boolean; text: string; vendor: string; onAsked: () => void; onDst: (f: File[]) => void }) {
  const pv = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open || !f || !pv.current) return;
    let live = true;
    void (async () => {
      const sb = createClient();
      const { data } = await sb.storage.from("proofs").download(f.path);
      if (!data || !live || !pv.current) return;
      try {
        const info = readDst(await data.arrayBuffer());
        const colors = (it.im.inks || "").split(/\s*,\s*/).map((n) => threadByName(n)?.hex || "").filter(Boolean);
        const c = drawDst(info, colors, 320); c.className = "emb-dst-c";
        pv.current.innerHTML = ""; pv.current.appendChild(c);
      } catch { /* not readable */ }
    })();
    return () => { live = false; };
  }, [open, f, it.im.inks]);
  const subject = text.split("\n")[0];
  return (
    <>
      <tr className={open ? "on" : ""} onClick={toggle} style={{ cursor: "pointer" }}>
        <td><span className="dgz-logo">{pic ? <img src={pic} alt="" /> : null}<b>{it.d ? designLabel(it.d) : "No logo yet"}</b></span></td>
        <td><Link className="ordno" href={`/shop/orders/${it.o.id}`} onClick={(e) => e.stopPropagation()}>#{it.o.number}</Link><div className="sub">{it.o.customers?.company || it.o.customers?.name || ""}{it.o.nickname ? ` · ${it.o.nickname}` : ""}</div></td>
        <td>{it.im.location}<div className="sub">{it.im.size || "size not set"}</div></td>
        <td className="num">{(f?.stitches || it.im.stitches || 0) ? (f?.stitches || it.im.stitches)!.toLocaleString() : "—"}<div className="sub">{f ? "from the DST" : it.im.stitches ? "estimate" : ""}</div></td>
        <td><span className="pill" style={{ ["--sc" as string]: st === "done" ? "var(--ok)" : st === "asked" ? "var(--warn)" : "var(--danger)" }}><span className="pill-t">{st === "done" ? "Digitized" : st === "asked" ? "Requested" : "Needs digitizing"}</span></span>{req && st === "asked" ? <div className="sub">{new Date(req.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div> : null}</td>
        <td className="faint">{open ? "▾" : "▸"}</td>
      </tr>
      {open && (
        <tr className="dgz-more"><td colSpan={6}>
          <div className="dgz-box">
            <div className="dgz-req">
              <div className="imp-l">Request for the digitizer</div>
              <pre className="dgz-text">{text}</pre>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn sm" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy the request"}</button>
                <a className="btn sm" href={`mailto:${encodeURIComponent(vendor)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>Open it in my mail</a>
                {canEdit && st === "need" && it.d && <button type="button" className="btn sm primary" disabled={busy} onClick={onAsked}>Mark requested</button>}
                {canEdit && it.d && <label className="btn sm" style={{ cursor: "pointer" }} title="The zip they send back, or the DST with the EMB and the PDF">{busy ? "Reading…" : f ? "Replace the files" : "Add the digitizer's files"}<input type="file" hidden multiple accept=".zip,.dst,.DST,.emb,.EMB,.pdf" onChange={(e) => { const x = [...(e.target.files || [])]; e.target.value = ""; if (x.length) onDst(x); }} /></label>}
              </div>
            </div>
            {f && (
              <div className="dgz-file">
                <div className="imp-l">The digitized files</div>
                <div><b>{f.name}</b></div>
                <div className="faint">{f.stitches.toLocaleString()} stitches · {f.colors} color{f.colors === 1 ? "" : "s"} · {f.wIn}&quot; × {f.hIn}&quot;</div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  {f.path && <a className="ap-link" href={`/api/files/open?${new URLSearchParams({ p: f.path, n: f.name })}`} target="_blank" rel="noreferrer">DST (sew)</a>}
                  {f.emb && <a className="ap-link" href={`/api/files/open?${new URLSearchParams({ p: f.emb.path, n: f.emb.name })}`} target="_blank" rel="noreferrer">EMB (edit in Hatch)</a>}
                  {f.sheet && <a className="ap-link" href={`/api/files/open?${new URLSearchParams({ p: f.sheet.path, n: f.sheet.name })}`} target="_blank" rel="noreferrer">Worksheet PDF (how to sew it, color stops)</a>}
                </div>
                <div ref={pv} className="emb-dst" aria-label="The stitches in the file" />
              </div>
            )}
          </div>
        </td></tr>
      )}
    </>
  );
}
