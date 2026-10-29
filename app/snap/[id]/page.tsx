import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSnap } from "@/lib/phoneSnap";
import { printOf } from "@/lib/sewouts";
import type { Order } from "@/lib/pricing";
import SnapSewout from "./SnapSewout";
import { stockKey } from "@/lib/threadStock";
import { currentSewFile } from "@/lib/digitizeStatus";
import type { SewCtx } from "@/components/SewnPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Take the photo · FBS", robots: { index: false } };

/**
 * What the computer's QR code opens on a phone (lib/phoneSnap.ts): no sign-in, the short link is the pass. For a
 * sew-out: the order and print, then the camera, the same crop as on the computer, and it goes back to the computer.
 */
export default async function SnapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const got = await openSnap(admin, id);
  if (!got.ok) return <main className="snap-page"><h1>Take the photo</h1><p className="pv-err">{got.error}</p></main>;
  const s = got.snap;
  const { data: o } = await admin.from("orders").select("*, customers(name, company)").eq("id", s.order_id).maybeSingle();
  const order = o as (Order & { customers?: { name?: string; company?: string } | null }) | null;
  const pr = order ? printOf(order, s.target) : null;
  if (!order || !pr) return <main className="snap-page"><h1>Take the photo</h1><p className="pv-err">That print isn&apos;t on the order anymore.</p></main>;
  const who = order.customers?.company || order.customers?.name || "";
  // "What we sewed" on the phone too: the logo's stitch files, the print's threads and size, the threads on the wall
  const [{ data: d }, { data: st }] = await Promise.all([
    pr.im.design_id ? admin.from("designs").select("specs").eq("id", pr.im.design_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("stock_threads").select("line, code").is("archived_at", null),
  ]);
  const files = ((d?.specs as { embroidery?: { files?: SewCtx["files"] } } | null)?.embroidery?.files) || [];
  const cur = currentSewFile(pr.im, files);
  const ctx: SewCtx = { files: files.length ? files : cur ? [cur as SewCtx["files"][number]] : [], current: cur?.path, inks: pr.im.inks || "", size: pr.im.size || "", stitches: pr.im.stitches || undefined, stock: ((st || []) as { line: string; code: string }[]).map((r) => stockKey(r.line, r.code)) };
  return (
    <main className="snap-page">
      <div className="eyebrow">Sew-out photo</div>
      <h1 data-notranslate>#{order.number}{who ? ` · ${who}` : ""}</h1>
      <p className="faint" data-notranslate>{pr.im.location}{pr.im.size ? `, ${pr.im.size}` : ""}{s.used_at ? " · a photo already came in from this link; another one is the next version" : ""}</p>
      <SnapSewout id={s.id} orderId={s.order_id} imprintId={s.target} ctx={ctx} />
    </main>
  );
}
