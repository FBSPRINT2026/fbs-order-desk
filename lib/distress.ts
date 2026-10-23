"use client";
/**
 * Distress the way the shop does it (Oct 22 2026, Nick on Peticolas: "we take the background vector art… then we take
 * that mask and duplicate it 3 times right on top of itself… it's the shirt color that comes through"). The mask is a
 * picture of the texture (white = texture, see Peticolas_Film_Mask.pdf); laid over the art `layers` times, the ink is
 * left out where it's strong, so the shirt shows through. The mockup uses one layer (how it looks printed: their
 * "PBC with Distress"); the film stacks three (enough to burn the screen).
 */
const load = async (b: Blob | string) => createImageBitmap(typeof b === "string" ? await (await fetch(b)).blob() : b);

export async function applyDistress(art: Blob | string, mask: Blob | string, o: { layers?: number; /** "stretch": the mask was cut to this art; "cover": a customer's mask fitted over it */ fit?: "stretch" | "cover"; name?: string } = {}): Promise<File> {
  const [a, m] = await Promise.all([load(art), load(mask)]);
  const W = a.width, H = a.height, layers = Math.max(1, o.layers || 1);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  // the mask over the art: cut to it, or fitted to cover it (centered, its shape kept)
  if (o.fit === "cover") { const k = Math.max(W / m.width, H / m.height); x.drawImage(m, (W - m.width * k) / 2, (H - m.height * k) / 2, m.width * k, m.height * k); }
  else x.drawImage(m, 0, 0, W, H);
  const md = x.getImageData(0, 0, W, H).data;
  x.clearRect(0, 0, W, H); x.drawImage(a, 0, 0);
  const img = x.getImageData(0, 0, W, H), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    // how strong the texture is here: its brightness (and its own see-through, for a mask saved on clear)
    const v = (Math.max(md[i], md[i + 1], md[i + 2]) / 255) * (md[i + 3] / 255);
    px[i + 3] = Math.round(px[i + 3] * Math.pow(1 - v, layers));
  }
  x.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) throw new Error("Couldn't make the distressed picture.");
  return new File([blob], o.name || "distressed.png", { type: "image/png" });
}
