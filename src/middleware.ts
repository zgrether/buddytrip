import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isObviouslyBogusPath } from "@/lib/botPaths";
import { safeNextPath } from "@/lib/nextPath";

export async function middleware(request: NextRequest) {
  // Credential scanners, 404'd at the edge BEFORE anything else. They were being
  // 307'd to /login like any other unauthenticated request; the scanner follows the
  // redirect and we pay a full serverless page render so someone can check whether
  // we leak AWS keys. 76 distinct such paths in one 3-hour production window.
  //
  // Deliberately the FIRST thing in the function — ahead of the Supabase client and
  // `getUser()` — so a bogus path costs one edge invocation and no auth round-trip.
  // Nothing legitimate reaches here: the rules key on shapes the App Router cannot
  // produce, never on observed scanner names (see `botPaths.ts` for why, and for the
  // tRPC batch-URL case that makes the dotfile rule `startsWith`, not `includes`).
  //
  // This is also the CLASS fix for a bug patched narrowly twice before —
  // `manifest.webmanifest`, then `/api/trpc` — each time by naming the one thing
  // that broke.
  if (isObviouslyBogusPath(request.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404 });
  }

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

    // Carry WHERE THEY WERE GOING across the bounce. Without this, every deep
    // link to a signed-out browser is a dead end that lands on /login with the
    // destination discarded — which is what an existing-account invite email
    // (`sendInviteExistingUser`, a plain `/trips/{id}` link with no token) did
    // to anyone who wasn't already signed in on that device.
    //
    // Deliberately generic: this is the same `?next=` chain an involuntary
    // session expiry already uses (authExpiry.ts), so a link to a trip, a game,
    // or a competition all survive re-auth the same way, and nothing here knows
    // what an invite is. `safeNextPath` on the READ side (login/page.tsx,
    // auth/callback) is what makes honoring it safe — this side only has to
    // avoid writing a useless one.
    const url = request.nextUrl.clone();
    const intended = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = "";
    // "/" is where login lands anyway, so a next of "/" is pure URL noise.
    if (intended !== "/") url.searchParams.set("next", intended);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from /login — honoring `?next=` so a deep
  // link opened on a device that already has a session goes where it points
  // instead of being flattened to "/". Same param, same chain; the destination
  // is validated by whatever serves it, and a bogus one just 404s in-app rather
  // than leaving the origin (see nextPath.ts).
  if (user && request.nextUrl.pathname === "/login") {
    const requested = safeNextPath(request.nextUrl.searchParams.get("next"));
    const url = request.nextUrl.clone();
    url.search = "";
    url.hash = "";
    url.pathname = "/";
    return NextResponse.redirect(requested ? new URL(requested, request.nextUrl.origin) : url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // manifest.webmanifest + sw.js are excluded like favicon.ico: they must be
    // publicly fetchable (Android install + SW registration send no auth
    // context), and without the exclusion the auth check 307'd them to /login.
    //
    // robots.txt + sitemap.xml join them, and were a LIVE bug rather than a cost
    // problem: both were 307'd to /login, which then answered 200 with an HTML
    // page. A crawler asking for robots.txt got a redirect chain ending in
    // markup, so search engines could not read this site's robots.txt at all.
    // They are crawler-facing by definition and must never be auth-gated.
    //
    // NB there is no `robots.ts`/`sitemap.ts` in `src/app`, so both now answer
    // with Next's 404 — which is the CORRECT response for a crawler (an absent
    // robots.txt means "no restrictions"), and is what it should have been all
    // along. Adding a real robots.txt/sitemap is a separate product call.
    //
    // `favicon.ico` is escaped now; it was `favicon.ico` with a bare `.`, which
    // matches any character. Cosmetic — no route was affected either way.
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
