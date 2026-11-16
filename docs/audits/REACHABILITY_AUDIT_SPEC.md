# Audit spec: what can still be reached (refreshes GAME_ROUTES_AUDIT.md, app-wide)

**Model:** Sonnet 5.5. **Read-only.**
**Output:** `REACHABILITY_AUDIT.md` at the repo root, on branch `audit/reachability`, as a PR containing only that file.
**Base:** current `main`. Record the commit.

## Why

The app was built piece by piece, and some screens are no longer linked from anywhere (for a while a
game could only be started at its URL). `GAME_ROUTES_AUDIT.md` (July) covered only the game routes.
Before the redesign replaces screens, Zach wants the full list of what is reachable, what is orphaned,
and what is dead, so he can decide what to remove.

## Method

Code is ground truth; cite `file:line`. Apply CLAUDE.md's "absence of matches is absence of search":
before calling something unreferenced, prove the search could have found it (template-string hrefs
such as `` `/trips/${id}/games/...` ``, `router.push`, `redirect()`, `Link`, `window.location`,
email templates, the service worker, middleware rewrites, E2E specs). Run `npx knip` for unused files,
exports and dependencies; don't add it to `package.json`. Treat knip's output as a starting point
(CLAUDE.md, Schema Cleanup Rule): confirm each finding by hand.

## Questions to answer

1. **Every route** (`src/app/**/page.tsx`, `route.ts`, API routes): how a person reaches it in normal
   use (the screen and control), or "only by URL", or "nothing reaches it". Include `/dashboard`,
   `/quick-game`, `/courses/new` and the standalone game routes.
2. **Every tRPC procedure** in `src/server/routers/`: its client callers. List procedures with
   none, and say whether a test, a server caller or a script uses them.
3. **Components and modules** knip reports as unused, confirmed by hand.
4. **What still depends on the orphans.** Tests (the four merge-blocking E2E specs especially), guard
   tests, docs. `GAME_ROUTES_AUDIT.md` found the spine E2E specs create games through
   `/games/new` and `/games/match/new`; say whether that is still true.
5. **A verdict per orphan:** keep (in use), replace in the redesign (name the screen from
   `docs/design/REDESIGN_PLAN.md`), or delete candidate, with what has to change first.

## STOP and report if

- a route looks orphaned but something outside the repo might link to it (emails already sent,
  bookmarks, the PWA start URL, `bbmi.app` links in news posts).

## DO NOT

- Delete, move or rename anything, or edit any file other than the report.
- Add dependencies.
- Count a route as dead because a narrower search missed it; show the search that would have found it.

## Done when

`REACHABILITY_AUDIT.md` has the route table, the unused-procedure list, the confirmed unused files,
the dependency list and a verdict per orphan, each cited. Zach decides deletions from it.
