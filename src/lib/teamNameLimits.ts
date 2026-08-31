/**
 * Team name length caps — ONE source, read by the input `maxLength`, the zod
 * schemas on `teams.create` / `teams.update`, and the character counters.
 *
 * They live together because a client cap without a server one is not a cap, and
 * two numbers that must agree are two numbers that will eventually not.
 *
 * NOT enforced in the database, deliberately. `short_name` already carries
 * `CHECK (char_length(short_name) <= 4)` from migration 001 and this constant
 * matches it; `name` has no constraint and is not getting one here, because a
 * DDL change needs its own PR and a manual prod push, and because a CHECK is the
 * wrong instrument for a number chosen from how a header looks.
 */

/**
 * 34 characters for the full name.
 *
 * Derived from the cup header, the tightest SUBJECT slot: at the 412px supported
 * floor the name block is ~168px per side (412 − 32 page inset − 32 card padding
 * − 12 gap, halved), and two lines at 17px/600 hold roughly 38 average-width
 * characters. 34 leaves headroom; the longest name in use is 30.
 *
 * It is a GUARDRAIL, not a guarantee. The app renders in the system font stack,
 * so the same 34 characters are SF Pro on an iPhone and Roboto on an Android,
 * and glyph width swings ~40% between narrow and wide text — no character count
 * can be exact across that. What actually holds the layout is the header's
 * two-line reserve plus its clamp; this only stops someone pasting a paragraph.
 */
export const TEAM_NAME_MAX = 34;

/**
 * 4 characters for the short name — the DB `CHECK` value from migration 001,
 * restated here so the input and the zod schema read from the same place as the
 * counter. Changing this alone would NOT widen the column.
 */
export const TEAM_SHORT_MAX = 4;
