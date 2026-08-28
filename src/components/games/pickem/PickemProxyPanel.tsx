"use client";

import { UserPlus, Check, ChevronLeft } from "lucide-react";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";

/**
 * Entering a sheet for someone who cannot, or did not.
 *
 * ── Why it is here and not in the phase strip ──────────────────────────────
 *
 * The phase strip carries COMMANDS — open, lock. This is neither: it is the
 * thing a captain reaches for ten minutes before the deadline, standing where
 * their own sheet already is.
 *
 * ── The list IS the permission ─────────────────────────────────────────────
 *
 * `pickem_sheet_status` returns exactly the people the caller may act for, as
 * decided by `_pickem_can_proxy_for` — the same predicate that gates the write
 * and the read. A plain participant gets one row (themselves), so this control
 * does not render for them AT ALL, without any role test in the client.
 *
 * That matters more than it looks: a client-side role check is a second copy of
 * the policy, and two copies drift. This one cannot, because it is not a copy.
 */

export interface ProxyTarget {
  userId: string;
  name: string;
  submitted: boolean;
  isGuest: boolean;
}

/**
 * Guests first, then people who have not submitted, then the rest — the order
 * of who needs chasing.
 *
 * A guest can NEVER enter their own sheet (no `auth.uid()`, so
 * `pickem_picks_write` can never match them), which is why they lead and why
 * their row says "hasn't signed up" rather than "hasn't submitted". Implying a
 * guest might yet do it themselves would send someone off to chase a person who
 * structurally cannot act.
 */
export function sortTargets(targets: ProxyTarget[]): ProxyTarget[] {
  const rank = (t: ProxyTarget) => (t.isGuest && !t.submitted ? 0 : t.submitted ? 2 : 1);
  return [...targets].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)
  );
}

/** What a row says about someone's state. Guests read differently on purpose. */
export function targetStatusLabel(t: ProxyTarget): string {
  if (t.submitted) return "Sheet in";
  return t.isGuest ? "Hasn't signed up" : "No sheet yet";
}

export function PickemProxyPanel({
  targets,
  onPick,
}: {
  /** Already excludes the viewer — see `PickemGameView`. */
  targets: ProxyTarget[];
  onPick: (t: ProxyTarget) => void;
}) {
  if (targets.length === 0) return null;
  const sorted = sortTargets(targets);
  const waiting = sorted.filter((t) => !t.submitted).length;

  return (
    <div className="mx-1 flex flex-col gap-2" data-testid="pickem-proxy-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span style={EYEBROW}>Enter for someone else</span>
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
          {waiting === 0 ? "Everyone's in" : `${waiting} still to come`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {sorted.map((t) => (
          <button
            key={t.userId}
            type="button"
            onClick={() => onPick(t)}
            data-testid={`pickem-proxy-target-${t.userId}`}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left"
            style={{
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
              minHeight: 48,
            }}
          >
            <span
              className="min-w-0 flex-1 truncate"
              style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}
            >
              {t.name}
            </span>
            <span
              className="flex shrink-0 items-center gap-1"
              style={{
                fontSize: TYPE_SCALE.caption,
                color: t.submitted ? "var(--color-bt-text-dim)" : "var(--color-bt-text)",
              }}
            >
              {t.submitted ? <Check size={13} /> : <UserPlus size={13} />}
              {targetStatusLabel(t)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The banner over a proxy sheet.
 *
 * PERSISTENT, and not a subtitle. The only way this feature goes badly is
 * someone editing what they think is their own sheet, and the sheet is
 * POPULATED in proxy mode — it looks exactly like a filled-in sheet, because it
 * is one. So the subject is stated as its own band, and the copy underneath it
 * is swept of "your" as well: a banner over second-person copy is a mixed
 * message, and mixed is how the misread happens.
 */
export function PickemProxyBanner({
  name,
  isGuest,
  submitted,
  onBack,
}: {
  name: string;
  isGuest: boolean;
  /** Drives the overwrite warning — and ONLY when true. Warning on an empty
   *  sheet is the common case, and friction there is noise. */
  submitted: boolean;
  onBack: () => void;
}) {
  return (
    <div
      data-testid="pickem-proxy-banner"
      className="mx-1 flex flex-col gap-1.5 rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-accent-faint)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="pickem-proxy-back"
          aria-label="Back to your own sheet"
          className="-ml-1 flex shrink-0 items-center rounded-lg"
          style={{ minHeight: 32, minWidth: 32, color: "var(--color-bt-text)" }}
        >
          <ChevronLeft size={18} />
        </button>
        <span
          className="min-w-0 flex-1"
          style={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}
        >
          You&rsquo;re entering {name}&rsquo;s sheet
        </span>
      </div>

      {submitted ? (
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
          {name} submitted their own sheet — saving replaces it.
        </span>
      ) : isGuest ? (
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
          {name} has no account, so this is the only way they get a sheet.
        </span>
      ) : null}
    </div>
  );
}
