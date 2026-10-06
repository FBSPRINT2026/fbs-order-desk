import "server-only";
import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Label printing to the Zebra (ZT231) from any phone or computer. A label is queued here; then either
 *  - the print relay (a small script on a shop computer on the same network as the printer) picks it up within a
 *    second or two and sends it to the printer's IP on port 9100, or
 *  - PrintNode (if PRINTNODE_API_KEY is set and a PrintNode printer is chosen) gets it right away.
 * Phones can't talk to a printer on the shop network from a secure web page, so something on the network has to.
 */
export type PrintSettings = { mode: "relay" | "printnode"; host: string; port: number; dpi: 203 | 300; printnodeId: string };
export const DEFAULT_PRINT: PrintSettings = { mode: "relay", host: "", port: 9100, dpi: 203, printnodeId: "" };

export async function printSettings(admin: SupabaseClient): Promise<PrintSettings> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const p = ((data?.data as Record<string, unknown>)?.printing || {}) as Partial<PrintSettings>;
  return { ...DEFAULT_PRINT, ...p, port: +(p.port || 9100) || 9100, dpi: +(p.dpi || 203) === 300 ? 300 : 203 };
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newRelayToken = () => "fbsr_" + randomBytes(24).toString("base64url");

/** Queue labels; sent to PrintNode right away when that's the mode. Returns how it went, in words. */
export async function queueLabels(admin: SupabaseClient, labels: { title: string; zpl: string; kind?: string; order_id?: string | null; archived_order_id?: string | null }[], by: string): Promise<{ ok: boolean; message: string; ids: string[] }> {
  if (!labels.length) return { ok: false, message: "Nothing to print.", ids: [] };
  const ps = await printSettings(admin);
  const usePn = ps.mode === "printnode" && !!process.env.PRINTNODE_API_KEY?.trim() && !!ps.printnodeId;
  const { data, error } = await admin.from("print_jobs").insert(labels.map((l) => ({ title: l.title, zpl: l.zpl, kind: l.kind || "label", order_id: l.order_id || null, archived_order_id: l.archived_order_id || null, created_by: by, status: usePn ? "sent" : "queued", sent_at: usePn ? new Date().toISOString() : null }))).select("id");
  if (error) return { ok: false, message: error.message, ids: [] };
  const ids = ((data || []) as { id: string }[]).map((x) => x.id);
  if (usePn) {
    const key = Buffer.from(process.env.PRINTNODE_API_KEY!.trim() + ":").toString("base64");
    const errs: string[] = [];
    for (const [i, l] of labels.entries()) {
      const r = await fetch("https://api.printnode.com/printjobs", { method: "POST", headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ printerId: +ps.printnodeId, title: l.title, contentType: "raw_base64", content: Buffer.from(l.zpl, "utf8").toString("base64"), source: "FBS Portal" }) }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
      const ok = r.ok;
      await admin.from("print_jobs").update(ok ? { status: "printed", done_at: new Date().toISOString() } : { status: "error", error: (await r.text()).slice(0, 300) }).eq("id", ids[i]);
      if (!ok) errs.push(l.title);
    }
    return errs.length ? { ok: false, message: `PrintNode didn't take ${errs.length} label${errs.length === 1 ? "" : "s"}. Check the printer in PrintNode.`, ids } : { ok: true, message: `Sent ${labels.length} label${labels.length === 1 ? "" : "s"} to the printer.`, ids };
  }
  // the relay: is a print computer listening?
  const { data: rl } = await admin.from("print_relays").select("last_seen_at").eq("revoked", false).order("last_seen_at", { ascending: false, nullsFirst: false }).limit(1);
  const seen = (rl || [])[0]?.last_seen_at as string | undefined;
  const live = !!seen && Date.now() - Date.parse(seen) < 90000;
  if (!ps.host) return { ok: false, message: "Set the printer's IP address first (Shipping Center → Settings → Label printer).", ids };
  return { ok: live, message: live ? `Sent ${labels.length} label${labels.length === 1 ? "" : "s"} to the printer.` : `Queued ${labels.length} label${labels.length === 1 ? "" : "s"}, but the print computer isn't connected. They'll print if it's back within 15 minutes.`, ids };
}
