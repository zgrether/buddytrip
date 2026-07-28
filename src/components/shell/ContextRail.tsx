"use client";

import { useRouter } from "next/navigation";
import { Flag, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useIsShellDesktop } from "./breakpoints";

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

  return (
    <aside
      className="hidden w-[246px] shrink-0 overflow-y-auto p-3 lg:block"
      style={{
        background: "var(--color-bt-card)",
        borderRight: "1px solid var(--color-bt-border)",
      }}
      data-testid="context-rail"
    >
      <Eyebrow>Your trips</Eyebrow>
      {rows.map((t) => {
        const current = t.id === activeTripId;
        return (
          <button
            key={t.id}
            type="button"
            aria-current={current || undefined}
            onClick={() => router.push(`/trips/${t.id}`)}
            data-testid="rail-trip"
            className="mb-1 flex w-full items-center gap-2.5 rounded-[9px] p-2.5 text-left transition-colors"
            style={{
              background: current ? "var(--color-bt-accent-faint)" : "transparent",
              border: `1px solid ${current ? "var(--color-bt-accent-border)" : "transparent"}`,
            }}
          >
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
              style={{
                background: current ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                color: current ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
              }}
            >
              {initials(t.title)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{t.title}</span>
              <span
                className="block truncate text-[10.5px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {t.locked_destination_location ?? t.location ?? "No destination yet"}
              </span>
            </span>
          </button>
        );
      })}

      <RailAction icon={<Flag size={14} />} label="Start a trip" onClick={() => router.push("/trips/new")} />

      <Eyebrow className="mt-5">Games</Eyebrow>
      <RailAction
        icon={<Trophy size={14} />}
        label="Play a game"
        onClick={() => router.push("/quick-game")}
      />
    </aside>
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
