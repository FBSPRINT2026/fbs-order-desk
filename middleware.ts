import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Sign-in links can land on any page (e.g. the home page) carrying ?code= or ?token_hash=.
  // Send them to the page that finishes signing in.
  const sp = request.nextUrl.searchParams;
  // (not API routes: Dropbox's sign-in also comes back with ?code=, to /api/dropbox/callback)
  if ((sp.get("code") || sp.get("token_hash")) && !request.nextUrl.pathname.startsWith("/auth/") && !request.nextUrl.pathname.startsWith("/api/")) {
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
  // the Home Screen app opened (its start page, /shop, loaded fresh, not a click inside the portal): straight on to the
  // page chosen on this phone (fbs_app_start, set by "Open the app to Email"; components/AppStart.tsx), before
  // anything is drawn (Oct 15, Nick: "it still goes to the dashboard first, then a few seconds later")
  const start = request.cookies.get("fbs_app_start")?.value || "";
  if (user && path === "/shop" && /^\/shop\/[a-z-]+$/.test(start) && !request.headers.get("rsc") && !request.headers.get("next-router-prefetch") && (request.headers.get("sec-fetch-dest") || "document") === "document" && !request.headers.get("referer")) {
    const url = request.nextUrl.clone();
    url.pathname = start;
    url.search = "";
    // carry the session the sign-in check may have just renewed (Oct 15, Nick: "it keeps logging me out of my phone"):
    // a bare redirect dropped the new tokens, the phone kept the used refresh token, and the next renewal signed it out
    const go = NextResponse.redirect(url, 307);
    response.cookies.getAll().forEach((c) => go.cookies.set(c));
    return go;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sw.js|manifest.webmanifest|iclock|api/stripe|api/health|api/version|api/inbound|api/cron|api/cal/|clipart/|fonts.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
