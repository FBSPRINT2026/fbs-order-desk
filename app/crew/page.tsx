import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobGate } from "@/lib/jobAccess";
import { crewHome } from "@/lib/crewHome";
import JobSignIn from "@/components/job/JobSignIn";
import CrewMenu from "@/components/crew/CrewMenu";
import { LangProvider, LANG_COOKIE, type Lang } from "@/components/job/lang";

export const dynamic = "force-dynamic";

/**
 * The crew phone's main menu (portal.fbsprint.com/crew, the QR on the wall; Nick, Nov 13 2026): sign in once with your
 * employee # and PIN on the shop's Wi-Fi, then your view (Receiving, Press operator, Assistant, Catcher, Office): the
 * time clock and fixes to your time card, your press's jobs today, what's to count in, and Scan a job. A scanned work
 * order opens the job's menu (/j/<number>), which has Main menu at the top to come back here.
 */
export default async function CrewPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const gate = await jobGate();
  const who = gate.who;
  const admin = createAdminClient();
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  let lang: Lang = saved === "es" || saved === "en" ? saved : "en";
  if (!saved && who?.employeeId) { const { data: e } = await admin.from("employees").select("lang").eq("id", who.employeeId).maybeSingle(); if (e?.lang === "es") lang = "es"; }
  const wrap = (el: React.ReactNode) => <LangProvider initial={lang} employee={who?.kind === "employee"}>{el}</LangProvider>;
  if (!who) return wrap(<JobSignIn code="" offNetwork={gate.offNetwork} />);
  const home = await crewHome(admin, who, (await searchParams).day === "next");
  return wrap(<CrewMenu home={home} />);
}
