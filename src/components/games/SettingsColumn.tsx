/**
 * SettingsColumn — the ONE spacing home for the game-settings page. A single
 * uniform gap between every section header (ZoneHeader) and every row
 * (ChecklistRow / panel / button), so no section is cramped and no two rows sit
 * flush. `ZoneHeader`'s own `pt-2` gives section breaks a touch more air on top
 * of the gap.
 *
 * This replaced the ad-hoc per-item margins (mt-6 / mt-2.5 / mt-2 / mt-3) that
 * had drifted apart across the layouts and left the reported 0px gaps
 * (Options→Handicaps, Course→Points). Rows carry NO margin of their own — the
 * gap is owned HERE, in one place, so the spacing can't diverge per format again.
 * (It has one caller now, `GameSettingsPage`, which is the stronger version of
 * the same guarantee — there is no longer a per-format tree to diverge.)
 *
 * There is deliberately NO `className` escape hatch. There was one, added by the
 * very commit that extracted this component to standardize the spacing (#556),
 * and it was used exactly once: match passed `className="pb-4"`, carried verbatim
 * from the ad-hoc `<div className="flex flex-col gap-2.5 pb-4">` it had before
 * (#545). So the commit that ended per-format spacing shipped the mechanism that
 * let one format keep its own, and match's settings column sat 36px above the
 * save bar while the other three sat 20px for two phases. An escape hatch on a
 * component whose purpose is uniformity will be used to defeat it.
 *
 * 20px is the number, and it comes from `SettingsSlideOver`, not from here: its
 * scroll body is `px-4 py-5`, symmetric top and bottom. The save bar is a
 * `flex-shrink-0` SIBLING below that body, with its own border and background —
 * it does not overlay the content, so there is nothing for a page to pad clear of.
 */
export function SettingsColumn({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2.5">{children}</div>;
}
