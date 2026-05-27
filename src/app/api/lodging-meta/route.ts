import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/lodging-meta — fetch a listing URL and extract OpenGraph
 * metadata (title, description, image) for the Add Property modal.
 *
 * Why server-side: VRBO / Airbnb pages block client-side fetches via
 * CORS, and shipping a parsing library to the browser is overkill for
 * a simple meta tag pluck. We fetch with a realistic User-Agent so the
 * host returns the public HTML, then regex out a handful of og:* tags.
 *
 * Best-effort: any failure (network, non-2xx, no tags found) returns
 * `{ ok: false, reason }`. The client treats that as "user fills the
 * form by hand" and doesn't surface the error loudly.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  // Cheap validation — bail before opening a socket on garbage input.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_url" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ ok: false, reason: "invalid_protocol" }, { status: 400 });
  }

  // SSRF guard — the caller controls the URL, so refuse anything that
  // could point at our own infrastructure (loopback, private RFC-1918,
  // link-local, IPv6 loopback / unique-local). Edge runtime has no DNS
  // module so this is a hostname-string check only; good enough to
  // block the obvious cases (localhost, 127.x, 10.x, 192.168.x, etc.)
  // — DNS rebinding is a separate concern we punt on.
  const host = parsed.hostname.toLowerCase();
  const blockedHost =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^0\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd");
  if (blockedHost) {
    return NextResponse.json({ ok: false, reason: "blocked_host" }, { status: 400 });
  }

  // Hard cap the fetch so a slow / hung host can't pin a route handler
  // open. 6s is generous for og-tag pluck; if a host is slower than
  // that the user will fill the form anyway.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  let html: string;
  try {
    const res = await fetch(parsed.toString(), {
      method: "GET",
      headers: {
        // Many travel sites (VRBO especially) return a stripped page or
        // a captcha to obvious bots. A modern desktop UA gets the same
        // HTML a real visitor sees, including <meta property="og:*">.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: `http_${res.status}` },
        { status: 200 }
      );
    }
    // Only read the first ~256KB — og tags live in <head>, anything
    // past that is page body we'd discard anyway. Caps memory if a
    // host returns a megabytes-long HTML doc.
    const reader = res.body?.getReader();
    if (!reader) {
      return NextResponse.json({ ok: false, reason: "no_body" }, { status: 200 });
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const cap = 256 * 1024;
    while (bytes < cap) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
    }
    reader.cancel().catch(() => {});
    html = new TextDecoder("utf-8").decode(
      chunks.reduce((acc, c) => {
        const combined = new Uint8Array(acc.length + c.length);
        combined.set(acc, 0);
        combined.set(c, acc.length);
        return combined;
      }, new Uint8Array())
    );
  } catch (err) {
    clearTimeout(timer);
    const reason =
      err instanceof Error && err.name === "AbortError" ? "timeout" : "fetch_error";
    return NextResponse.json({ ok: false, reason }, { status: 200 });
  }
  clearTimeout(timer);

  // ── Tag pluck. ────────────────────────────────────────────────────
  //
  // We deliberately don't pull in a full HTML parser; the og:* tags we
  // need follow a tight enough pattern that regex is faster + lighter.
  // Strategy:
  //   1. og:* — preferred (explicit, what publishers maintain)
  //   2. <meta name="twitter:..."> — common fallback
  //   3. <title>...</title> — last-resort name source
  const ogTag = (prop: string) => {
    // Match either property=".." content=".." or content=".." property=".."
    const a = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const b = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
      "i"
    );
    return html.match(a)?.[1] ?? html.match(b)?.[1] ?? null;
  };

  const title =
    ogTag("og:title") ??
    ogTag("twitter:title") ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
    null;

  const description =
    ogTag("og:description") ??
    ogTag("twitter:description") ??
    ogTag("description") ??
    null;

  // og:image can be either a property or itemprop tag; prefer the
  // explicit og:image and ignore obvious placeholders (1x1 trackers,
  // sprite sheets, etc. — rough check on filename).
  let image = ogTag("og:image") ?? ogTag("twitter:image") ?? null;
  if (image && /\.(svg|gif)(\?|$)/i.test(image)) image = null;

  // siteName helps the client pick a nice "this looks like a VRBO link"
  // label even when og:title is generic ("Vacation Rental").
  const siteName = ogTag("og:site_name") ?? null;

  // HTML-entity decode the bits we hand back — og:title often contains
  // &amp; / &#x27; / &quot; literals that read as garbage in an input.
  const decode = (s: string | null) =>
    s
      ? s
          .replace(/&amp;/g, "&")
          .replace(/&#39;|&apos;|&#x27;/gi, "'")
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
      : s;

  return NextResponse.json({
    ok: true,
    title: decode(title),
    description: decode(description),
    image,
    siteName: decode(siteName),
  });
}
