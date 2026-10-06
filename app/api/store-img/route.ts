import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Pictures on the public merch stores (banners, logos, product mockups). They're kept in the private proofs bucket under
 * stores/<store id>/…; only that folder can be read here, so customer art and proofs stay private.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p") || "";
  if (!/^stores\/[\w-]+\/[\w.\-/]+$/.test(p) || p.includes("..")) return new Response("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage.from("proofs").download(p);
  if (error || !data) return new Response("Not found", { status: 404 });
  const type = data.type || (/\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.svg$/i.test(p) ? "image/svg+xml" : /\.webp$/i.test(p) ? "image/webp" : "application/octet-stream");
  if (!/^image\//.test(type)) return new Response("Not found", { status: 404 });
  return new Response(await data.arrayBuffer(), { headers: { "content-type": type, "cache-control": "public, max-age=86400, immutable", ...(type === "image/svg+xml" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}) } });
}
