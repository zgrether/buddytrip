import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { SLATE_RESULT_WORD } from "./pickemResultWords";

/**
 * The screen says "Canceled", the database stores `cancelled` (Zach, 2026-10-08).
 * That one-letter split is fine as long as it is ONE split: the word on screen
 * comes from `SLATE_RESULT_WORD`, and nothing else spells it.
 *
 * This reads every user-visible string in `src` — string literals, template
 * text and JSX text, through the TypeScript scanner, so comments and
 * identifiers cannot match — and fails on any spelling of the word anywhere but
 * the mapping. The bare stored value, the literal `"cancelled"`, is allowed:
 * it is an identifier the code compares against, not copy.
 */

const ROOT = path.join(process.cwd(), "src");
const HOME = path.join("lib", "pickemResultWords.ts");
const WORD = /cancel+ed/i;

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

/** Every visible-text token in `file` that names the word, with its line. */
function mentions(file: string): { line: number; text: string }[] {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (VISIBLE.has(node.kind)) {
      const raw = node.getText(sf);
      if (WORD.test(raw)) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: raw.trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const all = sourceFiles(ROOT).map((f) => ({ rel: path.relative(ROOT, f), hits: mentions(f) }));

describe("the cancelled game's word on screen comes from ONE place", () => {
  it("CONTROL: the scanner reads the mapping's own word, and finds the stored value in use", () => {
    // Without this, a scanner that reads nothing reports no violations — which
    // is indistinguishable from a clean tree (CLAUDE.md: prove the instrument
    // can go red).
    expect(SLATE_RESULT_WORD.cancelled).toBe("Canceled");
    const home = all.find((f) => f.rel === HOME);
    expect(home?.hits.map((h) => h.text)).toContain('"Canceled"');
    const storedValueUses = all.flatMap((f) => f.hits).filter((h) => h.text === '"cancelled"').length;
    expect(storedValueUses).toBeGreaterThan(5);
  });

  it("no other file spells it — the bare stored value is the only exception", () => {
    const offenders = all
      .filter((f) => f.rel !== HOME)
      .flatMap((f) => f.hits.filter((h) => h.text !== '"cancelled"').map((h) => `${f.rel}:${h.line} ${h.text}`));
    expect(offenders).toEqual([]);
  });
});
