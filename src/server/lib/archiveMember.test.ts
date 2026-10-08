import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { archiveRefusalOf } from "./archiveMember";

/**
 * The refusal codes are a two-sided contract: `archive_trip_member` RAISEs
 * them in SQL, and `archiveRefusalOf` turns each into a readable message. A
 * code renamed on one side falls through to the generic 500 with no error
 * anywhere, so this reads the codes from the LATEST migration that defines the
 * function and checks the app knows every one.
 */

const MIGRATIONS = join(__dirname, "..", "..", "..", "supabase", "migrations");

function latestArchiveSource(): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const defining = files.filter((f) =>
    readFileSync(join(MIGRATIONS, f), "utf8").includes("CREATE OR REPLACE FUNCTION public.archive_trip_member(")
  );
  if (defining.length === 0) throw new Error("no migration defines archive_trip_member");
  return readFileSync(join(MIGRATIONS, defining[defining.length - 1]), "utf8");
}

describe("archive refusals: the app knows every code the function raises", () => {
  const raised = [...latestArchiveSource().matchAll(/RAISE EXCEPTION '(ARCHIVE_[A-Z_]+)'/g)].map((m) => m[1]);

  it("reads a real set of codes from the migration (the scan is not empty)", () => {
    expect(raised).toContain("ARCHIVE_OWNER_MUST_TRANSFER");
    expect(raised.length).toBeGreaterThanOrEqual(6);
  });

  it("maps every raised code, and nothing else", () => {
    for (const code of raised) {
      expect(archiveRefusalOf(`ERROR: ${code}`), code).toBe(code);
    }
    expect(archiveRefusalOf("some other database error")).toBeNull();
    expect(archiveRefusalOf(undefined)).toBeNull();
  });
});
