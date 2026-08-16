"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { GameActionRow } from "@/components/shell/GameActionRow";
import { CompetitionLeaderboard } from "./CompetitionLeaderboard";
import { CompetitionSettingsModal } from "./CompetitionSettingsModal";
import { RostersOverlay } from "./RostersOverlay";
import { TeamSheet, type Team } from "./TeamsPanel";
import { GameSheet } from "./CompetitionGamesPanel";
import { GAME_TYPES } from "@/lib/gameTypes";
import { isMatchPlayFormat, isRackFormat, isStrokeFormat } from "@/lib/gameRoutes";
import { useCupPanel } from "@/hooks/useCupPanel";
import { gamePanelView } from "./gamePanelView";
import { ScorecardPreviewSheet } from "@/components/games/ScorecardPreviewSheet";
import { useGameChrome } from "@/components/games/GameChrome";
import { useIsShellDesktop } from "@/components/shell/breakpoints";

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status: "upcoming" | "active" | "completed";
  /** Roster-setup progression (building → saved → dismissed) — drives the
   *  Team Rosters button + the "moved to Settings" signpost on the board. */
  roster_setup?: "building" | "saved" | "dismissed";
  /** Scoring-model axis (W-NONGOLF-02), independent of team count. Branches the
   *  non-golf result editor: match_play → win/lose/tie; points → #430 placement.
   *  Defaults to match_play when absent (matches the DB default + backfill). */
  scoring_model?: "match_play" | "points";
}

/**
 * The competition face's surfaces (the setup guide AND the aggregate games panel
 * were both retired — creation lands directly on the bones board):
 *   board    — the leaderboard (the main view for everyone, setup + live)
 *   settings — the consolidated Settings modal (competition details + scoring
 *              model + the reset/delete hatches) — reached from the header gear
 * Settings is a floating CompetitionSettingsModal OVER the still-mounted board —
 * the TripSettingsModal idiom: a card-float overlay whose master menu drills into
 * Competition details / Scoring model / the danger-zone confirms. The modal owns
 * its own back-button interception (useModalBackButton), so the OS/browser back
 * button closes it and returns to the board. (Replaces the old history-pushed
 * full-page sub-surface with its separate "Board" back arrow + a still-visible
 * header gear.)
 * "Add a game" no longer routes to a panel — it opens the GameSheet modal
 * directly over the board; existing games are managed on their per-game pages.
 */

interface Props {
  tripId: string;
  competition: Competition;
  canEdit: boolean;
  isOwner: boolean;
  /** Fired after the owner deletes the competition (host resets its flag). */
  onCompetitionDeleted?: () => void;
}

/**
 * CompetitionFace — the Live face's body: the board (leaderboard) plus the
 * consolidated Settings sub-surface, hosted on the escaped, clean competition
 * chrome (the host page provides Band 1 title bar + bottom nav; this owns
 * Band 2's competition header + the body).
 *
 * The competition is visible to the whole crew the moment it exists (option A —
 * the GO LIVE / setup↔active reveal was removed at the root; per-game
 * Setup/Scoring handles game-level readiness). So there is no setup/live toggle
 * here any more: the board is the home, Settings is a sub-surface reached from
 * the header gear and returns to it.
 *
 * STANDARD PALETTE ONLY (supersession #2) — no competition accent / tonal shift.
 */
export function CompetitionFace({
  tripId,
  competition,
  canEdit,
  isOwner,
  onCompetitionDeleted,
}: Props) {
  const utils = trpc.useUtils();

  // The board is the home in every stage now — creation lands here directly
  // (the setup guide was retired). Settings is a floating modal OVER the board
  // (the TripSettingsModal idiom — card-float overlay with master→detail
  // drill-in), opened from the header gear. The modal owns its own back-button
  // interception (useModalBackButton), so a plain boolean is all the host needs;
  // no history-pushed sub-surface, no in-page "Board" back button.
  // "Add a game" opens a modal over the board.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = () => setSettingsOpen(true);
  const [addingGame, setAddingGame] = useState(false);
  const [rostersOpen, setRostersOpen] = useState(false);
  // Leaderboard team-name tap → a STANDALONE identity editor (owner / captain-of-
  // that-team), NOT the overlay; non-permitted taps fall to the read-only overlay.
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  // GameSheet (add-game modal) needs the type catalog. Format definitions live in
  // CODE (W-PERF-01) — read synchronously, no fetch — so the modal's top half is
  // present the instant it opens, even on the bad signal organizers hit on-site.
  const gameTypes = GAME_TYPES;

  // ── Game panel (Spec 2) — the persistent-board game layer ───────────────────
  // A tapped panel-capable game (match play + rack + non-golf — Phase 1 & 2) opens
  // as a slide-in panel OVER this still-mounted board (no route teardown), driven
  // by `?game=<id>` in the URL. Open state is DERIVED from the searchParam (like
  // the settings deep-link) — the game view's own inner history (settings/score)
  // pushes entries ABOVE `?game=`, so those pop first and only a back at the root
  // pops `?game=` → the panel closes. The board already holds games.listByTrip
  // (faceBootstrap-seeded), so a game's format is known synchronously — no fetch
  // just to decide whether (and which view) to panel. ONE host for all formats.
  const search = useSearchParams();
  const router = useRouter();
  const openGameId = search.get("game");
  // The scorecard OVERLAY over the board (leaderboard caller): a golf game's
  // scorecard icon pushes `?scorecard=<id>` (GameRow), and we float the scorecard
  // Sheet over the still-mounted board. Dismiss (scrim/✕/back) → router.back()
  // pops the entry. Distinct from the in-game scorecard, which each game view
  // hosts itself so it can show live scores/save-state.
  const scorecardGameId = search.get("scorecard");
  // The two-pane predicate now lives in `useCupPanel` — AppShell needs the SAME
  // answer to decide who owns the scroll (in two-pane the body must not scroll,
  // each pane does), and deriving it in both places is how they silently disagree.
  // Same rule, same React Query cache; the second caller is a cache read.
  const { panelOpen, openGame, openType } = useCupPanel(tripId);
  // Suppress the game-panel slide-in wipe when the panel opens STRAIGHT into settings
  // (the deep-link `?settings=1` — the board→setup-game entry). In that case the settings
  // slide-over covers the panel immediately, so the wipe is just distracting dark motion
  // behind the overlay (seen through the desktop drawer's translucent scrim — the
  // "multiple dark backgrounds wiping in" report). Captured ONCE at the panel's rising
  // edge so a later gear-driven settings toggle can't re-trigger or wrongly suppress the
  // wipe; the gear path (open the game first, then the gear) keeps its normal slide-in.
  const prevPanelOpenRef = useRef(false);
  const suppressPanelWipeRef = useRef(false);
  if (panelOpen && !prevPanelOpenRef.current) {
    suppressPanelWipeRef.current = search.get("settings") === "1";
  }
  prevPanelOpenRef.current = panelOpen;
  // The bottom nav (z-40, fixed) overlays the panel's bottom (z-30). On surfaces
  // that KEEP the nav (scoreboards — not the nav-hiding score-entry surfaces), pad
  // the panel's scroll by the nav height so its last content clears the nav
  // instead of hiding behind it. Read from the published chrome so it tracks each
  // format's focusedEntry flag automatically.
  const chrome = useGameChrome();
  const navUnderPanel = panelOpen && !chrome?.focusedEntry;
  // Lock the PAGE scroll while a panel is open: the panel is `fixed` with its own
  // `overflow-y-auto`, so without this the board behind it keeps its own window
  // scrollbar → two vertical scrollbars (Zach's QA). The panel owns the only
  // scroll while it's up; restored on close.
  //
  // MOBILE ONLY. This is what actually killed scrolling in two-pane mode: it ran
  // at every width, but at `lg+` the panel is `lg:static` — in normal flow, not a
  // `fixed` box with its own scroller — so locking the document left the page
  // unable to scroll AND neither pane able to (their `overflow-y-auto` had no
  // bounded height either). "Open a game and neither pane scrolls", exactly.
  // At `lg+` the shell is now a bounded box and each pane owns a real scroller,
  // so there is no document scroll to lock in the first place.
  // NB the hook is called unconditionally — `panelOpen && useIsShellDesktop()`
  // would short-circuit and skip it, which breaks the rules of hooks. It gates a
  // document STYLE in an effect, never a tree, so it can't cause a remount.
  const isShellDesktop = useIsShellDesktop();
  const lockPageScroll = panelOpen && !isShellDesktop;
  useEffect(() => {
    if (!lockPageScroll) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = prev;
    };
  }, [lockPageScroll]);
  // Pick the format's view — each reads its own tripId + `?game=`, so the host just
  // selects which component to mount. Now KEYED BY THE GAME ID (#744): at `lg+` the
  // board below is `[list | pane]` and the list stays interactive beside the open
  // game, so `?game=` can move A→B with `panelOpen` never dipping false. Same
  // position + same type + same key is what makes React reuse an instance, and the
  // reused instance kept its captured `gameId` — the pane silently didn't navigate
  // and a score entered after the swap wrote to game A. The key is the remount.
  // See `gamePanelView` for why a key rather than a live-derived id.
  const panelView = panelOpen && openGameId ? gamePanelView(openType, openGameId) : null;

  // Warm-cache seed (Task 4) — so the panel renders INSTANTLY instead of
  // spinner-gating on a cold getById. For match/rack/non-golf, seed getById from
  // the warm list row (its EXACT shape: game row + empty participants — those views
  // read their real participants from matches/playGroups, never from getById),
  // only-if-absent so a real getById is never clobbered. STROKE is the exception:
  // it reads its ROSTER from getById.participants, so an empty-participants seed
  // would flash the pick-players screen — prefetch the real row instead (already
  // warm from the pointer-intent prefetch; this covers a cold deep-link too). Then
  // head-start each format's genuinely-cold child (match → matches, rack →
  // playGroups; non-golf/stroke read only getById + already-warm data) + scores.
  useEffect(() => {
    if (!openGame) return;
    const gameId = openGame.id;
    if (utils.games.getById.getData({ tripId, gameId }) === undefined) {
      if (isStrokeFormat(openType)) {
        void utils.games.getById.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
      } else {
        utils.games.getById.setData({ tripId, gameId }, { ...openGame, participants: [] } as never);
      }
    }
    void utils.scores.listByGame.prefetch({ tripId, gameId });
    if (isMatchPlayFormat(openType)) {
      void utils.matches.listByGame.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
    } else if (isRackFormat(openType)) {
      void utils.playGroups.listByGame.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGame?.id, tripId]);

  // Non-golf (manual) games now have their own scoreboard PAGE (the W-NONGOLF
  // lifecycle surface) — an editor taps the row and NAVIGATES there (the GameRow
  // link), the same as golf. The old in-place RunSheet + its pencil → GameSheet
  // edit-reopen are retired (the page's gear → settings page is the edit home now,
  // like golf). So this board no longer scores/edits non-golf games inline.

  // The leaderboard short-name tap opens the consolidated Edit Team modal for
  // EVERYONE — the modal self-gates via useCanEditTeam (owner: full; captain:
  // identity editable, roster read-only; member: all read-only). We only need
  // the team rows here to resolve the tapped id. faceBootstrap-seeded STRUCTURE
  // (cache hit).
  const { data: teamsList = [] } = trpc.teams.list.useQuery({ tripId, competitionId: competition.id }, STRUCTURE_QUERY);

  const handleEditTeam = (teamId: string) => {
    const team = (teamsList as Team[]).find((t) => t.id === teamId);
    if (team) setEditingTeam(team);
  };
  // GO LIVE / BACK TO SETUP was removed at the root (option A): a competition is
  // visible to the whole crew the moment it exists, and per-game Setup/Scoring
  // handles game-level readiness — a competition-level reveal is redundant. The
  // `competitions.status` setup↔active distinction is retired; do NOT re-add a
  // competition-level reveal/go-live state.

  // Roster-setup progression (building → saved → dismissed). Optimistic so the
  // Team Rosters button → signpost → clean transition is instant; the face reads
  // roster_setup from the faceBootstrap snapshot, so invalidate that too (#10).
  const rosterSetup = competition.roster_setup ?? "building";
  const advanceRoster = trpc.competitions.update.useMutation({
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });
  const setRosterSetup = (next: "saved" | "dismissed") =>
    advanceRoster.mutate({ tripId, competitionId: competition.id, rosterSetup: next });

  // ── Board (the home, setup + live) ──────────────────────────────────────────
  // The merged hero (identity + gear + scores) lives INSIDE the leaderboard now
  // (the standalone CompetitionHeader strip was retired with the old full-page
  // settings sub-surface); the hero's gear opens the settings modal.
  const scoringModel = competition.scoring_model ?? "match_play";
  return (
    /**
     * ONE COLUMN, at every width. This comment used to say "DESKTOP
     * MASTER-DETAIL … lg+ splits into [board | pane]", and it had been false
     * since drill-in started REPLACING the board (`lg:hidden` below the moment a
     * game opens). Nothing rendered a second column, and the 560 caps that
     * reserved space for one are gone with it — Cup now fills the content area
     * exactly as Trip does.
     *
     * The classes are applied to the SAME element open or closed (just extra
     * `lg:` ones), so opening a game reflows rather than remounting the board —
     * still the whole point of the panel idiom.
     */
    <div
      /**
       * THE STAGE. A clip box holding the one column; it never scrolls (the
       * column owns exactly one scroller — #752's rule).
       *
       * FLUID, and left-aligned. Three things are gone and they were all the
       * same mistake in different clothes: `lg:justify-center` and the
       * per-column `lg:mx-auto` (a column that re-centres inside the content
       * area moves its own origin every time the available width changes), the
       * 560 `max-w` caps (space reserved for a second column that no longer
       * exists — see breakpoints.ts), and the `@container` context (nothing
       * queried it once the lone `@[808px]` rule went with the caps).
       *
       * What is left is the rule the whole desktop layout now follows: the
       * shell owns where the content area starts and how wide it is
       * (contentArea.ts), and everything inside fills it. Cup and Trip are the
       * same shape because neither decides its own geometry any more.
       */
      className={
        panelOpen
          ? "space-y-4 lg:flex lg:h-full lg:min-h-0 lg:items-stretch lg:gap-4 lg:space-y-0"
          : "space-y-4 lg:h-full lg:min-h-0"
      }
      data-testid="cup-stage"
    >
      {/* Rosters entry point RELOCATED into competition settings (§2 / the deferred Phase B):
          the leaderboard header no longer carries a Rosters button. Points cups open the
          Rosters surface from Settings → "Teams & rosters"; match_play team editing stays a
          team-name tap → the Edit Team modal (per-team, no add/delete). */}
      {/*
        * THE LEADERBOARD — HIDDEN, not unmounted, once a game is open.
        *
        * Drill-in REPLACES: a game takes the surface the way it does on mobile, so
        * no game list stays live beside an open game. `hidden` makes it
        * non-interactive and removes it from layout while keeping it MOUNTED and
        * warm, which is the whole reason the panel idiom exists (CLAUDE.md #12) —
        * unmounting would throw the warm board away and pay to rebuild it on every
        * back. The wrapper is always present for the same reason: adding it
        * conditionally would remount the leaderboard.
        *
        * Capped at 560. The cap is now CONTINUOUS rather than `lg:`-gated, which
        * is what removes the "grows very wide, then snaps back" step: the cap
        * used to engage only at `lg`, so the board widened with the viewport all
        * the way to 1023 and then abruptly NARROWED to 560 at 1024. Below `lg`
        * it stays centred (there is no rail to align to, and a 560 column hugging
        * the left of a tablet reads as broken); at `lg+` `lg:mx-0` hands
        * alignment to the content area.
        */}
      <div
        // `lg:hidden`, NOT the `hidden` ATTRIBUTE — the attribute is width-blind and
        // reached mobile, where the board must stay in flow beneath the `fixed`
        // panel exactly as before (measured: it was being display:none'd at 390px).
        // Drill-in is a DESKTOP model; mobile keeps its overlay.
        className={`w-full min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto ${
          panelOpen ? "lg:hidden" : ""
        }`}
        data-testid="board-pane"
      >
      <CompetitionLeaderboard
        competitionId={competition.id}
        tripId={tripId}
        // Identity + gear for the merged hero (Task 1); the gear opens settings via
        // the #522 history-back overlay — same handler, so back-nav is unchanged.
        cupName={competition.name}
        tagline={competition.tagline}
        onSettings={canEdit ? openSettings : undefined}
        canEdit={canEdit}
        // The board layout is selected by the FROZEN scoring_model, not team
        // count (PR 2): match_play → Ryder hero, points → standings + matrix.
        scoringModel={scoringModel}
        onAddGame={() => setAddingGame(true)}
        // A hero team-name tap → the consolidated Edit Team modal (the team-
        // management home). It self-gates by role: owner edits everything, captain
        // edits identity (roster read-only), a plain member sees it read-only.
        onEditTeam={handleEditTeam}
      />
      </div>

      {/* Add a game opens the GameSheet modal directly over the board (the
          aggregate games panel was retired). It's ADD-only now — editing an
          existing game lives on the game's own settings page (the gear), for
          golf AND non-golf alike. It persists on its own Save and invalidates
          the board's leaderboard; we also re-resolve faceBootstrap so the
          board's GAMES list refreshes without a hard reload (#10). */}
      {addingGame && canEdit && (
        <GameSheet
          tripId={tripId}
          competitionId={competition.id}
          types={gameTypes}
          canEdit={canEdit}
          scoringModel={scoringModel}
          onClose={() => {
            setAddingGame(false);
            utils.competitions.faceBootstrap.invalidate({ tripId });
          }}
        />
      )}

      {/* Rosters overlay — the one home for team management (W-TEAMSURFACE-01),
          member-visible, owner-editable. Opened ONLY via the Rosters button (or a
          non-permitted team-name tap). Carries the relocated "Save rosters" commit. */}
      {rostersOpen && (
        <RostersOverlay
          tripId={tripId}
          competitionId={competition.id}
          isOwner={isOwner}
          // #789 — MEMBERSHIP (assign / remove) is Owner-or-Organizer at the
          // server; `isOwner` above still gates team create/delete + captaincy.
          canManageRoster={canEdit}
          // Team-COUNT lock keys on the frozen scoring_model: head-to-head is
          // exactly 2 teams (no add / no delete), so structure is locked; points
          // is 2–N, so adds/deletes stay open. (The go-live freeze this replaced
          // was retired with GO LIVE; player-removal protection once scoring
          // starts is a separate SCORE-based lock, teamAssignments.rosterLocked.)
          structureLocked={scoringModel === "match_play"}
          rosterBuilding={rosterSetup === "building"}
          onSaveRosters={() => { setRosterSetup("saved"); setRostersOpen(false); }}
          onClose={() => setRostersOpen(false)}
        />
      )}

      {/* Consolidated Edit Team modal — opened by a leaderboard short-name tap.
          The team-management home: identity + roster, self-gated by role
          (useCanEditTeam). showRoster defaults true here (the standalone home);
          the in-overlay per-card pencil passes false. */}
      {editingTeam && (
        <TeamSheet
          tripId={tripId}
          competitionId={competition.id}
          team={editingTeam}
          existingTeamNames={(teamsList as Team[])
            .filter((t) => t.id !== editingTeam.id)
            .map((t) => t.name.toLowerCase())}
          onClose={() => setEditingTeam(null)}
        />
      )}

      {/* Game panel (Spec 2 + #550) — the format's scoreboard as a slide-in layer.
          Positioned BELOW the 56px app bar (`top-14 z-30`, under the bar's z-40) so
          TopNav stays visible + interactive — chat/news/avatar reachable, and the
          bar carries the game's back/title/gear (GameChrome). The board stays
          MOUNTED underneath. A game view's inner surfaces fill this wrapper (they
          switch off `fixed inset-0` in panel mode via useInGamePanel). */}
      {panelOpen && (
        <div
          /**
           * MOBILE: an overlay layer over the board (`fixed`, below the 56px bar).
           * DESKTOP (lg+): the SAME state renders as a DETAIL PANE beside the game
           * list instead — `lg:static` drops it out of the overlay and the parent
           * grid (below) gives it a column. Phase 5: same URL, same `?game=` state,
           * two presentations, and NO routing construct — CLAUDE.md #12 forbids one
           * and the parallel-routes suggestion was made once and was wrong.
           *
           * The wipe animation is mobile-only: a pane appearing beside a list has
           * nothing to slide over.
           */
          /**
           * `lg:relative` REPLACES `lg:static`, and that is load-bearing beyond
           * layout. `MatchGameView`'s score-entry surface renders `absolute inset-0`
           * in panel mode, which resolves against the nearest POSITIONED ancestor —
           * on mobile that is this box (`fixed`), but `lg:static` removed the
           * positioning at desktop and nothing between here and the viewport is
           * positioned, so the entry surface escaped the pane and filled the whole
           * viewport. `relative` is in-flow exactly like `static` for layout AND
           * restores the containing block. (Pre-existing bug, fixed here because
           * this is the line that caused it.)
           *
           * `lg:h-full lg:min-h-0` is what finally makes the existing
           * `overflow-y-auto` do something at desktop: it had no bounded height,
           * so the box just grew to its content.
           */
          /**
           * `lg:top-0` is load-bearing, and its absence was a latent bug from #749.
           * `top-14` exists for the MOBILE `fixed` box (below the 56px app bar).
           * #749 changed `lg:static` → `lg:relative` to restore the containing block
           * for the entry surface — but `static` IGNORES `top` and `relative`
           * HONOURS it, so the pane silently gained a 56px downward offset while
           * keeping its full height, and hung 56px past the bottom of the viewport
           * (measured: top=174 bot=940 in a 900px viewport). Resetting it at `lg`
           * keeps the mobile offset and drops it where the box is in flow.
           */
          /**
           * ── The GAME column (drill-in) ────────────────────────────────────
           * The scoreboard is now the MAIN column and flexes 380–560; entry is the
           * fixed 412 beside it. Note this INVERTS the old `1fr : 1.35fr` grid,
           * where the game pane was the WIDER of the two — easy to carry forward by
           * accident, so it is spelled out.
           *
           * Flush, not a card: `lg:rounded-xl lg:border` is dropped. Per the mockup
           * the columns are plain panes on the page background and the CONTENT
           * inside them is card-surfaced (match rows, player rows). A card around a
           * card reads as a box in a box, and STYLE_GUIDE §1 puts contextual
           * structure on the page background rather than a chrome surface.
           */
          /**
           * `top-0` on a focused ENTRY surface, `top-14` everywhere else.
           *
           * This is the half that actually BUYS the space. `TopBarSlot` hides the
           * 56px app bar on mobile while entering scores, but the panel is a
           * `fixed` box offset below where that bar used to be — leave it at
           * `top-14` and hiding the bar just exposes 56px of page background.
           * The two must move together, which is why both read the same
           * `focusedEntry` flag rather than each deciding for itself.
           *
           * `lg:top-0` is unchanged and still load-bearing for its own reason
           * (see above) — at `lg+` the bar never hides, so this expression only
           * ever differs below the breakpoint.
           */
          /**
           * `lg:-mt-6` + `lg:h-[calc(100%+1.5rem)]` — the game header sits FLUSH
           * under the app bar at EVERY width.
           *
           * Below `lg` this box is `fixed top-14`, so its first row already began
           * immediately under the 56px bar. At `lg+` it is a normal-flow child of
           * the shell's content area, which carries `CONTENT_INSET` (`lg:p-6`,
           * `CONTENT_INSET_PX` = 24) — so the row started 24px lower than its
           * mobile counterpart, leaving an empty band between the bar and the game
           * title and REDRAWING the header on a viewport change.
           *
           * The pair is not optional. `-mt-6` alone moves the top to the bar and
           * drags the bottom 24px past the stage, eating the bottom gutter the
           * `ViewTabsPill` floats in; the height compensation puts the bottom back
           * exactly where it was (`56 + (H + 24) == 80 + H`).
           *
           * ── On the BOX, never on the first child (the #938 regression) ───────
           * #938 put `-mt-6` on `GameActionRow` instead. This box is
           * `overflow-y-auto`, and a first child pulled above a scroll container's
           * origin is unreachable by scrolling — it is clipped, which is exactly
           * what shipped: the game title rendered sliced in half. The box itself
           * is clipped by nothing (the content area's `lg:overflow-hidden` clips at
           * its PADDING box, and -24px lands on that edge, not past it).
           *
           * The verification that missed it read `getBoundingClientRect().top` and
           * saw 56 — a clipped box reports its geometric position perfectly
           * happily. Position is not visibility; assert both.
           *
           * Only the TOP inset goes. The horizontal inset stays, so the row lines
           * up with the content beneath it and with the rail divider — mobile's
           * full-bleed has no rail to sit against.
           */
          className={`fixed inset-x-0 bottom-0 ${chrome?.focusedEntry ? "top-0" : "top-14"} z-30 flex flex-col overflow-y-auto lg:relative lg:top-0 lg:z-auto lg:-mt-6 lg:h-[calc(100%+1.5rem)] lg:min-h-0 lg:w-full lg:min-w-0 lg:flex-1 ${suppressPanelWipeRef.current ? "" : "game-panel-in lg:animate-none"}`}
          style={{
            background: "var(--color-bt-base)",
            // Clear the bottom nav (58px) + safe area when it's showing; none on the
            // nav-hidden entry surfaces (their CTA anchors to the viewport bottom).
            paddingBottom: navUnderPanel ? "calc(64px + env(safe-area-inset-bottom))" : undefined,
          }}
          data-testid="game-panel"
        >
          {/* The action row belongs to the GAME SURFACE, so it lives inside the
              panel rather than at shell level. Shell-level placement coupled a
              normal-flow row to a FIXED panel through a CSS variable: mounting
              the row moved the panel's top edge, and the merge-blocking stroke
              spine timed out on "element is not stable". Inside the panel the
              row is just the first block of the same scroll context — no
              cross-element offset, nothing to oscillate. */}
          <GameActionRow />
          {/*
           * ── Why this wrapper exists (containing block, not decoration) ──────
           * `game-panel` above is `position: fixed`/`lg:relative` — a positioned
           * box — so a format view's `absolute inset-0` entry surface (Match's
           * score screen, Rack/Stroke's group entry, Stroke's WHOLE post-setup
           * surface) resolves `inset-0` against IT, not against the space below
           * `GameActionRow`. `inset:0` means "cover this positioned ancestor
           * from its own top edge," which is exactly `GameActionRow`'s own
           * position — so the entry surface painted OVER the back button
           * (positioned content always paints above a normal-flow sibling in
           * the same stacking context, regardless of DOM order or z-index).
           * That was the actual bug behind "stroke/entry has no back button":
           * not a missing chrome publish, a wrong containing block.
           *
           * `relative` here gives any nested `absolute inset-0` a NEW
           * containing block that starts below `GameActionRow`, not at
           * `game-panel`'s own top. `flex-1 min-h-0` (this box is now a flex
           * item of `game-panel`'s `flex flex-col`) sizes it to exactly the
           * remaining space, matching the `min-h-0`-on-a-flex-item pattern
           * used throughout this shell (see AppShell.tsx) so a plain in-flow
           * view (Match/Rack/NonGolf's overview, no `absolute inset-0` at
           * all) still overflows into `game-panel`'s own `overflow-y-auto`
           * exactly as it did before this wrapper existed — this only changes
           * where `inset-0` resolves, not how normal content scrolls.
           * This is the fourth time this session `absolute inset-0`'s
           * containing block has been the actual bug (chat's old inline
           * fixed box, the #749 pane offset, the #754 `lg:relative` fix
           * above, and now this) — if a new format view adds an `absolute
           * inset-0` surface, it MUST go inside this wrapper, not as a
           * sibling of it.
           */}
          <div className="relative min-h-0 flex-1">{panelView}</div>
        </div>
      )}

      {/* Scorecard overlay (leaderboard caller) — floats over the board via
          `?scorecard=<id>`. Only reachable when no game panel is open (the icon
          lives on the board), so no panel/scorecard z-fight. */}
      {scorecardGameId && (
        <ScorecardPreviewSheet tripId={tripId} gameId={scorecardGameId} onClose={() => router.back()} />
      )}

      {/* Competition settings — a floating modal over the still-mounted board
          (the TripSettingsModal idiom): a card-float overlay whose menu drills
          into Competition details / Scoring model / the danger-zone confirms.
          Opened from the header gear; owns its own back-button handling. */}
      {settingsOpen && (
        <CompetitionSettingsModal
          competition={competition}
          tripId={tripId}
          canEdit={canEdit}
          isOwner={isOwner}
          onClose={() => setSettingsOpen(false)}
          onDeleted={onCompetitionDeleted}
          // Points cups manage teams from settings now (§2). Opening Rosters closes settings
          // so the two overlays don't stack. Match-play keeps team-name-tap editing (no row).
          onOpenRosters={scoringModel === "points" ? () => { setSettingsOpen(false); setRostersOpen(true); } : undefined}
        />
      )}
    </div>
  );
}
