"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Plus, X, AlertTriangle, MapPin, PencilLine, GripVertical } from "lucide-react";
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

type TeeSet = { name: string; yards: (number | null)[] };
interface Draft {
  name: string;
  location: string;
  holeCount: 9 | 18;
  par: number[];
  index: IndexEntry[];
  hasStrokeIndex: boolean;
  teeSets: TeeSet[];
  source: "manual" | "golfapi";
  providerId?: string;
  /** Set when reviewing an existing library course; applied as-is unless edited. */
  existingId?: string;
}

type Screen = "search" | "confirm" | "new" | "entry";

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
  onApply: (course: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState<Screen>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CourseSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(18));
  const [activeTee, setActiveTee] = useState(0);
  const [hole, setHole] = useState(1);
  const [editingHole, setEditingHole] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  // True once any hole is edited — a reviewed library course is applied as-is
  // when untouched, or saved as a new course (a copy) when edited.
  const [edited, setEdited] = useState(false);

  const recent = trpc.courses.list.useQuery({ limit: 8 });
  const createCourse = trpc.courses.create.useMutation();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await searchCourses(q);
      if (!cancelled) {
        setResults(r);
        setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

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
    setPulling(true);
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
      source: "golfapi",
      providerId: detail.externalId,
    });
    setActiveTee(0);
    setScreen("confirm");
  }

  // Review a saved library course on the Confirm screen before applying (eyeball
  // / fix-a-hole). Untouched → applied as-is; edited → saved as a copy.
  function reviewRecent(c: RecentCourse) {
    setEdited(false);
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

  async function save() {
    if (!indexUsable || !draft.name.trim()) return;
    // Reviewing an existing library course, unedited → apply it directly.
    if (draft.existingId && !edited) {
      onApply({ id: draft.existingId, name: draft.name.trim() });
      return;
    }
    // Snapshot the index ONLY when it's a complete permutation; an untouched or
    // index-less course saves on par alone (sequential fallback).
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
    onApply({ id: course.id as string, name: course.name as string });
  }

  const headerTitle =
    screen === "search" ? "Add a course" : screen === "confirm" ? "Confirm course" : screen === "new" ? "New course" : "Enter holes";
  const back = () => {
    if (editingHole != null) return setEditingHole(null);
    if (screen === "confirm" || screen === "new") return setScreen("search");
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
        <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{headerTitle}</div>
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
          setPar={setPar}
          setIndex={setIndex}
          setYards={setYards}
          onDone={() => setEditingHole(null)}
        />
      ) : screen === "search" ? (
        <SearchScreen
          query={query}
          setQuery={setQuery}
          searching={searching}
          results={results}
          recent={(recent.data as RecentCourse[]) ?? []}
          pulling={pulling}
          onPick={pull}
          onPickRecent={reviewRecent}
          onManual={() => {
            setEdited(false);
            setDraft(blankDraft(18));
            setActiveTee(0);
            setScreen("new");
          }}
        />
      ) : screen === "confirm" ? (
        <ConfirmScreen
          draft={draft}
          activeTee={activeTee}
          setActiveTee={setActiveTee}
          indexUsable={indexUsable}
          flagged={flagged}
          saving={createCourse.isPending}
          onEditHole={(h) => setEditingHole(h)}
          onUse={save}
        />
      ) : screen === "new" ? (
        <NewCourseScreen draft={draft} setDraft={setDraft} onStart={() => { setHole(1); setScreen("entry"); }} />
      ) : (
        <EntryScreen
          draft={draft}
          hole={hole}
          setHole={setHole}
          activeTee={activeTee}
          setActiveTee={setActiveTee}
          indexUsable={indexUsable}
          saving={createCourse.isPending}
          setPar={setPar}
          setIndex={setIndex}
          setYards={setYards}
          onSave={save}
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

// ── Search ──────────────────────────────────────────────────────────────────
function SearchScreen({
  query,
  setQuery,
  searching,
  results,
  recent,
  pulling,
  onPick,
  onPickRecent,
  onManual,
}: {
  query: string;
  setQuery: (q: string) => void;
  searching: boolean;
  results: CourseSummary[];
  recent: RecentCourse[];
  pulling: boolean;
  onPick: (c: CourseSummary) => void;
  onPickRecent: (c: RecentCourse) => void;
  onManual: () => void;
}) {
  const showResults = query.trim().length >= 2;
  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
      <div className="flex items-center gap-2 rounded-xl border px-3" style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}>
        <Search size={16} style={{ color: "var(--color-bt-text-dim)" }} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search courses"
          className="w-full bg-transparent py-2.5 text-sm outline-none"
          style={{ color: "var(--color-bt-text)" }}
        />
      </div>

      {pulling && <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 14 }}>Pulling scorecard…</p>}

      {showResults ? (
        <div className="mt-4 flex flex-col gap-2">
          {searching && <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>Searching…</p>}
          {!searching && results.length === 0 && <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>No matches.</p>}
          {results.map((c) => (
            <CourseRow key={c.id} name={c.name} sub={c.location} onClick={() => onPick(c)} />
          ))}
        </div>
      ) : (
        recent.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Recent courses</p>
            <div className="flex flex-col gap-2">
              {recent.map((c) => {
                const par = (c.par ?? []).reduce<number>((a, p) => a + p, 0);
                return (
                  <CourseRow
                    key={c.id}
                    name={c.name}
                    sub={[c.location, par ? `Par ${par}` : "", `${c.hole_count} holes`].filter(Boolean).join(" · ")}
                    onClick={() => onPickRecent(c)}
                  />
                );
              })}
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
  activeTee,
  setActiveTee,
  indexUsable,
  flagged,
  saving,
  onEditHole,
  onUse,
}: {
  draft: Draft;
  activeTee: number;
  setActiveTee: (i: number) => void;
  indexUsable: boolean;
  flagged: Set<number>;
  saving: boolean;
  onEditHole: (h: number) => void;
  onUse: () => void;
}) {
  const tee = draft.teeSets[activeTee];
  const totalPar = draft.par.reduce<number>((a, p) => a + p, 0);
  const totalYards = (tee?.yards ?? []).reduce<number>((a, y) => a + (y ?? 0), 0);
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
            <span style={{ fontSize: 12.5, color: "var(--color-bt-warning)" }}>
              Stroke index started but incomplete — finish it (a wrong index mis-allocates handicap strokes), or clear it to play on par alone. Tap the flagged holes.
            </span>
          </div>
        ) : (
          !draft.index.some((v) => v != null) && (
            <p className="mt-3" style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", lineHeight: 1.5 }}>
              No hole difficulty set — strokes fall on holes 1–{draft.holeCount}. Tap a hole to set the index any time so handicaps land on the hardest holes.
            </p>
          )
        )}

        <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-bt-border)" }}>
          <HoleHeader hasIndex={draft.hasStrokeIndex} />
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
                {draft.hasStrokeIndex && <Cell warn={bad}>{draft.index[i] ?? "—"}</Cell>}
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
            {draft.hasStrokeIndex && <Cell> </Cell>}
            <span style={{ width: ICON_COL, flexShrink: 0 }} />
          </div>
        </div>
      </div>
      <Footer label={indexUsable ? "Use this course" : "Finish the index to use this course"} disabled={!indexUsable || saving} onClick={onUse} />
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

          {/* Stroke index toggle. */}
          <button
            onClick={() => setDraft((d) => ({ ...d, hasStrokeIndex: !d.hasStrokeIndex }))}
            className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left"
            style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}
          >
            <span className="min-w-0">
              <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--color-bt-text)" }}>Add stroke indices</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 2 }}>
                The course&apos;s 1–{draft.holeCount} difficulty ranking. Needed for net play — skip if you don&apos;t have it.
              </span>
            </span>
            <Switch on={draft.hasStrokeIndex} />
          </button>

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
  indexUsable,
  saving,
  setPar,
  setIndex,
  setYards,
  onSave,
}: {
  draft: Draft;
  hole: number;
  setHole: (h: number) => void;
  activeTee: number;
  setActiveTee: (i: number) => void;
  indexUsable: boolean;
  saving: boolean;
  setPar: (h: number, v: number) => void;
  setIndex: (h: number, v: number) => void;
  setYards: (h: number, v: number | null) => void;
  onSave: () => void;
}) {
  const n = draft.holeCount;
  const completed = draft.index.map((v, i) => (v != null ? i + 1 : 0)).filter(Boolean);
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
  const onNext = () => (lastHole ? onSave() : setHole(hole + 1));

  return (
    <>
      <div className="flex shrink-0 items-center justify-between" style={{ padding: "12px 16px" }}>
        <NavArrow dir="prev" disabled={hole <= 1} onClick={() => setHole(hole - 1)} />
        <div className="flex flex-col items-center" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-bt-text)" }}>Hole {hole}</div>
          <HoleProgress count={n} currentHole={hole} completed={completed} />
        </div>
        <NavArrow dir="next" disabled={hole >= n} onClick={() => setHole(hole + 1)} />
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: "4px 16px 8px" }}>
        <HoleEditor
          holeNumber={hole}
          holeCount={n}
          par={draft.par[hole - 1]}
          onPar={(v) => setPar(hole, v)}
          hasStrokeIndex={draft.hasStrokeIndex}
          index={draft.index}
          onIndexPick={(v) => setIndex(hole, v)}
          tees={draft.teeSets}
          activeTee={activeTee}
          onTee={setActiveTee}
          yards={yardsOf()}
          yardsActive
          onYardsTap={() => {}}
        />
      </div>

      <Keypad
        onDigit={pushDigit}
        onBackspace={backspace}
        onNext={onNext}
        nextLabel={lastHole ? (!indexUsable ? "Finish the index" : saving ? "Saving…" : "Save ›") : `Hole ${hole + 1} ›`}
      />
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
  setPar: (h: number, v: number) => void;
  setIndex: (h: number, v: number) => void;
  setYards: (h: number, v: number | null) => void;
  onDone: () => void;
}) {
  const [yardsActive, setYardsActive] = useState(false);
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
          hasStrokeIndex={draft.hasStrokeIndex}
          index={draft.index}
          onIndexPick={(v) => setIndex(hole, v)}
          tees={draft.teeSets}
          activeTee={activeTee}
          onTee={setActiveTee}
          yards={yardsOf()}
          yardsActive={yardsActive}
          onYardsTap={() => setYardsActive(true)}
          showSwapWarning
        />
      </div>
      {yardsActive ? (
        <Keypad onDigit={pushDigit} onBackspace={backspace} onNext={() => setYardsActive(false)} nextLabel="Done ✓" />
      ) : (
        <Footer label="Done" disabled={flagged.has(hole)} onClick={onDone} />
      )}
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
        padding: "5px 12px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
        background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
        color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: teeColor(name), flexShrink: 0 }} />
      {name}
    </button>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className="relative shrink-0"
      style={{ width: 40, height: 24, borderRadius: 9999, background: on ? "var(--color-bt-accent)" : "var(--color-bt-border)", transition: "background 0.15s" }}
    >
      <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
    </span>
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
