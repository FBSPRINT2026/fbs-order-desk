import type { ReactNode } from "react";
import StationShell from "@/components/StationShell";
import { stationOf } from "@/lib/stations";
import { getViewer } from "@/lib/supabase/server";

// a job's phone menu opened on a shop computer (FBS-PRESS) keeps the shop computers' top bar (Nick, Nov 23 2026)
export default async function JobLayout({ children }: { children: ReactNode }) {
  const v = await getViewer().catch(() => null);
  const station = v?.email ? stationOf(v.email) : null;
  return station ? <StationShell station={station} page={children} /> : <>{children}</>;
}
