import type { MetadataRoute } from "next";

/**
 * PWA manifest (PWA Phase 1) — makes the app installable on Android
 * (Chrome install prompt) and gives iOS Home-Screen installs a proper
 * standalone identity. Served by Next at /manifest.webmanifest and
 * auto-linked in <head>.
 *
 * Raw hex here is unavoidable (a manifest can't read CSS variables) —
 * the values ARE the dark-palette tokens: #0a0e1a = --color-bt-base
 * (dark). The app is dark-mode-forced, so the splash/background must
 * match the dark page background or launch flashes white.
 *
 * start_url "/" is correct as-is: the root route server-redirects an
 * authed user to their last-visited trip (or /dashboard) and shows the
 * marketing/login page otherwise — exactly the right open behavior for
 * an installed app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BuddyTrip",
    short_name: "BuddyTrip",
    description: "Group trip planning and competition scoring",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e1a",
    theme_color: "#0a0e1a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Separate maskable variant — glyph scaled into the 80% safe-zone
      // circle so Android's adaptive-icon masking never clips the flag.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
