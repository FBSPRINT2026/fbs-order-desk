/**
 * A garment photo from anywhere (a shop online, a picture dropped or pasted) made like a supplier's: on pure white,
 * padded to the Mockup Creator's photo frame (4:5), at most 1600px. The near-white background touching the edges
 * (light gray studio backdrops, JPEG noise) becomes pure white, so measureGarment (lib/mockup.ts) finds the garment and
 * sizes and lines it up like the front. A photo with a dark or busy background is left as it is.
 */
export async function cleanPhoto(src: Blob): Promise<Blob> {
  const url = URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("That picture didn't open.")); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const W = Math.max(w, Math.round(h * 0.8)), H = Math.round(W * 1.25);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
    x.drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
    const im = x.getImageData(0, 0, W, H), d = im.data;
    const light = (p: number) => { const r = d[p * 4], g = d[p * 4 + 1], b = d[p * 4 + 2]; return Math.min(r, g, b) >= 236 && Math.max(r, g, b) - Math.min(r, g, b) <= 14; };
    // only when the edges are light (a studio backdrop), not a photo of a room
    let edge = 0, n = 0;
    for (let X = 0; X < W; X += 4) { n += 2; if (light(X)) edge++; if (light((H - 1) * W + X)) edge++; }
    for (let Y = 0; Y < H; Y += 4) { n += 2; if (light(Y * W)) edge++; if (light(Y * W + W - 1)) edge++; }
    if (edge / n > 0.85) {
      const seen = new Uint8Array(W * H), st = new Int32Array(W * H); let sp = 0;
      const push = (p: number) => { if (!seen[p] && light(p)) { seen[p] = 1; st[sp++] = p; } };
      for (let X = 0; X < W; X++) { push(X); push((H - 1) * W + X); }
      for (let Y = 0; Y < H; Y++) { push(Y * W); push(Y * W + W - 1); }
      while (sp) { const p = st[--sp], X = p % W; d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255; if (X > 0) push(p - 1); if (X < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < W * (H - 1)) push(p + W); }
      x.putImageData(im, 0, 0);
    }
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("Couldn't save that picture."))), "image/jpeg", 0.92));
  } finally { URL.revokeObjectURL(url); }
}
