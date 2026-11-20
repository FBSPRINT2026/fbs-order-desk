"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A sew file's worksheet and EMB among what the customer sent (lib/designs.ts sewMates): their emailed attachments and
 * portal uploads with the same name once the digitizer's stamps are off. Read here (staff can't list those folders from
 * the browser); returns short links to download them.
 */
export async function sewMateLinks(customerId: string, fileName: string): Promise<{ name: string; url: string }[]> {
  const v = await getViewer();
  if (!v.user || !v.isStaff || !/^[0-9a-f-]{36}$/i.test(customerId)) return [];
  const { sewStem } = await import("@/lib/sewStem");
  const admin = createAdminClient(), stem = sewStem(fileName), own = fileName.toLowerCase();
  if (stem.length < 3) return [];
  const out: { name: string; path: string }[] = [];
  const look = async (dir: string) => {
    const { data } = await admin.storage.from("proofs").list(dir, { limit: 300, sortBy: { column: "created_at", order: "desc" } });
    for (const o of data || []) {
      const n = o.name.replace(/^[a-z0-9]{6,10}-/i, "");
      if (!/\.(pdf|emb)$/i.test(n) || n.toLowerCase() === own || sewStem(n) !== stem) continue;
      if (out.some((f) => f.name.toLowerCase().slice(-4) === n.toLowerCase().slice(-4))) continue;
      out.push({ name: n, path: `${dir}/${o.name}` });
    }
  };
  await look(`emails/${customerId}`);
  if (!out.length) {
    const { data: ods } = await admin.storage.from("proofs").list(`requests/${customerId}`, { limit: 30, sortBy: { column: "created_at", order: "desc" } });
    for (const d of (ods || []).slice(0, 10)) { await look(`requests/${customerId}/${d.name}`); if (out.length) break; }
  }
  const res: { name: string; url: string }[] = [];
  for (const f of out) { const { data } = await admin.storage.from("proofs").createSignedUrl(f.path, 600); if (data?.signedUrl) res.push({ name: f.name, url: data.signedUrl }); }
  return res;
}
