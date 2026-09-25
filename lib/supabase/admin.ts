import { SUPABASE_URL } from "@/lib/config";
import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Full-access client for trusted server code only (never sent to a browser).
 * Every use must check first that the viewer is allowed to act on the record.
 */
export function createAdminClient() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
