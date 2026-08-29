"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * Everyone else's sheets, once picks are locked.
 *
 * ── The gap this fills ─────────────────────────────────────────────────────
 *
 * Reading another person's sheet was only ever reachable from the PICKS-OPEN
 * page, through the proxy button — a control about entering FOR somebody, whose
 * list is scoped to who you may act for. The moment picks locked, that whole
 * surface went away with the sheet it sat on.
 *
 * So the one phase in which every sheet is deliberately readable was the one
 * phase with nowhere to read them. The board answers "who is winning" and the
 * head-to-head answers "by how much", and neither shows a single pick.
 *
 * ── It is NOT the proxy list ───────────────────────────────────────────────
 *
 * The proxy list comes from `pickem_sheet_status`, which answers "whose sheet
 * may I write". This answers "whose sheet may I read", and after the lock those
 * are different questions with different answers: a member with no proxy rights
 * may read everybody's and write nobody's. Sourcing this from the proxy list
 * would have shown most people an empty screen on a page whose entire premise
 * is that the sheets are now public.
 *
 * `sheets` is already the read-scoped set — the same map the board scores from,
 * RLS-gated upstream — so the answer is a property of the data rather than of a
 * check made here.
 *
 * ── Non-submitters are ROWS, not omissions ─────────────────────────────────
 *
 * Somebody who never submitted has no sheet, and rendering only the sheets
 * would make fifteen rows where there are seventeen people — the reader cannot
 * tell a short field from a dropped one. They get a row that says what happened
 * and does not open, because there is nothing behind it to open.
 */

export interface OtherSheet {
  userId: string;
  name: string;
  /** Their team, for the second line. Null when they are on none. */
  team: string | null;
  /** Null for somebody who never submitted — NOT zero. A sheet that scored
   *  nothing and a sheet that does not exist are opposite facts. */
  points: number | null;
}

export function PickemOtherPicks({
  sheets,
  avatarFor,
  onOpen,
}: {
  sheets: OtherSheet[];
  avatarFor: (userId: string) => { avatarIcon: string | null; teamColor: string | null };
  onOpen: (userId: string) => void;
}) {
  if (sheets.length === 0) {
    return (
      <div
        data-testid="pickem-other-picks-empty"
        className="flex flex-col items-center gap-1.5 text-center"
        style={{
          padding: "26px 20px",
          borderRadius: 14,
          border: "1px dashed var(--color-bt-border)",
        }}
      >
        <span style={{ fontSize: TYPE_SCALE.name, fontWeight: 700 }}>Nobody else yet</span>
        <span style={{ fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}>
          You&rsquo;re the only one in this game so far.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="pickem-other-picks">
      {sheets.map((s) => {
        const { avatarIcon, teamColor } = avatarFor(s.userId);
        const missing = s.points == null;
        return (
          <button
            key={s.userId}
            type="button"
            disabled={missing}
            onClick={() => onOpen(s.userId)}
            data-testid="pickem-other-picks-row"
            data-submitted={missing ? "false" : "true"}
            className="@container flex items-center gap-2.5 px-3 text-left"
            style={{
              minHeight: 52,
              borderRadius: 11,
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
              // Not `disabled:opacity-40`: the row is still the answer to "did
              // they pick", and fading it to nothing would hide the very people
              // it exists to surface. Only the chevron goes.
              cursor: missing ? "default" : "pointer",
            }}
          >
            <Avatar
              name={s.name}
              avatarIcon={avatarIcon}
              teamColor={teamColor}
              sizePx={30}
              collapse
              collapseAt="chip"
            />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate"
                style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 600 }}
              >
                {s.name}
              </span>
              <span
                className="mt-0.5 block truncate"
                style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
              >
                {missing ? "Didn’t pick — no sheet to show" : (s.team ?? "No team")}
              </span>
            </span>
            {!missing && (
              <span
                className="shrink-0"
                style={{
                  fontSize: TYPE_SCALE.body,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.points} <span style={{ fontSize: 10, fontWeight: 600 }}>pts</span>
              </span>
            )}
            {!missing && (
              <ChevronRight
                size={16}
                aria-hidden
                style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sorted by what a reader is scanning for: the best sheet first, and the people
 * who never submitted last.
 *
 * Non-submitters sort to the bottom rather than to the top of a 0-point tail,
 * which is where a naive numeric sort would put them alongside everyone who
 * picked badly. Those are opposite facts and they must not interleave.
 */
export function sortOtherSheets(list: OtherSheet[]): OtherSheet[] {
  return [...list].sort((a, b) => {
    if ((a.points == null) !== (b.points == null)) return a.points == null ? 1 : -1;
    if (a.points != null && b.points != null && a.points !== b.points) {
      return b.points - a.points;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Which half of the Picks tab is showing. */
export type PicksSub = "your" | "other";

/**
 * The sub-tab bar under Picks.
 *
 * ── Deliberately not the same control as the tab bar above it ──────────────
 *
 * Two identical segmented bars stacked would leave the reader working out which
 * one they just pressed. This is quieter and smaller — an underline rather than
 * a raised surface — so the hierarchy is legible without a label saying so: the
 * bar above chooses the SCREEN, this one chooses whose sheet is on it.
 *
 * No counts on either. The tab above already carries the viewer's total, and a
 * count of other people is not a thing anybody is deciding between.
 */
export function PickemPicksSubTabs({
  open,
  onOpen,
}: {
  open: PicksSub;
  onOpen: (sub: PicksSub) => void;
}) {
  return (
    <div
      className="flex gap-4 px-1"
      role="tablist"
      data-testid="pickem-picks-subtabs"
      style={{ borderBottom: "1px solid var(--color-bt-border)" }}
    >
      {(
        [
          ["your", "Your picks"],
          ["other", "Other picks"],
        ] as const
      ).map(([value, label]) => {
        const selected = open === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onOpen(value)}
            data-testid={`pickem-picks-sub-${value}`}
            data-selected={selected ? "true" : "false"}
            style={{
              minHeight: 38,
              paddingBottom: 6,
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: selected ? 700 : 600,
              color: selected ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
              // Sits ON the container's hairline, so the selected tab reads as
              // joined to the content below it rather than as a lit chip.
              borderBottom: `2px solid ${selected ? "var(--color-bt-accent)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Whose sheet you are READING — and pointedly not the proxy banner.
 *
 * The first build of this reused `PickemProxyBanner`, which put "You're
 * entering Charlie's sheet · Charlie submitted their own sheet — saving
 * replaces it" over a surface that cannot be entered, saved, or replaced. Every
 * clause was false, and it was the loudest thing on the screen.
 *
 * That reuse looked right because the two headers answer the same question —
 * whose sheet is this — and it was wrong because they exist for opposite
 * reasons. The proxy band is a WARNING, sized to the only way that feature goes
 * badly: somebody editing what they think is their own sheet. Here nothing can
 * be edited, so a warning has nothing to warn about, and a band shouting one
 * would train people to ignore the one that matters.
 *
 * So: a title with a way back, at the weight of a title.
 */
export function PickemReadingHeader({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1 px-1" data-testid="pickem-reading-header">
      <button
        type="button"
        onClick={onBack}
        data-testid="pickem-reading-back"
        aria-label="Back to the list"
        className="-ml-1 flex shrink-0 items-center justify-center"
        style={{ width: 32, height: 32, color: "var(--color-bt-accent)" }}
      >
        <ChevronLeft size={20} />
      </button>
      <span className="min-w-0 flex-1 truncate" style={{ fontSize: 17, fontWeight: 700 }}>
        {name}&rsquo;s picks
      </span>
    </div>
  );
}
