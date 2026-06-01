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
import { Clock } from "lucide-react";
import {
  formatTime12,
  DAYPART_PRESETS,
  TEE_PRESETS,
  type Period,
  type TimePreset,
  type TimeValue,
} from "@/lib/time";

// ── Props ──────────────────────────────────────────────────────────────────

export type TimePresetKind = "daypart" | "tee" | false;

interface TimePickerProps {
  /** 12-hour value. null shows the placeholder. */
  value: TimeValue | null;
  onChange: (value: TimeValue) => void;
  /** Domain tint for icon, selected items, center band, focus ring. Default teal. */
  accent?: string;
  /** ~0.16-alpha of accent — center band + focus ring. Default accent-faint. */
  accentFaint?: string;
  /** Label above the trigger field. */
  label?: string;
  /** Leading glyph in the trigger field (domain-colored). */
  icon?: ReactNode;
  /** Preset row above the wheels. "daypart" | "tee" | false. Default "daypart". */
  presets?: TimePresetKind;
  /** data-testid for the trigger field (E2E). */
  testId?: string;
  disabled?: boolean;
}

// Cap text on the accent fill — the only hard-coded color in this component
// (per the design spec). Dark ink reads on every domain hue.
const CAP_TEXT = "#0d1f1a";

// Popover geometry — kept in sync with the dialog's Tailwind width.
const POPOVER_W = 280;
const POPOVER_GAP = 8;

// Wheel geometry. The center selection band is BAND_H tall; each item is
// ITEM_H tall; spacers above/below = (BAND_H − ITEM_H)/2 so the first/last
// items can scroll to the band's center.
const ITEM_H = 36;
const BAND_H = 38;
const WHEEL_VISIBLE = 5; // odd → one row dead-center
const WHEEL_H = ITEM_H * WHEEL_VISIBLE;
const SPACER = (WHEEL_H - ITEM_H) / 2;

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1–12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0–59
const PERIODS: Period[] = ["AM", "PM"];

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Shared time-picker. A trigger pill (matching DatePicker) opens a popover
 * with three tap-or-scroll wheels (hour · minute · AM/PM). Selection lives in
 * a draft while open and commits on "Set time". Emits a 12-hour TimeValue —
 * callers convert to "HH:MM" at the data layer (see lib/time.ts).
 */
export function TimePicker({
  value,
  onChange,
  accent = "var(--color-bt-accent)",
  accentFaint = "var(--color-bt-accent-faint)",
  label,
  icon,
  presets = "daypart",
  testId,
  disabled = false,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Draft selection — defaults to noon when opening with no value.
  const [draft, setDraft] = useState<TimeValue>({ h: 12, m: 0, period: "PM" });

  const presetList: TimePreset[] | null = useMemo(() => {
    if (presets === "daypart") return DAYPART_PRESETS;
    if (presets === "tee") return TEE_PRESETS;
    return null;
  }, [presets]);

  function handleOpen() {
    if (disabled) return;
    setDraft(value ?? { h: 12, m: 0, period: "PM" });
    setOpen(true);
  }

  // Close on outside click / Escape. Popover is portaled, so check both refs.
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
  }, [open]);

  const triggerText = value ? formatTime12(value) : "";

  function commit() {
    onChange(draft);
    setOpen(false);
  }

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
          {icon ?? <Clock size={15} />}
        </span>
        <span className="min-w-0 flex-1 truncate tabular-nums">
          {triggerText || "Select time"}
        </span>
        <Clock
          size={15}
          className="flex-shrink-0"
          style={{ color: "var(--color-bt-text-dim)" }}
        />
      </button>

      {/* ── Popover wheels (portaled to <body>) ───────────────────────── */}
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          className="fixed z-[100] w-[280px] rounded-2xl p-3"
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
          {presetList && (
            <div
              className={
                presets === "tee"
                  ? "mb-3 grid grid-cols-4 gap-1.5"
                  : "mb-3 flex flex-wrap gap-1.5"
              }
            >
              {presetList.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setDraft(p.value)}
                  className={
                    presets === "tee"
                      ? "rounded-lg px-1.5 py-1 text-center font-mono text-[11px] font-semibold"
                      : "rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  }
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text-dim)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Three wheels with a shared center band behind them */}
          <div className="relative" style={{ height: WHEEL_H }}>
            {/* Center selection band */}
            <div
              className="pointer-events-none absolute inset-x-0 rounded-lg"
              style={{
                top: (WHEEL_H - BAND_H) / 2,
                height: BAND_H,
                background: accentFaint,
              }}
              aria-hidden
            />
            <div className="relative grid grid-cols-3">
              <Wheel
                items={HOURS}
                render={(h) => String(h)}
                selectedIndex={HOURS.indexOf(draft.h)}
                onSelect={(i) => setDraft((d) => ({ ...d, h: HOURS[i] }))}
                accent={accent}
                open={open}
              />
              <Wheel
                items={MINUTES}
                render={(m) => String(m).padStart(2, "0")}
                selectedIndex={MINUTES.indexOf(draft.m)}
                onSelect={(i) => setDraft((d) => ({ ...d, m: MINUTES[i] }))}
                accent={accent}
                open={open}
                mono
              />
              <Wheel
                items={PERIODS}
                render={(p) => p}
                selectedIndex={PERIODS.indexOf(draft.period)}
                onSelect={(i) => setDraft((d) => ({ ...d, period: PERIODS[i] }))}
                accent={accent}
                open={open}
              />
            </div>
          </div>

          {/* Footer: live summary + Set time */}
          <div
            className="mt-2 flex items-center justify-between gap-2 border-t pt-2.5"
            style={{ borderColor: "var(--color-bt-border)" }}
          >
            <span
              className="min-w-0 truncate text-xs tabular-nums"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {formatTime12(draft)}
            </span>
            <button
              type="button"
              onClick={commit}
              className="flex-shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold"
              style={{ background: accent, color: CAP_TEXT }}
            >
              Set time
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Wheel ────────────────────────────────────────────────────────────────────

interface WheelProps<T> {
  items: T[];
  render: (item: T) => string;
  selectedIndex: number;
  onSelect: (index: number) => void;
  accent: string;
  open: boolean;
  mono?: boolean;
}

/**
 * One scroll-snap column. Tap an item or scroll/snap it into the center band.
 * On open and whenever the selected index changes externally (e.g. a preset),
 * scrollTop is set directly to selectedIndex × ITEM_H (not scrollIntoView, so
 * sibling wheels and the page don't get dragged around).
 */
function Wheel<T>({
  items,
  render,
  selectedIndex,
  onSelect,
  accent,
  open,
  mono = false,
}: WheelProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync scroll position to the selected index (open + external changes).
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el || selectedIndex < 0) return;
    el.scrollTop = selectedIndex * ITEM_H;
  }, [open, selectedIndex]);

  // After the user stops scrolling, snap-commit the nearest item.
  function onScroll() {
    const el = ref.current;
    if (!el) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const idx = Math.round(el.scrollTop / ITEM_H);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      if (clamped !== selectedIndex) onSelect(clamped);
    }, 90);
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="no-scrollbar overflow-y-auto overscroll-contain"
      style={{
        height: WHEEL_H,
        scrollSnapType: "y mandatory",
      }}
    >
      <div style={{ height: SPACER }} aria-hidden />
      {items.map((item, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`flex w-full items-center justify-center ${mono ? "font-mono" : ""}`}
            style={{
              height: ITEM_H,
              scrollSnapAlign: "center",
              color: selected ? accent : "var(--color-bt-text-dim)",
              fontWeight: selected ? 700 : 400,
              fontSize: selected ? 15 : 14,
              opacity: selected ? 1 : 0.55,
            }}
          >
            {render(item)}
          </button>
        );
      })}
      <div style={{ height: SPACER }} aria-hidden />
    </div>
  );
}
