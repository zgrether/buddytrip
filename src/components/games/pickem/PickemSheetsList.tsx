"use client";

import { ChevronLeft, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { TYPE_SCALE } from "@/lib/typeScale";
import { sortTargets, targetStatusLabel, type ProxyTarget } from "./PickemProxyPanel";

/**
 * Screen I — everyone whose sheet you may enter.
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
  onBack,
  onPick,
}: {
  /** Straight from `pickem_sheet_status`, minus the viewer. Never filtered here. */
  targets: ProxyTarget[];
  /** Titles the screen. A LABEL — see the note above; it gates nothing. */
  runner: boolean;
  /** The viewer's own team, for the captain's scope line. Null when they have none. */
  scopeName: string | null;
  avatarFor: (userId: string) => { avatarIcon: string | null; teamColor: string | null };
  onBack: () => void;
  onPick: (t: ProxyTarget) => void;
}) {
  const sorted = sortTargets(targets);
  const waiting = sorted.filter((t) => !t.submitted).length;

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-sheets-list">
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={onBack}
          data-testid="pickem-sheets-back"
          aria-label="Back to your sheet"
          className="-ml-1 flex shrink-0 items-center justify-center"
          style={{ width: 32, height: 32, color: "var(--color-bt-accent)" }}
        >
          <ChevronLeft size={20} />
        </button>
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: 17, fontWeight: 700 }}>
          {runner ? "Everyone’s sheets" : "Your team’s sheets"}
        </span>
        <span
          className="shrink-0"
          data-testid="pickem-sheets-waiting"
          style={{
            fontSize: TYPE_SCALE.caption,
            color: waiting > 0 ? "var(--color-bt-owner)" : "var(--color-bt-text-dim)",
            fontWeight: waiting > 0 ? 600 : 400,
          }}
        >
          {waiting === 0 ? "Everyone’s in" : `${waiting} still to come`}
        </span>
      </div>

      <div
        className="px-1"
        style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)" }}
      >
        {runner || !scopeName
          ? `Everyone but you · ${targets.length} sheet${targets.length === 1 ? "" : "s"}`
          : `${scopeName} · your ${targets.length} teammate${targets.length === 1 ? "" : "s"}`}
      </div>

      {sorted.map((t) => {
        const a = avatarFor(t.userId);
        return (
          <button
            key={t.userId}
            type="button"
            onClick={() => onPick(t)}
            data-testid={`pickem-proxy-target-${t.userId}`}
            className="mx-1 flex items-center gap-2.5 px-3 text-left active:scale-[0.99]"
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
 * The way in — a header button rather than a block at the bottom of the page.
 *
 * It was under the sheet, which put a captain's job below sixteen rows of their
 * own picks. Up here it is reachable without scrolling past the thing it is not
 * about.
 *
 * Renders only when the server has given the viewer somebody to act for, which
 * is the same "the list is the permission" rule one level up: no role test
 * decides whether this button exists, the row count does.
 */
export function PickemSheetsButton({
  count,
  waiting,
  onOpen,
}: {
  count: number;
  waiting: number;
  onOpen: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="mx-1 flex justify-end">
      <button
        type="button"
        onClick={onOpen}
        data-testid="pickem-sheets-open"
        className="flex items-center gap-1.5 px-2.5"
        style={{
          height: 32,
          borderRadius: 9,
          fontSize: TYPE_SCALE.bodyDense,
          fontWeight: 600,
          background: "transparent",
          border: `1px solid ${waiting > 0 ? "var(--color-bt-warning-border)" : "var(--color-bt-border)"}`,
          color: waiting > 0 ? "var(--color-bt-owner)" : "var(--color-bt-text)",
        }}
      >
        <Users size={14} />
        Sheets
        {waiting > 0 && (
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{waiting}</span>
        )}
      </button>
    </div>
  );
}
