import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkPage, linkViewed } from "@/lib/proofLinks";
import { inkNames, lineQty, orderGroups, printHow, sizeLabel } from "@/lib/pricing";
import { fmtPhone } from "@/lib/phone";
import ProofAnswer from "./ProofAnswer";
import OrderSteps from "./OrderSteps";
import { orderSteps } from "@/lib/customerSend";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your proof · FBS Print", robots: { index: false } };

/**
 * The customer's proof page (lib/proofLinks.ts; Oct 29, Nick: "you send a link to the customer… this screen pops up. You
 * can see the PDF on the right. And some basic details on the left… change notes and approve it, requires changes").
 * No sign-in: the link is the key. The PDF is the same one the shop downloads.
 */
export default async function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  // an order's page: every step waiting on the customer (lib/customerSend.ts)
  const os = await orderSteps(admin, id);
  if (os) {
    const sh0 = os.settings.shop;
    const art = os.steps.find((x) => x.kind === "art" && x.state === "todo");
    if (art) { const lp = await linkPage(admin, id, { kind: "art" }); if (lp) await linkViewed(admin, lp).catch(() => null); }
    for (const s0 of os.steps.filter((x) => x.kind === "sewout" && x.state === "todo")) { const lp = await linkPage(admin, id, { kind: "sewout", id: s0.sewoutId! }); if (lp) await linkViewed(admin, lp).catch(() => null); }
    return (
      <div className="pfl">
        <header className="pfl-top">
          <img src={sh0.logoUrl || "/brand/fbs-logo.svg"} alt={sh0.name} />
          <div className="pfl-ttl"><b data-notranslate>{os.o.nickname || `Order #${os.o.number}`}</b><span>Order #{os.o.number}</span></div>
          <span className="pfl-sp" />
          {sh0.phone && <a href={`tel:${sh0.phone.replace(/[^\d+]/g, "")}`}>Questions? {fmtPhone(sh0.phone)}</a>}
        </header>
        <OrderSteps id={id} orderId={os.o.id} steps={os.steps} />
      </div>
    );
  }
  const p = await linkPage(admin, id);
  if (!p) return <main className="pfl-gone"><h1>This proof link doesn&apos;t work</h1><p>Ask us for a new one and we&apos;ll send it right over.</p></main>;
  if (p.status === "pending") await linkViewed(admin, p).catch(() => null);
  const { o, settings, link, sewout } = p;
  const sh = settings.shop;
  const groups = orderGroups(o);
  const due = o.due_date ? new Date(`${o.due_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "";
  const pdf = link.kind === "art" ? `/print/${o.id}?proof=1&link=${id}` : `/print/${o.id}?sewout=${sewout?.id}&link=${id}`;
  const what = link.kind === "art" ? `Proof version ${link.version}` : `Sew-out version ${sewout?.version || 1}`;
  // the sew-out's print, for its details
  const im = sewout ? groups.flatMap((g) => g.imprints || []).find((x) => x.id === sewout.imprint_id) : null;
  const sg = sewout ? groups.find((g) => (g.imprints || []).some((x) => x.id === sewout.imprint_id)) : null;
  const shown = link.kind === "art" ? groups : sg ? [sg] : [];
  const qty = shown.reduce((a, g) => a + g.lines.reduce((b, l) => b + lineQty(l), 0), 0);
  const threads = sewout ? [...new Set((sewout.sewn?.threads || []).map((t) => t.sewn))] : [];
  return (
    <div className="pfl">
      <header className="pfl-top">
        <img src={sh.logoUrl || "/brand/fbs-logo.svg"} alt={sh.name} />
        <span className="pfl-sp" />
        {sh.phone && <a href={`tel:${sh.phone.replace(/[^\d+]/g, "")}`}>Questions? {fmtPhone(sh.phone)}</a>}
      </header>
      <div className="pfl-body">
        <aside className="pfl-side">
          <div>
            <h1 data-notranslate>{o.nickname || `Order #${o.number}`}</h1>
            <div className="pfl-sub">Order #{o.number} · {what}</div>
          </div>
          <table className="pfl-kv"><tbody>
            {qty > 0 && <tr><th>Quantity</th><td>{qty.toLocaleString()}</td></tr>}
            {link.kind === "sewout" && im && <>
              <tr><th>Print</th><td>{im.location}{im.size ? `, ${im.size}` : ""}</td></tr>
              {sewout?.sewn?.file && <tr><th>Size</th><td>{sewout.sewn.file.wIn}&quot; × {sewout.sewn.file.hIn}&quot;</td></tr>}
              {sewout?.sewn?.file && <tr><th>Stitches</th><td>{sewout.sewn.file.stitches.toLocaleString()}</td></tr>}
              {threads.length > 0 && <tr><th>Thread{threads.length > 1 ? "s" : ""}</th><td>{threads.join(", ")}</td></tr>}
            </>}
            {due && <tr><th>In hands</th><td>{due}</td></tr>}
          </tbody></table>
          {link.kind === "art" && shown.map((g, gi) => (
            <div className="pfl-g" key={g.id}>
              {shown.length > 1 && <div className="pfl-gn">{g.name?.trim() || `Group ${gi + 1}`}</div>}
              {g.lines.filter((l) => lineQty(l) > 0).map((l) => <div key={l.id} className="pfl-line"><b>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}<span>{lineQty(l)} · {Object.entries(l.sizes || {}).filter(([, q]) => +(q || 0) > 0).map(([z, q]) => `${sizeLabel(z as never)} ${q}`).join(", ")}</span></div>)}
              {(g.imprints || []).map((d) => <div key={d.id} className="pfl-line"><b>{d.location}</b> · {printHow(d)}{d.size ? ` · ${d.size}` : ""}{inkNames(d.inks).length ? <span>{inkNames(d.inks).join(", ")}</span> : null}</div>)}
            </div>
          ))}
          {link.kind === "sewout" && sewout?.note && <div className="pfl-note">{sewout.note}</div>}
          <ProofAnswer id={id} kind={link.kind === "sewout" ? "sewout" : "art"} status={p.status as "pending" | "approved" | "changes" | "replaced" | "gone"} decidedName={p.decidedName} decidedAt={p.decidedAt} comment={p.comment} />
        </aside>
        <section className="pfl-pdf">
          <div className="pfl-bar"><span>{what}</span><span className="pfl-sp" /><a href={pdf.replace("&link=", "&link=")} target="_blank" rel="noreferrer">Open the PDF</a></div>
          <iframe src={`${pdf}&embed=1`} title={what} />
        </section>
      </div>
    </div>
  );
}
