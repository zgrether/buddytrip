# Limits Surfaced at Setup (build spec)

*TRACKER: NEXT → "Limits surfaced at setup". Small, bounded: Sonnet. One branch, per-task commits.*

**Rule (Zach):** every hard limit is visible at the first choice it constrains, never discovered on Save. One limits source feeds both the hint and the server refusal.

**What's there today (main):**
- Create picker, points + teams: a "Start with N teams" stepper capped at `MAX_SEED_TEAMS = 4`. More teams are added later in `TeamsPanel`, up to `MAX_TEAMS = 8` (#1697). At 8, the Add button disables and `TEAM_CAP_LINE` appears.
- So the setup screen implies the limit is 4, the real limit (8) only appears at the 8th team, and there are two numbers for one rule.

---

## Phase 0 · Measure, report, STOP

1. Every place a team count is chosen or a team is added (create picker, `TeamsPanel`, anything else), and which limit each uses.
2. Player limits: which game types carry a participant cap (`scorecard_schema.participants.max`, `maxPlayersPerSide`, or similar), whether any is enforced today (UI and/or server), and where players are picked for a game.
3. Anything else with a hard cap that a user can run into while configuring a competition or game.

STOP. Wait for Zach.

## 1 · Team limit at setup

- **Create picker:** the stepper's max becomes **`MAX_TEAMS`** (one number for the rule). Seed names continue Team A … Team H. Delete `MAX_SEED_TEAMS`.
- **Under the stepper, always visible** (13px, `--color-bt-text-dim`): **"Up to 8 teams, one color each"**, derived from `MAX_TEAMS`, never a literal.
- **Head-to-head:** fixed at 2 as today. No hint, nothing new.
- **Individuals:** no team limit, so no hint.

## 2 · Team editor (`TeamsPanel`)

- Next to **Add team**, always visible: a count, **"5 of 8"** (dim). State shown by styling; no sentence.
- At the cap: as #1697 built it (button disabled, `TEAM_CAP_LINE`).

## 3 · Player limits (only if Phase 0 finds real, enforced caps)

- At the player-picking step: the header shows **"Up to 4 players"** (from the template), and picking stops at the cap, the same way the stepper does. No refusal on Save.
- A cap that exists in the schema but isn't enforced anywhere: report it, don't start enforcing it here.

---

## DO NOT

- Hard-code 8 (or any limit) in copy or UI. Derive every hint from the same constant or template value the server checks.
- Add an explanatory sentence where a count or a disabled control already says it.
- Change the cap itself, the color uniqueness rules, or the server refusal from #1697.
- Enforce a player cap that isn't enforced today without a ruling.
