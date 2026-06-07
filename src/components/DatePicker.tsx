"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollLock } from "@/hooks/useScrollLock";
import {
  addMonths,
  applyRangeClick,
  atNoon,
  isOutOfBounds,
  isSameDay,
  isWithinRange,
  monthMatrix,
  nightsBetween,
  rangePresets,
  startOfMonth,
  type DateRange,
} from "@/lib/calendar";

// ── Props ──────────────────────────────────────────────────────────────────

interface BaseProps {
  /** Domain tint for caps, today dot, focus ring, icon. Default teal. */
  accent?: string;
  /** ~0.16-alpha of accent — fills the range body. Default accent-faint. */
  accentFaint?: string;
  /** Label above the trigger field. */
  label?: string;
  /** Leading glyph in the trigger field (domain-colored). */
  icon?: ReactNode;
  /** Show quick presets above the grid. Default true. */
  presets?: boolean;
  /** Earliest selectable day (inclusive). Days before are disabled. */
  min?: Date | null;
  /** Latest selectable day (inclusive). Days after are disabled. */
  max?: Date | null;
  /** data-testid for the trigger field (E2E). */
  testId?: string;
  disabled?: boolean;
}

interface RangeProps extends BaseProps {
  mode: "range";
  value: DateRange | null;
  onChange: (value: DateRange) => void;
}

interface SingleProps extends BaseProps {
  mode: "single";
  value: Date | null;
  onChange: (value: Date | null) => void;
}

export type DatePickerProps = RangeProps | SingleProps;

// ── Formatting ──────────────────────────────────────────────────────────────

const fmtMonthDay = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function fmtRange(start: Date | null, end: Date | null): string {
  if (start && end) {
    const sameMonth =
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();
    return sameMonth
      ? `${fmtMonthDay(start)} – ${end.getDate()}`
      : `${fmtMonthDay(start)} – ${fmtMonthDay(end)}`;
  }
  if (start) return fmtMonthDay(start);
  if (end) return fmtMonthDay(end);
  return "";
}

const nightsLabel = (n: number) => `${n} ${n === 1 ? "night" : "nights"}`;

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// Cap text on the accent fill — the only hard-coded color in this component
// (per the design spec). Dark ink reads on every domain hue.
const CAP_TEXT = "#0d1f1a";

// Popover geometry — kept in sync with the dialog's Tailwind width (w-[300px]).
const POPOVER_W = 300;
const POPOVER_GAP = 8;

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Shared calendar date-picker. One component, two modes:
 *   - range  → start→end selection in a single calendar (value {start,end})
 *   - single → one day (value Date)
 *
 * A trigger pill replaces the old native <input type="date">; clicking it
 * opens a popover calendar that holds a *draft* selection and commits via
 * Apply. The tint is fully prop-driven so each screen passes its domain hue.
 */
export function DatePicker(props: DatePickerProps) {
  const {
    mode,
    accent = "var(--color-bt-accent)",
    accentFaint = "var(--color-bt-accent-faint)",
    label,
    icon,
    presets = true,
    min,
    max,
    testId,
    disabled = false,
  } = props;

  const today = useMemo(() => atNoon(new Date()), []);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<Date | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Fixed-position coords for the portaled popover (null until measured).
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Draft selection lives only while the popover is open; Apply commits it.
  const [draftRange, setDraftRange] = useState<DateRange>({ start: null, end: null });
  const [draftSingle, setDraftSingle] = useState<Date | null>(null);
  const [viewDate, setViewDate] = useState<Date>(today);

  // Seed the draft + view from the committed value each time we open.
  function handleOpen() {
    if (disabled) return;
    if (mode === "range") {
      const v = props.value ?? { start: null, end: null };
      setDraftRange({ start: v.start, end: v.end });
      setViewDate(startOfMonth(v.start ?? v.end ?? today));
    } else {
      setDraftSingle(props.value ?? null);
      setViewDate(startOfMonth(props.value ?? today));
    }
    setOpen(true);
  }

  // Close on outside click / Escape. The popover is portaled to <body>, so a
  // click inside it is outside rootRef — check both refs before closing.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      const inTrigger = rootRef.current?.contains(target);
      const inPopover = popoverRef.current?.contains(target);
      if (!inTrigger && !inPopover) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Position the portaled popover relative to the trigger, flipping above when
  // there isn't room below. Recomputed on open and on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const popH = popoverRef.current?.offsetHeight ?? 360;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = r.left;
      if (left + POPOVER_W > vw - POPOVER_GAP) left = vw - POPOVER_W - POPOVER_GAP;
      if (left < POPOVER_GAP) left = POPOVER_GAP;

      let top = r.bottom + POPOVER_GAP;
      const fitsBelow = top + popH <= vh - POPOVER_GAP;
      const fitsAbove = r.top - POPOVER_GAP - popH >= POPOVER_GAP;
      if (!fitsBelow && fitsAbove) top = r.top - POPOVER_GAP - popH;

      setCoords({ top, left });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, mode]);

  // ── Trigger display ────────────────────────────────────────────────────
  const triggerText =
    mode === "range"
      ? props.value && (props.value.start || props.value.end)
        ? fmtRange(props.value.start, props.value.end)
        : ""
      : props.value
        ? fmtMonthDay(props.value)
        : "";
  const placeholder = mode === "range" ? "Select dates" : "Select date";
  const triggerNights =
    mode === "range" && props.value?.start && props.value?.end
      ? nightsBetween(props.value.start, props.value.end)
      : null;

  // ── Draft validity + footer summary ──────────────────────────────────────
  const valid =
    mode === "range" ? !!(draftRange.start && draftRange.end) : !!draftSingle;

  let summary: string;
  if (mode === "range") {
    if (draftRange.start && draftRange.end) {
      summary = `${fmtMonthDay(draftRange.start)} – ${fmtMonthDay(
        draftRange.end
      )} · ${nightsLabel(nightsBetween(draftRange.start, draftRange.end))}`;
    } else if (draftRange.start) {
      summary = "Pick an end date";
    } else {
      summary = "Pick a start date";
    }
  } else {
    summary = draftSingle ? fmtMonthDay(draftSingle) : "Pick a date";
  }

  function commit() {
    if (!valid) return;
    if (mode === "range") {
      props.onChange({ start: draftRange.start, end: draftRange.end });
    } else {
      props.onChange(draftSingle);
    }
    setOpen(false);
  }

  function handleDayClick(day: Date) {
    if (isOutOfBounds(day, min, max)) return;
    if (mode === "range") {
      setDraftRange((cur) => applyRangeClick(cur, day));
    } else {
      setDraftSingle(atNoon(day));
    }
  }

  const weeks = useMemo(() => monthMatrix(viewDate), [viewDate]);
  const monthLabel = viewDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="relative" ref={rootRef}>
      {label && (
        <label
          className="mb-1 block text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {label}
        </label>
      )}

      {/* ── Trigger pill ──────────────────────────────────────────────── */}
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        onClick={() => (open ? setOpen(false) : handleOpen())}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm outline-none transition-shadow disabled:opacity-50"
        style={{
          background: "var(--color-bt-card-raised)",
          borderColor: open ? accent : "var(--color-bt-border)",
          color: triggerText ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
          boxShadow: open ? `0 0 0 3px ${accentFaint}` : "none",
        }}
      >
        <span className="flex flex-shrink-0 items-center" style={{ color: accent }}>
          {icon ?? <CalendarIcon size={15} />}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {triggerText || placeholder}
        </span>
        {triggerNights !== null && (
          <span
            className="flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]"
            style={{ background: accentFaint, color: accent }}
          >
            {nightsLabel(triggerNights)}
          </span>
        )}
        <CalendarIcon
          size={15}
          className="flex-shrink-0"
          style={{ color: "var(--color-bt-text-dim)" }}
        />
      </button>

      {/* ── Popover calendar (portaled to <body> so it escapes any clipping
            ancestor and floats above the surrounding panel) ─────────────── */}
      {open && typeof document !== "undefined" && createPortal(
        <ScrollLock>
        <div
          ref={popoverRef}
          role="dialog"
          className="fixed z-[100] w-[300px] rounded-2xl p-3"
          style={{
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            visibility: coords ? "visible" : "hidden",
            background: "var(--color-bt-card-float)",
            border: "1px solid var(--color-bt-border)",
            boxShadow: "var(--shadow-floating)",
          }}
        >
          {/* Presets */}
          {presets && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {mode === "range"
                ? rangePresets(today).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setDraftRange(p.range);
                        if (p.range.start) setViewDate(startOfMonth(p.range.start));
                      }}
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        background: "var(--color-bt-card-raised)",
                        color: "var(--color-bt-text-dim)",
                        border: "1px solid var(--color-bt-border)",
                      }}
                    >
                      {p.label}
                    </button>
                  ))
                : (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftSingle(today);
                        setViewDate(startOfMonth(today));
                      }}
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        background: "var(--color-bt-card-raised)",
                        color: "var(--color-bt-text-dim)",
                        border: "1px solid var(--color-bt-border)",
                      }}
                    >
                      Today
                    </button>
                  )}
            </div>
          )}

          {/* Month nav */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setViewDate((d) => addMonths(d, -1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <ChevronLeft size={16} />
            </button>
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {monthLabel}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setViewDate((d) => addMonths(d, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((d, i) => (
              <div
                key={i}
                className="flex h-7 items-center justify-center text-[10px] font-semibold uppercase"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {weeks.flat().map((day) => {
              const inMonth = day.getMonth() === viewDate.getMonth();
              const outOfBounds = isOutOfBounds(day, min, max);
              const isToday = isSameDay(day, today);

              const range =
                mode === "range" ? draftRange : { start: draftSingle, end: null };
              const isStart = isSameDay(day, range.start);
              const isEnd = mode === "range" && isSameDay(day, range.end);
              const isCap = isStart || isEnd;
              const between =
                mode === "range" && isWithinRange(day, draftRange);
              const hasEnd = mode === "range" && !!draftRange.end;
              const isHovered = isSameDay(day, hovered);

              // Continuous range fill: a half/full bar behind the caps.
              const showFill = between || (isStart && hasEnd) || isEnd;

              return (
                <div
                  key={day.getTime()}
                  className="relative flex h-9 items-center justify-center"
                >
                  {showFill && (
                    <div
                      className="absolute inset-y-1"
                      style={{
                        left: isStart ? "50%" : 0,
                        right: isEnd ? "50%" : 0,
                        background: accentFaint,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    disabled={outOfBounds}
                    onClick={() => handleDayClick(day)}
                    onMouseEnter={() => setHovered(day)}
                    onMouseLeave={() => setHovered(null)}
                    className="relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-[13px] leading-none disabled:cursor-not-allowed"
                    style={{
                      background: isCap ? accent : "transparent",
                      color: isCap
                        ? CAP_TEXT
                        : outOfBounds
                          ? "var(--color-bt-text-dim)"
                          : inMonth
                            ? "var(--color-bt-text)"
                            : "var(--color-bt-text-dim)",
                      opacity: outOfBounds ? 0.35 : inMonth ? 1 : 0.45,
                      fontWeight: isCap ? 700 : 400,
                      boxShadow:
                        isHovered && !isCap && !outOfBounds
                          ? `inset 0 0 0 1px ${accent}`
                          : "none",
                    }}
                  >
                    {day.getDate()}
                    {isToday && !isCap && (
                      <span
                        className="absolute bottom-1 h-1 w-1 rounded-full"
                        style={{ background: accent }}
                        aria-hidden
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Footer: live summary + Apply */}
          <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2.5"
            style={{ borderColor: "var(--color-bt-border)" }}
          >
            <span
              className="min-w-0 truncate text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {summary}
            </span>
            <button
              type="button"
              onClick={commit}
              disabled={!valid}
              className="flex-shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{ background: accent, color: CAP_TEXT }}
            >
              Apply
            </button>
          </div>
        </div>
        </ScrollLock>,
        document.body
      )}
    </div>
  );
}
