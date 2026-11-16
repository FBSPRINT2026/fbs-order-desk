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
/** link: how the Zebra is plugged in. "usb": a USB cable into the print computer (the relay prints to it through Windows,
 *  by name, or finds the Zebra itself when usbName is blank); "network": it has its own IP address (Nov 13, Nick: "it's just a USB printer"). */
export type PrintSettings = { mode: "relay" | "printnode"; link: "usb" | "network"; usbName: string; host: string; port: number; dpi: 203 | 300; printnodeId: string };
export const DEFAULT_PRINT: PrintSettings = { mode: "relay", link: "network", usbName: "", host: "", port: 9100, dpi: 203, printnodeId: "" };

export async function printSettings(admin: SupabaseClient): Promise<PrintSettings> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const p = ((data?.data as Record<string, unknown>)?.printing || {}) as Partial<PrintSettings>;
  return { ...DEFAULT_PRINT, ...p, link: p.link === "usb" ? "usb" : "network", usbName: String(p.usbName || "").trim(), port: +(p.port || 9100) || 9100, dpi: +(p.dpi || 203) === 300 ? 300 : 203 };
}

/** the Zebra is set up: PrintNode with a printer picked, or the relay with the Zebra on USB or at an IP address */
export const printerReady = (ps: PrintSettings) => (ps.mode === "printnode" ? !!ps.printnodeId : ps.link === "usb" || !!ps.host);

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newRelayToken = () => "fbsr_" + randomBytes(24).toString("base64url");

/** Queue labels; sent to PrintNode right away when that's the mode. Returns how it went, in words. */
/**
 * The print computers (each with its own Zebra; Nick, Nov 16 2026): connected = asked for labels in the last 90 seconds.
 * A label goes to the one the browser picked (lib/labelPrinter.ts); with none picked, the only one there is.
 */
export async function printers(admin: SupabaseClient) {
  const { data } = await admin.from("print_relays").select("id, name, last_seen_at").eq("revoked", false).order("created_at");
  return ((data || []) as { id: string; name: string; last_seen_at: string | null }[]).map((r) => ({ id: r.id, name: r.name, live: !!r.last_seen_at && Date.now() - Date.parse(r.last_seen_at) < 90000 }));
}

export async function queueLabels(admin: SupabaseClient, labels: { title: string; zpl: string; kind?: string; order_id?: string | null; archived_order_id?: string | null }[], by: string, printer?: string | null): Promise<{ ok: boolean; message: string; ids: string[] }> {
  if (!labels.length) return { ok: false, message: "Nothing to print.", ids: [] };
  const ps = await printSettings(admin);
  const usePn = ps.mode === "printnode" && !!process.env.PRINTNODE_API_KEY?.trim() && !!ps.printnodeId;
  // which computer's Zebra: the one this browser picked, else the only one
  const all = usePn ? [] : await printers(admin);
  const to = usePn ? null : all.find((p) => p.id === printer) || (all.length === 1 ? all[0] : null);
  if (!usePn && !all.length) return { ok: false, message: "No print computer yet: Shipping Center → Settings → Label printer → Set up a print computer (the one the printer plugs into).", ids: [] };
  if (!usePn && !to) return { ok: false, message: "Pick this computer's label printer (Prints on, beside Print).", ids: [] };
  const { data, error } = await admin.from("print_jobs").insert(labels.map((l) => ({ title: l.title, zpl: l.zpl, kind: l.kind || "label", order_id: l.order_id || null, archived_order_id: l.archived_order_id || null, created_by: by, status: usePn ? "sent" : "queued", sent_at: usePn ? new Date().toISOString() : null, relay_target: to?.id || null }))).select("id");
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
  const live = !!to?.live, n = labels.length, ls = `label${n === 1 ? "" : "s"}`;
  return { ok: live, message: live ? `Sent ${n} ${ls} to ${to!.name}'s printer.` : `Queued ${n} ${ls}, but ${to!.name} isn't connected (its relay isn't running, or the computer is off or asleep). They'll print if it's back within 15 minutes.`, ids };
}
