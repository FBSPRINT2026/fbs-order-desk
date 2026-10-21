"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { colorHex } from "@/lib/inkColors";
import { TAG_GRAY, drawNeckView, isPicture, labelCanvas, labelFileFor, picturePath, type NeckLabelSet } from "@/lib/neckLabels";

/** signed links for label art, kept for the page's life (an hour each) */
const urlCache = new Map<string, Promise<string>>();
export function neckFileUrl(path: string): Promise<string> {
  if (!urlCache.has(path)) urlCache.set(path, Promise.resolve(createClient().storage.from("proofs").createSignedUrl(path, 3600)).then((r) => r.data?.signedUrl || ""));
  return urlCache.get(path)!;
}
export const loadPic = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("no picture")); im.src = src; });

/** the ink the label prints in: the set's ink, else the shop's usual light gray on every shirt (Oct 21, Nick: "we
 *  typically print the same color on both black and white… usually a light gray") */
export const labelInkHex = (set: NeckLabelSet, _shirtHex?: string) => (set.ink && (colorHex(set.ink) || (/^#[0-9a-f]{6}$/i.test(set.ink) ? set.ink : ""))) || TAG_GRAY;

/** the label for one size as it prints (null when the art isn't a picture we can draw) */
export async function labelFor(set: NeckLabelSet, size: string, shirtHex: string): Promise<HTMLCanvasElement | null> {
  const f = labelFileFor(set, size);
  if (!f || !isPicture(f)) return null;
  const u = await neckFileUrl(picturePath(f));
  if (!u) return null;
  const img = await loadPic(u).catch(() => null);
  return img ? labelCanvas(img, set, size, labelInkHex(set, shirtHex)) : null;
}

/**
 * The inside of the back neck with the customer's label printed (the tag cut out), for one size. Drawn, since most
 * supplier photos don't show inside the neck (Oct 20, Nick: "if not every shirt image has where you can see it in
 * there… just do a little visual mock-up").
 */
export default function NeckLabelView({ set, size, shirtHex, width = 220, caption = true }: { set: NeckLabelSet; size: string; shirtHex: string; width?: number; caption?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let off = false;
    void (async () => {
      const lab = await labelFor(set, size, shirtHex).catch(() => null);
      if (off || !ref.current) return;
      setMissing(!lab);
      const S = 2, h = Math.round(width * 0.8), capH = caption ? 22 : 0;
      const c = ref.current; c.width = width * S; c.height = (h + capH) * S; c.style.width = `${width}px`; c.style.height = `${h + capH}px`;
      const x = c.getContext("2d")!; x.scale(S, S); x.clearRect(0, 0, width, h + capH);
      drawNeckView(x, 0, 0, width, h, shirtHex, lab, set.widthIn || 2.5, caption ? `Inside neck · size ${size}` : undefined);
    })();
    return () => { off = true; };
  }, [set, size, shirtHex, width, caption]);
  return (
    <figure className="nlv" style={{ width }}>
      <canvas ref={ref} aria-label={`Inside the neck: ${set.name} label, size ${size}`} />
      {missing && <figcaption className="nlv-miss">No picture of the {size} label yet{labelFileFor(set, size) && !isPicture(labelFileFor(set, size)) ? " (upload a PNG or JPG to show it)" : ""}</figcaption>}
    </figure>
  );
}
