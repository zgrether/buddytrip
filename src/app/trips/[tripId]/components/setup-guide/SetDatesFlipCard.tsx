"use client";

import { useState, type FC, type ReactNode } from "react";
import { Calendar, RotateCcw, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { DatePickerPanel } from "../../tabs/components/DatePickerPanel";
import { DOMAIN_COLORS } from "@/lib/domainColors";
import type { TripData } from "../../tabs/types";

// ── SetDatesFlipCard ──────────────────────────────────────────────────────
//
// Step 1 of the FreshTripGuide. The card flips in place on tap to reveal a
// compact Pick / Poll date picker (no navigation). Pick mode uses the same
// DatePickerPanel as the DatesSheet, so the lock behaviour stays consistent.
// Poll mode is gated on crew size: under 2 crew the tab shows an
// "Add the crew first" redirect with an Invite-crew CTA + a quiet
// "or just pick the dates yourself" link that flips back to Pick. ≥2 crew
// surfaces a simpler "Set up date poll" hand-off — the full inline poll
// builder lives in DatesSheet (we route there instead of duplicating it).

export interface SetDatesFlipCardProps {
  tripId: string;
  trip: TripData;
  /** Open the existing DatesSheet — used for the Poll branch (>=2 crew)
   *  since the full poll builder already lives there. */
  onOpenDatesSheet?: () => void;
  /** Navigate to the Crew tab — the "Add the crew first" redirect uses
   *  this when crew < 2. */
  onTabChange?: (tab: string) => void;
  /** Set to true once trip.start_date is locked. Renders the done state
   *  (no flip; "Change" link replaces the CTA). */
  done?: boolean;
  /** Summary shown in the done state, e.g. "May 26 – Jun 14". */
  doneSummary?: string;
}

type PickerTab = "pick" | "poll";

const STEP_NUMBER = 1;

export const SetDatesFlipCard: FC<SetDatesFlipCardProps> = ({
  tripId,
  trip,
  onOpenDatesSheet,
  onTabChange,
  done = false,
  doneSummary,
}) => {
  const tint = DOMAIN_COLORS.home;
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<PickerTab>("pick");
  const utils = trpc.useUtils();

  // Crew count — drives the poll-tab gate. Cheap because HomeTab already
  // prefetches tripMembers.list at page load.
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const crewCount = members.length;

  const lockDates = trpc.trips.lockDates.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old
          ? {
              ...old,
              start_date: vars.startDate,
              end_date: vars.endDate,
              poll_mode: false,
            }
          : old,
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      // Lock succeeded — flip back so the card shows the done state.
      setFlipped(false);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const handleSave = (startDate: string, endDate: string) => {
    lockDates.mutate({ tripId, startDate, endDate });
  };

  // ── Front face (default) ──────────────────────────────────────────────
  const front: ReactNode = (
    <div className="flex h-full flex-col">
      <div
        className="mb-3 flex h-20 items-center justify-center overflow-hidden rounded-lg"
        style={{
          background: tint.faint,
          color: tint.color,
          opacity: done ? 0.55 : 1,
        }}
        aria-hidden="true"
      >
        <MiniCalendarThumbnail />
      </div>
      <p
        className="text-[13px] font-semibold leading-tight"
        style={{ color: "var(--color-bt-text)" }}
      >
        Set your dates
      </p>
      {done && doneSummary ? (
        <p
          className="mt-1 text-[12px]"
          style={{ color: tint.color }}
        >
          {doneSummary}
        </p>
      ) : (
        <p
          className="mt-1 text-[11px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Lock a range or poll the crew — bookends the day-by-day timeline.
        </p>
      )}
      <div className="mt-3">
        {done ? (
          <button
            type="button"
            onClick={() => setFlipped(true)}
            className="text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="guide-step-dates-change"
          >
            Change
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setFlipped(true)}
            className="w-full rounded-lg py-2 text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: tint.color,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="guide-step-dates-cta"
          >
            Set dates
          </button>
        )}
      </div>
    </div>
  );

  // ── Back face (flipped — picker) ──────────────────────────────────────
  const back: ReactNode = (
    <div className="flex h-full flex-col">
      {/* Tab strip */}
      <div className="mb-3 inline-flex self-start rounded-lg p-0.5"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        {(["pick", "poll"] as const).map((value) => {
          const active = tab === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors"
              style={
                active
                  ? {
                      background: tint.faint,
                      color: tint.color,
                    }
                  : {
                      background: "transparent",
                      color: "var(--color-bt-text-dim)",
                    }
              }
              data-testid={`guide-dates-tab-${value}`}
            >
              {value === "pick" ? "Pick" : "Poll"}
            </button>
          );
        })}
      </div>

      {tab === "pick" ? (
        <div className="flex-1">
          <DatePickerPanel
            tripId={tripId}
            initialStartDate={trip.start_date ?? null}
            initialEndDate={trip.end_date ?? null}
            onSave={handleSave}
            isSaving={lockDates.isPending}
            onCancel={() => setFlipped(false)}
            showDescription={false}
          />
        </div>
      ) : crewCount < 2 ? (
        // Poll requires ≥2 crew — show the "add the crew first" redirect.
        <div className="flex flex-1 flex-col items-start gap-2">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{
              background: tint.faint,
              color: tint.color,
            }}
            aria-hidden="true"
          >
            <Users size={16} />
          </span>
          <p
            className="text-[13px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            Add the crew first
          </p>
          <p
            className="text-[11px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Polling needs at least two people — invite the crew, then come
            back to set up the date poll.
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onTabChange?.("crew")}
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
              style={{
                background: tint.color,
                color: "var(--color-bt-on-accent, #0d1f1a)",
              }}
              data-testid="guide-dates-poll-invite-crew"
            >
              Invite crew
            </button>
            <button
              type="button"
              onClick={() => setTab("pick")}
              className="text-[11px] transition-opacity hover:opacity-80"
              style={{ color: "var(--color-bt-text-dim)" }}
              data-testid="guide-dates-poll-fallback-pick"
            >
              or just pick the dates yourself
            </button>
          </div>
        </div>
      ) : (
        // ≥2 crew — hand off to the existing poll builder in DatesSheet.
        <div className="flex flex-1 flex-col items-start gap-2">
          <p
            className="text-[13px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            Poll the crew
          </p>
          <p
            className="text-[11px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Propose a few date ranges and the crew votes. Set up the
            options in the dates sheet.
          </p>
          <button
            type="button"
            onClick={() => {
              setFlipped(false);
              onOpenDatesSheet?.();
            }}
            className="mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: tint.color,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="guide-dates-poll-launch"
          >
            Set up date poll →
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setFlipped(false)}
        aria-label="Back"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{ color: "var(--color-bt-text-dim)" }}
        data-testid="guide-dates-flip-back"
      >
        <RotateCcw size={13} />
      </button>
    </div>
  );

  return (
    <div className="relative" style={{ perspective: 1200 }}>
      {/* Step number badge — sits above both faces. */}
      <span
        className="absolute -top-2 left-3 z-10 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums"
        style={{
          background: tint.color,
          color: "var(--color-bt-on-accent, #0d1f1a)",
        }}
        aria-hidden="true"
      >
        {STEP_NUMBER}
      </span>
      <div
        className="relative w-full"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 450ms cubic-bezier(.2,.8,.2,1)",
        }}
        data-testid="guide-step-dates"
      >
        {/* Front */}
        <div
          className="rounded-xl p-4"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          {front}
        </div>
        {/* Back */}
        <div
          className="absolute inset-0 rounded-xl p-4"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            transform: "rotateY(180deg)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            overflow: "auto",
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
};

// ── Mini calendar thumbnail (front face) ─────────────────────────────────
//
// Tiny stylized 7-column calendar grid — just enough to read as "a calendar"
// without being literal. The current row highlights the "selected" range.

function MiniCalendarThumbnail() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Calendar size={18} strokeWidth={1.8} />
      <div className="grid grid-cols-7 gap-[3px]">
        {Array.from({ length: 21 }).map((_, i) => {
          // Highlight a 5-day range in the middle row.
          const inRange = i >= 9 && i <= 13;
          return (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-[1px]"
              style={{
                background: inRange
                  ? "currentColor"
                  : "rgba(255,255,255,0.15)",
                opacity: inRange ? 0.85 : 1,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
