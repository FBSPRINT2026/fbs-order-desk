import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkArtForEmail } from "@/lib/linkArt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Art sent as a link (Canva, Dropbox, Google Drive) → saved with the email like an attachment (lib/linkArt.ts).
 *   POST { activity, force? }  staff: read the email's links now
 *   GET  ?activity=…&t=…       the shop's tooling token (integration_tokens "tooling", short-lived, set by the owner
 *                              or Claude for a one-off check): same, plus &file=N&part=P returns that saved file in
 *                              base64 pieces (so it can be looked at without a sign-in)
 */
async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }

export async function POST(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { activity, force } = await req.json().catch(() => ({}));
  const r = await linkArtForEmail(createAdminClient(), String(activity || ""), { force: !!force });
  return NextResponse.json(r);
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const admin = createAdminClient();
  const { data: tk } = await admin.from("integration_tokens").select("data").eq("name", "tooling").maybeSingle();
  const t = (tk?.data || {}) as { token?: string; expires_at?: string };
  if (!t.token || !t.expires_at || t.expires_at < new Date().toISOString() || q.get("t") !== t.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  // a look at what a link answers with (status, where it sends you, the start of the page): for teaching new wrappers
  if (q.get("peek")) {
    const r = await fetch(q.get("peek")!, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" }, signal: AbortSignal.timeout(15_000) }).catch((e) => e as Error);
    if (r instanceof Error) return NextResponse.json({ error: r.message });
    const body = await r.text().catch(() => "");
    return NextResponse.json({ status: r.status, location: r.headers.get("location"), type: r.headers.get("content-type"), body: body.slice(0, 6000) });
  }
  // the emailprotection hand-off step by step (what the WebSocket says), for troubleshooting
  if (q.get("wsdebug")) {
    const log: string[] = [];
    const WS = (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;
    log.push(`node ${process.version}, WebSocket ${WS ? "yes" : "no"}`);
    const r = await fetch(q.get("wsdebug")!, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" } });
    const html = await r.text(); const info = html.match(/data-urlinfo=["']([^"']+)["']/i)?.[1];
    log.push(`page ${r.status}, urlinfo ${info ? info.length : 0} chars, set-cookie ${r.headers.get("set-cookie") ? "yes" : "no"}`);
    if (WS && info) {
      await new Promise<void>((done) => {
        const sock = new WS(`wss://${new URL(q.get("wsdebug")!).host}/scanning`);
        const t = setTimeout(() => { log.push("timeout"); try { sock.close(); } catch { /* */ } done(); }, 30_000);
        sock.onopen = () => { log.push("open"); sock.send(info); };
        sock.onerror = (e) => { log.push(`error ${String((e as unknown as { message?: string }).message || e.type)}`); };
        sock.onclose = (e) => { log.push(`close ${e.code} ${e.reason}`); clearTimeout(t); done(); };
        sock.onmessage = (e) => { log.push(`msg ${String(e.data).slice(0, 600)}`); if (/redirect/.test(String(e.data))) { clearTimeout(t); try { sock.close(); } catch { /* */ } done(); } };
      });
    }
    return NextResponse.json({ log });
  }
  const id = q.get("activity") || "";
  if (q.get("file") != null) {
    const { data: a } = await admin.from("activities").select("meta").eq("id", id).maybeSingle();
    const f = ((a?.meta as { attachments?: { path: string; name: string; type: string }[] } | null)?.attachments || [])[+(q.get("file") || 0)];
    if (!f) return NextResponse.json({ error: "No such file" }, { status: 404 });
    const { data: blob } = await admin.storage.from("proofs").download(f.path);
    if (!blob) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64"), size = 60_000, part = +(q.get("part") || 0);
    return new NextResponse(`${f.name}|${f.type}|${part}|${Math.ceil(b64.length / size)}|${b64.slice(part * size, (part + 1) * size)}`, { headers: { "content-type": "text/plain" } });
  }
  const r = await linkArtForEmail(admin, id, { force: q.get("force") === "1" });
  return NextResponse.json(r);
}
