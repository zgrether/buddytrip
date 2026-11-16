# Audit spec: moving today's data into crews (X5)

**Model:** Fable 5.1 (the model and the migration order are expensive to get wrong). **Read-only.**
**Output:** `DATA_MOVE_AUDIT.md` at the repo root, on branch `audit/data-move`, as a PR containing only that file.
**Base:** current `main` and the production schema as recorded by the migrations. Record the commit.

## Why

The redesign makes the **crew** (`circles` in code) the container for everything: games, competitions,
trips and people (`docs/design/REDESIGN_PLAN.md`: D1, D4, D11, D12, D13, D14, D16; Phase 1). Today
the trip is the container. Before `CREWS_FOUNDATION.md` is written, we need an exact map of what
exists, where each row goes, and what blocks the move. Nobody is actively using the app (Nov 2026),
so the move can be done in one pass, but BBMI's history must come through intact.

## Method

Code and migrations are ground truth; cite `file:line` or the migration for every claim. Use
production row counts where the read-only SQL allows (counts only, no personal data in the report).
"Unconfirmed" is a valid answer.

## Questions to answer

1. **Inventory.** Every table that references a trip, a user, a guest, a competition or a game, with its
   key columns, FKs, unique constraints and the RLS helpers that read it. Include the `circles`,
   `circle_events`, `circle_courses` stubs (migration 024) and what uses them today.
2. **The target, per the plan.** For each decided rule, the columns and constraints it needs:
   - crews with members and roles Member · Helper · Admin, several admins (D12, D16);
   - every trip belongs to a crew; joining a trip joins its crew (D4);
   - a competition belongs to a crew, the trip is optional, one competition per trip still holds for
     trips (D11; today `competitions.trip_id` is NOT NULL, migration 033, and unique, migration 195);
   - games belong to a crew or to no crew (D3), with the "hide from the rest of the crew" switch (D13);
   - name-only people per crew, absorbing today's guests (X5); a per-crew display name;
   - archive and soft delete with 30-day restore (D16); the Phase 1 guardrails in the plan (join
     policy, invites not trip-only, `max_uses`/`expires_at` per invite, entrants separate from members,
     `archived_at`, an app-admin flag, contact details not readable by other members).
3. **The map.** For each existing table: where its rows go, how, and what is lost or ambiguous. Specifically:
   - BBMI's trips into one crew. Which trip roles become crew roles (Owner → Admin, Organizer → Helper),
     and what happens where the same person has different roles on different trips.
   - Guests (`is_guest`) → name-only crew people, and how `merge_guest_to_real_user` changes. List every
     table it touches today, from the live function, not a doc.
   - Games, competitions, teams, pick'em, brackets, side games, expenses, news, chat, invites.
   - Anything that cannot be mapped without a decision from Zach.
4. **Migration order.** A proposed sequence of migrations (names and one line each, no SQL), following
   CLAUDE.md's Migration Workflow: additive first, code switched over, drops last (rule 3b), each
   replayable from zero, each reversible or saying why not. Mark which can ship dark.
5. **What breaks.** Every RLS helper, policy, trigger, function and tRPC procedure that assumes "trip"
   and would need a crew-aware version. Every guard test and E2E spec affected.

## STOP and report if

- any rule in the plan can't be expressed without contradicting another (say which two);
- production data contains a shape the plan didn't anticipate (for example a person on two trips under
  two different guest rows).

## DO NOT

- Write migrations, SQL beyond read-only counts, or application code.
- Read or quote personal data (names, emails) into the report. Counts and ids only.
- Decide a mapping the plan leaves open. List it as a question for Zach.

## Done when

`DATA_MOVE_AUDIT.md` has the inventory, the target columns, the table-by-table map, the open
questions, the migration order and the "what breaks" list, each claim cited.
