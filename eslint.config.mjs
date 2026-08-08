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
  ]),
]);

export default eslintConfig;
