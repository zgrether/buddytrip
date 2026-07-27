"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAppView, type AppView } from "./useAppView";
import { AppTabBar } from "./AppTabBar";
import { LockedTabExplainer } from "./LockedTabExplainer";

/**
 * AppShell — the persistent frame for the four-tab navigation (Phase 3).
 *
 * ── Scope, stated precisely: persistent WITHIN a context, not across ─────────
 * Trip ↔ Cup ↔ Chat are free: same route, no server round trip, no remount —
 * the shell and all three surfaces stay mounted and only the visible one
 * changes. **Home is a navigation**, because Home is context-free and lives on
 * `/dashboard` while the other three are scoped to `/trips/[tripId]`.
 *
 * That is a deliberate trade, not an oversight. Context switches are rare and
 * heavy by nature, and keeping them on a ROUTE boundary is what preserves the
 * anti-flash guarantee below. Don't read "no reload between tabs" as covering
 * Home — it doesn't, and it isn't meant to.
 *
 * ── Anti-flash: why a context switch stays a route change ────────────────────
 * Measured on the running app: with the trip page's 8-query gate DISABLED, a
 * trip switch still showed zero frames of trip A's content under trip B's
 * header, because `app/trips/[tripId]/loading.tsx` covers the navigation — Next
 * tears the segment down and rebuilds it. So the thing actually preventing the
 * bleed today is the ROUTE BOUNDARY, and the gate is belt-and-braces on top of
 * it. (Supporting: nothing in `src` uses `keepPreviousData`/`placeholderData`
 * and no surface mirrors a list query into local state, so a re-key yields
 * `undefined` rather than the previous trip's rows.)
 *
 * Keeping the context switch as a route change therefore keeps that guarantee
 * intact, which is what lets Phase 4 remove the gate without reintroducing the
 * bleed the gate was written for.
 */
export function AppShell({
  /** Current trip context, or null on the context-free host (`/dashboard`). */
  tripId,
  home,
  trip,
  cup,
  chat,
}: {
  tripId: string | null;
  home: ReactNode;
  trip?: ReactNode;
  cup?: ReactNode;
  chat?: ReactNode;
}) {
  const router = useRouter();
  const { view, setView } = useAppView();
  const [peeking, setPeeking] = useState<Exclude<AppView, "home"> | null>(null);
  const hasContext = !!tripId;

  const select = useCallback(
    (next: AppView) => {
      setPeeking(null);
      // Home is context-free and lives on its own route — see the scope note.
      if (next === "home") {
        router.push("/dashboard");
        return;
      }
      setView(next);
    },
    [router, setView],
  );

  const effectiveView: AppView = hasContext ? view : "home";

  let body: ReactNode;
  if (peeking) {
    body = <LockedTabExplainer view={peeking} onPickTrip={() => setPeeking(null)} />;
  } else if (!hasContext) {
    body = home;
  } else {
    /**
     * All three scoped surfaces stay MOUNTED; only visibility changes. That is
     * what makes a tab switch free — no remount, no refetch, scroll preserved.
     *
     * `key={tripId}` is INERT TODAY and is documentation of intent, not active
     * defence: while the route boundary stands, each route instance only ever
     * sees ONE tripId, so the key never observes a change and never forces a
     * remount. It becomes load-bearing ONLY if the shell later collapses to a
     * single host where `tripId` changes underneath a mounted tree — at which
     * point it is the thing that stops trip A's content rendering under trip
     * B's header. Do not read it as protecting you before that change; do not
     * remove it while making that change.
     */
    body = (
      <div key={tripId ?? "no-context"}>
        <div hidden={effectiveView !== "trip"}>{trip}</div>
        <div hidden={effectiveView !== "cup"}>{cup}</div>
        <div hidden={effectiveView !== "chat"}>{chat}</div>
      </div>
    );
  }

  return (
    <>
      <div style={{ paddingBottom: "calc(var(--bt-bottomnav-height, 0px) + 8px)" }}>{body}</div>
      <AppTabBar
        active={peeking ?? effectiveView}
        hasContext={hasContext}
        onSelect={select}
        onLockedTap={(v) => setPeeking(v as Exclude<AppView, "home">)}
      />
    </>
  );
}
