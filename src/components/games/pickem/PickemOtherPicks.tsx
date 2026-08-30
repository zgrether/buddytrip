"use client";

import { ChevronLeft } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";

export type { PicksSub } from "@/lib/pickemSurface";
import type { PicksSub } from "@/lib/pickemSurface";

/**
 * Everyone else's sheets, grouped by team.
 *
 * ── The gap this fills ─────────────────────────────────────────────────────
 *
 * Reading another person's sheet was only ever reachable from the PICKS-OPEN
 * page, through the proxy button — a control about entering FOR somebody, whose
 * list is scoped to who you may act for. The moment picks locked, that whole
 * surface went away with the sheet it sat on, so the one phase in which every
 * sheet is deliberately readable was the one phase with nowhere to read them.
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
 * ── Grouped by TEAM, in columns ────────────────────────────────────────────
 *
 * A flat list ordered by score answers "who is winning", which the board
 * already does better. What this screen is for is finding a person — usually
 * one you are about to chase — and people are held in teams, so the team is
 * the axis to file them under.
 *
 * Within a team it is the ROSTER's own order, not alphabetical and not by
 * score: that is the order the team is written down in everywhere else in the
 * app, and a list that reorders itself as results land is a list you cannot
 * learn.
 *
 * The columns wrap on available width (`auto-fit`, 150px floor), so two teams
 * give two columns on a phone and four give four on a desktop, with no
 * breakpoint deciding it.
 */

export interface OtherSheet {
  userId: string;
  name: string;
  /**
   * How many contests they have called — or NULL when the count is not
   * knowable from here.
   *
   * Null is not zero and not "complete". While picks are open, RLS hides other
   * people's rows, and `pickem_sheet_status` answers with a boolean rather than
   * a count — so before the lock we know THAT somebody has started and not how
   * far they are. Saying nothing is the honest rendering of that, and it is the
   * same thing a finished sheet says, which is why the two share a branch.
   */
  picked: number | null;
  total: number;
  /**
   * A placeholder who has never signed up. Structurally unable to submit for
   * themselves — no `auth.uid()`, so `pickem_picks_write` can never match them —
   * which is why somebody else has to, and why the label is worth saying even
   * on a person whose sheet is full: it is where those picks came from.
   */
  isGuest: boolean;
  /** Their total, or null when there is no figure to show — either they have no
   *  sheet, or picks are still open and nobody may see one. */
  points: number | null;
  /**
   * Does tapping this row do anything?
   *
   * Stated rather than inferred from `points`. The two coincided after the lock
   * — a readable sheet is one that exists — and they come apart before it: a
   * captain may OPEN a teammate's sheet to enter for them while its contents
   * are hidden from everyone, so there is a figure to show for nobody and a row
   * that very much opens.
   */
  openable: boolean;
}

/** One team's column. `teamId` is null for the people on no team at all. */
export interface OtherPicksColumn {
  teamId: string | null;
  teamName: string;
  people: OtherSheet[];
}

/**
 * The line under a person's name.
 *
 * ── It replaced the team name, and that is the point ──────────────────────
 *
 * Under a team heading, printing the team again on every row is the same word
 * four times. The slot was the most valuable one on the card and it was holding
 * something the column already said — so it now holds the only thing this
 * screen cannot show any other way: how far along they are.
 *
 * Null for a finished sheet. Nothing needs saying about somebody who is done,
 * and a line reading "16/16 picks submitted" on every complete row would bury
 * the two rows that are not.
 *
 * "Not a member of BuddyTrip" outranks the counts, and stays true of somebody
 * whose sheet is FULL: a placeholder cannot enter their own, so a full sheet
 * means a captain entered it for them. The label is the provenance of those
 * picks, not an apology for their absence — which is why it is said whatever
 * the count is. It replaced "Hasn't signed up", which read as a step they had
 * skipped rather than a fact about the account.
 *
 * A null `picked` says nothing, for the same reason a finished sheet does: with
 * picks open the count is not knowable from here, and inventing a distinction
 * the data cannot support is worse than the silence.
 */
export function sheetStateLine(s: OtherSheet): string | null {
  if (s.isGuest) return "Not a member of BuddyTrip";
  if (s.picked === 0) return "Nothing submitted";
  if (s.picked != null && s.picked < s.total) {
    return `${s.picked}/${s.total} picks submitted`;
  }
  return null;
}

export function PickemOtherPicks({
  columns,
  avatarFor,
  onOpen,
}: {
  columns: OtherPicksColumn[];
  avatarFor: (userId: string) => { avatarIcon: string | null; teamColor: string | null };
  onOpen: (userId: string) => void;
}) {
  const anybody = columns.some((c) => c.people.length > 0);
  if (!anybody) {
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
    <div
      data-testid="pickem-other-picks"
      className="grid gap-x-3 gap-y-4"
      /* `auto-fit` with a 150px floor rather than a breakpoint: two teams give
         two columns on a phone, four give four on a desktop, and nothing here
         has to know which. */
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
    >
      {columns
        .filter((c) => c.people.length > 0)
        .map((col) => (
          <div key={col.teamId ?? "none"} className="flex min-w-0 flex-col gap-1.5">
            <div className="px-1" style={EYEBROW} data-testid="pickem-other-picks-team">
              {col.teamName}
            </div>
            {col.people.map((s) => (
              <PersonRow
                key={s.userId}
                sheet={s}
                avatar={avatarFor(s.userId)}
                onOpen={() => onOpen(s.userId)}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

function PersonRow({
  sheet: s,
  avatar,
  onOpen,
}: {
  sheet: OtherSheet;
  avatar: { avatarIcon: string | null; teamColor: string | null };
  onOpen: () => void;
}) {
  const openable = s.openable;
  const state = sheetStateLine(s);
  return (
    <button
      type="button"
      disabled={!openable}
      onClick={onOpen}
      data-testid="pickem-other-picks-row"
      data-submitted={openable ? "true" : "false"}
      className="@container flex min-w-0 items-center gap-2 px-2 text-left"
      style={{
        minHeight: 46,
        borderRadius: 10,
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        // Not `disabled:opacity-40`: the row is still the answer to "did they
        // pick", and fading it to nothing would hide the very people it exists
        // to surface.
        cursor: openable ? "pointer" : "default",
      }}
    >
      <Avatar
        name={s.name}
        avatarIcon={avatar.avatarIcon}
        teamColor={avatar.teamColor}
        sizePx={24}
        collapse
        collapseAt="chip"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span
            className="min-w-0 flex-1 truncate"
            style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}
          >
            {s.name}
          </span>
          {s.points != null && (
            <span
              className="shrink-0"
              style={{
                fontSize: TYPE_SCALE.caption,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.points}
            </span>
          )}
        </span>
        {state && (
          <span
            className="mt-0.5 block truncate"
            data-testid="pickem-other-picks-state"
            style={{ fontSize: 10.5, color: "var(--color-bt-text-dim)" }}
          >
            {state}
          </span>
        )}
      </span>
    </button>
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

/**
 * The sub-tab bar under Picks.
 *
 * ── Deliberately not the same control as the tab bar above it ──────────────
 *
 * Two identical segmented bars stacked would leave the reader working out which
 * one they just pressed. This is quieter and smaller — an underline rather than
 * a raised surface — so the hierarchy is legible without a label saying so: the
 * bar above chooses the SCREEN, this one chooses whose sheet is on it.
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
