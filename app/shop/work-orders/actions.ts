"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** marks work orders printed (Work Orders page; Nick, Nov 13 2026: so nobody prints one twice); kept two weeks */
export async function markWorkOrdersPrinted(ids: string[]): Promise<void> {
  const v = await getViewer().catch(() => null);
  if (!v?.user || !v.isStaff) return;
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (data?.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString(), cut = Date.now() - 14 * 86400000;
  const cur = Object.fromEntries(Object.entries((d.woPrinted || {}) as Record<string, string>).filter(([, at]) => Date.parse(at) > cut));
  for (const id of ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200)) cur[id] = now;
  await admin.from("settings").update({ data: { ...d, woPrinted: cur } }).eq("id", 1);
}
