import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  AWARD_WORD,
  SKINS_DEAD_POT,
  COMPETITION_CHOICE_WORD,
  COMPETITION_NAME_EXAMPLE,
  COMPETITION_UMBRELLA,
  COMPETITION_WORD,
  DELEGATE_WORD,
  EITHER_CHOICE,
  EITHER_COMPETITION,
  GAME_STATE_WORD,
  MATCH_LEVEL_WORD,
  RESULT_WORD,
  PROJECTED_RESULTS,
  RECREDIT_WORD,
  BRACKET_ROUND_WORD,
  HALVED_MARGIN,
  NAV_WORD,
  SIDE_GAME_WORD,
  SLATE_RESULT_WORD,
  TRIP_ROLE_WORD,
  WITHDREW_WORD,
  competitionNoun,
  competitionWord,
} from "./vocabulary";

/**
 * THE VOCABULARY GUARD (#1619) — every domain term has one home,
 * `src/lib/vocabulary.ts`, and no surface spells one itself.
 *
 * This merges the two guards that used to watch one word each
 * (`competitionWords.guard.test.ts`, `pickemResultWords.guard.test.ts`) and
 * extends them to every term the module holds. It reads every user-visible
 * string in `src` — string literals, template text and JSX text, through the
 * TypeScript scanner, so comments and identifiers can't match.
 *
 * Three strengths of check, because the words are not alike:
 *
 *  1. RETIRED words and the code's word "competition" as copy — anywhere
 *     (unchanged from the competition guard).
 *  2. DISTINCTIVE terms — anywhere in visible text, outside the module: they
 *     mean one thing wherever they appear (Re-credit, In review, Canceled, …).
 *  3. GENERIC terms — only as an exact standalone literal: "Live", "Final",
 *     "Won" also occur inside ordinary sentences, so only a literal that is the
 *     bare word is a term. There is NO exception list: a spelling that means
 *     something else here is its own named term in the module (a nav tab's
 *     "Live" is NAV_WORD, a bracket round's "Final" is BRACKET_ROUND_WORD,
 *     the engine's stored "AS" margin is HALVED_MARGIN), so the way to make
 *     this pass is to name the meaning, never to excuse a file.
 *
 * NOT CHECKED, stated so nobody reads it as covered:
 *  - ROLES. A role's label ("Organizer") is spelled exactly like the stored
 *    value RLS branches on, and ~170 literals in `src` are that value
 *    (`requireTripRole("Organizer")`, `role === "Owner"`). No text check can
 *    tell a label from a value. `TRIP_ROLE_WORD` is typed over the role values,
 *    so a new role cannot ship without a word; the label sites read it.
 *  - A surface that serves both competition kinds but says "cup" (unchanged
 *    from the competition guard: "cup" is right on a head-to-head-only one).
 *  - Sentences. A term inside a one-off sentence ("Re-credit {name}'s games")
 *    reads the term from the module, but the sentence around it is the
 *    component's own copy and stays inline.
 */

const ROOT = path.join(process.cwd(), "src");
const HOME = path.join("lib", "vocabulary.ts");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "__tests__") sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec|guard)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const VISIBLE = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

/** An identifier, not copy: one token that is all lower case, or that carries
 *  a separator or a camel hump (`competitions`, `competition-hero`, `isRace`). */
function identifierShaped(raw: string): boolean {
  const s = raw.replace(/^[`"'}]|[`"'$]+\{?$/g, "").trim();
  if (/\s/.test(s)) return false;
  return /^[a-z0-9]+$/.test(s) || /[-_.\/:]/.test(s) || /[a-z][A-Z]/.test(s);
}

/** The visible text of a token, without its quotes or template punctuation. */
function bare(raw: string): string {
  return raw.replace(/^[`"'}]+|[`"'$]+\{?$/g, "").trim();
}

/** Every visible-text token in `source` matching `word`, with its line. */
export function copyMatches(
  source: string,
  fileName: string,
  word: RegExp,
  opts: { skipIdentifiers?: boolean } = { skipIdentifiers: true }
): { line: number; text: string }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    // Import and export paths are module names, not copy.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (VISIBLE.has(node.kind)) {
      const raw = node.getText(sf);
      if (word.test(raw) && !(opts.skipIdentifiers && identifierShaped(raw))) {
        out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: raw.trim().slice(0, 120) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** A WHOLE string: a literal or JSX text. Template parts are pieces of a longer
 *  string (`Final ${x}`), so they are never a bare word. */
const WHOLE = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.JsxText,
]);

/** Visible-text tokens whose WHOLE text is exactly `word`. */
export function exactLiterals(source: string, fileName: string, word: string): { line: number; text: string }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (WHOLE.has(node.kind) && bare(node.getText(sf)) === word) {
      out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.getText(sf).trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const files = sourceFiles(ROOT).map((f) => ({ rel: path.relative(ROOT, f), source: fs.readFileSync(f, "utf8") }));
const report = (hits: { rel: string; line: number; text: string }[]) => hits.map((h) => `${h.rel}:${h.line}  ${h.text}`);

// ── 0 · The words themselves, pinned to exactly what the screens showed ──────

describe("the vocabulary's values — exactly the words the screens spelled before the move", () => {
  it("competition types", () => {
    expect(COMPETITION_WORD).toEqual({ match_play: "Cup", points: "Tournament" });
    expect(competitionWord("points")).toBe("Tournament");
    expect(competitionNoun("match_play")).toBe("cup");
    expect(competitionWord(null)).toBe("Cup");
    expect(competitionWord(undefined)).toBe("Cup");
    expect(COMPETITION_CHOICE_WORD).toEqual({ match_play: "Head-to-Head Cup", points: "Tournament" });
    expect(COMPETITION_CHOICE_WORD.points).toBe(COMPETITION_WORD.points);
    expect(EITHER_CHOICE).toBe("Head-to-Head Cup or Tournament");
    expect(EITHER_COMPETITION).toBe("Cup or Tournament");
    expect(COMPETITION_NAME_EXAMPLE).toEqual({ match_play: "e.g. The Turkey Cup", points: "e.g. The Yert Open" });
    expect(COMPETITION_UMBRELLA).toBe("Competition");
  });

  it("match states and results", () => {
    expect(MATCH_LEVEL_WORD).toEqual({ not_started: "Not started", level: "AS", halved: "Halved" });
    expect(GAME_STATE_WORD).toEqual({ live: "Live", final: "Final", inReview: "In review" });
    expect(RESULT_WORD).toEqual({ won: "Won", lost: "Lost", tied: "Tied", pending: "Not decided" });
    expect(SLATE_RESULT_WORD).toEqual({ cancelled: "Canceled" });
    expect(PROJECTED_RESULTS).toBe("Projected results");
  });

  it("roles and actions", () => {
    expect(TRIP_ROLE_WORD).toEqual({ Owner: "Owner", Organizer: "Organizer", Member: "Member" });
    expect(DELEGATE_WORD).toBe("Delegate");
    expect(RECREDIT_WORD).toEqual({ action: "Re-credit", by: "Re-credited by" });
    expect(SIDE_GAME_WORD).toBe("Side game");
    expect(WITHDREW_WORD).toBe("Withdrew");
  });

  it("points are awarded", () => {
    expect(AWARD_WORD).toEqual({ label: "Points", unawarded: "Not awarded", none: "This game awards no points." });
    expect(SKINS_DEAD_POT).toBe("Nobody won the last skins.");
  });

  it("navigation, structure, and the stored margin", () => {
    expect(NAV_WORD).toEqual({ live: "Live" });
    expect(BRACKET_ROUND_WORD).toEqual({ final: "Final", semifinals: "Semi-finals", quarterfinals: "Quarter-finals" });
    expect(HALVED_MARGIN).toBe("AS");
  });
});

// ── Controls: the instrument can go red ──────────────────────────────────────

describe("the scanner (controls)", () => {
  it("reads the source it means to", () => {
    // Without this, an empty file list reads as "clean".
    expect(files.length).toBeGreaterThan(300);
    const home = files.find((f) => f.rel === HOME);
    expect(home && copyMatches(home.source, "vocabulary.ts", /Cup or Tournament/)).toHaveLength(1);
  });

  it("catches copy and passes identifiers and comments", () => {
    const sample = [
      `// a race comment`,
      `const label = "Points race";`,
      `const el = <p>Set Up Competition</p>;`,
      `const t = \`The \${x} competition is decided\`;`,
      `supabase.from("competitions");`,
      `const id = "competition-hero";`,
      `function isRace() {}`,
    ].join("\n");
    expect(copyMatches(sample, "sample.tsx", RETIRED).map((h) => h.line)).toEqual([2]);
    expect(copyMatches(sample, "sample.tsx", CODE_WORD).map((h) => h.line)).toEqual([3, 4]);
  });

  it("an exact literal is the bare word only — a sentence or a longer label is not", () => {
    const sample = [`const a = "Final";`, `const b = <span>Final</span>;`, `const c = "Final score";`, `const d = \`Final \${x}\`;`].join("\n");
    expect(exactLiterals(sample, "sample.tsx", "Final").map((h) => h.line)).toEqual([1, 2]);
  });
});

// ── 1 · Retired words, and the code's word as copy (from the competition guard)

const RETIRED = /\b(races?|tourneys?|ryder|presidents\s+cup|solheim|walker\s+cup)\b/i;
const CODE_WORD = /\bcompetitions?\b/i;

/** Files whose copy uses "competition" as plain English for the ACTIVITY, not
 *  as the name of the container: the app's own description and the marketing
 *  page. Each entry is a deliberate decision, not a convenience. */
const PLAIN_ENGLISH = new Set([
  path.join("app", "layout.tsx"), // <meta> description: "Group trip planning and competition app"
  path.join("app", "manifest.ts"), // PWA description
  path.join("components", "marketing", "HeroSection.tsx"), // "live competition scoring"
]);

describe("no screen uses a retired word or the code's word", () => {
  it("no copy says race, tourney or a real event's name", () => {
    const hits = files.flatMap((f) => copyMatches(f.source, f.rel, RETIRED).map((h) => ({ rel: f.rel, ...h })));
    expect(report(hits)).toEqual([]);
  });

  it("no copy names the container 'competition' — it says Cup, Tournament, or both", () => {
    const hits = files
      // The module defines the umbrella word, the one sanctioned use.
      .filter((f) => !PLAIN_ENGLISH.has(f.rel) && f.rel !== HOME)
      .flatMap((f) => copyMatches(f.source, f.rel, CODE_WORD).map((h) => ({ rel: f.rel, ...h })));
    expect(report(hits)).toEqual([]);
  });
});

// ── 2 · Distinctive terms: never spelled outside the module ───────────────────

/**
 * Each means one thing wherever it appears, so ANY visible occurrence outside
 * the module is a spelling of the term. `cancel+ed` catches both spellings; the
 * bare stored value `"cancelled"` is an identifier the code compares against,
 * not copy, and is the one exception (from the pick'em guard).
 */
const DISTINCTIVE: { name: string; re: RegExp }[] = [
  { name: "Canceled", re: /cancel+ed/i },
  { name: "Re-credit", re: /\bRe-credit/ },
  { name: "In review", re: /\bIn review\b/i },
  { name: "Withdrew", re: /\bWithdrew\b/ },
  { name: "Not decided", re: /\bNot decided\b/ },
  { name: "Projected results", re: /\bProjected results\b/ },
  { name: "Head-to-Head Cup", re: /\bHead-to-Head Cup\b/ },
  { name: "Cup or Tournament", re: /\bCup or Tournament\b/ },
  { name: "Semi-finals", re: /\bSemi-finals\b/ },
  { name: "Quarter-finals", re: /\bQuarter-finals\b/ },
  { name: "Not awarded", re: /\bNot awarded\b/ },
  { name: "Nobody won the last skins.", re: /Nobody won the last skins/ },
  { name: "This game awards no points.", re: /\bawards no points\b/i },
];

describe("distinctive terms are spelled only in the module", () => {
  it("CONTROL: the stored value `cancelled` is in use, and the module spells the screen word", () => {
    const home = files.find((f) => f.rel === HOME)!;
    expect(copyMatches(home.source, HOME, /cancel+ed/i, { skipIdentifiers: false }).map((h) => h.text)).toContain('"Canceled"');
    const stored = files.flatMap((f) => exactLiterals(f.source, f.rel, "cancelled")).length;
    expect(stored).toBeGreaterThan(5);
  });

  for (const { name, re } of DISTINCTIVE) {
    it(`"${name}"`, () => {
      const hits = files
        .filter((f) => f.rel !== HOME)
        .flatMap((f) =>
          copyMatches(f.source, f.rel, re, { skipIdentifiers: false })
            .filter((h) => !(name === "Canceled" && bare(h.text) === "cancelled"))
            .map((h) => ({ rel: f.rel, ...h }))
        );
      expect(report(hits)).toEqual([]);
    });
  }
});

// ── 3 · Generic terms: never a bare literal outside the module ────────────────

const GENERIC = [
  GAME_STATE_WORD.live,
  GAME_STATE_WORD.final,
  RESULT_WORD.won,
  RESULT_WORD.lost,
  RESULT_WORD.tied,
  MATCH_LEVEL_WORD.level,
  MATCH_LEVEL_WORD.halved,
  MATCH_LEVEL_WORD.not_started,
  SIDE_GAME_WORD,
  DELEGATE_WORD,
];

describe("generic terms are never a bare literal outside the module", () => {
  for (const word of GENERIC) {
    it(`"${word}"`, () => {
      const hits = files
        .filter((f) => f.rel !== HOME)
        .flatMap((f) => exactLiterals(f.source, f.rel, word).map((h) => ({ rel: f.rel, ...h })));
      expect(report(hits)).toEqual([]);
    });
  }
});

// ── 4 · Points are awarded, never paid ───────────────────────────────────────

/**
 * Pay words are MONEY words (Zach, the #1668 look): a game AWARDS points. The
 * files below are where pay genuinely means money, and are the only places
 * copy may say it. Each entry is a decision, not a convenience.
 */
const PAY = /\b(pay|pays|paid|paying|payouts?|unpaid)\b/i;
const MONEY = new Set([
  path.join("app", "trips", "[tripId]", "tabs", "AddExpenseModal.tsx"), // "Paid by"
  path.join("app", "trips", "[tripId]", "tabs", "EditExpenseModal.tsx"), // "Paid by"
  path.join("app", "trips", "[tripId]", "tabs", "ExpensesSection.tsx"), // "Paid by", "who paid"
  path.join("app", "trips", "[tripId]", "tabs", "ExpensesTab.tsx"), // "Track who paid for what"
  path.join("components", "HelperCards.tsx"), // the expenses helper card
  path.join("components", "marketing", "FeaturesSection.tsx"), // the expenses feature
  path.join("server", "routers", "expenses.ts"), // "a receipt you paid for"
  path.join("server", "routers", "tripMembers.ts"), // "expenses they paid"
]);
/** One-word literals the copy scanner skips as identifier-shaped, which is how
 *  `one ? "pays" : "pay"` hid from the sweep that found the rest. */
const PAY_WORDS = ["pay", "pays", "paid", "paying", "payout", "unpaid"];

describe("no copy says a game pays points", () => {
  it("CONTROL: a sentence and a bare one-word literal are both caught", () => {
    const sample = [`const a = "This game pays no points.";`, `const b = one ? "pays" : "pay";`].join("\n");
    expect(copyMatches(sample, "sample.ts", PAY).map((h) => h.line)).toEqual([1]);
    expect(PAY_WORDS.flatMap((w) => exactLiterals(sample, "sample.ts", w)).map((h) => h.line)).toEqual([2, 2]);
  });

  it("CONTROL: the money files really do say it (so the exclusion is excluding something)", () => {
    for (const rel of MONEY) {
      const file = files.find((x) => x.rel === rel);
      expect(file, rel).toBeDefined();
      expect(copyMatches(file!.source, rel, PAY).length, rel).toBeGreaterThan(0);
    }
  });

  it("in a sentence", () => {
    const hits = files
      .filter((x) => !MONEY.has(x.rel))
      .flatMap((x) => copyMatches(x.source, x.rel, PAY).map((h) => ({ rel: x.rel, ...h })));
    expect(report(hits)).toEqual([]);
  });

  it("as a bare one-word literal", () => {
    const hits = files
      .filter((x) => !MONEY.has(x.rel))
      .flatMap((x) => PAY_WORDS.flatMap((w) => exactLiterals(x.source, x.rel, w)).map((h) => ({ rel: x.rel, ...h })));
    expect(report(hits)).toEqual([]);
  });
});
