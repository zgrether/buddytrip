"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flag, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { Spinner } from "@/components/Spinner";
import { useIsShellDesktop, RAIL_WIDTH_PX } from "./breakpoints";

/**
 * ContextRail — Home promoted from a tab to a persistent left rail (Phase 5).
 *
 * On mobile there is no room for a permanent context switcher, so Home is a tab.
 * On desktop there is, so it is always visible and Trip/Cup/Chat become content
 * tabs beside it. Same model either way: this is the ONLY thing that changes
 * context.
 *
 * The rail is `hidden lg:flex` — CSS, not a JS branch, so crossing the
 * breakpoint reflows rather than remounting the content beside it.
 *
 * `trips.list` is gated on the breakpoint because CSS can hide an element but
 * cannot stop it fetching, and a phone should not pay for a rail it will never
 * show. Gating a QUERY on a media query is safe in a way that gating a TREE is
 * not: crossing the breakpoint enables the query, it doesn't rebuild anything.
 * The key is shared with the dashboard, so it's usually warm already.
 */

interface TripRow {
  id: string;
  title: string;
  locked_destination_location?: string | null;
  location?: string | null;
  myRole?: string | null;
}

export function ContextRail({ activeTripId }: { activeTripId: string | null }) {
  const router = useRouter();
  const isDesktop = useIsShellDesktop();
  const { data: trips = [] } = trpc.trips.list.useQuery(undefined, {
    ...STRUCTURE_QUERY,
    enabled: isDesktop,
  });

  const rows = trips as TripRow[];

  // Which row is mid-switch. `useTransition` is the same mechanism `TripCard`
  // uses — it tracks router.push from click to the new route rendering, so the
  // flag paints immediately rather than after the route bundle loads. The id is
  // held alongside it because `isPending` alone can't say WHICH row was tapped,
  // and lighting up the whole rail would be worse than lighting up none of it.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [isSwitching, startSwitch] = useTransition();
  const pendingTripId = isSwitching ? switchingTo : null;

  const openTrip = (id: string) => {
    // Re-tapping the trip you're already in is a no-op today (Next renders the
    // same route and nothing moves), so don't flash a spinner that would never
    // resolve into a visible change.
    if (id === activeTripId) return;
    setSwitchingTo(id);
    startSwitch(() => {
      router.push(`/trips/${id}`);
    });
  };

  return (
    /**
     * `lg:flex lg:flex-col` + `min-h-0` + an inner scroll body, rather than one
     * `overflow-y-auto` box: the aside now FILLS the bounded shell column
     * (AppShell's root is `lg:h-dvh` and every flex ancestor carries `min-h-0`),
     * so the rail is viewport-height with 2 trips or 20, and only its body
     * scrolls — it can never push the page taller. Before this it had
     * `overflow-y-auto` with no bounded height, which does nothing: the box just
     * grew to its content, and `lg:items-stretch` on the parent stretched it to
     * whatever the CONTENT column happened to be.
     */
    <aside
      className="hidden shrink-0 flex-col lg:flex lg:min-h-0"
      style={{
        width: RAIL_WIDTH_PX,
        background: "var(--color-bt-card)",
        borderRight: "1px solid var(--color-bt-border)",
      }}
      data-testid="context-rail"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <Eyebrow>Your trips</Eyebrow>
      {rows.map((t) => {
        const current = t.id === activeTripId;
        return (
          <RailTripRow
            key={t.id}
            trip={t}
            current={current}
            pending={pendingTripId === t.id}
            onOpen={() => openTrip(t.id)}
          />
        );
      })}

      <RailAction icon={<Flag size={14} />} label="Start a trip" onClick={() => router.push("/trips/new")} />

      <Eyebrow className="mt-5">Games</Eyebrow>
      <RailAction
        icon={<Trophy size={14} />}
        label="Play a game"
        onClick={() => router.push("/quick-game")}
      />
      </div>
    </aside>
  );
}

/**
 * One trip row, with the in-row pending state the dashboard's cards already had.
 *
 * The rail lost the affordance the dashboard shipped with (`TripCard`'s
 * `useTransition` + spinner): tapping a row called `router.push` bare, so nothing
 * acknowledged the tap and the row sat inert until the main pane transformed a
 * second later. It matters MORE here than it did on the dashboard, because the
 * rail stays on screen for the whole switch — the unresponsive row is visible the
 * entire time, next to the thing that is visibly working.
 *
 * Same mechanism as `TripCard`, not a second one: `useTransition` tracks Next's
 * `router.push` from click through to the new route rendering, which is what makes
 * the pending flag paint within a frame instead of waiting on the route bundle.
 * Only the TAPPED row shows it — the pending id is compared per row, so the rest
 * of the rail stays live and you can still change your mind.
 */
function RailTripRow({
  trip,
  current,
  pending,
  onOpen,
}: {
  trip: TripRow;
  current: boolean;
  pending: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={current || undefined}
      aria-busy={pending || undefined}
      onClick={onOpen}
      disabled={pending}
      data-testid="rail-trip"
      data-pending={pending || undefined}
      className="relative mb-1 flex w-full items-center gap-2.5 rounded-[9px] p-2.5 text-left transition-colors"
      style={{
        background: current ? "var(--color-bt-accent-faint)" : "transparent",
        border: `1px solid ${current ? "var(--color-bt-accent-border)" : "transparent"}`,
        cursor: pending ? "wait" : "pointer",
      }}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
        style={{
          background: current ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
          color: current ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
          // The avatar is where the spinner lands, so fade it rather than the
          // whole row — the title stays readable while the switch is in flight.
          opacity: pending ? 0 : 1,
        }}
      >
        {initials(trip.title)}
      </span>
      {pending && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-2.5 grid h-7 w-7 place-items-center"
        >
          <Spinner />
        </span>
      )}
      <span className="min-w-0 flex-1" style={{ opacity: pending ? 0.6 : 1 }}>
        <span className="block truncate text-[13px] font-semibold">{trip.title}</span>
        <span
          className="block truncate text-[10.5px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {trip.locked_destination_location ?? trip.location ?? "No destination yet"}
        </span>
      </span>
    </button>
  );
}

function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`mb-2 ml-1 text-[10px] font-bold uppercase ${className}`}
      style={{ color: "var(--color-bt-text-dim)", letterSpacing: "0.1em" }}
    >
      {children}
    </div>
  );
}

function RailAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 flex w-full items-center justify-center gap-2 rounded-[9px] p-2.5 text-[12.5px] font-semibold"
      style={{
        border: "1px dashed var(--color-bt-border)",
        color: "var(--color-bt-text-dim)",
        background: "transparent",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
