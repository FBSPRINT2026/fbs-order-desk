import { createAdminClient } from "@/lib/supabase/admin";
import { customerHandles, deviceFor, handleForms, purgeOurOwn, sha } from "@/lib/texts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** FBS Texts (the Mac): the customers' numbers and emails, in the forms Messages uses. Plain text: "v <version>", then one per line. */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const d = await deviceFor(admin, req);
  if (!d) return new Response("Not a known Mac (set it up again from Settings > Texts).", { status: 401 });
  const keys = [...(await customerHandles(admin)).keys()].sort();
  const forms = [...new Set(keys.flatMap(handleForms))];
  await admin.from("text_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", d.id);
  await purgeOurOwn(admin).catch(() => 0);
  return new Response(`v ${sha(keys.join(",")).slice(0, 16)}\n${forms.join("\n")}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
