"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dice5, Lightbulb, Luggage, PanelLeftClose, PanelLeftOpen, Plus, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { getEffectiveStatus } from "@/lib/tripStatus";
import { readQuickGameState, quickGameSubtitle } from "@/lib/quickGame";
import { compareActive, comparePast, compareIdea } from "@/lib/tripSort";
import { ROLE_COLOR, type BadgedRole } from "@/lib/roleColor";
import { useIsShellDesktop } from "./breakpoints";
import { useRailWidth, RAIL_STRIP_PX, RAIL_MIN_PX, RAIL_CONTRACTED_PX } from "./rail/useRailWidth";
import { RailTripRow, RailPastTripRow, RailIdeaTripRow } from "./rail/RailTripRow";
import { CreateTripModal } from "@/components/trips/CreateTripModal";
import type { DestinationMode } from "@/components/DestinationPicker";

/**
 * ContextRail — Home promoted from a tab to a persistent left rail (Phase 5).
 *
 * On mobile there is no room for a permanent context switcher, so Home is a tab.
 * On desktop there is, so it is always visible and Trip/Cup/Chat become content
 * tabs beside it. Same model either way: this is the ONLY thing that changes
 * context.
 *
 * The rail is `hidden lg:flex` — CSS, not a JS branch, so crossing the
 * breakpoint reflows rather than remounting the content beside it.
 *
 * `trips.list` is gated on the breakpoint because CSS can hide an element but
 * cannot stop it fetching, and a phone should not pay for a rail it will never
 * show. Gating a QUERY on a media query is safe in a way that gating a TREE is
 * not: crossing the breakpoint enables the query, it doesn't rebuild anything.
 * The key is shared with the dashboard, so it's usually warm already.
 *
 * ── Also gated on idle (#750) ─────────────────────────────────────────────────
 * `enabled: isDesktop` alone still cost every desktop trip page a THIRD
 * cold-open batch — `useIsShellDesktop` is `useState(false)` corrected in a
 * `useEffect` (`breakpoints.ts`), so ANYTHING gated on it structurally misses
 * the initial mount batch by exactly one tick, every time. That's not
 * incidental timing to chase into an earlier tick; it's how the hook is
 * built, so "collapse it into an existing batch" isn't on the table while
 * the breakpoint gate works this way.
 *
 * So this defers instead of trying to win a spot in the critical-path
 * batches: `useIdle` holds `enabled` false until the browser reports it has
 * nothing more pressing to do, which is well after the queries the user is
 * actually waiting on (trip content, chrome) have already gone out. Same
 * shape as the Phase 3 lazy-mount decision — don't pay for a surface nobody
 * has looked at yet, even one that's always on screen. The rail still fills
 * in almost immediately in practice; it just never competes for the cold
 * path's batch window.
 *
 * ── The cache policy on this key is DELIBERATELY not shared (#764) ───────────
 * `trips.list` has three observers (this rail, `DashboardClient`,
 * `FeedbackModal`) and they all resolve to the SAME React Query key —
 * `undefined` input is omitted from the tRPC key, so there is one query, not
 * three. (It was five until #812 removed the unreachable `TripSwitcher` and
 * `TopNav`'s query, which existed only to feed it.) This site is the ONLY one
 * that overrides the cache policy, and the
 * override is intentional and bounded. Read `DashboardClient`'s note beside its
 * own `trips.list` call before changing either one; the two are a pair.
 *
 * WHY `STRUCTURE_QUERY` IS SAFE HERE, precisely. It is NOT because the list
 * can't go stale — it can, and nothing on this key can invalidate the ways it
 * goes stale across devices:
 *
 *   - Being ADDED to a trip, REMOVED from one, or having your role changed are
 *     all done by SOMEONE ELSE'S client. There is no invalidation path and no
 *     Realtime path either — `useRealtimeMembers` is per-trip
 *     (`trip_id=eq.{tripId}`), invalidates `tripMembers.list` and not this key,
 *     and by construction cannot fire for a trip you don't yet know about.
 *   - A trip renamed / re-dated by another Organizer is the same shape.
 *
 * What makes that tolerable is NOT `gcTime`. Under `staleTime: Infinity`
 * nothing is ever stale, and `refetchOnMount: true` is gated on staleness
 * (`shouldFetchOnMount` → `isStale`, query-core) — so within one page session
 * this observer refetches on an explicit invalidate and on nothing else. The
 * 30-minute `gcTime` only produces a refetch when EVERY observer has been
 * unmounted for longer than that. The actual in-session refresh comes from
 * `DashboardClient`'s observer, which inherits the 60s default and is mounted
 * at `lg+` too (`AppShell.tsx` keeps `home` under `lg:hidden`) — so any visit
 * to Home refreshes the shared cache and this rail reads the result.
 *
 * THE CONSEQUENCE, stated so the next reader doesn't have to rediscover it:
 * putting `DashboardClient` on this same policy would remove the only path
 * that refreshes this key inside a session. Don't "converge" the two without
 * first adding invalidation on the membership mutations.
 */

/** True once the browser reports it's idle, or after one tick as a fallback
 *  where `requestIdleCallback` doesn't exist (Safari). Stays `false` while
 *  `!enabled`, so nothing is scheduled on mobile at all. */
function useIdle(enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => setIdle(true));
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setIdle(true), 1);
    return () => window.clearTimeout(id);
  }, [enabled]);
  return idle;
}

type Entity = "trips" | "ideas" | "games";

/** `trips.list` selects `*`, so these were always on the wire — the rail simply
 *  didn't read them. Dates drive the section split and the countdown band;
 *  `hasCompetition` drives the trophy mark. */
interface TripRow {
  id: string;
  title: string;
  locked_destination_location?: string | null;
  location?: string | null;
  myRole?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  locked_destination_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  hasCompetition?: boolean | null;
  /** Candidates under consideration — folded in by `trips.list`, counted
   *  server-side rather than shipped as rows. */
  ideaCount?: number | null;
}

export function ContextRail({ activeTripId }: { activeTripId: string | null }) {
  const router = useRouter();
  const isDesktop = useIsShellDesktop();
  const idle = useIdle(isDesktop);
  /**
   * `isError` is read, not swallowed. This used to be a bare `data: trips = []`,
   * which renders a FAILED fetch identically to a successful empty one — the
   * rail simply showed no trips, with no way to tell "you're in no trips" apart
   * from "the request failed" (#764).
   */
  const {
    data: trips = [],
    isError,
    refetch,
  } = trpc.trips.list.useQuery(undefined, {
    ...STRUCTURE_QUERY,
    enabled: isDesktop && idle,
  });

  const rows = trips as TripRow[];
  // Which LIST is showing. Not persisted: it is a position ("what am I looking at
  // right now"), not a preference, and the trips list is the right thing to land
  // on every time — the precedent split is in `useRailWidth`'s note.
  const [entity, setEntity] = useState<Entity>("trips");

  /**
   * Which list the ACTIVE trip lives in — `null` when no trip is open.
   *
   * An idea-phase trip is a trip: same crew, same chat, same context. It is a
   * different LIST of the same thing, not a different kind of thing, which is
   * what keeps the strip coherent (Trips, Ideas, Games are all containers you
   * can be inside of).
   */
  const activeList: Entity | null = (() => {
    if (!activeTripId) return null;
    const t = rows.find((r) => r.id === activeTripId);
    if (!t) return null;
    return getEffectiveStatus(t) === "idea" ? "ideas" : "trips";
  })();

  /**
   * Follow the trip you are IN when it changes list.
   *
   * Locking a destination moves a trip from Ideas to Trips while you are looking
   * at it — `lockDestination` invalidates `trips.list` and you stay on the trip
   * page. Without this the row would simply vanish from the list beside you, and
   * a trip disappearing from the switcher while you are inside it reads as losing
   * it, not as progress.
   *
   * Deliberately targeted at the ACTIVE trip's own transition rather than a
   * general "always show the active trip's list": browsing Games or Ideas while
   * sitting in a placed trip is a legitimate thing to be doing, and yanking the
   * strip back on every render would fight the user. `activeList` only changes
   * when the trip itself moves.
   */
  const { width: railWidth, wide, collapsed, collapse, setWidth } = useRailWidth();
  const columnRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * The floor to reopen to, captured at the moment of COLLAPSE.
   *
   * "Reopen to the minimum" means the measured minimum, and the measurement
   * needs the rows on screen — which is exactly what collapsing takes away. So
   * it is read on the way down, while the column is still rendered, rather than
   * guessed on the way back up. A rail that has only ever been collapsed by a
   * cold-loaded `0` falls back to `RAIL_MIN_PX`, and the first drag re-measures
   * anyway.
   */
  const reopenFloor = useRef(RAIL_MIN_PX);

  /**
   * The drag floor — the widest rendered trip NAME, so nothing truncates that
   * didn't have to.
   *
   * MEASURED ONCE PER DRAG, at pointerdown, rather than per render. Measuring on
   * every render would be a layout read in the render path of a component that
   * re-renders on every trip switch; measuring once when a drag STARTS is O(rows)
   * a handful of times per session, always current, and costs the render path
   * nothing. That is the middle answer between "measure constantly" (expensive)
   * and "hardcode a floor" (wrong the moment someone has a long trip name).
   *
   * ── WHAT is measured changed when titles started wrapping ──────────────────
   * This used to read `scrollWidth` — the untruncated width of a single clamped
   * line. Under `line-clamp-2` that number is WRONG in a way that would freeze
   * the drag outright: a wrapping block has no horizontal overflow, so its
   * `scrollWidth` equals its current rendered width, and the floor would come
   * back as "however wide the rail happens to be right now" — a rail that can
   * never be narrowed from wherever it was last left.
   *
   * The honest question for a wrapping name is its MIN-CONTENT width: the
   * longest single word, because that is the only part that genuinely cannot
   * get narrower. This is what item 1 buys — "International Federation of
   * Having Fun 2026" stops asking for the width of 38 characters and asks for
   * the width of "International". The floor is no longer hostage to the longest
   * name; it is hostage only to the longest WORD, which is a far lower bar.
   *
   * Measured in two passes (write all, then read all) rather than
   * write-read-write per row: interleaving would force a synchronous layout per
   * name, and this runs on pointerdown with every visible row in the column.
   * `display: block` is set alongside it because `line-clamp-2` renders as a
   * `-webkit-box`, where intrinsic width sizing is not something to rely on.
   */
  const measureFloor = () => {
    const el = columnRef.current;
    if (!el) return RAIL_MIN_PX;
    const names = Array.from(el.querySelectorAll<HTMLElement>("[data-rail-name]"));
    if (names.length === 0) return RAIL_MIN_PX;

    // The name sits in a row with padding, the art slot and the gaps around it.
    // Derived from the row's own box rather than a second hand-typed number: the
    // difference between the row's inner width and the name's own width IS the
    // chrome, whatever the row's padding happens to be. Read BEFORE the
    // min-content pass below, which changes the name's box on purpose.
    const name = names[0]!;
    const row = name.closest<HTMLElement>("[data-testid^='rail-trip']");
    const chrome = row
      ? Math.max(0, row.getBoundingClientRect().width - name.getBoundingClientRect().width)
      : 24;

    const restore = names.map((n) => ({ n, display: n.style.display, width: n.style.width }));
    for (const { n } of restore) {
      n.style.display = "block";
      n.style.width = "min-content";
    }
    let widest = 0;
    for (const { n } of restore) {
      widest = Math.max(widest, n.getBoundingClientRect().width);
    }
    for (const { n, display, width } of restore) {
      n.style.display = display;
      n.style.width = width;
    }

    // CAPPED at the narrow snap, and that cap is the important half.
    //
    // "The widest trip name" taken literally locks the rail: one long title
    // measures wider than the MAXIMUM, the floor lands above the ceiling, and the
    // divider refuses to move at all. Which protects nothing — that name is
    // already truncating at the wide snap, so refusing to narrow doesn't save it.
    //
    // The floor is therefore "as narrow as the names allow, but never tighter
    // than the width that already shipped". Short names → drag down to
    // `RAIL_MIN_PX`; long names → stop at the narrow snap, where nothing
    // truncates that didn't truncate before. Wrapping means far fewer names
    // reach that cap at all, but the cap stays: it is what makes a pathological
    // name a wart rather than a lock.
    const measured = Math.ceil(widest + chrome);
    return Math.min(RAIL_CONTRACTED_PX, Math.max(RAIL_MIN_PX, measured));
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const floor = measureFloor();
    const startX = e.clientX;
    const startW = railWidth;
    setDragging(true);
    const onMove = (ev: PointerEvent) => setWidth(startW + (ev.clientX - startX), floor);
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // On WINDOW, not the handle: a fast drag outruns a 5px-wide element, and
    // pointer events stop firing on it the moment the cursor leaves. The window
    // keeps receiving them wherever the pointer goes.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /**
   * The button: collapse ⇄ reopen to the minimum. NOT a second width control —
   * it does the one thing the drag deliberately cannot (`clampRailWidth` never
   * returns the collapsed value), and it reopens to the floor rather than to
   * wherever you last left it, so it never competes with the divider to express
   * a width.
   *
   * Dragging OUT of a collapsed rail also works and is not a third mechanism:
   * it is the same `setWidth`, and its floor comes back as `RAIL_MIN_PX`
   * because there are no rows to measure. The next drag measures properly.
   */
  const collapseRail = () => {
    reopenFloor.current = measureFloor();
    collapse();
  };
  const openRail = () => setWidth(reopenFloor.current, reopenFloor.current);
  const toggleCollapsed = () => (collapsed ? openRail() : collapseRail());

  /**
   * A strip entry TOGGLES the list it names.
   *
   * Trips/Ideas/Games paint a selected state, which is a promise: a highlighted
   * control that cannot be un-highlighted by the control itself is the
   * affordance lying. Re-clicking the open list now closes the panel, and
   * clicking any entry while collapsed opens it — the standard behaviour for an
   * icon rail beside a panel (VS Code's Activity Bar is the canonical
   * implementation, and it is enough of a convention that editors copying it get
   * bug reports when they diverge).
   *
   * NOT a new width mechanism. It calls the same `collapseRail`/`openRail` the
   * button does, so there remain exactly two ways to size the rail — collapsed,
   * or a dragged width — and the strip is a third CALLER of one of them, not a
   * third state.
   *
   * The paired half is `active={!collapsed && ...}` below: while collapsed no
   * entry reads as selected, because no list is showing. Without that the strip
   * would still be claiming an open panel that isn't there — the same lie in the
   * other direction.
   */
  const selectEntity = (next: Entity) => {
    if (!collapsed && entity === next) {
      collapseRail();
      return;
    }
    setEntity(next);
    if (collapsed) openRail();
  };

  /**
   * Publish the rail's TOTAL width so the top bar's tab group can align to its
   * right edge.
   *
   * `breakpoints.ts` used to be that single source (`RAIL_WIDTH_PX`, read by both
   * the rail and `TopNav`), and its own comment warned that two hand-typed 246s
   * drifting apart is "exactly the class of bug" to avoid. Phase 2 caused that
   * drift: the rail became a 62px strip plus a 246–296px column, and `TopNav` was
   * left offsetting by 246 — so the tabs sat 62–112px inside the rail.
   *
   * A constant can't be the source any more, because the width is now stateful
   * (the expand/contract toggle). A CSS variable can, and it is the pattern this
   * shell already uses for exactly this reason — `AppTabBar` publishes
   * `--bt-bottomnav-height` so its consumers track it without importing anything.
   */
  const totalWidth = RAIL_STRIP_PX + railWidth;
  useEffect(() => {
    document.documentElement.style.setProperty("--bt-rail-width", `${totalWidth}px`);
  }, [totalWidth]);

  // Adjusted during RENDER, not in an effect. React's documented shape for
  // "change state when a value changes" — it re-renders before committing, so
  // there is no flash of the wrong list, and it is what the compiler lint asks
  // for instead of `setState` inside `useEffect`. Seeded from `activeList` so a
  // fresh mount never counts as a transition.
  const [lastList, setLastList] = useState<Entity | null>(activeList);
  if (activeList && activeList !== lastList) {
    setLastList(activeList);
    setEntity(activeList);
  }

  // Which row is mid-switch. `useTransition` is the same mechanism `TripCard`
  // uses — it tracks router.push from click to the new route rendering, so the
  // flag paints immediately rather than after the route bundle loads. The id is
  // held alongside it because `isPending` alone can't say WHICH row was tapped,
  // and lighting up the whole rail would be worse than lighting up none of it.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [isSwitching, startSwitch] = useTransition();
  const pendingTripId = isSwitching ? switchingTo : null;

  /**
   * The create flow, open as a modal over the rail. `null` = closed; the value
   * is the path the entry point pre-selects (item 4), so ONE piece of state
   * carries both "is it open" and "which + was pressed" — a separate boolean
   * would be a second thing to keep in step for no gain.
   */
  const [creating, setCreating] = useState<DestinationMode | "closed">("closed");

  const openTrip = (id: string) => {
    // Re-tapping the trip you're already in is a no-op today (Next renders the
    // same route and nothing moves), so don't flash a spinner that would never
    // resolve into a visible change.
    if (id === activeTripId) return;
    setSwitchingTo(id);
    startSwitch(() => {
      router.push(`/trips/${id}`);
    });
  };

  return (
    /**
     * `lg:flex lg:flex-col` + `min-h-0` + an inner scroll body, rather than one
     * `overflow-y-auto` box: the aside now FILLS the bounded shell column
     * (AppShell's root is `lg:h-dvh` and every flex ancestor carries `min-h-0`),
     * so the rail is viewport-height with 2 trips or 20, and only its body
     * scrolls — it can never push the page taller. Before this it had
     * `overflow-y-auto` with no bounded height, which does nothing: the box just
     * grew to its content, and `lg:items-stretch` on the parent stretched it to
     * whatever the CONTENT column happened to be.
     */
    <aside
      className="relative hidden shrink-0 lg:flex lg:min-h-0"
      data-testid="context-rail"
    >
      {/* ── Level one: the entity strip ──────────────────────────────────────
          WHICH LIST you are looking at. Deliberately not the same axis as the top
          bar's Trip · Cup · Chat, which is navigation WITHIN a trip — two levels
          of navigation competing for the same glance would be worse than the one
          level we had. Each entry is a kind of thing you own a list of; Circles
          and Competitions are the obvious later members. */}
      <nav
        className="flex shrink-0 flex-col items-center gap-[3px] py-2.5"
        style={{
          width: RAIL_STRIP_PX,
          background: "var(--color-bt-chrome)",
          borderRight: "1px solid var(--color-bt-border)",
        }}
        aria-label="Lists"
      >
        {/* NOT the flag. A golf flag means nothing on its own here — it reads as
            a course marker, and it is the glyph `StandardGrid` and
            `GameSetupRows` use for exactly that.

            NOT a plane either, and that is the collision check earning its keep
            (the same check that found `Dices` was taken for Games). `Plane` is
            already `{ key: "flying", label: "Flying" }` in `ItineraryView`, the
            Arrivals group header, and `TravelControls`; `PlaneTakeoff` is
            Departures and `PlaneLanding` is the arrival leg — all three plane
            glyphs are spoken for. And unlike the `Dices`/`Dice5` case, these
            WOULD share a glance: the rail is persistent on desktop while the
            Schedule tab shows itinerary rows. The brief asked for a plane on the
            grounds that it "doesn't imply flying" — in this codebase it is
            literally the icon labelled "Flying", so the premise doesn't hold
            here even though it's fair in general.

            `Luggage` keeps everything the plane was wanted for — it reads as
            travel instantly and implies going somewhere rather than a mode of
            transport, so it fits an idea-phase trip as well as a booked one —
            and it is used nowhere else in the app. */}
        <StripItem
          icon={<Luggage size={19} />}
          label="Trips"
          active={!collapsed && entity === "trips"}
          onClick={() => selectEntity("trips")}
        />
        {/* Ideas is a different LIST of the same thing, not a different kind of
            thing — an idea-phase trip has crew, chat and a real trip context. It
            earns a strip entry because Phase 2 made it unreachable on desktop
            (ideas left the rail), and mobile already has a home for it. */}
        <StripItem
          icon={<Lightbulb size={19} />}
          label="Ideas"
          active={!collapsed && entity === "ideas"}
          onClick={() => selectEntity("ideas")}
        />
        {/* NOT the trophy. The trophy means COMPETITION — it marks trip rows that
            have a cup and it is the Cup tab — so using it here said games are
            competitions, which is the opposite of what this entity holds:
            standalone play with no cup attached.

            `Dice5` is play, generically. Not golf-specific (Games will hold
            cornhole, euchre, pool), not video-game-specific the way a gamepad or
            joystick would read, and unused anywhere else. One adjacency worth
            knowing: `Dices` (three dice) is `CATEGORY_ICONS.other`, so the family
            is shared — deliberately, since both mean "play" — but the glyphs are
            distinct and they never appear in the same context. `Dices` itself was
            the obvious pick and is taken, which is the same collision this item
            exists to remove. */}
        <StripItem
          icon={<Dice5 size={19} />}
          label="Games"
          active={!collapsed && entity === "games"}
          onClick={() => selectEntity("games")}
        />
        <div className="flex-1" />
        {/* COLLAPSE ⇄ reopen-to-minimum, not snap-wide/snap-narrow. The two
            snaps were 50px apart, which is not a range worth a divider — the
            button and the drag were expressing the same 50px. They are split by
            KIND now: this takes the list away entirely, the divider owns every
            width in between. (This reverses the previous spec; the reasoning
            lives in `useRailWidth`.) */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Show the list" : "Hide the list"}
          aria-expanded={!collapsed}
          title={collapsed ? "Show the list" : "Hide the list"}
          data-testid="rail-width-toggle"
          data-collapsed={collapsed || undefined}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition-colors hover:border-[var(--color-bt-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bt-accent)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </nav>

      {/* ── Level two: the list ──────────────────────────────────────────────
          Background matches the strip, not the main viewport, so the two read as
          one chrome region rather than the column reading as content.

          UNMOUNTED when collapsed, not merely `width: 0`. A zero-width box with
          `overflow-y-auto` keeps every row in the accessibility tree and in the
          tab order — a collapsed rail you can still tab through row by row is
          worse than one that animates. The cost is that collapsing snaps rather
          than eases; reopening eases, because the box mounts at 0 and the
          transition carries it out. */}
      {!collapsed && (
      <div
        ref={columnRef}
        className="min-h-0 flex-1 overflow-y-auto"
        style={{
          width: railWidth,
          background: "var(--color-bt-chrome)",
          borderRight: "1px solid var(--color-bt-border)",
          // No transition WHILE dragging — an eased width would lag the pointer
          // and the divider would swim away from the cursor. The snap button
          // still animates, which is what makes the two states read as a jump
          // rather than a glitch.
          transition: dragging ? undefined : "width 180ms ease",
        }}
        data-testid="rail-column"
        data-wide={wide || undefined}
        data-dragging={dragging || undefined}
      >
        {entity === "ideas" ? (
          <IdeasColumn
            rows={rows}
            isError={isError}
            onRetry={() => void refetch()}
            activeTripId={activeTripId}
            pendingTripId={pendingTripId}
            onOpen={openTrip}
            onNew={() => setCreating("exploring")}
          />
        ) : entity === "trips" ? (
          <TripsColumn
            rows={rows}
            isError={isError}
            onRetry={() => void refetch()}
            activeTripId={activeTripId}
            pendingTripId={pendingTripId}
            // The art drops in the narrow half — same midpoint the snap button
            // reads, so "wide" means one thing. Contraction still drops the
            // silhouette first; name, location, dates and countdown all survive.
            expanded={wide}
            onOpen={openTrip}
            onNew={() => setCreating("known")}
          />
        ) : (
          <GamesColumn onPlay={() => router.push("/quick-game")} />
        )}
      </div>
      )}

      {/* The divider. A 5px grab strip over the column's right border — wider
          than the 1px line so it is catchable, and `col-resize` says so before
          you press. Not focusable and not keyboard-operable ON PURPOSE: the
          button beside it reaches both ends of the range from the keyboard
          (collapsed, and the minimum), so the drag is an enhancement rather than
          the only way to size the rail. It stays mounted while collapsed —
          that's what makes dragging back out possible. */}
      <div
        onPointerDown={startDrag}
        role="separator"
        aria-orientation="vertical"
        aria-hidden="true"
        data-testid="rail-divider"
        // ABSOLUTE, so the grab strip costs no layout width. In flow it net-added
        // 2px (5px wide, -3px margin), which put the rail's real right edge 2px
        // past the width being published — the tabs would align to a number the
        // rail no longer had. The published value and the rendered edge have to
        // be the same thing.
        className="absolute inset-y-0 z-10 w-[5px] cursor-col-resize"
        style={{
          left: totalWidth - 3,
          // Only paints while dragging — a permanently visible grab strip would
          // double the border the column already draws.
          background: dragging ? "var(--color-bt-accent)" : undefined,
        }}
      />

      {/* The create flow, over the rail rather than instead of it. Mounted
          conditionally, which is what `useModalBackButton`'s usage pattern 1
          and `ScrollLock` both ask for. */}
      {creating !== "closed" && (
        <CreateTripModal initialMode={creating} onClose={() => setCreating("closed")} />
      )}
    </aside>
  );
}

/** The key's swatch — the same 3px edge the rows draw, from the same source,
 *  so the legend cannot describe a colour the rows don't paint. */
function KeyEdge({ role }: { role: BadgedRole }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block"
      style={{ width: 3, height: 11, borderRadius: 2, background: ROLE_COLOR[role].text }}
    />
  );
}

/** One entity in the narrow strip — icon over label. */
function StripItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      data-testid={`rail-entity-${label.toLowerCase()}`}
      className="flex w-12 flex-col items-center gap-[3px] rounded-[9px] py-[7px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
      style={{
        background: active ? "var(--color-bt-accent-faint)" : undefined,
        color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
      }}
    >
      {icon}
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  );
}

/**
 * The trips list.
 *
 * Two sections, and the third is deliberately absent: IDEAS never reaches the
 * rail. An idea is destination imagery, price bands and course counts — that is
 * main-viewport content (the archived-ideas screen), not a sidebar row, and
 * rendering a stripped-down version here would be a worse version of a screen
 * that already exists.
 */
function TripsColumn({
  rows,
  isError,
  onRetry,
  activeTripId,
  pendingTripId,
  expanded,
  onOpen,
  onNew,
}: {
  rows: TripRow[];
  isError: boolean;
  onRetry: () => void;
  activeTripId: string | null;
  pendingTripId: string | null;
  expanded: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  // `getEffectiveStatus` is the SAME derivation the dashboard sections on, so the
  // two lists can't disagree about what's active. now + upcoming both read as
  // "Active" here: the rail's job is which trips are live concerns, and the
  // dashboard's finer split is a main-viewport distinction.
  const active: TripRow[] = [];
  const past: TripRow[] = [];
  for (const t of rows) {
    const status = getEffectiveStatus(t);
    if (status === "idea") continue;
    if (status === "past") past.push(t);
    else active.push(t);
  }
  // The SAME comparators the dashboard sorts with (`@/lib/tripSort`). This
  // column previously did not sort at all — it rendered `trips.list`'s own
  // order — so the two surfaces showed one list two ways. The dashboard splits
  // Active into `now` and `upcoming`; that is a sectioning difference, and
  // `compareActive` is correct applied to the merged set here or to either half
  // there.
  active.sort(compareActive);
  past.sort(comparePast);

  return (
    <div className="p-2">
      <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
        <span className="flex-1 text-[16px] font-bold" style={{ color: "var(--color-bt-text)" }}>
          Trips
        </span>
        <EyebrowAction label="Start a trip" onClick={onNew} />
      </div>

      {/* The key — every mark explained ONCE, here, instead of every row carrying
          its own label. A row is read every time; a key is read once.

          ONE line for all three marks. It was two rows, because two role edges
          plus the cup mark did not fit on one at the narrow end — "Has a cup"
          shortened to "Cup" is what buys the third slot back. Nothing is lost:
          the mark is a trophy sitting beside a list of trips, so "Cup" is not
          ambiguous in place, and the longer phrase was carrying a verb the
          reader supplies for free.

          Historical note kept because it was a reversal: this line once read
          "Admin", a single amber edge meaning "Owner or Organizer" — a name for
          a rights tier this app does not have. The previous spec moved it from
          "Yours to run" to "Admin"; #904 replaced the grouping with two edges
          matching the badges, which need no collective noun at all. */}
      <div
        className="flex flex-wrap items-center gap-x-[7px] gap-y-[3px] px-1.5 pb-2 text-[11px]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <KeyEdge role="Owner" />
        <span>Owner</span>
        <span style={{ opacity: 0.35 }}>·</span>
        <KeyEdge role="Organizer" />
        <span>Organizer</span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span
          aria-hidden="true"
          className="inline-flex h-3 w-3 items-center justify-center rounded-full"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
            border: "1px solid var(--color-bt-accent-border)",
          }}
        >
          <Trophy size={7} strokeWidth={2.5} />
        </span>
        <span>Cup</span>
      </div>

      {isError ? (
        <RailLoadError onRetry={onRetry} />
      ) : (
        <>
          <Section label="Active" count={active.length}>
            {active.map((t) => (
              <RailTripRow
                key={t.id}
                trip={t}
                current={t.id === activeTripId}
                pending={pendingTripId === t.id}
                expanded={expanded}
                onOpen={() => onOpen(t.id)}
              />
            ))}
          </Section>
          <Section label="Past" count={past.length}>
            {past.map((t) => (
              <RailPastTripRow
                key={t.id}
                trip={t}
                current={t.id === activeTripId}
                pending={pendingTripId === t.id}
                onOpen={() => onOpen(t.id)}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

/**
 * The Ideas list — trips with no destination locked yet.
 *
 * These vanished from desktop entirely when Phase 2 dropped ideas from the rail:
 * a trip you had started, added organizers to and begun comparing destinations in
 * appeared nowhere. The rule was right (the app is destination-first, and a trip
 * without one genuinely isn't placed), but the state needed a home. Mobile always
 * had one — the dashboard's IDEAS section — so this restores parity rather than
 * inventing a concept.
 *
 * NOT the destination library. The curated twenty and a user's archived ideas are
 * reference data the comparison flow reads, not containers you can be inside of,
 * and they have no mobile home either. Separate work.
 */
function IdeasColumn({
  rows,
  isError,
  onRetry,
  activeTripId,
  pendingTripId,
  onOpen,
  onNew,
}: {
  rows: TripRow[];
  isError: boolean;
  onRetry: () => void;
  activeTripId: string | null;
  pendingTripId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const ideas = rows.filter((t) => getEffectiveStatus(t) === "idea").sort(compareIdea);
  return (
    <div className="p-2">
      <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
        <span className="flex-1 text-[16px] font-bold" style={{ color: "var(--color-bt-text)" }}>
          Ideas
        </span>
        <EyebrowAction label="Start a trip" onClick={onNew} />
      </div>

      {isError ? (
        <RailLoadError onRetry={onRetry} />
      ) : ideas.length === 0 ? (
        <p className="px-1.5 pb-2 text-[12.5px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
          Trips without a destination yet will collect here.
        </p>
      ) : (
        ideas.map((t) => (
          <RailIdeaTripRow
            key={t.id}
            trip={t}
            current={t.id === activeTripId}
            pending={pendingTripId === t.id}
            onOpen={() => onOpen(t.id)}
          />
        ))
      )}
    </div>
  );
}

/** The Games list. History is a stub until finished games are tracked. */
function GamesColumn({ onPlay }: { onPlay: () => void }) {
  const quick = useQuickGameSummary();
  return (
    <div className="p-2">
      <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
        <span className="flex-1 text-[16px] font-bold" style={{ color: "var(--color-bt-text)" }}>
          Games
        </span>
        <EyebrowAction label="Play a game" onClick={onPlay} />
      </div>

      {/* No `count`: this section renders even when empty, so the column says
          "nothing in progress" rather than opening on History alone and reading
          as though the list failed to load. `Section` hides at count 0, which is
          right for the trips list (no Past section on a first trip) and wrong
          here — the difference is that Games has only two sections, and hiding
          one leaves almost nothing. */}
      <Section label="In progress">
        {quick ? (
          <button
            type="button"
            onClick={onPlay}
            data-testid="rail-game-inprogress"
            className="mb-[3px] block w-full rounded-[9px] p-2.5 text-left transition-colors hover:bg-[var(--color-bt-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <div className="truncate text-[14px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {quick.title}
            </div>
            {quick.subtitle && (
              <div className="mt-[3px] truncate text-[12.5px]" style={{ color: "var(--color-bt-text-dim)" }}>
                {quick.subtitle}
              </div>
            )}
          </button>
        ) : (
          <p className="px-1.5 pb-2 text-[12.5px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            Nothing in progress.
          </p>
        )}
      </Section>

      <Section label="History">
        <p className="px-1.5 pb-2 text-[12.5px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
          Finished games will collect here.
        </p>
      </Section>
    </div>
  );
}

/**
 * The in-progress Quick Game, read from the SAME localStorage state and through
 * the SAME `quickGameSubtitle` the dashboard card uses — so the rail and the card
 * cannot crown a different leader or disagree about the hole (#825's lesson: the
 * subtitle runs the same two calls `ScoreEntryView`'s "Leading" badge runs).
 *
 * Read on mount only. Local storage has no change event within a tab, and the
 * rail is not where scores are entered — the game surface is, and it owns the
 * live version.
 */
function useQuickGameSummary(): { title: string; subtitle: string } | null {
  // Lazy initializer, not an effect — same reason as `useRailWidth`: it reads on
  // first render (SSR returns null from `readQuickGameState`'s own window guard),
  // and setState-inside-an-effect is what the React Compiler lint refuses.
  const [summary] = useState<{ title: string; subtitle: string } | null>(() => {
    const state = readQuickGameState();
    return state ? { title: "Quick Stroke Play", subtitle: quickGameSubtitle(state) } : null;
  });
  return summary;
}

/** A grouping header with an optional count. Renders nothing when empty. */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <>
      <div
        className="flex items-center gap-1.5 px-1.5 pb-1.5 pt-2.5 text-[11px] font-bold uppercase"
        style={{ color: "var(--color-bt-text-dim)", letterSpacing: "0.1em" }}
      >
        <span>{label}</span>
        {count != null && <span>{count}</span>}
      </div>
      {children}
    </>
  );
}

/**
 * The column header's "+".
 *
 * There used to be one way to start a trip in this rail: a full-width dashed
 * button at the END of the list. That is a first-run affordance — useful while
 * the list is short, progressively worse as it grows, because it sits below every
 * trip you have. A header action is always in view regardless of list length, and
 * it matches mobile, where the dashboard's "New trip" is a header button too.
 */
function EyebrowAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      // Sized against the 16px column header beside it. It was 24px with a 13px
      // glyph — set against type that has since grown, and small even before.
      className="flex h-7 w-7 items-center justify-center rounded-lg transition-[background-color,transform] hover:bg-[var(--color-bt-hover)] active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
      style={{ border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
      data-testid="rail-add-trip"
    >
      <Plus size={16} />
    </button>
  );
}

/**
 * A FAILED trips fetch, told apart from an empty one (#764). Without this the
 * rail renders both states identically — no rows — and "you're in no trips" is
 * indistinguishable from "the request didn't land".
 */
function RailLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mb-1 px-2.5 py-2">
      <p className="text-[12px]" style={{ color: "var(--color-bt-danger)" }}>
        Couldn&apos;t load your trips.
      </p>
      <button
        type="button"
        onClick={onRetry}
        // Ghost/text-link treatment (STYLE_GUIDE.md §5's "Ghost" variant
        // covers text links). `hover:opacity-70` reuses an existing
        // convention already used for text links elsewhere in the app
        // (e.g. archived-ideas' back link) rather than inventing a value —
        // opacity, not a background wash, since this is bare underlined
        // text with no surface of its own to tint. `active:scale-[0.98]`
        // and the uniform focus ring, same as every other element here.
        className="mt-1 text-[12px] font-semibold underline transition-[opacity,transform] hover:opacity-70 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bt-accent)]"
        style={{ color: "var(--color-bt-accent)" }}
      >
        Try again
      </button>
    </div>
  );
}

