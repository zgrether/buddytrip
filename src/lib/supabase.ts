import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ---------------------------------------------------------------------------
// Module-singleton client for Supabase Realtime.
//
// Every useRealtime* hook previously did `useRef(createClient())`, minting a
// fresh client — and therefore a fresh WebSocket — per hook. A page mounting
// chat + notifications + competition + events opened 4+ sockets, defeating
// Supabase's per-client channel multiplexing. Sharing one client lets all
// channels ride a single WebSocket.
//
// Client-side only — must never be called from server code (it reads the
// browser auth/cookie storage via createBrowserClient).
// ---------------------------------------------------------------------------
let realtimeClient: ReturnType<typeof createClient> | null = null;

export function getRealtimeClient() {
  if (!realtimeClient) {
    realtimeClient = createClient();
  }
  return realtimeClient;
}
