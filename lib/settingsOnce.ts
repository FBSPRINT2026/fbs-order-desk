import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The shop's settings row, read once per page (Nick, Nov 16 2026: the crew's phone screens were slow: the same row was
 * read four or five times for one page). Outside a page render (a route handler) it simply reads it each call.
 */
export const settingsData = cache(async (): Promise<unknown> => {
  const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
  return (data?.data as unknown) ?? null;
});
