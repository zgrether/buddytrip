"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Plus, X, AlertTriangle, MapPin, PencilLine, GripVertical, Check } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { HoleEditor, Keypad } from "./HoleEditor";
import {
  searchCourses,
  getCourseDetail,
  parFromDetail,
  indexFromDetail,
  teeSetsFromDetail,
  teeColor,
  type CourseSummary,
} from "@/lib/courseService";
import { validateStrokeIndex, applyStrokeIndexSwap, type IndexEntry } from "@/lib/courseIndex";
import { NavArrow, HoleProgress } from "../entryChrome";

/**
 * CoursePicker — the Course Selector/Builder flow (Slice C + addendum C-1). A
 * full-screen overlay launched from the new-game "Select a course" field. Two
 * paths, one editor: lookup (search → results → confirm) and manual (new course
 * → stepped per-hole entry), both producing a saved global `courses` row; on
 * apply it hands the parent { id, name } to snapshot onto the game.
 *
 * Par is required; the stroke index is OPTIONAL. An untouched index saves on par
 * alone (sequential fallback) — only a STARTED-but-incomplete index blocks
 * Use/Save; a complete one is enforced as a valid 1..N permutation via the
 * 18-cell grid's swap-on-pick. A dirty/partial pulled index is treated as absent.
 * Per-hole controls are tap-first: par segmented, yards keypad, index grid.
 */

// Full per-tee record (mig 059): ratings carried from golfcourseapi (null for
// manual entry, which doesn't collect them). Displaying all tees' ratings on
// the scorecard is a follow-up (PR 2) — this rev persists the data.
type TeeSet = {
  name: string;
  courseRating?: number | null;
  slopeRating?: number | null;
  bogeyRating?: number | null;
  yards: (number | null)[];
};
interface Draft {
  name: string;
  location: string;
  holeCount: 9 | 18;
  par: number[];
  index: IndexEntry[];
  hasStrokeIndex: boolean;
  teeSets: TeeSet[];
  source: "manual" | "golfcourseapi";
  providerId?: string;
  /** Set when reviewing an existing library course; applied as-is unless edited. */
  existingId?: string;
}

type Screen = "search" | "confirm" | "new" | "entry" | "saved";

const blankTee = (n: number, name: string): TeeSet => ({ name, yards: Array(n).fill(null) });

function blankDraft(holeCount: 9 | 18): Draft {
  return {
    name: "",
    location: "",
    holeCount,
    par: Array(holeCount).fill(4),
    index: Array(holeCount).fill(null),
    hasStrokeIndex: true,
    teeSets: [blankTee(holeCount, "White")],
    source: "manual",
  };
}

export function CoursePicker({
  onApply,
  onClose,
}: {
  onApply: (course: { id: string; name: string; teeName?: string }) => void;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState<Screen>("search");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // API (golfcourseapi) results — populated ONLY by the explicit "Search the
  // full database" control, never by typing. Local typeahead is the default.
  const [apiResults, setApiResults] = useState<CourseSummary[]>([]);
  const [apiSearching, setApiSearching] = useState(false);
  const [apiSearched, setApiSearched] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(18));
  const [activeTee, setActiveTee] = useState(0);
  const [hole, setHole] = useState(1);
  const [editingHole, setEditingHole] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  // True once any hole is edited — a reviewed library course is applied as-is
  // when untouched, or saved as a new course (a copy) when edited.
  const [edited, setEdited] = useState(false);
  // The stroke index table is opt-in (per the empty-grid scrim) — course-level
  // UI state, not per-hole (the same table is filled from any hole's screen).
  const [indexOptedIn, setIndexOptedIn] = useState(false);
  // The Confirm/review card is two modes: 'use' (pick → drop into the game) and
  // 'summary' (manual add → save to My courses, NOT auto-used).
  const [confirmMode, setConfirmMode] = useState<"use" | "summary">("use");
  // The course just saved via "Save to my courses" — highlighted on My courses.
  const [savedId, setSavedId] = useState<string | null>(null);

  const recent = trpc.courses.list.useQuery({ limit: 8 });
  const createCourse = trpc.courses.create.useMutation();
  // Daily golfcourseapi cap (50/day, UTC). atCap disables the wider-search +
  // import and steers to the manual floor; local typeahead is never affected.
  const utils = trpc.useUtils();
  const apiUsage = trpc.courses.apiUsage.useQuery(undefined, { staleTime: 0 });
  const recordApiCall = trpc.courses.recordApiCall.useMutation();
  const atCap = apiUsage.data?.atCap ?? false;

  // Debounce the typed query for the LOCAL search (free, never hits the API).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // A new query invalidates any prior API results (they're for the old term).
  useEffect(() => {
    setApiResults([]);
    setApiSearched(false);
  }, [debouncedQuery]);

  // LOCAL typeahead against our own courses table — the common path, zero API
  // calls, unaffected by the daily cap.
  const localSearch = trpc.courses.search.useQuery(
    { q: debouncedQuery, limit: 10 },
    { enabled: debouncedQuery.length >= 2 }
  );

  // The ONLY path that hits golfcourseapi — one call per explicit click, never
  // per keystroke. Gated by the daily counter: record-then-fire, and bail
  // (without firing) if the atomic check says we're at the cap.
  async function searchFullDatabase() {
    const q = query.trim();
    if (q.length < 2 || apiSearching || atCap) return;
    setApiSearching(true);
    const gate = await recordApiCall.mutateAsync();
    await utils.courses.apiUsage.invalidate();
    if (!gate.permitted) {
      setApiSearching(false); // hit the cap between render and click — button now disables
      return;
    }
    const r = await searchCourses(q);
    setApiResults(r);
    setApiSearched(true);
    setApiSearching(false);
  }

  const validation = useMemo(
    () => validateStrokeIndex(draft.index, draft.holeCount),
    [draft.index, draft.holeCount]
  );
  // The stroke index is OPTIONAL: untouched (no hole set) is a legal, saveable
  // state (sequential fallback). Only a STARTED-but-incomplete index blocks
  // Use/Save. A complete permutation is the real index.
  const indexStarted = draft.hasStrokeIndex && draft.index.some((v) => v != null);
  const indexUsable = !indexStarted || validation.valid; // untouched OR complete
  const flagged = useMemo(
    () =>
      indexStarted && !validation.valid
        ? new Set([...validation.unsetHoles, ...validation.duplicateHoles, ...validation.outOfRangeHoles])
        : new Set<number>(),
    [validation, indexStarted]
  );

  const setPar = (h: number, value: number) => {
    setEdited(true);
    setDraft((d) => ({ ...d, par: d.par.map((p, i) => (i === h - 1 ? value : p)) }));
  };
  const setIndex = (h: number, value: number) => {
    setEdited(true);
    setDraft((d) => ({ ...d, index: applyStrokeIndexSwap(d.index, h - 1, value) }));
  };
  const setYards = (h: number, value: number | null) => {
    setEdited(true);
    setDraft((d) => ({
      ...d,
      teeSets: d.teeSets.map((t, ti) =>
        ti === activeTee ? { ...t, yards: t.yards.map((y, i) => (i === h - 1 ? value : y)) } : t
      ),
    }));
  };

  async function pull(summary: CourseSummary) {
    setEdited(false);
    setIndexOptedIn(false);
    setConfirmMode("use");
    setPulling(true);
    // Importing is a second API call — gate it too. At cap, fall back to manual
    // entry with the name/location prefilled (same path as a failed detail).
    const gate = await recordApiCall.mutateAsync();
    await utils.courses.apiUsage.invalidate();
    if (!gate.permitted) {
      setPulling(false);
      setDraft({ ...blankDraft(18), name: summary.name, location: summary.location });
      setActiveTee(0);
      setHole(1);
      setScreen("new");
      return;
    }
    const detail = await getCourseDetail(summary.id);
    setPulling(false);
    if (!detail || detail.holes.length === 0) {
      setDraft({ ...blankDraft(18), name: summary.name, location: summary.location });
      setActiveTee(0);
      setHole(1);
      setScreen("new");
      return;
    }
    const holeCount = (detail.holes.length >= 18 ? 18 : 9) as 9 | 18;
    const tees = teeSetsFromDetail(detail);
    // Dirty lookup data: a complete clean permutation is kept; a missing/partial
    // pulled index is treated as ABSENT (cleared to untouched → fallback) rather
    // than carried in as a started-but-broken index.
    const pulledIndex = indexFromDetail(detail).slice(0, holeCount);
    const cleanIndex = validateStrokeIndex(pulledIndex, holeCount).valid
      ? pulledIndex
      : Array(holeCount).fill(null);
    setDraft({
      name: detail.name,
      location: detail.location,
      holeCount,
      par: parFromDetail(detail).slice(0, holeCount),
      index: cleanIndex,
      hasStrokeIndex: true,
      teeSets: tees.length ? tees.map((t) => ({ ...t, yards: t.yards.slice(0, holeCount) })) : [blankTee(holeCount, "White")],
      source: "golfcourseapi",
      providerId: detail.externalId,
    });
    setActiveTee(0);
    setScreen("confirm");
  }

  // Review a saved library course on the Confirm screen before applying (eyeball
  // / fix-a-hole). Untouched → applied as-is; edited → saved as a copy.
  function reviewRecent(c: RecentCourse) {
    setEdited(false);
    setIndexOptedIn(false);
    setConfirmMode("use");
    setDraft({
      name: c.name,
      location: c.location ?? "",
      holeCount: c.hole_count,
      par: c.par,
      index: c.has_stroke_index ? c.handicap_index : Array(c.hole_count).fill(null),
      hasStrokeIndex: c.has_stroke_index,
      teeSets: c.tee_sets?.length ? c.tee_sets : [blankTee(c.hole_count, "White")],
      source: "manual",
      existingId: c.id,
    });
    setActiveTee(0);
    setScreen("confirm");
  }

  // Persist the draft as a global course. The index is snapshotted ONLY when the
  // table is a complete 1..N ranking; an untouched (or partial-cleared) table
  // saves on par alone (fallback: handicap from the first hole onward).
  async function persistDraft() {
    const hasIndex = validation.valid;
    const course = await createCourse.mutateAsync({
      name: draft.name.trim(),
      location: draft.location.trim() || undefined,
      holeCount: draft.holeCount,
      par: draft.par,
      handicapIndex: hasIndex ? (draft.index as number[]) : undefined,
      hasStrokeIndex: hasIndex,
      teeSets: draft.teeSets,
      source: draft.source,
      providerId: draft.providerId,
    });
    return course;
  }

  // mode 'use' — pick a course to drop into the game. The active tee chip is the
  // configured tee — pass it so applyCourse snapshots THAT tee's yardage.
  async function useCourse() {
    if (!indexUsable || !draft.name.trim()) return;
    const teeName = draft.teeSets[activeTee]?.name?.trim() || undefined;
    // Reviewing an existing library course, unedited → apply it directly.
    if (draft.existingId && !edited) {
      onApply({ id: draft.existingId, name: draft.name.trim(), teeName });
      return;
    }
    const course = await persistDraft();
    onApply({ id: course.id as string, name: course.name as string, teeName });
  }

  // mode 'summary' — manual add lands on My courses (NOT auto-used in a game).
  async function saveToMyCourses() {
    if (!indexUsable || !draft.name.trim()) return;
    const course = await persistDraft();
    setSavedId(course.id as string);
    await recent.refetch();
    setScreen("saved");
  }

  // On the per-hole screens (stepped entry + single-hole edit) the title is the
  // course itself, with "Hole N of N" as the subtitle (so the hole number lives
  // in the header, not buried at the bottom of the editor).
  const holeShown = editingHole ?? (screen === "entry" ? hole : null);
  const headerTitle =
    holeShown != null
      ? draft.name.trim() || "New course"
      : screen === "search"
        ? "Add a course"
        : screen === "confirm"
          ? confirmMode === "summary"
            ? "Course summary"
            : "Confirm course"
          : screen === "new"
            ? "New course"
            : screen === "saved"
              ? "My courses"
              : "Enter holes";
  const headerSubtitle =
    holeShown != null ? `Hole ${holeShown} of ${draft.holeCount}` : screen === "confirm" && confirmMode === "summary" ? "Review what you entered" : null;
  const back = () => {
    if (editingHole != null) return setEditingHole(null);
    if (screen === "confirm") return setScreen(confirmMode === "summary" ? "entry" : "search");
    if (screen === "new" || screen === "saved") return setScreen("search");
    if (screen === "entry") return setScreen("new");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--color-bt-base)" }}>
      <header
        className="flex shrink-0 items-center justify-between"
        style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}
      >
        <button onClick={back} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
          <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
        </button>
        {/* Same shape + spacing as the score-entry header (ScoreEntryView). */}
        <div className="flex min-w-0 flex-col items-center text-center">
          <div className="max-w-full truncate" style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{headerTitle}</div>
          {headerSubtitle && <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{headerSubtitle}</div>}
        </div>
        <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center">
          <X size={20} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>
      </header>

      {editingHole != null ? (
        <HoleEditScreen
          draft={draft}
          hole={editingHole}
          activeTee={activeTee}
          setActiveTee={setActiveTee}
          flagged={flagged}
          indexOptedIn={indexOptedIn}
          onOptInIndex={() => setIndexOptedIn(true)}
          setPar={setPar}
          setIndex={setIndex}
          setYards={setYards}
          onDone={() => setEditingHole(null)}
        />
      ) : screen === "search" ? (
        <SearchScreen
          query={query}
          setQuery={setQuery}
          localResults={(localSearch.data as RecentCourse[]) ?? []}
          localSearching={localSearch.isFetching && debouncedQuery.length >= 2}
          apiResults={apiResults}
          apiSearching={apiSearching}
          apiSearched={apiSearched}
          onSearchFull={searchFullDatabase}
          atCap={atCap}
          recent={(recent.data as RecentCourse[]) ?? []}
          pulling={pulling}
          onPick={pull}
          onPickCourse={reviewRecent}
          onManual={() => {
            setEdited(false);
            setIndexOptedIn(false);
            setConfirmMode("summary");
            setDraft(blankDraft(18));
            setActiveTee(0);
            setScreen("new");
          }}
        />
      ) : screen === "confirm" ? (
        <ConfirmScreen
          draft={draft}
          mode={confirmMode}
          activeTee={activeTee}
          setActiveTee={setActiveTee}
          indexUsable={indexUsable}
          flagged={flagged}
          saving={createCourse.isPending}
          onEditHole={(h) => setEditingHole(h)}
          onPrimary={confirmMode === "summary" ? saveToMyCourses : useCourse}
        />
      ) : screen === "new" ? (
        <NewCourseScreen draft={draft} setDraft={setDraft} onStart={() => { setHole(1); setScreen("entry"); }} />
      ) : screen === "saved" ? (
        <SavedScreen
          courses={(recent.data as RecentCourse[]) ?? []}
          savedId={savedId}
          onPick={reviewRecent}
          onAddAnother={() => {
            setEdited(false);
            setIndexOptedIn(false);
            setConfirmMode("summary");
            setSavedId(null);
            setDraft(blankDraft(18));
            setActiveTee(0);
            setScreen("new");
          }}
        />
      ) : (
        <EntryScreen
          draft={draft}
          hole={hole}
          setHole={setHole}
          activeTee={activeTee}
          setActiveTee={setActiveTee}
          indexOptedIn={indexOptedIn}
          onOptInIndex={() => setIndexOptedIn(true)}
          indexUsable={indexUsable}
          setPar={setPar}
          setIndex={setIndex}
          setYards={setYards}
          onReview={() => setScreen("confirm")}
        />
      )}
    </div>
  );
}

interface RecentCourse {
  id: string;
  name: string;
  location: string | null;
  hole_count: 9 | 18;
  par: number[];
  handicap_index: number[];
  has_stroke_index: boolean;
  tee_sets: TeeSet[];
}

// ── Search (two-stage: local typeahead → explicit full-database) ──────────────
// Typing searches OUR library only (free, instant, cap-proof). The full
// golfcourseapi database is reached ONLY via the explicit control below the
// local results — one API call per click, never per keystroke.
function SearchScreen({
  query,
  setQuery,
  localResults,
  localSearching,
  apiResults,
  apiSearching,
  apiSearched,
  onSearchFull,
  atCap,
  recent,
  pulling,
  onPick,
  onPickCourse,
  onManual,
}: {
  query: string;
  setQuery: (q: string) => void;
  localResults: RecentCourse[];
  localSearching: boolean;
  apiResults: CourseSummary[];
  apiSearching: boolean;
  apiSearched: boolean;
  onSearchFull: () => void;
  atCap: boolean;
  recent: RecentCourse[];
  pulling: boolean;
  onPick: (c: CourseSummary) => void;
  onPickCourse: (c: RecentCourse) => void;
  onManual: () => void;
}) {
  const showResults = query.trim().length >= 2;
  const courseSub = (c: RecentCourse) => {
    const par = (c.par ?? []).reduce<number>((a, p) => a + p, 0);
    return [c.location, par ? `Par ${par}` : "", `${c.hole_count} holes`].filter(Boolean).join(" · ");
  };
  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
      <div className="flex items-center gap-2 rounded-xl border px-3" style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}>
        <Search size={16} style={{ color: "var(--color-bt-text-dim)" }} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your courses"
          className="w-full bg-transparent py-2.5 text-sm outline-none"
          style={{ color: "var(--color-bt-text)" }}
        />
      </div>

      {pulling && <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 14 }}>Pulling scorecard…</p>}

      {showResults ? (
        <>
          {/* Stage 1 — local library (free). */}
          <div className="mt-4 flex flex-col gap-2">
            {localSearching && localResults.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>Searching your courses…</p>
            )}
            {!localSearching && localResults.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>No saved courses match.</p>
            )}
            {localResults.map((c) => (
              <CourseRow key={c.id} name={c.name} sub={courseSub(c)} onClick={() => onPickCourse(c)} />
            ))}
          </div>

          {/* Stage 2 — explicit, deliberate API search (the only golfcourseapi call).
              At the daily cap the control is disabled and points at the manual floor;
              local typeahead above keeps working (it never hits the API). */}
          {atCap ? (
            <div
              className="mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5"
              style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}
            >
              <AlertTriangle size={15} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)" }}>
                Course search is temporarily unavailable — you can add the course manually below.
              </span>
            </div>
          ) : (
            <button
              onClick={onSearchFull}
              disabled={apiSearching}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3 disabled:opacity-50"
              style={{ borderColor: "var(--color-bt-border)", background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
            >
              <Search size={15} style={{ color: "var(--color-bt-text-dim)" }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {apiSearching ? "Searching the full database…" : "Don't see it? Search the full course database →"}
              </span>
            </button>
          )}

          {apiSearched && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                From the course database
              </p>
              <div className="flex flex-col gap-2">
                {apiResults.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>No matches in the database.</p>
                ) : (
                  apiResults.map((c) => <CourseRow key={c.id} name={c.name} sub={c.location} onClick={() => onPick(c)} />)
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        recent.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Recent courses</p>
            <div className="flex flex-col gap-2">
              {recent.map((c) => (
                <CourseRow key={c.id} name={c.name} sub={courseSub(c)} onClick={() => onPickCourse(c)} />
              ))}
            </div>
          </div>
        )
      )}

      <button
        onClick={onManual}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3"
        style={{ borderColor: "var(--color-bt-accent-border)", borderStyle: "dashed", color: "var(--color-bt-accent)", background: "transparent" }}
      >
        <PencilLine size={16} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Add course manually</span>
      </button>
      <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 8, textAlign: "center" }}>
        No course found, or no signal? Enter par + index by hand.
      </p>
    </div>
  );
}

function CourseRow({ name, sub, onClick }: { name: string; sub?: string | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left" style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}>
      <span className="min-w-0">
        <span className="block truncate" style={{ fontSize: 15, color: "var(--color-bt-text)" }}>{name}</span>
        {sub && <span className="block truncate" style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>{sub}</span>}
      </span>
      <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
    </button>
  );
}

// ── Confirm (lookup) ──────────────────────────────────────────────────────────
function ConfirmScreen({
  draft,
  mode,
  activeTee,
  setActiveTee,
  indexUsable,
  flagged,
  saving,
  onEditHole,
  onPrimary,
}: {
  draft: Draft;
  mode: "use" | "summary";
  activeTee: number;
  setActiveTee: (i: number) => void;
  indexUsable: boolean;
  flagged: Set<number>;
  saving: boolean;
  onEditHole: (h: number) => void;
  onPrimary: () => void;
}) {
  const tee = draft.teeSets[activeTee];
  const totalPar = draft.par.reduce<number>((a, p) => a + p, 0);
  const totalYards = (tee?.yards ?? []).reduce<number>((a, y) => a + (y ?? 0), 0);
  const indexStarted = draft.index.some((v) => v != null);
  const indexComplete = validateStrokeIndex(draft.index, draft.holeCount).valid;
  const showIndexCol = indexStarted; // show the rank column once any rank exists
  const primaryLabel = !indexUsable
    ? "Finish the stroke index table to save"
    : saving
      ? "Saving…"
      : mode === "summary"
        ? "Save to my courses"
        : "Use this course";
  return (
    <>
      <div className="flex-1 overflow-y-auto" style={{ padding: "16px 16px 8px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>{draft.name}</div>
        <div className="flex flex-wrap items-center gap-x-2" style={{ marginTop: 2 }}>
          {draft.location && (
            <span className="flex items-center gap-1">
              <MapPin size={13} style={{ color: "var(--color-bt-text-dim)" }} />
              <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{draft.location}</span>
            </span>
          )}
          <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>
            {draft.location ? "· " : ""}Par {totalPar}{totalYards > 0 ? ` · ${totalYards.toLocaleString()} yds` : ""}
          </span>
        </div>

        {draft.teeSets.length > 0 && (
          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
            {draft.teeSets.map((t, i) => (
              <TeeChip key={i} name={t.name || `Tee ${i + 1}`} on={i === activeTee} onClick={() => setActiveTee(i)} />
            ))}
          </div>
        )}

        {!indexUsable ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5" style={{ background: "var(--color-bt-warning-faint)", borderColor: "var(--color-bt-warning-border)" }}>
            <AlertTriangle size={15} style={{ color: "var(--color-bt-warning)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: "var(--color-bt-text)" }}>
              You started the stroke index table — rank every hole, or clear it to use an assigned handicap from the first hole onward. Tap the flagged holes.
            </span>
          </div>
        ) : indexComplete ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5" style={{ background: "var(--color-bt-accent-faint)", borderColor: "var(--color-bt-accent-border)" }}>
            <Check size={15} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: "var(--color-bt-text)" }}>
              Stroke index table complete — handicap strokes land on the hardest holes first.
            </span>
          </div>
        ) : (
          <p className="mt-3" style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", lineHeight: 1.5 }}>
            {draft.source === "golfcourseapi"
              ? "No difficulty ranking — this listing's stroke index table was missing or incomplete, so an assigned handicap is used starting on the first hole and continuing on. Tap a hole to fill in the table yourself."
              : "No stroke index table — an assigned handicap is used starting on the first hole and continuing on. Tap a hole to fill one in."}
          </p>
        )}

        <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-bt-border)" }}>
          <HoleHeader hasIndex={showIndexCol} />
          {draft.par.map((p, i) => {
            const h = i + 1;
            const bad = flagged.has(h);
            return (
              <button
                key={h}
                onClick={() => onEditHole(h)}
                className="flex w-full items-center text-left"
                style={{ height: 38, background: i % 2 === 0 ? "var(--color-bt-card)" : "var(--color-bt-base)", borderTop: i === 0 ? undefined : "1px solid var(--color-bt-subtle-border)" }}
              >
                <Cell bold left>{h}</Cell>
                <Cell>
                  {tee?.yards[i] != null ? (
                    <span style={{ color: "var(--color-bt-text-dim)" }}>{tee.yards[i]}</span>
                  ) : (
                    <span style={{ color: "var(--color-bt-text-dim)", opacity: 0.4 }}>000</span>
                  )}
                </Cell>
                <Cell>{p}</Cell>
                {showIndexCol && <Cell warn={bad}>{draft.index[i] ?? "—"}</Cell>}
                <IconCol>
                  <PencilLine size={13} style={{ color: "var(--color-bt-text-dim)" }} />
                </IconCol>
              </button>
            );
          })}
          {/* Course totals — par is course-level; yards is the active tee. */}
          <div className="flex items-center" style={{ height: 36, background: "var(--color-bt-card-raised)", borderTop: "1px solid var(--color-bt-border)" }}>
            <Cell bold left>Total</Cell>
            <Cell dim>{totalYards > 0 ? totalYards.toLocaleString() : "—"}</Cell>
            <Cell bold>{totalPar}</Cell>
            {showIndexCol && <Cell> </Cell>}
            <span style={{ width: ICON_COL, flexShrink: 0 }} />
          </div>
        </div>
      </div>
      <Footer label={primaryLabel} disabled={!indexUsable || saving} onClick={onPrimary} />
    </>
  );
}

// ── New course (manual setup) ─────────────────────────────────────────────────
function NewCourseScreen({
  draft,
  setDraft,
  onStart,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  onStart: () => void;
}) {
  const setHoleCount = (n: 9 | 18) =>
    setDraft((d) => ({
      ...d,
      holeCount: n,
      par: Array(n).fill(4),
      index: Array(n).fill(null),
      teeSets: d.teeSets.map((t) => ({ ...t, yards: Array(n).fill(null) })),
    }));
  const addTee = () => setDraft((d) => ({ ...d, teeSets: [...d.teeSets, blankTee(d.holeCount, "")] }));
  const setTeeName = (i: number, name: string) => setDraft((d) => ({ ...d, teeSets: d.teeSets.map((t, ti) => (ti === i ? { ...t, name } : t)) }));
  const removeTee = (i: number) => setDraft((d) => ({ ...d, teeSets: d.teeSets.filter((_, ti) => ti !== i) }));
  const reorderTee = (from: number, to: number) =>
    setDraft((d) => {
      if (from === to) return d;
      const next = [...d.teeSets];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...d, teeSets: next };
    });

  return (
    <>
      <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
        <div className="flex flex-col gap-3.5">
          <Field label="Course name">
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Pebble Creek" className="w-full rounded-xl border px-3 py-2.5 text-sm" style={inputStyle} />
          </Field>
          <Field label="Location">
            <input value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} placeholder="Optional" className="w-full rounded-xl border px-3 py-2.5 text-sm" style={inputStyle} />
          </Field>
          <Field label="Holes">
            <div className="flex gap-2">
              {([18, 9] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setHoleCount(n)}
                  className="flex-1 rounded-xl border py-2.5 text-sm font-semibold"
                  style={{
                    background: draft.holeCount === n ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                    borderColor: draft.holeCount === n ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
                    color: draft.holeCount === n ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                  }}
                >
                  {n} holes
                </button>
              ))}
            </div>
          </Field>

          {/* No stroke-index toggle here — the table is opt-in later, on the
              empty index grid in the per-hole editor (spec §2). */}
          <Field label="Tee sets">
            <TeeList tees={draft.teeSets} onName={setTeeName} onRemove={removeTee} onReorder={reorderTee} />
            <button onClick={addTee} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border py-2" style={{ borderStyle: "dashed", borderColor: "var(--color-bt-accent-border)", color: "var(--color-bt-accent)" }}>
              <Plus size={15} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Add tee set</span>
            </button>
            <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 6 }}>Drag to order · longest first.</p>
          </Field>
        </div>
      </div>
      <Footer label="Start entering holes" disabled={!draft.name.trim() || draft.teeSets.every((t) => !t.name.trim())} onClick={onStart} />
    </>
  );
}

/** Pointer-drag reorderable tee list (works on touch + mouse). */
function TeeList({
  tees,
  onName,
  onRemove,
  onReorder,
}: {
  tees: TeeSet[];
  onName: (i: number, name: string) => void;
  onRemove: (i: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const ROW = 52;
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const startY = useRef(0);

  const total = (t: TeeSet) => t.yards.reduce<number>((a, y) => a + (y ?? 0), 0);

  return (
    <div className="flex flex-col gap-2">
      {tees.map((t, i) => {
        const dragging = drag?.from === i;
        return (
          <div
            key={i}
            className="flex items-center gap-2 rounded-xl border px-2"
            style={{
              height: 44,
              background: "var(--color-bt-card-raised)",
              borderColor: dragging ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
              transform: dragging ? `translateY(${drag!.dy}px)` : undefined,
              zIndex: dragging ? 2 : undefined,
              position: dragging ? "relative" : undefined,
              touchAction: "none",
            }}
          >
            <span
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                startY.current = e.clientY;
                setDrag({ from: i, dy: 0 });
              }}
              onPointerMove={(e) => {
                if (drag?.from === i) setDrag({ from: i, dy: e.clientY - startY.current });
              }}
              onPointerUp={() => {
                if (drag?.from === i) {
                  const to = Math.max(0, Math.min(tees.length - 1, i + Math.round(drag.dy / ROW)));
                  onReorder(i, to);
                  setDrag(null);
                }
              }}
              className="flex h-9 w-7 cursor-grab items-center justify-center"
              style={{ color: "var(--color-bt-text-dim)", touchAction: "none" }}
            >
              <GripVertical size={16} />
            </span>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: teeColor(t.name || `Tee ${i + 1}`), flexShrink: 0 }} />
            <input
              value={t.name}
              onChange={(e) => onName(i, e.target.value)}
              placeholder="Name them anything (White, Member…)"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--color-bt-text)" }}
            />
            <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>{total(t) > 0 ? `${total(t)} yds` : ""}</span>
            {tees.length > 1 && (
              <button onClick={() => onRemove(i)} aria-label="Remove tee" className="flex h-8 w-8 shrink-0 items-center justify-center" style={{ color: "var(--color-bt-text-dim)" }}>
                <X size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Stepped per-hole entry (manual) ───────────────────────────────────────────
function EntryScreen({
  draft,
  hole,
  setHole,
  activeTee,
  setActiveTee,
  indexOptedIn,
  onOptInIndex,
  indexUsable,
  setPar,
  setIndex,
  setYards,
  onReview,
}: {
  draft: Draft;
  hole: number;
  setHole: (h: number) => void;
  activeTee: number;
  setActiveTee: (i: number) => void;
  indexOptedIn: boolean;
  onOptInIndex: () => void;
  indexUsable: boolean;
  setPar: (h: number, v: number) => void;
  setIndex: (h: number, v: number) => void;
  setYards: (h: number, v: number | null) => void;
  onReview: () => void;
}) {
  const n = draft.holeCount;
  const completed = draft.index.map((v, i) => (v != null ? i + 1 : 0)).filter(Boolean);
  // The keypad is a dismissable yards accessory; the footer below it is the
  // PERSISTENT advance control. Per-hole Next is NEVER blocked — the only gate
  // is the completion CTA on the review card (spec §4).
  const [yardsActive, setYardsActive] = useState(false);
  const teeName = draft.teeSets[activeTee]?.name?.trim() || `Tee ${activeTee + 1}`;
  const yardsOf = () => draft.teeSets[activeTee]?.yards[hole - 1] ?? null;
  const pushDigit = (d: number) => {
    const cur = yardsOf();
    if (cur == null && d === 0) return; // no leading zero
    const next = (cur ?? 0) * 10 + d;
    if (next > 999) return;
    setYards(hole, next);
  };
  const backspace = () => {
    const cur = yardsOf();
    setYards(hole, cur == null || cur < 10 ? null : Math.floor(cur / 10));
  };
  const lastHole = hole >= n;
  // Per-hole Next is never blocked. The last-hole "Done · review card" IS gated,
  // but only on a started-but-incomplete stroke index table (a course-wide
  // datum): rank them all, or leave the table empty (fallback). The inline amber
  // reminder explains why it's disabled.
  const reviewBlocked = lastHole && !indexUsable;
  const footerLabel = lastHole ? "Done · review card" : "Next hole ›";
  const onAdvance = () => (lastHole ? onReview() : setHole(hole + 1));

  return (
    <>
      <div className="shrink-0" style={{ padding: "12px 16px 6px" }}>
        <div className="flex items-center justify-between">
          <NavArrow dir="prev" disabled={hole <= 1} onClick={() => setHole(hole - 1)} />
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-bt-text)" }}>Hole {hole}</div>
          <NavArrow dir="next" disabled={hole >= n} onClick={() => setHole(hole + 1)} />
        </div>
        <div style={{ marginTop: 14 }}>
          <HoleProgress count={n} currentHole={hole} completed={completed} maxWidth="100%" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: "4px 16px 8px" }}>
        <HoleEditor
          holeNumber={hole}
          holeCount={n}
          par={draft.par[hole - 1]}
          onPar={(v) => setPar(hole, v)}
          index={draft.index}
          onIndexPick={(v) => setIndex(hole, v)}
          indexOptedIn={indexOptedIn}
          onOptInIndex={onOptInIndex}
          tees={draft.teeSets}
          activeTee={activeTee}
          onTee={setActiveTee}
          yards={yardsOf()}
          yardsActive={yardsActive}
          onYardsTap={() => setYardsActive(true)}
        />
      </div>

      {yardsActive && (
        <Keypad
          title={`Yards · ${teeName} Tees`}
          hint="Done to keep editing the hole"
          onDigit={pushDigit}
          onBackspace={backspace}
          onDone={() => setYardsActive(false)}
        />
      )}
      <div className="shrink-0" style={{ padding: "10px 16px 14px", background: "transparent" }}>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>Hole {hole} / {n}</span>
          <button
            onClick={onAdvance}
            disabled={reviewBlocked}
            className="flex-1 disabled:opacity-40"
            style={{ height: 54, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}
          >
            {footerLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Single-hole edit (from confirm) ───────────────────────────────────────────
function HoleEditScreen({
  draft,
  hole,
  activeTee,
  setActiveTee,
  flagged,
  indexOptedIn,
  onOptInIndex,
  setPar,
  setIndex,
  setYards,
  onDone,
}: {
  draft: Draft;
  hole: number;
  activeTee: number;
  setActiveTee: (i: number) => void;
  flagged: Set<number>;
  indexOptedIn: boolean;
  onOptInIndex: () => void;
  setPar: (h: number, v: number) => void;
  setIndex: (h: number, v: number) => void;
  setYards: (h: number, v: number | null) => void;
  onDone: () => void;
}) {
  const [yardsActive, setYardsActive] = useState(false);
  const teeName = draft.teeSets[activeTee]?.name?.trim() || `Tee ${activeTee + 1}`;
  const yardsOf = () => draft.teeSets[activeTee]?.yards[hole - 1] ?? null;
  const pushDigit = (d: number) => {
    const cur = yardsOf();
    if (cur == null && d === 0) return;
    const next = (cur ?? 0) * 10 + d;
    if (next > 999) return;
    setYards(hole, next);
  };
  const backspace = () => {
    const cur = yardsOf();
    setYards(hole, cur == null || cur < 10 ? null : Math.floor(cur / 10));
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
        <HoleEditor
          holeNumber={hole}
          holeCount={draft.holeCount}
          par={draft.par[hole - 1]}
          onPar={(v) => setPar(hole, v)}
          index={draft.index}
          onIndexPick={(v) => setIndex(hole, v)}
          indexOptedIn={indexOptedIn}
          onOptInIndex={onOptInIndex}
          tees={draft.teeSets}
          activeTee={activeTee}
          onTee={setActiveTee}
          yards={yardsOf()}
          yardsActive={yardsActive}
          onYardsTap={() => setYardsActive(true)}
          showSwapWarning
        />
      </div>
      {yardsActive && (
        <Keypad
          title={`Yards · ${teeName} Tees`}
          hint="Done to keep editing the hole"
          onDigit={pushDigit}
          onBackspace={backspace}
          onDone={() => setYardsActive(false)}
        />
      )}
      <Footer label="Save hole" disabled={flagged.has(hole)} onClick={onDone} />
    </>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
  color: "var(--color-bt-text)",
};

function TeeChip({ name, on, onClick }: { name: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5"
      style={{
        padding: "7px 12px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: on ? 600 : 500,
        border: "1px solid var(--color-bt-border)",
        background: on ? "var(--color-bt-card-float)" : "var(--color-bt-card-raised)",
        color: on ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: teeColor(name), flexShrink: 0 }} />
      {name}
    </button>
  );
}

// ── My courses (manual-add destination) ───────────────────────────────────────
// Lands here after "Save to my courses" — the new course is highlighted (NEW),
// NOT auto-selected for play. Adding a course and using one are separate
// concerns (spec §6); tapping a row reviews it (→ Confirm, mode 'use').
function SavedScreen({
  courses,
  savedId,
  onPick,
  onAddAnother,
}: {
  courses: RecentCourse[];
  savedId: string | null;
  onPick: (c: RecentCourse) => void;
  onAddAnother: () => void;
}) {
  const saved = courses.find((c) => c.id === savedId);
  return (
    <>
      <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
        {saved && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5" style={{ background: "var(--color-bt-accent-faint)", borderColor: "var(--color-bt-accent-border)" }}>
            <Check size={15} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 13, color: "var(--color-bt-text)" }}>
              <span style={{ fontWeight: 600 }}>{saved.name}</span> added to your courses.
            </span>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {courses.map((c) => {
            const par = (c.par ?? []).reduce<number>((a, p) => a + p, 0);
            const isNew = c.id === savedId;
            return (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left"
                style={{
                  background: isNew ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
                  borderColor: isNew ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
                }}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate" style={{ fontSize: 15, color: "var(--color-bt-text)" }}>{c.name}</span>
                    {isNew && (
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent-border)", borderRadius: 4, padding: "1px 5px" }}>
                        NEW
                      </span>
                    )}
                  </span>
                  <span className="block truncate" style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
                    {[c.location, par ? `Par ${par}` : "", `${c.hole_count} holes`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      </div>
      <Footer label="Add another course" onClick={onAddAnother} />
    </>
  );
}

// Data columns share the width equally (flex:1); the trailing icon column is
// just wide enough for the edit pencil.
const ICON_COL = 32;

function HoleHeader({ hasIndex }: { hasIndex: boolean }) {
  return (
    <div className="flex items-center" style={{ height: 30, background: "var(--color-bt-card-raised)", borderBottom: "1px solid var(--color-bt-border)" }}>
      <HCell left>Hole</HCell>
      <HCell>Yds</HCell>
      <HCell>Par</HCell>
      {hasIndex && <HCell>Index</HCell>}
      <span style={{ width: ICON_COL, flexShrink: 0 }} />
    </div>
  );
}
function HCell({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return <span style={{ flex: 1, minWidth: 0, textAlign: left ? "left" : "center", paddingLeft: left ? 12 : 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-bt-text-dim)" }}>{children}</span>;
}
function Cell({ children, bold, warn, left, dim }: { children: React.ReactNode; bold?: boolean; warn?: boolean; left?: boolean; dim?: boolean }) {
  return (
    <span style={{ flex: 1, minWidth: 0, textAlign: left ? "left" : "center", paddingLeft: left ? 12 : 0, fontSize: 14, fontWeight: bold || warn ? 700 : 500, color: warn ? "var(--color-bt-warning)" : dim ? "var(--color-bt-text-dim)" : "var(--color-bt-text)", fontVariantNumeric: "tabular-nums" }}>
      {children}
    </span>
  );
}
function IconCol({ children }: { children: React.ReactNode }) {
  return <span className="flex items-center justify-center" style={{ width: ICON_COL, flexShrink: 0 }}>{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>{label}</label>
      {children}
    </div>
  );
}

function Footer({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="shrink-0" style={{ padding: 16, borderTop: "1px solid var(--color-bt-subtle-border)", background: "var(--color-bt-base)" }}>
      <button onClick={onClick} disabled={disabled} className="w-full disabled:opacity-40" style={{ height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
        {label}
      </button>
    </div>
  );
}
