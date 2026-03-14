"use client";

import type { FC } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Calendar } from "lucide-react";
import { StatusBadge, getTripStatus } from "./StatusBadge";
import { RoleBadge } from "./RoleBadge";
import { parseLocalDate } from "@/lib/dates";
import { trpc } from "@/lib/trpc-client";
import type { TripRole } from "@/server/middleware";

interface Trip {
  id: string;
  title: string;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  locked_destination_title?: string | null;
  myRole?: TripRole | null;
}

interface TripCardProps {
  trip: Trip;
  unreadCount?: number;
}

function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return "Dates TBD";
  const fmt = (d: string) =>
    parseLocalDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}

function getDaysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = parseLocalDate(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export const TripCard: FC<TripCardProps> = ({ trip, unreadCount = 0 }) => {
  const router = useRouter();
  const utils = trpc.useUtils();
  const status = getTripStatus(trip);

  const handleClick = () => {
    // Seed the getById cache with data we already have so the detail page
    // renders immediately instead of showing a loading spinner.
    const { myRole, myStatus, ...tripData } = trip as Trip & {
      myStatus?: string | null;
      [key: string]: unknown;
    };
    utils.trips.getById.setData({ tripId: trip.id }, tripData);
    router.push(`/trips/${trip.id}`);
  };

  return (
    <button
      data-testid={`trip-card-${trip.id}`}
      onClick={handleClick}
      className="w-full rounded-xl p-4 text-left transition-all hover:ring-1"
      style={{
        background: "var(--color-bt-card)",
        borderColor: "var(--color-bt-border)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          {trip.myRole && <RoleBadge role={trip.myRole} />}
        </div>
        {unreadCount > 0 && (
          <span
            className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>

      {/* Title */}
      <h3
        className="mt-2 text-base font-semibold leading-tight"
        style={{ color: "var(--color-bt-text)" }}
      >
        {trip.title}
      </h3>

      {/* Meta row */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {(trip.location || trip.locked_destination_title) && (
          <span className="flex items-center gap-1" style={{ color: "var(--color-bt-text-dim)" }}>
            <MapPin size={12} />
            {trip.locked_destination_title ?? trip.location}
          </span>
        )}
        <span className="flex items-center gap-1" style={{ color: "var(--color-bt-text-dim)" }}>
          <Calendar size={12} />
          {formatDateRange(trip.start_date, trip.end_date)}
        </span>
      </div>

      {/* Countdown strip for "ready" trips */}
      {status === "ready" && trip.start_date && (
        <div
          className="mt-3 rounded-md px-3 py-1.5 text-center text-xs font-medium"
          style={{ background: "var(--color-bt-ready-bg)", color: "var(--color-bt-ready)" }}
        >
          {getDaysUntil(trip.start_date) <= 0
            ? "Starting today!"
            : `${getDaysUntil(trip.start_date)} days until departure`}
        </div>
      )}

      {/* Live indicator strip */}
      {status === "live" && (
        <div className="mt-3 flex items-center gap-1.5">
          <span
            className="h-2 w-2 animate-pulse rounded-full"
            style={{ background: "var(--color-bt-accent)" }}
          />
          <span className="text-xs font-medium" style={{ color: "var(--color-bt-accent)" }}>
            In progress
          </span>
        </div>
      )}
    </button>
  );
};
