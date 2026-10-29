"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideByLink, openLink, type LinkDecision, type Step } from "@/lib/proofLinks";
import { decideQuote } from "@/lib/customerSend";

/** The customer's answer on their proof link or order page (no sign-in: the link is the key; lib/proofLinks.ts checks it). */
export async function answerProof(id: string, decision: LinkDecision, name: string, note: string, step?: Step) {
  try { return await decideByLink(createAdminClient(), id, decision, name, note, step); }
  catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong. Try again." }; }
}

/** Approve the quote (signed) or decline it with why, on the order page. */
export async function answerQuote(id: string, decision: "approve" | "decline", name: string, reason: string) {
  try {
    const admin = createAdminClient();
    const link = await openLink(admin, id);
    if (!link || link.kind !== "order") return { ok: false as const, error: "This link doesn't work anymore. Ask us for a new one." };
    return await decideQuote(admin, link.order_id, decision, name, reason, link.sent_to || "customer");
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong. Try again." }; }
}
