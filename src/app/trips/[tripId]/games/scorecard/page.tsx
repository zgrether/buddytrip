"use client";

import { useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { StandardGrid } from "@/components/games/StandardGrid";
import { unitsFromSchema, teeFromSchema } from "@/lib/strokePlayConfig";
import { isGolfFormat } from "@/lib/gameRoutes";
import { useScorecardTeeRows } from "@/hooks/useScorecardTeeRows";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Empty scorecard PREVIEW (Spec 5a) — a course-setup VALIDATOR. Renders the
 * game's PERSISTED course structure (par / yardage / stroke index, front + back,
 * including a combined-two-nines course) with NO scores, so an owner can confirm
 * "did I set the course up right?".
 *
 * It reads `games.getById` — the server's snapshotted `scorecard_schema`, the
 * source of truth — never optimistic/cached UI state (a validator that trusted the
 * cache it's meant to check would defeat its purpose). Format-agnostic: ONE page
 * for every golf format, since it needs only the schema (not per-format
 * scores/roster). Single tee box; multi-tee is Spec 5b. Reached from the
 * leaderboard scorecard icon and the game-settings course row.
 */
export default function ScorecardPreviewPage() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const gameId = search.get("game");

  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery(
    { slugOrId: param },
    { ...STRUCTURE_QUERY, enabled: !isId, retry: false }
  );
  const tripId = isId ? param : resolved.data?.id;

  // Persisted read (the whole point of a validator): the snapshot as SAVED.
  const gameQ = trpc.games.getById.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!gameId }
  );

  const schema = gameQ.data?.scorecard_schema as Parameters<typeof unitsFromSchema>[0];
  const units = useMemo(() => unitsFromSchema(schema), [schema]);
  const tee = useMemo(
    () => teeFromSchema(schema as Parameters<typeof teeFromSchema>[0]),
    [schema]
  );
  // Multi-tee yardage rows (Spec 5b) — reads the persisted course record(s).
  const { rows: teeRows } = useScorecardTeeRows(tripId, gameQ.data);
  const gameTypeId = gameQ.data?.game_type_id as string | undefined;
  // A course is applied ⟺ course_id is set (a 9-hole front counts — the preview
  // honestly shows a lone front nine so "I forgot the back" is visible).
  const hasCourse = !!(gameQ.data as { course_id?: string | null } | undefined)?.course_id;
  const isGolf = isGolfFormat(gameTypeId ?? null);

  const header = (title: string, subtitle?: string) => (
    <header
      className="flex shrink-0 items-center"
      style={{
        height: 52,
        padding: "0 8px",
        background: "var(--color-bt-nav-bg)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
    >
      <button onClick={() => router.back()} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
        <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
      </button>
      <div className="min-w-0 flex-1 text-center" style={{ marginRight: 36 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{title}</div>
        {subtitle && (
          <div className="truncate" style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
        )}
      </div>
    </header>
  );

  // ── Loading ──
  if (!tripId || !gameId || gameQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // ── No scorecard to preview (non-golf, or no course applied). The entry points
  // are gated to golf-with-course, so this is a defensive/deep-link fallback. ──
  if (!gameQ.data || !isGolf || !hasCourse) {
    return (
      <div className="flex min-h-screen flex-col" style={{ background: "var(--color-bt-base)" }}>
        {header("Scorecard")}
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            No course set for this game yet — apply a course in game settings to preview its scorecard.
          </p>
        </div>
      </div>
    );
  }

  // ── Empty preview: course structure only (participants=[] → no score rows). ──
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--color-bt-base)" }}>
      {header("Scorecard", (gameQ.data.name as string | undefined) ?? undefined)}
      <div className="min-h-0 flex-1">
        <StandardGrid units={units} tee={tee} participants={[]} values={{}} direction="low_wins" teeRows={teeRows} />
      </div>
    </div>
  );
}
