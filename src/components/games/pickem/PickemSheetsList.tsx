"use client";

import { Avatar } from "@/components/Avatar";
import { TYPE_SCALE } from "@/lib/typeScale";
import { sortTargets, targetStatusLabel, type ProxyTarget } from "./PickemProxyPanel";

/**
 * Everyone whose sheet you may enter — the OTHER PICKS sub-tab, while picks
 * are open.
 *
 * ── It stopped being a page ────────────────────────────────────────────────
 *
 * This was its own screen, reached from a button above the sheet, with its own
 * back chevron and its own title. That made two ways to look at sheets on one
 * game — this one before the lock, "Other picks" after it — which is two names
 * and two routes for one job.
 *
 * It is now the same sub-tab in both phases. The header went with the page: a
 * sub-tab bar directly above it already says what this is, and a title under a
 * tab of the same name is the duplicate-heading bug this feature has now hit
 * four times. The chevron went too — the way back is the other sub-tab.
 *
 * What is left is the LIST, which is the part that was ever specific to this
 * phase: before the lock these rows are people you may enter FOR, and after it
 * the same slot holds everyone whose sheet you may read (`PickemOtherPicks`).
 * Different question, different source, same place on the screen.
 *
 * ── THE LIST IS THE PERMISSION ─────────────────────────────────────────────
 *
 * `pickem_sheet_status` returns exactly the people the caller may act for, as
 * decided by `_pickem_can_proxy_for` — the same predicate that gates the write
 * and the read. A plain participant gets one row (themselves), the viewer is
 * removed from their own list upstream, and so this surface never appears for
 * them AT ALL without any role test in the client.
 *
 * A client-side role check would be a second copy of the policy, and two copies
 * drift. This one cannot, because it is not a copy. **Do not add one.**
 *
 * The one thing `canEdit` decides here is the TITLE — whether to say
 * "Everyone's sheets" or "Your team's sheets". That is a label, not a gate: it
 * changes no row, admits nobody and refuses nobody, and getting it wrong would
 * misname a list rather than leak one.
 *
 * ── A guest reads differently, and structurally must ───────────────────────
 *
 * A guest has no `auth.uid()`, so `pickem_picks_write` can never match them —
 * they can NEVER enter their own sheet. "No sheet yet" implies they might yet
 * do it themselves and sends somebody off to chase a person who cannot act, so
 * their row reads "Hasn't signed up" and they sort first. Both live in
 * `targetStatusLabel` / `sortTargets`, shared with whatever else lists people.
 */

export function PickemSheetsList({
  targets,
  runner,
  scopeName,
  avatarFor,
  onPick,
}: {
  /** Straight from `pickem_sheet_status`, minus the viewer. Never filtered here. */
  targets: ProxyTarget[];
  /** Titles the screen. A LABEL — see the note above; it gates nothing. */
  runner: boolean;
  /** The viewer's own team, for the captain's scope line. Null when they have none. */
  scopeName: string | null;
  avatarFor: (userId: string) => { avatarIcon: string | null; teamColor: string | null };
  onPick: (t: ProxyTarget) => void;
}) {
  const sorted = sortTargets(targets);
  const waiting = sorted.filter((t) => !t.submitted).length;

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-sheets-list">
      {/* ONE line where a title, a chevron and a scope line used to be.
          The sub-tab above says what this is, so a heading here would be the
          same word twice; the other sub-tab is the way back, so a chevron would
          be a second one. What no control says is WHOSE list this is — a
          captain sees their team, a runner sees everybody — and how many are
          still out, which is the only thing on this screen anybody is chasing. */}
      <div
        className="flex items-baseline gap-2 px-1"
        style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)" }}
      >
        <span className="min-w-0 flex-1 truncate">
          {runner || !scopeName
            ? `Everyone but you · ${targets.length} sheet${targets.length === 1 ? "" : "s"}`
            : `${scopeName} · your ${targets.length} teammate${targets.length === 1 ? "" : "s"}`}
        </span>
        <span
          className="shrink-0"
          data-testid="pickem-sheets-waiting"
          style={{
            color: waiting > 0 ? "var(--color-bt-owner)" : "var(--color-bt-text-dim)",
            fontWeight: waiting > 0 ? 600 : 400,
          }}
        >
          {waiting === 0 ? "Everyone’s in" : `${waiting} still to come`}
        </span>
      </div>

      {sorted.map((t) => {
        const a = avatarFor(t.userId);
        return (
          <button
            key={t.userId}
            type="button"
            onClick={() => onPick(t)}
            data-testid={`pickem-proxy-target-${t.userId}`}
            className="flex items-center gap-2.5 px-3 text-left active:scale-[0.99]"
            style={{
              minHeight: 52,
              borderRadius: 12,
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            {/* The shared Avatar, identity as everywhere else.
                The design tints this amber when a sheet is missing; that is not
                done here because colour on an avatar already MEANS something in
                this app — it is the person's team — and a second meaning on the
                same disc would make "no sheet yet" and "on the amber team" the
                same picture. The waiting signal is on the label instead, which
                has no competing job. */}
            <Avatar
              name={t.name}
              avatarIcon={a.avatarIcon}
              teamColor={a.teamColor}
              sizePx={32}
              muted={t.isGuest}
            />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate"
                style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 600 }}
              >
                {t.name}
              </span>
              {t.side && (
                <span
                  className="block truncate"
                  style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
                >
                  {t.side}
                </span>
              )}
            </span>
            <span
              className="shrink-0"
              style={{
                fontSize: TYPE_SCALE.caption,
                fontWeight: t.submitted ? 400 : 600,
                color: t.submitted ? "var(--color-bt-text-dim)" : "var(--color-bt-owner)",
              }}
            >
              {targetStatusLabel(t)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * DELETED: `PickemSheetsButton`.
 *
 * It was the way into this list when the list was a page — a header button that
 * opened a screen. There is no screen now: the list is a sub-tab, and the
 * sub-tab bar is the control.
 *
 * Its one real idea survives in that bar: it rendered only when the server had
 * given the viewer somebody to act for, deciding on the ROW COUNT rather than
 * on a role. The Other picks sub-tab is gated the same way while picks are
 * open, for the same reason — a client-side role test would be a second copy of
 * a policy that exists in one place.
 */
