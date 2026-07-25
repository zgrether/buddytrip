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
    // /api/trpc gets a 401, NOT a 307 (DATA_FRESHNESS_AUDIT.md §8-F1). `fetch`
    // follows a redirect preserving the method, so the old 307 rendered a full
    // /login PAGE and handed a tRPC client unparseable HTML — one Edge
    // invocation plus a complete page render, returning nothing usable
    // (~1,150 /login renders in one measured 30-minute window, the single
    // largest CPU line item). The route STAYS in the matcher: middleware is the
    // confirmed token-refresh path (§6.3) — getUser() above rotates cookies via
    // setAll for a user whose access token expired while they only polled, and
    // excluding /api/trpc would delete that, stranding the browser on a
    // consumed refresh token (Supabase rotates them) = a hard mid-round logout.
    //
    // The body is the FULL tRPC error envelope, not a convenience shape. The
    // client's transformResult() rejects anything whose `error` isn't an object
    // with a NUMERIC `code`, throwing TransformResultError — which surfaces as a
    // TRPCClientError with `data: undefined`, so the authExpiry handler's
    // `data.code === "UNAUTHORIZED"` check would never match and the recovery
    // would be silently inert. Verified against the installed @trpc/client +
    // superjson. Shape matches authedProcedure's own UNAUTHORIZED (trpc.ts:100)
    // so the handler can't tell the two apart. Non-array is deliberate:
    // httpBatchLink fans a single object out to every op in the batch.
    if (request.nextUrl.pathname.startsWith("/api/trpc")) {
      const body = {
        error: {
          json: {
            message: "UNAUTHORIZED",
            code: -32001, // TRPC_ERROR_CODES_BY_KEY.UNAUTHORIZED
            data: { code: "UNAUTHORIZED", httpStatus: 401 },
          },
        },
      };
      // Carry over anything setAll wrote. On a definitively dead session
      // getUser() → _removeSession() → SIGNED_OUT → setAll writes cookie
      // DELETIONS onto supabaseResponse; the old redirect discarded them, so the
      // browser kept re-sending a known-dead token on every request. (A rotated
      // -cookie refresh can't land here — a successful refresh returns a user.)
      const res = NextResponse.json(body, { status: 401 });
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        res.cookies.set(cookie);
      });
      return res;
    }

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
