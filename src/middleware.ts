import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Validate the session against the auth server. getUser() re-verifies the JWT
  // (and refreshes it, writing fresh cookies via setAll above) rather than
  // trusting whatever the cookie decodes to. getSession() only reads the cookie
  // locally — so an orphaned/expired auth cookie read as "logged in" and
  // bounced users off /login into a redirect dead-end. Supabase also flags
  // server-side getSession() as insecure for exactly this reason.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to /login (except for public routes).
  // The root route `/` serves the marketing page for unauthenticated visitors
  // and bounces authenticated users to their most relevant trip via the
  // client-side wrapper at src/app/page.tsx.
  const isPublicRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/privacy" ||
    request.nextUrl.pathname === "/terms" ||
    request.nextUrl.pathname.startsWith("/auth/") ||
    request.nextUrl.pathname.startsWith("/scoreboard/") ||
    request.nextUrl.pathname.startsWith("/invite");

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from /login
  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // manifest.webmanifest + sw.js are excluded like favicon.ico: they must be
    // publicly fetchable (Android install + SW registration send no auth
    // context), and without the exclusion the auth check 307'd them to /login.
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
