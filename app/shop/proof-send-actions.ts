"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { previewProofEmail, sendProofs } from "@/lib/proofs";
import { previewSewoutEmail, sendSewoutNow, sewoutLinkCopy } from "@/lib/sewouts";

/**
 * Send a proof (components/tools/SendProofTool.tsx): the preview first, then Send, or Copy the link / a button to put in
 * your own email (Oct 29, Nick: "preview proof to customer, and then you click actually send… copy a link that makes,
 * like, a little button"). An art proof is an order's current mockups (lib/proofs.ts); a sew-out is one photo
 * (lib/sewouts.ts). Both open the customer's proof page (lib/proofLinks.ts).
 */
export type ProofTarget = { kind: "art" | "sewout"; orderId: string; sewoutId?: string; note?: string; /** the version already out with the customer (its link only) */ live?: boolean };

async function me() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const { data } = await v.supabase.from("staff").select("name").eq("email", v.email).maybeSingle();
  return { email: v.email, name: (data?.name as string) || v.email.split("@")[0] };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export async function proofSendPreview(t: ProofTarget) {
  try {
    await me();
    const admin = createAdminClient();
    if (t.kind === "sewout") return await previewSewoutEmail(admin, t.sewoutId || "");
    const r = await previewProofEmail(admin, t.orderId, t.note || "");
    if (!r.mockups) return { ok: false as const, error: "Make a mockup in the Mockup Creator first." };
    return { ok: true as const, to: r.to, subject: r.subject, html: r.html };
  } catch (e) { return fail(e); }
}

export async function proofSend(t: ProofTarget) {
  try {
    const who = await me(), admin = createAdminClient();
    if (t.kind === "sewout") { const r = await sendSewoutNow(admin, t.sewoutId || "", who); return r.ok ? { ok: true as const, msg: `Sent to ${r.to}.` } : r; }
    const r = await sendProofs(admin, t.orderId, who, t.note || "");
    return r.ok ? { ok: true as const, msg: r.emailed ? `Proof version ${r.version} sent.` : `Proof version ${r.version} made, but the email didn't go out. Copy the link and send it yourself.`, link: r.link } : r;
  } catch (e) { return fail(e); }
}

export async function proofCopyLink(t: ProofTarget) {
  try {
    const who = await me(), admin = createAdminClient();
    if (t.kind === "sewout") return await sewoutLinkCopy(admin, t.sewoutId || "", who);
    if (t.live) {
      const { data } = await admin.from("proofs").select("version").eq("order_id", t.orderId).not("version", "is", null).is("archived_at", null).limit(1).maybeSingle();
      if (!data?.version) return { ok: false as const, error: "No proof is out with the customer." };
      const { proofLinkFor, proofUrl } = await import("@/lib/proofLinks");
      return { ok: true as const, url: proofUrl(await proofLinkFor(admin, { kind: "art", orderId: t.orderId, version: data.version, by: who.email })) };
    }
    const r = await sendProofs(admin, t.orderId, who, t.note || "", { email: false });
    return r.ok ? { ok: true as const, url: r.link } : r;
  } catch (e) { return fail(e); }
}
