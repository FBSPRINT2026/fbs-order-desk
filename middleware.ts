import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Sign-in links can land on any page (e.g. the home page) carrying ?code= or ?token_hash=.
  // Send them to the page that finishes signing in.
  const sp = request.nextUrl.searchParams;
  if ((sp.get("code") || sp.get("token_hash")) && !request.nextUrl.pathname.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    const target = request.nextUrl.pathname === "/login" ? sp.get("next") || "/" : request.nextUrl.pathname;
    url.pathname = "/auth/confirm";
    url.search = "";
    if (sp.get("code")) url.searchParams.set("code", sp.get("code")!);
    if (sp.get("token_hash")) url.searchParams.set("token_hash", sp.get("token_hash")!);
    if (sp.get("type")) url.searchParams.set("type", sp.get("type")!);
    url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }
  let response = NextResponse.next({ request });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Settings missing in Vercel: let pages load so the problem is visible instead of a blank error.
    return response;
  }
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsLogin = path.startsWith("/shop") || path.startsWith("/portal") || path.startsWith("/print");
  if (!user && needsLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/stripe|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
