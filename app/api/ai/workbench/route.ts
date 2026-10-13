import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import { runWorkbench } from "@/lib/ai/workbench";
import type { WBEvent, WBFile, WBMsg } from "@/lib/ai/workbenchShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * AI Workbench: one message to the AI. Body { chat?, text, files }. The answer streams back as lines of JSON
 * (what it's doing, its words, the cards it makes) and the chat is saved as it goes.
 */
export async function POST(req: Request) {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) return Response.json({ error: "Staff only." }, { status: 403 });
  const perms = await viewerPerms(v.supabase, v.email, v.role);
  if (!perms.workbench) return Response.json({ error: "The AI Workbench isn't on for you (Settings → User Access)." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const text = String(b.text || "").slice(0, 20000).trim();
  const email = v.email.toLowerCase();
  const admin = createAdminClient();
  let chat: { id: string; title: string; messages: WBMsg[] } | null = null;
  if (b.chat) {
    const { data } = await admin.from("ai_chats").select("id, title, messages").eq("id", String(b.chat)).eq("owner", email).maybeSingle();
    if (data) chat = { id: data.id as string, title: String(data.title || ""), messages: (data.messages || []) as WBMsg[] };
  }
  // the files: only ones uploaded here, numbered on after the chat's earlier files (f1, f2…)
  const had = (chat?.messages || []).flatMap((m) => m.files || []).length;
  const files: WBFile[] = (Array.isArray(b.files) ? b.files : []).filter((f: WBFile) => typeof f?.path === "string" && f.path.startsWith("ai/uploads/") && !f.path.includes(".."))
    .slice(0, 12).map((f: WBFile, i: number) => ({ id: `f${had + i + 1}`, path: f.path, name: String(f.name || "file").slice(0, 120), type: String(f.type || "").slice(0, 100), size: Math.max(0, +f.size || 0),
      ...(typeof f.preview?.path === "string" && f.preview.path.startsWith("ai/uploads/") && !f.preview.path.includes("..") ? { preview: { path: f.preview.path } } : {}) }));
  if (!text && !files.length) return Response.json({ error: "Type something or add a file." }, { status: 400 });
  const userMsg: WBMsg = { role: "user", text, files: files.length ? files : undefined, at: new Date().toISOString() };
  if (!chat) {
    const title = (text || files.map((f) => f.name).join(", ")).replace(/\s+/g, " ").slice(0, 70);
    const { data, error } = await admin.from("ai_chats").insert({ owner: email, title, messages: [userMsg] }).select("id").single();
    if (error || !data) return Response.json({ error: error?.message || "Couldn't start the chat." }, { status: 500 });
    chat = { id: data.id as string, title, messages: [userMsg] };
  } else {
    chat.messages = [...chat.messages, userMsg];
    await admin.from("ai_chats").update({ messages: chat.messages, updated_at: new Date().toISOString() }).eq("id", chat.id);
  }
  const c = chat;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: WBEvent) => { try { ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* the page went away; keep going so the chat is saved */ } };
      emit({ t: "chat", id: c.id, title: c.title });
      let msg: WBMsg;
      try {
        const r = await runWorkbench(admin, { history: c.messages, by: email, name: String((v.staff?.name as string) || ""), emit, deadline: Date.now() + 240_000 });
        msg = { role: "assistant", text: r.text || (r.error ? "" : "Done."), cards: r.cards.length ? r.cards : undefined, at: new Date().toISOString() };
        if (r.error) { msg.text = [msg.text, r.error].filter(Boolean).join("\n\n"); msg.error = true; }
      } catch (e) {
        msg = { role: "assistant", text: `Something went wrong: ${e instanceof Error ? e.message : "error"}`, at: new Date().toISOString(), error: true };
      }
      // read again before saving: a card's button may have changed the chat meanwhile
      const { data } = await admin.from("ai_chats").select("messages").eq("id", c.id).maybeSingle();
      await admin.from("ai_chats").update({ messages: [...((data?.messages || c.messages) as WBMsg[]), msg], updated_at: new Date().toISOString() }).eq("id", c.id);
      emit({ t: "done", msg });
      try { ctrl.close(); } catch { /* closed */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
