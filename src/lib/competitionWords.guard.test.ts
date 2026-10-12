import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { COMPETITION_WORD, competitionNoun, competitionWord } from "./competitionWords";

/**
 * On screen a competition is a **Cup** (head to head) or a **Tournament**
 * (points-based) — Zach, 2026-10-12, recorded in the CLAUDE.md glossary. Never
 * "Race" or "Tourney", never a real event's name, and never the code's own word
 * for the container.
 *
 * This reads every user-visible string in `src` — string literals, template
 * text and JSX text, through the TypeScript scanner, so comments and
 * identifiers can't match — and fails on:
 *
 *  1. a RETIRED word: race, tourney, or a real event's name;
 *  2. the code's word, "competition", used as copy. Identifier-shaped strings
 *     (`"competitions"` the table, `"competition-hero"` a test id) are not copy.
 *
 * What it can NOT check, stated so nobody reads it as covered: a surface that
 * serves both kinds but says "cup". "cup" is right on a head-to-head-only
 * surface (Rack-n-Stack, the two-team refusals), so the word alone can't tell a
 * correct use from a wrong one. Those surfaces read `competitionWord(model)`.
 */

const ROOT = path.join(process.cwd(), "src");

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

/** Every visible-text token in `source` matching `word`, with its line. */
export function copyMatches(source: string, fileName: string, word: RegExp): { line: number; text: string }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    // Import and export paths are module names, not copy.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (VISIBLE.has(node.kind)) {
      const raw = node.getText(sf);
      if (word.test(raw) && !identifierShaped(raw)) {
        out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: raw.trim().slice(0, 120) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const files = sourceFiles(ROOT).map((f) => ({ rel: path.relative(ROOT, f), source: fs.readFileSync(f, "utf8") }));

const report = (hits: { rel: string; line: number; text: string }[]) => hits.map((h) => `${h.rel}:${h.line}  ${h.text}`);

describe("the words a competition goes by on screen", () => {
  it("is a Cup when head to head and a Tournament when points-based", () => {
    expect(COMPETITION_WORD).toEqual({ match_play: "Cup", points: "Tournament" });
    expect(competitionWord("points")).toBe("Tournament");
    expect(competitionNoun("match_play")).toBe("cup");
  });

  it("reads an unset model as head to head, the column's own default", () => {
    expect(competitionWord(null)).toBe("Cup");
    expect(competitionWord(undefined)).toBe("Cup");
  });
});

describe("no screen uses a retired word or the code's word", () => {
  it("the scan reads the source it means to (control)", () => {
    // Without this, an empty file list or a broken scanner reads as "clean".
    expect(files.length).toBeGreaterThan(300);
    const own = files.find((f) => f.rel === path.join("lib", "competitionWords.ts"));
    expect(own && copyMatches(own.source, "competitionWords.ts", /Cup or Tournament/)).toHaveLength(1);
  });

  it("the scanner catches copy, and passes identifiers and comments (control)", () => {
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

  it("no copy says race, tourney or a real event's name", () => {
    const hits = files.flatMap((f) => copyMatches(f.source, f.rel, RETIRED).map((h) => ({ rel: f.rel, ...h })));
    expect(report(hits)).toEqual([]);
  });

  it("no copy names the container 'competition' — it says Cup, Tournament, or both", () => {
    const hits = files
      .filter((f) => !PLAIN_ENGLISH.has(f.rel))
      .flatMap((f) => copyMatches(f.source, f.rel, CODE_WORD).map((h) => ({ rel: f.rel, ...h })));
    expect(report(hits)).toEqual([]);
  });
});
