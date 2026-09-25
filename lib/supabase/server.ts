import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client acting as the signed-in user (row security applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component; the middleware refreshes sessions instead.
        }
      },
    },
  });
}

/** The signed-in user plus whether they are shop staff. */
export async function getViewer() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, email: "", isStaff: false };
  const email = (user.email || "").toLowerCase();
  const { data } = await supabase.from("staff").select("email").eq("email", email).maybeSingle();
  return { supabase, user, email, isStaff: !!data };
}
