import type { SetupReasonCode } from "./gameReadiness";

/**
 * Opening a game's settings at the row that fixes a problem (Zach's
 * Needs-attention ruling 4, 2026-10-21): `?game=<id>&settings=1&row=<row>`.
 *
 * A row is named by its `ChecklistRow` test id without the `row-` prefix, so the
 * link, the row and the tests share one name. `settingsRows.guard.test.ts`
 * fails if a row named here no longer exists in the settings screens.
 */
export const SETTINGS_ROW_PARAM = "row";

export const SETTINGS_ROWS = [
  "matches",
  "groupings",
  "bracket-pool",
  "total-points",
  "point-distribution",
  "the-picks",
] as const;
export type SettingsRow = (typeof SETTINGS_ROWS)[number];

/** The row each setup reason is fixed in. */
export const SETUP_REASON_ROW: Record<SetupReasonCode, SettingsRow> = {
  matches_none: "matches",
  matches_unpaired: "matches",
  player_not_on_team: "matches",
  groups_none: "groupings",
  bracket_field: "bracket-pool",
  points_missing: "total-points",
  too_many_places: "point-distribution",
  slate_empty: "the-picks",
};

export function parseSettingsRow(value: string | null | undefined): SettingsRow | null {
  return (SETTINGS_ROWS as readonly string[]).includes(value ?? "") ? (value as SettingsRow) : null;
}

/** The `data-testid` a row renders, which is also how the link finds it. */
export function settingsRowTestId(row: SettingsRow): string {
  return `row-${row}`;
}
