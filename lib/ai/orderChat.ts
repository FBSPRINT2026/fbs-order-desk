import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, type LookedUp } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { orderBrief, type ReorderCheck, type ReorderFix } from "@/lib/ai/reorderCheck";
import { LOCATIONS, type Settings } from "@/lib/pricing";

/**
 * Order chat: staff talk an order through with the AI ("looks good, did you go into the film folder and pull the
 * previous sizing?"). It answers from the order, its notes, history and production files, the old job for a reorder,
 * and the pictures / film it can look at. It can suggest fixes (one field on one print) that staff apply with a click.
 * The conversation is kept on the order (ai_suggestions, kind order_chat).
 */
export type ChatMsg = { role: "staff" | "ai"; text: string; at: string; by?: string; fixes?: ReorderFix[]; lookedUp?: LookedUp };

export async function chatThread(admin: SupabaseClient, orderId: string): Promise<ChatMsg[]> {
  const { data } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", `order_chat:${orderId}`).limit(1).maybeSingle();
  return ((data?.payload as { messages?: ChatMsg[] } | null)?.messages || []);
}

export async function orderChat(admin: SupabaseClient, s: Settings, orderId: string, by: string, message: string, lookedUp?: LookedUp | null): Promise<{ ok: true; messages: ChatMsg[] } | { ok: false; error: string }> {
  const msg = message.trim().slice(0, 2000);
  if (!msg) return { ok: false, error: "Type a question first." };
  const b = await orderBrief(admin, orderId, false);
  if (!b.ok) return b;
  const { o, ims, images, documents } = b;
  const thread = await chatThread(admin, orderId);
  const [{ data: evs }, { data: rc }] = await Promise.all([
    admin.from("order_events").select("kind, detail, actor, created_at").eq("order_id", orderId).order("created_at", { ascending: false }).limit(25),
    admin.from("ai_suggestions").select("payload").eq("dedupe_key", `reorder_check:${orderId}`).limit(1).maybeSingle(),
  ]);
  const check = rc?.payload as ReorderCheck | undefined;
  const prompt = [
    b.text,
    evs?.length ? `\nOrder history (newest first):\n${evs.map((e) => `- ${String(e.created_at).slice(0, 16).replace("T", " ")} ${e.kind}: ${e.detail || ""}${e.actor ? ` (${e.actor})` : ""}`).join("\n")}` : "",
    check ? `\nThe last reorder check said: ${check.summary}${check.issues.length ? ` Issues: ${check.issues.map((i) => i.text).join(" / ")}` : ""}` : "",
    thread.length ? `\nThe conversation so far:\n${thread.slice(-16).map((m) => `${m.role === "staff" ? `Staff${m.by ? ` (${m.by})` : ""}` : "You"}: ${m.text}`).join("\n")}` : "",
    `\nStaff now says: ${msg}`,
    lookedUp?.text ? `Looked up online for that: ${lookedUp.text}` : "",
  ].filter(Boolean).join("\n");

  const r = await askClaude<{ reply: string; fixes?: ReorderFix[] }>({
    task: "order_chat", model: s.assistant.ai.model, maxTokens: 1500, timeoutMs: 55_000, admin, images, documents,
    ctx: { order_id: orderId, customer_id: o.customer_id, by },
    tool: { name: "answer", description: "Your reply to staff, and any fixes to the prints.", input_schema: { type: "object", properties: {
      reply: { type: "string", description: "Plain words, short. Say what you checked and what you found." },
      fixes: { type: "array", description: "Changes to make, one field on one print each; only when staff asked for a change or something is clearly wrong.", items: { type: "object", properties: {
        imprint_id: { type: "string" }, field: { type: "string", enum: ["size", "location", "inks", "colors", "drop"] },
        value: { type: "string" }, why: { type: "string" },
      }, required: ["imprint_id", "field", "value", "why"] } },
    }, required: ["reply"] } },
    system: `${SHOP_CONTEXT(s)}

You're talking an order through with the shop's staff, like a production manager who has the job in front of them. Answer from what's actually on the order, its notes and history, its production files and the files attached (the old job's art or mockup, the job's film at real print size, the art on each print, our mockup). Be honest about what was and wasn't done: e.g. a print whose notes say "Size from the film: X" had its size taken from the film; one with "size off the film" in its line did too; if no film is in the production files, say none was found. When you look at a film, read the art's size on it (films are 1:1 print size) and compare with the print's size.
If staff ask for a change, or something is clearly wrong, suggest fixes (one field on one print, using the print ids given). Sizes like 6.25" wide; locations from: ${LOCATIONS.join(", ")}; inks comma separated (PMS names when known); colors a number; drop in inches below the collar.
Keep replies short: a few sentences, no headings.`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const ids = new Set(ims.map((i) => i.id));
  const now = new Date().toISOString();
  const messages: ChatMsg[] = [...thread,
    { role: "staff" as const, text: msg, at: now, by },
    { role: "ai" as const, text: String(r.data.reply || "").slice(0, 4000), at: new Date().toISOString(), fixes: (r.data.fixes || []).filter((f) => ids.has(f.imprint_id)).slice(0, 8), ...(lookedUp?.text ? { lookedUp } : {}) },
  ].slice(-60);
  const row = { kind: "order_chat", dedupe_key: `order_chat:${orderId}`, source: "ai", status: "done", priority: 3, order_id: orderId, customer_id: o.customer_id, title: `Order chat #${o.number}`, body: msg.slice(0, 300), payload: { messages }, model: r.model, run_id: r.runId, updated_at: now };
  const { data: had } = await admin.from("ai_suggestions").select("id").eq("dedupe_key", row.dedupe_key).limit(1).maybeSingle();
  if (had) await admin.from("ai_suggestions").update(row).eq("id", had.id);
  else await admin.from("ai_suggestions").insert(row);
  return { ok: true, messages };
}
