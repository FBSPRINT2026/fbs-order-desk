"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideByLink, type LinkDecision } from "@/lib/proofLinks";

/** The customer's answer on their proof link (no sign-in: the link is the key; lib/proofLinks.ts checks it). */
export async function answerProof(id: string, decision: LinkDecision, name: string, note: string) {
  try { return await decideByLink(createAdminClient(), id, decision, name, note); }
  catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong. Try again." }; }
}
