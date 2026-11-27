import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs on every request: refreshes the login session cookie and
 * sends anyone who is not logged in to /login.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Do not put code between createServerClient and getClaims(): it can cause random logouts.
  // getClaims() checks the login token's signature (and refreshes it when it has expired). With Supabase's
  // JWT signing keys this happens locally, without a round trip to Supabase on every page load.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub } : null;

  const path = request.nextUrl.pathname;
  const isLoginPage = path === "/login";

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path !== "/" ? `?next=${encodeURIComponent(path)}` : "";
    return NextResponse.redirect(url);
  }
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
