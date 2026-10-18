import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";

/**
 * SOURCE GUARD for #1276: no single-row read in `src/server` may drop its
 * `error` and then turn an empty result into a refusal.
 *
 *   const { data: game } = await ctx.supabase.from("games")...maybeSingle();
 *   if (!game) throw new TRPCError({ code: "NOT_FOUND", ... });
 *
 * A failed read comes back as `data: null` too, so that shape tells a person
 * "this doesn't exist" (or "you can't") when the truth is "we couldn't look",
 * and every such code is terminal to the client outboxes. Read it through the
 * `rowOrThrow` family instead: `maybeRowOrThrow(await …maybeSingle(), "what")`,
 * then the same guard.
 *
 * The scanner is the one #1276 was measured with (13 sites on 2026-10-18, all
 * rewritten). It carries its own CONTROL below: a planted snippet it MUST flag
 * and two it must not, so a scanner that silently stopped matching anything
 * would fail here rather than pass forever.
 *
 * The expression is `[^;]*?`, NOT `[\s\S]*?`. With the lazy any-character
 * version, a `const {` that does not end in `.single()` / `.maybeSingle()`
 * stretched forward and swallowed the NEXT statement that does; when the
 * swallowing statement destructured `error`, the merged match was skipped and
 * the real site behind it vanished. It hid 16 sites while this guard read
 * green (#1276, reopened 2026-10-18). The control's third case is that shape.
 */

const STATEMENT = /const\s*\{\s*([^}]*)\}\s*=\s*await\s+([^;]*?)\.(single|maybeSingle)\(\)\s*;/g;

function findSites(src: string): number[] {
  const text = src.split("\r").join("");
  const lines: number[] = [];
  let m: RegExpExecArray | null;
  STATEMENT.lastIndex = 0;
  while ((m = STATEMENT.exec(text))) {
    const pattern = m[1];
    if (/\berror\b/.test(pattern)) continue;
    const dm = /\bdata\s*:\s*(\w+)/.exec(pattern);
    const v = dm ? dm[1] : /\bdata\b/.test(pattern) ? "data" : null;
    if (!v) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const guard = new RegExp(
      "if\\s*\\(\\s*!" + v + "\\b[^)]*\\)\\s*\\{?\\s*throw\\s+new\\s+TRPCError\\(\\s*\\{\\s*code:\\s*\"[A-Z_]+\""
    );
    if (guard.test(after)) lines.push(text.slice(0, m.index).split("\n").length);
  }
  return lines;
}

function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...serverFiles(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("the scanner (CONTROL: it can fail)", () => {
  it("flags the #1276 shape, single-line and multi-line", () => {
    const bad = [
      'const { data: game } = await ctx.supabase.from("games").select("id").eq("id", x).maybeSingle();',
      'if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });',
      "const { data: row } = await ctx.supabase",
      '  .from("trips")',
      '  .select("id")',
      "  .single();",
      "if (!row) {",
      '  throw new TRPCError({ code: "FORBIDDEN", message: "no" });',
      "}",
    ].join("\n");
    expect(findSites(bad)).toEqual([1, 3]);
  });

  it("flags a site that follows an earlier statement destructuring `error` (the shape that hid 16)", () => {
    const swallowed = [
      'const { data: list, error } = await ctx.supabase.from("games").select("id");',
      'const { data: member } = await ctx.supabase.from("trip_members").select("id").maybeSingle();',
      'if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "x" });',
    ].join("\n");
    expect(findSites(swallowed)).toEqual([2]);
  });

  it("does not flag a read that keeps its error, or one that refuses nothing", () => {
    const ok = [
      'const { data: game, error } = await ctx.supabase.from("games").select("id").maybeSingle();',
      'if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "x" });',
      'const { data: other } = await ctx.supabase.from("games").select("id").maybeSingle();',
      "return other ?? null;",
    ].join("\n");
    expect(findSites(ok)).toEqual([]);
  });
});

describe("src/server", () => {
  it("has no single-row read that turns a failed read into a refusal (#1276)", () => {
    const root = join(__dirname);
    const found: string[] = [];
    for (const f of serverFiles(root)) {
      for (const line of findSites(readFileSync(f, "utf8"))) {
        found.push(`${relative(root, f).split(sep).join("/")}:${line}`);
      }
    }
    expect(
      found,
      "Read these through maybeRowOrThrow (src/server/lib/rowOrThrow.ts), then keep the guard: a failed read must not read as absent"
    ).toEqual([]);
  });
});
