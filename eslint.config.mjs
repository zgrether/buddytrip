import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  // A bare `toThrow()` passes on ANY throw, so it cannot tell the refusal a
  // test is named for from any other (#1543). "a Member cannot add
  // participants" sent one user id where the schema's floor is two: zod refused
  // it before the permission gate ran, and the bare assertion read that as the
  // Member being refused. With the gate forced open, the requests still died on
  // a LATER refusal (RLS, a downstream precondition) — which the bare form also
  // accepted. Name what is expected: `toMatchObject({ code, message })`, a zod
  // issue's `cause.issues[].path`, or `toThrow(<message or /pattern/>)`.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // `.not.toThrow()` is exempt: "does not throw" names exactly one outcome.
          selector:
            "CallExpression[callee.property.name=/^toThrow(Error)?$/][arguments.length=0]:not([callee.object.property.name='not'])",
          message:
            "A bare toThrow() passes on ANY error, so it cannot tell the refusal this test is named for from any other (#1543). Name it: .rejects.toMatchObject({ code: \"FORBIDDEN\", message: … }), a zod issue path via cause.issues, or .toThrow(\"…\" / /…/).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // `design/` is DESIGN EXPLORATION, not application code. The .jsx files
    // there are standalone mockups — they reference illustrative components
    // (`BTButton`, `BTAvatar`, …) that are deliberately never defined or
    // imported, because the files exist to be looked at, not built. Nothing
    // imports them, Next never compiles them, and linting them with the app's
    // React rules produces 198 errors that all say the same non-fact.
    //
    // This ignores the FILES, and says nothing about whether the design RULES
    // in design/README.md and design/SKILL.md are live — that question is open
    // (RULES_AUDIT.md §7 Q4). Do not read this entry as retiring them.
    "design/**",

    // Local-only. `.claude/worktrees/` holds full git worktrees — each one a
    // complete second checkout of this repo, `src/` and all. ESLint 9 flat
    // config does not read `.gitignore`, so a bare `npx eslint` (which IS the
    // CI gate command) crawls every one of them and lints the same files N+1
    // times. Measured against 6 worktrees: >10 minutes with no output, versus
    // well under a minute once ignored.
    //
    // CI is unaffected — its checkout has no worktrees — and that is exactly
    // why this went unnoticed for so long: the gate is slow ONLY where a person
    // runs it, which is the one place slowness costs something. The risk is not
    // the minutes; it is that a gate nobody will wait for stops being run, and
    // then the local check quietly becomes a narrower one (CLAUDE.md's
    // "run the gate's own command" — this keeps that command affordable).
    //
    // Nothing tracked under `.claude/` is lintable (`git ls-files .claude`
    // returns no JS/TS), so this removes local noise and no coverage.
    ".claude/**",
  ]),
]);

export default eslintConfig;
