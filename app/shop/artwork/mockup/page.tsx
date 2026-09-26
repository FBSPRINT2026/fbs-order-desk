"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LOCATIONS, designLabel, newImprint, orderGroups, uid, type Customer, type Design, type Garment, type Imprint, type Order } from "@/lib/pricing";
import { custLabel } from "@/lib/format";
import { previewUrls, uploadDesign } from "@/lib/designs";
import { PMS_HEX, WILFLEX_HEX, colorHex, detectColors, recolor } from "@/lib/inkColors";
import { PHOTO_H, PHOTO_W, PX_PER_IN, basePlacement, guessHex, printWidth, spotFor, ssImg, teeSvg, type View } from "@/lib/mockup";

type Line = { id: string; style: string; brand: string; color: string; garment: string };
type Offset = { dx: number; dy: number };
/** Per imprint: colors found in the logo and the ink each one prints as. */
type Paint = { design: string; sources: { hex: string; share: number }[]; map: Record<string, { name: string; hex: string }> };

export default function MockupPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><Builder /></Suspense>;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("Couldn't load " + src.slice(0, 60)));
    im.src = src;
  });
}

/** Mockup builder: garment photos from S&S for each color, the customer's designs placed by location and print size. */
function Builder() {
  const sp = useSearchParams();
  const orderId = sp.get("order") || "";
  const groupId = sp.get("group") || "";
  const sb = useMemo(() => createClient(), []);

  const [order, setOrder] = useState<Order | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(sp.get("customer") || "");
  const [catalog, setCatalog] = useState<Garment[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([{ id: uid(), style: "", brand: "", color: "", garment: "" }]);
  const [imprints, setImprints] = useState<Imprint[]>([newImprint("Full Front")]);
  const [groupName, setGroupName] = useState("");
  const [active, setActive] = useState(0);
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const scale = 1;
  const [paints, setPaints] = useState<Record<string, Paint>>({});
  const [pop, setPop] = useState<{ id: string; src: string; x: number; y: number } | null>(null);
  const [painted, setPainted] = useState<Record<string, string>>({});
  const imgCache = useRef(new Map<string, HTMLImageElement>());
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ title: string; url: string }[]>([]);
  const refreshed = useRef(new Set<number>());

  // load the order group (or start blank), catalog and customers
  useEffect(() => {
    (async () => {
      const [cat, cu] = await Promise.all([sb.from("garments").select("*"), sb.from("customers").select("*")]);
      setCatalog((cat.data || []) as Garment[]);
      setCustomers(((cu.data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
      if (orderId) {
        const { data } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
        if (!data) return setMsg("Order not found.");
        const o = data as Order;
        setOrder(o);
        setCustomerId(o.customer_id || "");
        const groups = orderGroups(o);
        const g = groups.find((x) => x.id === groupId) || groups[0];
        if (g) {
          setGroupName(g.name || `Group ${groups.indexOf(g) + 1}`);
          setLines(g.lines.filter((l) => l.style || l.color).map((l) => ({ id: l.id, style: l.style, brand: l.brand, color: l.color, garment: l.garment })));
          setImprints(g.imprints.map((d) => ({ ...d })));
        }
      }
    })();
  }, [sb, orderId, groupId]);

  // the customer's designs
  useEffect(() => {
    (async () => {
      if (!customerId) { setDesigns([]); setUrls({}); return; }
      const { data } = await sb.from("designs").select("*").eq("customer_id", customerId).order("number", { ascending: false });
      const list = (data || []) as Design[];
      setDesigns(list);
      setUrls(await previewUrls(sb, list));
    })();
  }, [sb, customerId]);

  // find the colors in each imprint's logo when its design changes
  useEffect(() => {
    imprints.forEach(async (im) => {
      const d = designs.find((x) => x.id === im.design_id);
      if (!d || !urls[d.id]) return;
      if (paints[im.id]?.design === d.id) return;
      try {
        const img = imgCache.current.get(d.id) || (await loadImg(urls[d.id]));
        imgCache.current.set(d.id, img);
        const sources = detectColors(img);
        setPaints((p) => ({ ...p, [im.id]: { design: d.id, sources, map: {} } }));
      } catch { /* preview not loadable */ }
    });
  }, [imprints, designs, urls]);

  // repaint logos whenever an ink choice changes
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const im of imprints) {
      const pt = paints[im.id];
      if (!pt || !Object.keys(pt.map).length) continue;
      const img = imgCache.current.get(pt.design);
      if (!img) continue;
      const targets: Record<string, string> = {};
      Object.entries(pt.map).forEach(([src, v]) => { targets[src] = v.name === "none" ? "none" : v.hex; });
      next[im.id] = recolor(img, pt.sources.map((x) => x.hex), targets);
    }
    setPainted(next);
  }, [paints, imprints]);

  function setInk(im: Imprint, src: string, v: { name: string; hex: string } | null) {
    setPaints((p) => {
      const pt = p[im.id];
      if (!pt) return p;
      const map = { ...pt.map };
      if (v) map[src] = v; else delete map[src];
      const np = { ...p, [im.id]: { ...pt, map } };
      // keep the imprint's ink list and color count in step with the choices
      const inks = pt.sources.map((x) => map[x.hex]).filter((x) => x && x.name !== "none").map((x) => x!.name);
      setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, inks: inks.length ? inks.join(", ") : x.inks, colors: inks.length && x.method !== "dtf" && x.colors < 11 ? inks.length : x.colors } : x)));
      return np;
    });
  }
  const artUrl = (im: Imprint) => { const d = designs.find((x) => x.id === im.design_id); return painted[im.id] || (d ? urls[d.id] : ""); };

  const garmentFor = (l: Line) => catalog.find((g) => g.style.toLowerCase() === l.style.trim().toLowerCase() && (!l.brand || g.brand.toLowerCase() === l.brand.toLowerCase()))
    || catalog.find((g) => g.style.toLowerCase() === l.style.trim().toLowerCase());

  // styles pulled from S&S before photos were saved: refresh them once to get the color photos
  useEffect(() => {
    lines.forEach((l) => {
      const g = garmentFor(l);
      if (!g?.ss_style_id || refreshed.current.has(g.ss_style_id)) return;
      if (g.color_images && Object.keys(g.color_images).length) return;
      refreshed.current.add(g.ss_style_id);
      fetch(`/api/ss/lookup?styleid=${g.ss_style_id}`).then((r) => r.json()).then((j) => {
        if (j.garment) setCatalog((c) => c.map((x) => (x.id === j.garment.id ? j.garment : x)));
      }).catch(() => {});
    });
  }, [lines, catalog]);

  const photo = (l: Line, view: View) => {
    const g = garmentFor(l);
    const ci = g?.color_images?.[l.color] || Object.entries(g?.color_images || {}).find(([k]) => k.toLowerCase() === l.color.toLowerCase())?.[1];
    const p = ci ? (view === "front" ? ci.front : ci.back) : "";
    return p ? ssImg(p) : teeSvg(guessHex(l.color), view);
  };

  const designOf = (im: Imprint) => designs.find((d) => d.id === im.design_id);
  const ratioOf = (d?: Design) => (d?.width_px && d?.height_px ? d.height_px / d.width_px : 0);
  const place = (im: Imprint) => {
    const d = designOf(im);
    const r = ratioOf(d) || 0.6;
    const wIn = printWidth(im.size, im.location, ratioOf(d));
    const drop = im.drop && !isNaN(+im.drop) ? +im.drop : null;
    const b = basePlacement(im.location, wIn, r, drop, scale);
    const o = offsets[im.id] || { dx: 0, dy: 0 };
    return { ...b, x: b.x + o.dx, y: b.y + o.dy, wIn, hIn: wIn * r, d };
  };
  const views: View[] = (["front", "back"] as View[]).filter((v) => imprints.some((im) => spotFor(im.location).view === v));
  const line = lines[active] || lines[0];

  async function uploadNew(im: Imprint, f: File) {
    if (!customerId) return setMsg("Pick the customer first. New art is saved to their account.");
    try {
      const { data: u } = await sb.auth.getUser();
      const d = await uploadDesign(sb, { file: f, customer_id: customerId, by: u.user?.email || "" });
      setDesigns((x) => [d, ...x]);
      setUrls({ ...urls, ...(await previewUrls(sb, [d])) });
      setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: d.id } : x)));
      setMsg(`Saved ${designLabel(d)} to the customer's account.`);
    } catch (e) { setMsg("Upload failed: " + (e instanceof Error ? e.message : String(e))); }
  }

  /** Draw one garment color with every imprint, plus a spec strip, as a PNG. */
  async function render(l: Line): Promise<Blob> {
    const k = 0.6, pw = PHOTO_W * k, ph = PHOTO_H * k, pad = 24;
    const specLines = imprints.map((im) => { const p = place(im); return `${im.location}: ${p.d ? designLabel(p.d) : "no design"} · ${p.wIn.toFixed(1)}" × ${(p.hIn || 0).toFixed(1)}"${im.inks ? " · " + im.inks : ""}`; });
    const W = pad * 2 + views.length * pw + (views.length - 1) * pad;
    const H = 70 + ph + 30 + specLines.length * 26 + pad;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d")!;
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#141D2B"; x.font = "700 24px Helvetica, Arial, sans-serif";
    x.fillText(`${order ? `#${order.number} ` : ""}${groupName || "Mockup"}`, pad, 36);
    x.font = "16px Helvetica, Arial, sans-serif"; x.fillStyle = "#4A566B";
    x.fillText([l.brand, l.style, l.garment].filter(Boolean).join(" ") + (l.color ? ` — ${l.color}` : ""), pad, 60);
    for (let i = 0; i < views.length; i++) {
      const v = views[i], ox = pad + i * (pw + pad), oy = 70;
      const bg = await loadImg(photo(l, v)).catch(() => loadImg(teeSvg(guessHex(l.color), v)));
      x.drawImage(bg, ox, oy, pw, ph);
      for (const im of imprints.filter((m) => spotFor(m.location).view === v)) {
        const p = place(im);
        if (!p.d || !artUrl(im)) continue;
        const art = await loadImg(artUrl(im)).catch(() => null);
        if (art) x.drawImage(art, ox + p.x * k, oy + p.y * k, p.w * k, p.h * k);
      }
      x.fillStyle = "#7A8599"; x.font = "600 13px Helvetica, Arial, sans-serif";
      x.fillText(v.toUpperCase(), ox, oy + ph + 18);
    }
    x.fillStyle = "#141D2B"; x.font = "15px Helvetica, Arial, sans-serif";
    specLines.forEach((s, i) => x.fillText(s, pad, 70 + ph + 44 + i * 26));
    return await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
  }

  /** Write the imprints (locations, designs, sizes, inks) back to the order group, so both screens match. */
  async function syncOrder(): Promise<boolean> {
    if (!order) return false;
    const { data } = await sb.from("orders").select("groups").eq("id", order.id).maybeSingle();
    const groups = (data?.groups || []) as Order["groups"];
    const g = groups.find((x) => x.id === groupId) || groups[0];
    if (!g) return false;
    g.imprints = imprints.map((im) => ({ ...(g.imprints.find((x) => x.id === im.id) || {}), ...im }));
    const { error } = await sb.from("orders").update({ groups }).eq("id", order.id);
    if (error) { setMsg("Couldn't update the order: " + error.message); return false; }
    return true;
  }

  async function saveAll() {
    if (!customerId) return setMsg("Pick a customer so the mockups save to their account.");
    if (!lines.some((l) => l.style || l.color)) return setMsg("Add a garment and color first.");
    const missing = imprints.filter((im) => !designOf(im));
    if (missing.length) return setMsg(`${missing.map((m) => m.location).join(", ")} ${missing.length > 1 ? "have" : "has"} no design yet. Pick one of the customer's designs or upload new art.`);
    setSaving(true);
    setMsg("");
    const { data: u } = await sb.auth.getUser();
    const out: { title: string; url: string }[] = [];
    try {
      for (const l of lines.filter((z) => z.style || z.color)) {
        const blob = await render(l);
        const title = `${groupName || "Mockup"} — ${[l.brand, l.style].filter(Boolean).join(" ")} ${l.color}`.trim();
        const path = orderId ? `${orderId}/mockup-${Date.now()}-${uid().slice(0, 6)}.png` : `mockups/${customerId}/${Date.now()}-${uid().slice(0, 6)}.png`;
        const up = await sb.storage.from("proofs").upload(path, blob, { contentType: "image/png" });
        if (up.error) throw new Error(up.error.message);
        let proofId: string | null = null;
        if (orderId) {
          const { data: pr } = await sb.from("proofs").insert({ order_id: orderId, title, file_path: path, file_type: "image/png" }).select("id").single();
          proofId = pr?.id || null;
        }
        await sb.from("mockups").insert({ customer_id: customerId, order_id: orderId || null, proof_id: proofId, title, file_path: path, design_ids: [...new Set(imprints.map((i) => i.design_id).filter(Boolean))], created_by: u.user?.email || "" });
        out.push({ title, url: URL.createObjectURL(blob) });
      }
      await syncOrder();
      setSaved(out);
      setMsg(orderId ? `Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to the order as proofs and to the customer's account.` : `Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to the customer's account.`);
    } catch (e) { setMsg("Couldn't save: " + (e instanceof Error ? e.message : String(e))); }
    setSaving(false);
  }

  const garmentOptions = catalog.slice().sort((a, b) => `${a.brand} ${a.style}`.localeCompare(`${b.brand} ${b.style}`));
  return (
    <>
      <Link className="back" href={orderId ? `/shop/orders/${orderId}` : "/shop/artwork"}>← {orderId ? `Order #${order?.number || ""}` : "Artwork"}</Link>
      <div className="page-head">
        <div><div className="eyebrow">{custLabel(customers.find((c) => c.id === customerId)) || "Mockup builder"}</div><h1>{orderId ? `Mockup · ${groupName}` : "Mockup builder"}</h1></div>
        <div className="row"><span className="save-state">{msg}</span>{orderId && <button className="btn" type="button" disabled={saving} onClick={async () => { if (await syncOrder()) setMsg("Order updated."); }}>Update order only</button>}<button className="btn primary" type="button" disabled={saving} onClick={saveAll}>{saving ? "Saving…" : orderId ? "Save mockups to order" : "Save mockup"}</button></div>
      </div>

      <div className="mk">
        <div className="mk-stage-wrap">
          {lines.length > 1 && (
            <div className="chips" style={{ marginBottom: 10 }}>
              {lines.map((l, i) => <button key={l.id} type="button" className={"chip" + (i === active ? " on" : "")} onClick={() => setActive(i)}>{[l.style, l.color].filter(Boolean).join(" · ") || `Garment ${i + 1}`}</button>)}
            </div>
          )}
          <div className="mk-views">
            {(views.length ? views : (["front"] as View[])).map((v) => (
              <Stage key={v} src={line ? photo(line, v) : teeSvg("#9aa1ab", v)} label={v}
                items={imprints.filter((im) => spotFor(im.location).view === v).map((im) => ({ id: im.id, p: place(im), url: artUrl(im) }))}
                onMove={(id, dx, dy) => setOffsets((o) => ({ ...o, [id]: { dx: (o[id]?.dx || 0) + dx, dy: (o[id]?.dy || 0) + dy } }))}
                onResize={(id, newW) => {
                  const im = imprints.find((x) => x.id === id); if (!im) return;
                  const old = place(im);
                  const inches = Math.round((newW / (PX_PER_IN * scale)) * 100) / 100;
                  // keep the left edge where it is while the size changes
                  setOffsets((o) => ({ ...o, [id]: { dx: (o[id]?.dx || 0) + (newW - old.w) / 2, dy: o[id]?.dy || 0 } }));
                  setImprints((xs) => xs.map((x) => (x.id === id ? { ...x, size: `${inches}" wide` } : x)));
                }}
                onPick={(id, rx, ry, cx, cy) => {
                  const im = imprints.find((x) => x.id === id); const pt = paints[id];
                  if (!im || !pt) return;
                  const img = imgCache.current.get(pt.design); if (!img) return;
                  const c = document.createElement("canvas"); c.width = 1; c.height = 1;
                  const cx2 = c.getContext("2d", { willReadFrequently: true })!;
                  cx2.drawImage(img, Math.floor(rx * img.naturalWidth), Math.floor(ry * img.naturalHeight), 1, 1, 0, 0, 1, 1);
                  const [r, g, b2, a] = cx2.getImageData(0, 0, 1, 1).data;
                  if (a < 100) return;
                  let best = pt.sources[0]?.hex, bd = Infinity;
                  for (const src of pt.sources) { const v = [1, 3, 5].map((o) => parseInt(src.hex.slice(o, o + 2), 16)); const dd = (v[0] - r) ** 2 + (v[1] - g) ** 2 + (v[2] - b2) ** 2; if (dd < bd) { bd = dd; best = src.hex; } }
                  if (best) setPop({ id, src: best, x: cx, y: cy });
                }} />
            ))}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 8 }}>
            <span className="faint" style={{ fontSize: 12 }}>Dashed boxes show each location&apos;s max print area · drag designs to fine-tune</span>
            {Object.keys(offsets).length > 0 && <button className="btn sm ghost" type="button" onClick={() => setOffsets({})}>Reset positions</button>}
          </div>
          {pop && (() => {
            const im = imprints.find((x) => x.id === pop.id);
            const cur = paints[pop.id]?.map[pop.src];
            if (!im) return null;
            return (
              <div className="mk-pop" style={{ left: Math.min(pop.x + 8, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300), top: pop.y + 8 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="sw" style={{ background: pop.src }} /><span>→</span><span className="sw" style={{ background: cur ? (cur.name === "none" ? "transparent" : cur.hex) : pop.src }} />
                  <InkSelect key={pop.src + pop.id} value={cur} onChange={(v) => setInk(im, pop.src, v)} />
                  <button className="btn icon ghost" type="button" aria-label="Close" onClick={() => setPop(null)}>✕</button>
                </div>
              </div>
            );
          })()}
          {saved.length > 0 && (
            <div className="mk-saved">{saved.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer"><img src={s.url} alt={s.title} /><span>{s.title}</span></a>)}</div>
          )}
        </div>

        <div className="mk-side stack">
          {!orderId && (
            <section className="panel">
              <div className="panel-h"><h2>Customer & garment</h2></div>
              <div className="panel-b stack">
                <select aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Choose a customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}</select>
                <input type="text" aria-label="Mockup name" placeholder="Mockup name (e.g. Spring promo tee)" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                {lines.map((l, i) => {
                  const g = garmentFor(l);
                  return (
                    <div key={l.id} className="row" style={{ gap: 6 }}>
                      <select aria-label="Garment" value={g?.id || ""} onChange={(e) => { const gg = catalog.find((x) => x.id === e.target.value); setLines((ls) => ls.map((x, j) => (j === i ? { ...x, style: gg?.style || "", brand: gg?.brand || "", garment: gg?.description || "", color: gg?.colors?.[0] || "" } : x))); }}>
                        <option value="">Garment from your catalog…</option>{garmentOptions.map((gg) => <option key={gg.id} value={gg.id}>{gg.brand} {gg.style} — {gg.description}</option>)}
                      </select>
                      <select aria-label="Color" value={l.color} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}>
                        <option value="">Color…</option>{(g?.colors || []).map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  );
                })}
                <button className="btn sm" type="button" onClick={() => { const last = lines[lines.length - 1]; setLines([...lines, { ...last, id: uid(), color: "" }]); }}>+ Another color</button>
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-h"><h2>Imprints</h2><button className="btn sm" type="button" onClick={() => setImprints([...imprints, newImprint(LOCATIONS.find((z) => !imprints.some((i) => i.location === z)) || "Full Back")])}>+ Add location</button></div>
            <div className="panel-b stack">
              {imprints.map((im) => {
                const p = place(im);
                return (
                  <div key={im.id} className="mk-imp">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <select aria-label="Location" value={im.location} onChange={(e) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, location: e.target.value } : x)))}>{!LOCATIONS.includes(im.location) && <option>{im.location}</option>}{LOCATIONS.map((z) => <option key={z}>{z}</option>)}</select>
                      <button className="btn icon ghost" type="button" aria-label={`Remove ${im.location}`} onClick={() => setImprints((xs) => xs.filter((x) => x.id !== im.id))}>✕</button>
                      <span className="faint" style={{ fontSize: 12 }}>{p.wIn.toFixed(1)}&quot; × {(p.hIn || 0).toFixed(1)}&quot;</span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {p.d && urls[p.d.id] ? <img className="dp-th" src={urls[p.d.id]} alt="" /> : <span className="dp-th" />}
                      <select aria-label={`Design for ${im.location}`} value={im.design_id || ""} onChange={(e) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: e.target.value || undefined } : x)))} style={{ flex: 1 }}>
                        <option value="">{designs.length ? "Pick a design…" : "No designs yet"}</option>
                        {designs.map((d) => <option key={d.id} value={d.id}>{designLabel(d)}</option>)}
                      </select>
                    </div>
                    {p.d && paints[im.id] && paints[im.id].sources.length > 0 && (
                      <div className="mk-colors">
                        <div className="lbl">COLORS IN THIS DESIGN</div>
                        {paints[im.id].sources.map((src) => {
                          const cur = paints[im.id].map[src.hex];
                          return (
                            <div key={src.hex} className="mk-color">
                              <span className="sw" style={{ background: src.hex }} title={src.hex} />
                              <span className="arrow">→</span>
                              <span className="sw" style={{ background: cur ? (cur.name === "none" ? "transparent" : cur.hex) : src.hex }} />
                              <InkSelect value={cur} onChange={(v) => setInk(im, src.hex, v)} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!p.d && <div className="ink-warn">Which design goes on the {im.location}? Pick one of the customer&apos;s designs, or upload new art.</div>}
                    <div className="row" style={{ gap: 6 }}>
                      <label className="btn sm ghost" style={{ cursor: "pointer" }}>Upload new art<input type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadNew(im, f); }} /></label>
                      <input type="text" aria-label="Width in inches" placeholder="Width" style={{ width: 80 }} value={(im.size.match(/^([\d.]+)/) || [])[1] || ""} onChange={(e) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, size: e.target.value ? `${e.target.value.replace(/[^\d.]/g, "")}" wide` : "" } : x)))} />
                      <span className="faint" style={{ fontSize: 12 }}>in. wide</span>
                    </div>
                  </div>
                );
              })}
              {orderId && <div className="faint" style={{ fontSize: 12 }}>Changes here (locations, designs, sizes, inks) go back to the order when you save.</div>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/** One garment photo with designs you can drag, resize from the corner (proportions locked) and click to recolor. */
function Stage({ src, label, items, onMove, onResize, onPick }: {
  src: string; label: string;
  items: { id: string; p: { x: number; y: number; w: number; h: number; area: { x: number; y: number; w: number; h: number } }; url: string }[];
  onMove: (id: string, dx: number, dy: number) => void;
  onResize: (id: string, newW: number) => void;
  onPick: (id: string, relX: number, relY: number, clientX: number, clientY: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; sx: number; sy: number; mode: "move" | "size"; w: number; el?: HTMLElement } | null>(null);
  const [sel, setSel] = useState("");
  const k = () => (box.current ? box.current.clientWidth / PHOTO_W : 0.42);
  const s = 100 / PHOTO_W, sy = 100 / PHOTO_H;
  return (
    <div className="mk-stage">
      <div ref={box} className="mk-photo" style={{ aspectRatio: `${PHOTO_W} / ${PHOTO_H}` }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          const f = k();
          if (d.mode === "move") onMove(d.id, (e.clientX - d.x) / f, (e.clientY - d.y) / f);
          else { const dw = (e.clientX - d.x) / f; if (d.w + dw > 12) { onResize(d.id, d.w + dw); d.w += dw; } }
          drag.current = { ...d, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
          // a click (no real movement) on a logo opens the color picker for the color under the cursor
          if (d && d.mode === "move" && d.el && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) {
            const r = d.el.getBoundingClientRect();
            onPick(d.id, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX, e.clientY);
          }
        }}
        onPointerLeave={() => { drag.current = null; }}
        onPointerDown={(e) => { if (e.target === box.current || (e.target as HTMLElement).classList.contains("mk-bg")) setSel(""); }}>
        <img src={src} alt="" draggable={false} className="mk-bg" />
        {items.map((it) => <div key={"a" + it.id} className="mk-area" style={{ left: `${it.p.area.x * s}%`, top: `${it.p.area.y * sy}%`, width: `${it.p.area.w * s}%`, height: `${it.p.area.h * sy}%` }} />)}
        {items.map((it) => (
          <div key={it.id} className={"mk-art" + (sel === it.id ? " sel" : "") + (it.url ? "" : " mk-missing")}
            style={{ left: `${it.p.x * s}%`, top: `${it.p.y * sy}%`, width: `${it.p.w * s}%`, height: `${it.p.h * sy}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSel(it.id);
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              drag.current = { id: it.id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: "move", w: it.p.w, el: e.currentTarget as HTMLElement };
            }}>
            {it.url ? <img src={it.url} alt="" draggable={false} /> : "?"}
            {sel === it.id && (
              <span className="mk-handle" title="Drag to resize (proportions stay locked)"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  drag.current = { id: it.id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: "size", w: it.p.w };
                }} />
            )}
          </div>
        ))}
      </div>
      <div className="mk-label">{label}</div>
    </div>
  );
}

/** Pick the ink a logo color prints as: a Wilflex RFU color, a PMS color, a custom PMS, or drop it. */
function InkSelect({ value, onChange }: { value?: { name: string; hex: string }; onChange: (v: { name: string; hex: string } | null) => void }) {
  const known = value && (value.name === "none" || WILFLEX_HEX[value.name] || PMS_HEX[value.name]);
  const [custom, setCustom] = useState(!!value && !known);
  if (custom) {
    return (
      <span className="row" style={{ gap: 4, flex: 1 }}>
        <input type="text" aria-label="PMS number or ink name" placeholder="PMS 7621 C" value={value?.name || ""} onChange={(e) => onChange({ name: e.target.value, hex: value?.hex || "#888888" })} style={{ flex: 1, minWidth: 0 }} />
        <input type="color" aria-label="Screen color" value={value?.hex || "#888888"} onChange={(e) => onChange({ name: value?.name || "Custom", hex: e.target.value })} style={{ width: 34, padding: 0, height: 30 }} />
        <button type="button" className="btn icon ghost" title="Back to the list" onClick={() => { setCustom(false); onChange(null); }}>▾</button>
      </span>
    );
  }
  return (
    <select aria-label="Ink color" value={value?.name || ""} style={{ flex: 1, minWidth: 0 }}
      onChange={(e) => {
        const n = e.target.value;
        if (n === "__custom") { setCustom(true); onChange({ name: "", hex: "#888888" }); return; }
        if (!n) return onChange(null);
        onChange({ name: n, hex: n === "none" ? "" : colorHex(n) });
      }}>
      <option value="">Keep as uploaded</option>
      <option value="none">Remove (shirt shows through)</option>
      <optgroup label="Wilflex RFU">{Object.keys(WILFLEX_HEX).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
      <optgroup label="PMS">{Object.keys(PMS_HEX).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
      <option value="__custom">Other PMS / custom…</option>
    </select>
  );
}
