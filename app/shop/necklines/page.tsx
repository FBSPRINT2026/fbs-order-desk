"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PHOTO_H, PHOTO_W, measureGarment, ssImg } from "@/lib/mockup";

/**
 * Necklines (Admin Tools): every garment photo in the catalog, 100 at a time, with the line where the finder thinks the
 * bottom of the sewn front neckline is (every print's drop is measured from it). Click a photo where the seam really is
 * and that's saved right away; "Done, the rest are right" saves every line you didn't touch and loads the next 100
 * (Oct 20, Nick: "let me scan through a large page of 100 and just click where the red line should go, and I'll say I'm
 * done, and then you can assume we're all right"). Saved per photo in garment_necks, used by the Mockup Creator.
 */
type Item = { photo: string; brand: string; style: string; color: string };
type Card = Item & { crop?: string; y0: number; k: number; guess: number | null; set: number | null; err?: string };

const CW = 240, CH = 250;

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("no photo")); im.src = src; });
}

export default function NecklinesPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [left, setLeft] = useState<number | null>(null), [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [measuring, setMeasuring] = useState(0);
  const run = useRef(0);

  const load = useCallback(async () => {
    const my = ++run.current;
    setBusy(true); setMsg(""); setCards([]);
    const j = await fetch("/api/garments/neck?todo=1&limit=100").then((r) => r.json()).catch(() => null);
    if (!j?.items) { setMsg(j?.error || "Couldn't load the photos."); setBusy(false); return; }
    setLeft(j.left); setDone(j.done);
    const items = j.items as Item[];
    setCards(items.map((it) => ({ ...it, y0: 0, k: 1, guess: null, set: null })));
    setBusy(false);
    // measure each photo in turn (a few hundredths of a second each) and show its neck area with the guess
    for (let i = 0; i < items.length; i++) {
      if (run.current !== my) return;
      setMeasuring(i + 1);
      const it = items[i];
      try {
        const img = await loadImg(ssImg(it.photo));
        const fit = measureGarment(img, "front");
        const c = document.createElement("canvas"); c.width = PHOTO_W; c.height = PHOTO_H;
        const x = c.getContext("2d")!;
        const iw = img.naturalWidth || PHOTO_W, ih = img.naturalHeight || PHOTO_H, z = Math.min(PHOTO_W / iw, PHOTO_H / ih);
        x.fillStyle = "#fff"; x.fillRect(0, 0, PHOTO_W, PHOTO_H); x.drawImage(img, (PHOTO_W - iw * z) / 2, (PHOTO_H - ih * z) / 2, iw * z, ih * z);
        const s = fit?.s || 1, cx = fit?.cx ?? PHOTO_W / 2, top = fit?.top ?? 100;
        // the neck area: 9.4" wide, from just above the shoulders to below where a hood ends
        const w = Math.round(320 * s), h = Math.round(w * (CH / CW)), x0 = Math.round(cx - w / 2), y0 = Math.max(0, Math.round(top - 10 * s));
        const o = document.createElement("canvas"); o.width = CW; o.height = CH;
        o.getContext("2d")!.drawImage(c, x0, y0, w, h, 0, 0, CW, CH);
        const crop = o.toDataURL("image/jpeg", 0.85);
        setCards((l) => l.map((q) => (q.photo === it.photo ? { ...q, crop, y0, k: CW / w, guess: fit?.neck ?? null } : q)));
      } catch {
        setCards((l) => l.map((q) => (q.photo === it.photo ? { ...q, err: "Photo didn't load" } : q)));
      }
    }
    setMeasuring(0);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = (items: { photo: string; neck: number }[]) =>
    fetch("/api/garments/neck", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(items.length === 1 ? items[0] : { items }) }).then((r) => r.ok).catch(() => false);

  const click = async (c: Card, e: React.MouseEvent<HTMLDivElement>) => {
    if (!c.crop) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = Math.round(c.y0 + ((e.clientY - r.top) / r.height) * CH / c.k);
    setCards((l) => l.map((q) => (q.photo === c.photo ? { ...q, set: y, err: undefined } : q)));
    if (!(await save([{ photo: c.photo, neck: y }]))) setCards((l) => l.map((q) => (q.photo === c.photo ? { ...q, err: "Didn't save, click again" } : q)));
  };

  const finish = async () => {
    const rest = cards.filter((c) => c.set == null && c.guess != null).map((c) => ({ photo: c.photo, neck: c.guess as number }));
    setBusy(true); setMsg("");
    const ok = rest.length ? await save(rest) : true;
    setBusy(false);
    if (!ok) { setMsg("Didn't save. Try Done again."); return; }
    load();
  };

  const ready = cards.length > 0 && !measuring;
  const noGuess = cards.filter((c) => c.crop && c.guess == null && c.set == null).length;
  return (
    <div className="nl-page">
      <div className="nl-head">
        <div>
          <h1>Necklines</h1>
          <p>The red line is where I think the bottom of the sewn neckline is (on a hoodie, the bottom of the hood). Every drop is measured from it. If one is off, click the photo where it should be: it turns blue and saves. When you&apos;ve looked through the page, click Done and the rest are saved as right.</p>
        </div>
        <div className="nl-act">
          <span className="nl-count">{left == null ? "" : left === 0 ? "All photos are set" : `${left} left · ${done} set`}{measuring ? ` · reading ${measuring} of ${cards.length}` : ""}</span>
          <button type="button" className="btn primary" disabled={!ready || busy} onClick={finish}>Done, the rest are right</button>
        </div>
      </div>
      {msg && <p className="nl-msg">{msg}</p>}
      {noGuess > 0 && ready && <p className="nl-msg">{noGuess} photo{noGuess === 1 ? " has" : "s have"} no line yet (outlined in orange): click the seam on {noGuess === 1 ? "it" : "them"}, or they stay on the list.</p>}
      <div className="nl-grid">
        {cards.map((c) => {
          const y = c.set ?? c.guess;
          return (
            <figure key={c.photo} className={"nl-card" + (c.set != null ? " fixed" : c.crop && c.guess == null ? " none" : "")}>
              <div className="nl-shot" onClick={(e) => click(c, e)} style={{ aspectRatio: `${CW} / ${CH}` }}>
                {c.crop ? <img src={c.crop} alt="" draggable={false} /> : <span className="nl-wait">{c.err || "…"}</span>}
                {c.crop && y != null && <i className="nl-line" style={{ top: `${((y - c.y0) * c.k / CH) * 100}%` }} />}
              </div>
              <figcaption><b>{c.brand} {c.style}</b> {c.color}{c.err && c.crop ? <em> · {c.err}</em> : null}</figcaption>
            </figure>
          );
        })}
      </div>
      {ready && cards.length > 12 && <div className="nl-foot"><button type="button" className="btn primary" disabled={busy} onClick={finish}>Done, the rest are right</button></div>}
    </div>
  );
}
