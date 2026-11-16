# Design docs

Product and UX decisions for the redesign (crews, the game loop, Home, trips in crews).
Written by Claude in design sessions with Zach; specs for Claude Code are built from these
and from the Workflow Wireframes canvas (its Prototype page is the source of truth for screens).

| Doc | What it holds |
|---|---|
| `REDESIGN_PLAN.md` | Features ranked, scale, journey audit, decisions log (D1…), build phases, which model when |
| `SCORE_SHEET_PATTERNS.md` | The abstractable score sheet: entry patterns on one shell |
| `FUTURE_PATTERNS.md` | Leagues, the TV board, judged events (later) |
| `ITINERARY_REDESIGN.md` | The one-tab itinerary (deferred) |
| `LIMITS_AT_SETUP.md` | Player limits shown at setup |
| `BRAND.md` | Put Me Down For: name, logo, palette, type, copy rules, what changes in the app |
| `PRODUCT_SCOPE.md` | The finished app in plain words, for brand and marketing |

`docs/CLINCH_AND_PODIUM.md` (one level up) is also a design doc and stays where it is.


## Keeping these in sync

- **This repo is the source of truth** for every doc, these included.
- Claude changes design docs through a pull request on a `claude/…` branch; Zach reviews and
  merges. Nothing here is edited anywhere else first.
- The claude.ai project holds read-only mirrors. Each mirror's first line names the commit it
  was copied from; Claude refreshes them from `main` at the start of a design session.
