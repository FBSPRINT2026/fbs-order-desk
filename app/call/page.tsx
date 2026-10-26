import { redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { ScreenCall } from "@/components/ScreenShare";

/**
 * The support call's own window (Oct 26, Nick: refreshing the portal ended the call): sharing (?share=1, &s= the
 * session once it's started) or watching (?watch=<session>). Shop staff only.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Support call · FBS" };

export default async function CallPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await getViewer(", name");
  if (!v.user) redirect(`/login?next=${encodeURIComponent("/call" + (sp.watch ? `?watch=${sp.watch}` : "?share=1"))}`);
  if (!v.isStaff) redirect("/portal");
  const ok = (x?: string) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
  const watch = ok(sp.watch);
  return <ScreenCall email={v.email} name={String(v.staff?.name || "")} mode={watch ? "watch" : "share"} sessionId={watch || ok(sp.s)} note={String(sp.note || "")} />;
}
