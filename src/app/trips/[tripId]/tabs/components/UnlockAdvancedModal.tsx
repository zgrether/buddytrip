"use client";

import { useState } from "react";
import {
  ArrowRight,
  Calendar,
  CalendarDays,
  Home,
  Loader2,
  MapPin,
  Sparkles,
  Users,
} from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { formatDateRange } from "@/lib/dates";

/**
 * UnlockAdvancedModal — two-step "ready to make it official?" flow that
 * replaces the direct advance-to-going button on the planning grid.
 *
 *   Step 1: trip summary recap — destination, dates, crew, lodging, schedule.
 *           "See what's next →" advances to step 2.
 *   Step 2: pitch for the going-stage experience (itinerary, leaderboard,
 *           expenses preview composite). "Make it Official" calls onConfirm,
 *           which fires the existing advanceToGoing mutation upstream.
 *
 * The modal is read-only display in both steps — no inline editing here.
 * The mini preview on step 2 is intentionally non-interactive.
 */
export interface UnlockAdvancedModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when "Make it Official" is tapped on step 2. */
  onConfirm: () => void;
  /** True while the upstream advanceToGoing mutation is in flight. */
  isConfirming: boolean;
  trip: {
    destination: string | null;
    start_date: string | null;
    end_date: string | null;
    crew_count: number;
    lodging_count: number;
    lodging_first_name: string | null;
    lodging_confirmed_count: number;
    schedule_count: number;
  };
}

export function UnlockAdvancedModal({
  isOpen,
  onClose,
  onConfirm,
  isConfirming,
  trip,
}: UnlockAdvancedModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Reset step when closing so a re-open always starts at step 1.
  const handleClose = () => { setStep(1); onClose(); };

  useModalBackButton(isOpen ? handleClose : () => {});

  if (!isOpen) return null;

  const dateLabel =
    trip.start_date && trip.end_date
      ? formatDateRange(trip.start_date, trip.end_date)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={handleClose}
      data-testid="unlock-advanced-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full overflow-y-auto"
        style={{
          maxWidth: "380px",
          width: "calc(100% - 32px)",
          maxHeight: "90vh",
          background: "var(--color-bt-card)",
          borderRadius: "22px",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Nav row: back link (step 2 only) | clickable step pills | spacer */}
        <div className="flex items-center px-4 pb-3 pt-3">
          {/* Left slot — back link on step 2, invisible spacer on step 1 */}
          <div style={{ width: 56, flexShrink: 0 }}>
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-1"
                style={{
                  color: "var(--color-bt-text-dim)",
                  fontSize: "13px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                >
                  <path d="M9 2L4 7l5 5" />
                </svg>
                Back
              </button>
            )}
          </div>

          {/* Center — clickable step pills */}
          <div className="flex flex-1 items-center justify-center gap-2">
            <div
              role="button"
              aria-label="Step 1"
              onClick={() => setStep(1)}
              style={{
                height: 3,
                borderRadius: 2,
                transition: "all 0.2s",
                width: step === 1 ? 24 : 16,
                background:
                  step === 1 ? "var(--color-bt-accent)" : "var(--color-bt-border)",
                cursor: step === 2 ? "pointer" : "default",
              }}
            />
            <div
              role="button"
              aria-label="Step 2"
              onClick={() => setStep(2)}
              style={{
                height: 3,
                borderRadius: 2,
                transition: "all 0.2s",
                width: step === 2 ? 24 : 16,
                background:
                  step === 2 ? "var(--color-bt-accent)" : "var(--color-bt-border)",
                cursor: step === 1 ? "pointer" : "default",
              }}
            />
          </div>

          {/* Right spacer — mirrors left slot width to keep pills truly centered */}
          <div style={{ width: 56, flexShrink: 0 }} />
        </div>

        {step === 1 ? (
          <Step1Summary
            trip={trip}
            dateLabel={dateLabel}
            onClose={handleClose}
            onNext={() => setStep(2)}
          />
        ) : (
          <Step2Pitch
            trip={trip}
            dateLabel={dateLabel}
            onClose={handleClose}
            onConfirm={onConfirm}
            isConfirming={isConfirming}
          />
        )}
      </div>
    </div>
  );
}

// ── Step 1 — trip summary recap ─────────────────────────────────────────

function Step1Summary({
  trip,
  dateLabel,
  onClose,
  onNext,
}: {
  trip: UnlockAdvancedModalProps["trip"];
  dateLabel: string | null;
  onClose: () => void;
  onNext: () => void;
}) {
  return (
    <div className="px-6 pb-5 pt-4">
      <p
        style={{
          color: "var(--color-bt-accent)",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        Ready to continue
      </p>
      <h2
        className="mt-1"
        style={{
          fontSize: "20px",
          fontWeight: 800,
          color: "var(--color-bt-text)",
        }}
      >
        Here&apos;s where things stand
      </h2>
      <p
        className="mt-1.5"
        style={{ fontSize: "13px", color: "var(--color-bt-text-dim)" }}
      >
        Everything you&apos;ve set up so far. Nothing goes away when you continue.
      </p>

      <div
        className="mt-4 space-y-2 rounded-xl p-4"
        style={{ background: "var(--color-bt-card-raised)" }}
      >
        <SummaryRow
          icon={<MapPin size={14} />}
          iconBg="rgba(96,165,250,0.15)"
          iconColor="#60a5fa"
          label="Destination"
          value={trip.destination}
          missingText="Not set"
        />
        <SummaryRow
          icon={<Calendar size={14} />}
          iconBg="var(--color-bt-accent-faint)"
          iconColor="var(--color-bt-accent)"
          label="Dates"
          value={dateLabel}
          missingText="Not set"
        />
        <SummaryRow
          icon={<Users size={14} />}
          iconBg="rgba(167,139,250,0.15)"
          iconColor="#a78bfa"
          label="Crew"
          value={
            trip.crew_count > 0
              ? `${trip.crew_count} ${trip.crew_count === 1 ? "person" : "people"}`
              : null
          }
          missingText="No one added"
        />
        <SummaryRow
          icon={<Home size={14} />}
          iconBg="var(--color-bt-warning-faint)"
          iconColor="var(--color-bt-warning)"
          label="Lodging"
          value={trip.lodging_first_name}
          missingText="Nothing added"
          badge={
            trip.lodging_count > 0
              ? trip.lodging_confirmed_count > 0
                ? "confirmed"
                : "pending"
              : null
          }
        />
        <SummaryRow
          icon={<CalendarDays size={14} />}
          iconBg="rgba(248,113,113,0.12)"
          iconColor="var(--color-bt-danger)"
          label="Schedule"
          value={
            trip.schedule_count > 0
              ? `${trip.schedule_count} ${trip.schedule_count === 1 ? "item" : "items"}`
              : null
          }
          missingText="Nothing planned"
        />
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={onClose}
          className="rounded-lg px-3 py-2.5 text-sm transition-opacity hover:opacity-80"
          style={{
            color: "var(--color-bt-text-dim)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          Not yet
        </button>
        <button
          onClick={onNext}
          data-testid="unlock-step1-next-btn"
          className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
            border: "none",
            cursor: "pointer",
          }}
        >
          See what&apos;s next
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function SummaryRow({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  missingText,
  badge,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | null;
  missingText: string;
  badge?: "confirmed" | "pending" | null;
}) {
  const isMissing = !value;
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
        style={{ background: iconBg, color: iconColor }}
      >
        {icon}
      </span>
      <span
        className="w-20 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {label}
      </span>
      <span className="flex flex-1 items-center gap-1.5 truncate text-[13px]">
        {isMissing ? (
          <span
            className="italic"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {missingText}
          </span>
        ) : (
          <>
            <span className="truncate" style={{ color: "var(--color-bt-text)" }}>
              {value}
            </span>
            {badge && (
              <span
                className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={
                  badge === "confirmed"
                    ? {
                        background: "var(--color-bt-tag-bg)",
                        color: "var(--color-bt-accent)",
                      }
                    : {
                        background: "var(--color-bt-warning-faint)",
                        color: "var(--color-bt-warning)",
                      }
                }
              >
                {badge}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}

// ── Step 2 — pitch for the advanced (going-stage) experience ────────────

function Step2Pitch({
  trip,
  dateLabel,
  onClose,
  onConfirm,
  isConfirming,
}: {
  trip: UnlockAdvancedModalProps["trip"];
  dateLabel: string | null;
  onClose: () => void;
  onConfirm: () => void;
  isConfirming: boolean;
}) {
  // First-day label for the itinerary preview — falls back to a placeholder
  // when no dates exist yet (rare since the planning grid blocks advance
  // without dates, but the modal is dumb-display so handle it gracefully).
  const dayHeader =
    trip.start_date
      ? `Day 2 — ${formatDateRange(trip.start_date, null).replace(/^From /, "")}`
      : `Day 2 — ${dateLabel ?? "Trip starts"}`;

  return (
    <>
      {/* Hero — gradient background with two radial blobs */}
      <div
        className="relative overflow-hidden px-6 pb-5 pt-4"
        style={{
          background:
            "linear-gradient(160deg, #0d2030 0%, #0f1f35 50%, #151028 100%)",
        }}
      >
        {/* Teal blob top-left */}
        <div
          className="pointer-events-none absolute"
          aria-hidden
          style={{
            top: "-40px",
            left: "-40px",
            width: "180px",
            height: "180px",
            background:
              "radial-gradient(circle, rgba(45,212,191,0.35) 0%, transparent 70%)",
          }}
        />
        {/* Purple blob bottom-right */}
        <div
          className="pointer-events-none absolute"
          aria-hidden
          style={{
            bottom: "-40px",
            right: "-40px",
            width: "180px",
            height: "180px",
            background:
              "radial-gradient(circle, rgba(167,139,250,0.30) 0%, transparent 70%)",
          }}
        />

        <div className="relative flex flex-col items-center text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1.5px solid",
              borderImage:
                "linear-gradient(135deg, #2dd4bf, #a78bfa) 1",
            }}
          >
            <Sparkles size={26} style={{ color: "#2dd4bf" }} />
          </div>
          <h2
            className="mt-3 text-xl font-extrabold"
            style={{
              background: "linear-gradient(135deg, #2dd4bf 0%, #a78bfa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Level up your trip
          </h2>
          <p
            className="mt-1.5 text-[13px] leading-snug"
            style={{ color: "rgba(241,245,249,0.7)" }}
          >
            Keep the crew engaged all the way through — from arrival to the
            final score.
          </p>
        </div>
      </div>

      {/* Mini preview composite — three sections */}
      <div className="px-4 py-4">
        <div
          className="overflow-hidden"
          style={{
            background: "var(--color-bt-base)",
            border: "1px solid var(--color-bt-border)",
            borderRadius: "14px",
          }}
        >
          {/* Itinerary section */}
          <div className="px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ background: "var(--color-bt-accent)" }}
              />
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {dayHeader}
              </span>
            </div>
            <PreviewItem
              dotColor="#60a5fa"
              borderColor="rgba(96,165,250,0.25)"
              text={trip.lodging_first_name ?? "Lodging check-in"}
              meta="3:00 PM"
            />
            <PreviewItem
              dotColor="var(--color-bt-accent)"
              borderColor="var(--color-bt-accent-border)"
              text="Crew arrives"
              meta="5:30 PM"
            />
            <PreviewItem
              dotColor="var(--color-bt-warning)"
              borderColor="var(--color-bt-warning-border)"
              text={
                trip.schedule_count > 0
                  ? `${trip.schedule_count} item${trip.schedule_count === 1 ? "" : "s"} planned`
                  : "Welcome dinner"
              }
              meta="7:30 PM"
            />
          </div>

          {/* Leaderboard section */}
          <div
            className="px-3 py-2.5"
            style={{ borderTop: "1px solid var(--color-bt-border)" }}
          >
            <p
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Live Leaderboard
            </p>
            <TeamBar name="USA" color="#3b82f6" score={24} max={24} />
            <TeamBar name="EUR" color="#ef4444" score={18} max={24} />
          </div>

          {/* Expenses section */}
          <div
            className="px-3 py-2.5"
            style={{ borderTop: "1px solid var(--color-bt-border)" }}
          >
            <p
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Expenses
            </p>
            <ExpenseRow label="Greens fee" amount="$320" perPerson="$80 ea" />
            <ExpenseRow label="Dinner" amount="$184" perPerson="$46 ea" />
          </div>
        </div>
      </div>

      <div className="px-6 pb-5">
        <button
          onClick={onConfirm}
          disabled={isConfirming}
          data-testid="unlock-make-official-btn"
          className="flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-extrabold disabled:opacity-50"
          style={{
            background:
              "linear-gradient(135deg, var(--color-bt-accent) 0%, #a78bfa 100%)",
            color: "#0d1f1a",
            border: "none",
          }}
        >
          {isConfirming ? (
            <Loader2 size={18} className="animate-spin" />
          ) : null}
          Make it Official
          <ArrowRight size={16} />
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2 text-sm transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Not yet, stick to the basics
        </button>
      </div>
    </>
  );
}

function PreviewItem({
  dotColor,
  borderColor,
  text,
  meta,
}: {
  dotColor: string;
  borderColor: string;
  text: string;
  meta: string;
}) {
  return (
    <div
      className="mt-1 flex items-center justify-between rounded-md px-2 py-1.5"
      style={{ border: `1px solid ${borderColor}` }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: dotColor }}
        />
        <span
          className="truncate text-[11px]"
          style={{ color: "var(--color-bt-text)" }}
        >
          {text}
        </span>
      </div>
      <span
        className="flex-shrink-0 text-[10px]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {meta}
      </span>
    </div>
  );
}

function TeamBar({
  name,
  color,
  score,
  max,
}: {
  name: string;
  color: string;
  score: number;
  max: number;
}) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  return (
    <div className="mb-1 flex items-center gap-2">
      <span
        className="w-8 flex-shrink-0 text-[11px] font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        {name}
      </span>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full"
        style={{ background: "var(--color-bt-card-raised)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        className="w-6 flex-shrink-0 text-right text-[11px] font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        {score}
      </span>
    </div>
  );
}

function ExpenseRow({
  label,
  amount,
  perPerson,
}: {
  label: string;
  amount: string;
  perPerson: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span style={{ color: "var(--color-bt-text)" }}>{label}</span>
      <span className="flex items-center gap-1.5">
        <span style={{ color: "var(--color-bt-text)" }}>{amount}</span>
        <span style={{ color: "var(--color-bt-text-dim)" }}>{perPerson}</span>
      </span>
    </div>
  );
}
