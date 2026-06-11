"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Plus, X, AlertTriangle, MapPin, PencilLine } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { HoleEditor } from "./HoleEditor";
import {
  searchCourses,
  getCourseDetail,
  parFromDetail,
  indexFromDetail,
  teeSetsFromDetail,
  type CourseSummary,
} from "@/lib/courseService";
import { validateStrokeIndex, applyStrokeIndexSwap, type IndexEntry } from "@/lib/courseIndex";
import { NavArrow, HoleProgress } from "../entryChrome";

/**
 * CoursePicker — the Course Selector/Builder flow (Slice C part 2). A full-screen
 * overlay launched from the new-game "Select a course" field. Two paths, one
 * editor: lookup (search → results → confirm) and manual (new course → stepped
 * per-hole entry), both producing a saved global `courses` row; on apply it
 * hands the parent { id, name } to snapshot onto the game (games.applyCourse).
 *
 * The stroke index is enforced as a valid 1..N permutation via swap-on-edit, and
 * `Use this course` / `Save` is blocked until complete — including dirty lookup
 * data, where golfapi's missing hcp lands as null and is flagged here.
 */

type TeeSet = { name: string; yards: (number | null)[] };
interface Draft {
  name: string;
  location: string;
  holeCount: 9 | 18;
  par: number[];
  index: IndexEntry[];
  teeSets: TeeSet[];
  source: "manual" | "golfapi";
  providerId?: string;
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
  const [hole, setHole] = useState(1); // 1-based, entry screen
  const [editingHole, setEditingHole] = useState<number | null>(null); // confirm-edit, 1-based
  const [pulling, setPulling] = useState(false);

  const recent = trpc.courses.list.useQuery({ limit: 8 });
  const createCourse = trpc.courses.create.useMutation();

  // Debounced provider search. All setState runs inside the timeout/async
  // callback (never synchronously in the effect body); stale results for a
  // too-short query are hidden by `showResults` in the render, not cleared here.
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
  const flagged = useMemo(
    () => new Set([...validation.unsetHoles, ...validation.duplicateHoles, ...validation.outOfRangeHoles]),
    [validation]
  );

  // ── Draft mutators ────────────────────────────────────────────────────
  const setPar = (h: number, value: number) =>
    setDraft((d) => ({ ...d, par: d.par.map((p, i) => (i === h - 1 ? value : p)) }));
  const setIndex = (h: number, value: number) =>
    setDraft((d) => ({ ...d, index: applyStrokeIndexSwap(d.index, h - 1, value) }));
  const setYards = (h: number, value: number | null) =>
    setDraft((d) => ({
      ...d,
      teeSets: d.teeSets.map((t, ti) =>
        ti === activeTee ? { ...t, yards: t.yards.map((y, i) => (i === h - 1 ? value : y)) } : t
      ),
    }));

  // ── Pull a lookup result → confirm ──────────────────────────────────────
  async function pull(summary: CourseSummary) {
    setPulling(true);
    const detail = await getCourseDetail(summary.id);
    setPulling(false);
    if (!detail || detail.holes.length === 0) {
      // No usable scorecard — fall back to manual, prefilled with what we know.
      const d = blankDraft(18);
      setDraft({ ...d, name: summary.name, location: summary.location });
      setActiveTee(0);
      setHole(1);
      setScreen("new");
      return;
    }
    const holeCount = (detail.holes.length >= 18 ? 18 : 9) as 9 | 18;
    const tees = teeSetsFromDetail(detail);
    setDraft({
      name: detail.name,
      location: detail.location,
      holeCount,
      par: parFromDetail(detail).slice(0, holeCount),
      index: indexFromDetail(detail).slice(0, holeCount),
      teeSets: tees.length ? tees.map((t) => ({ ...t, yards: t.yards.slice(0, holeCount) })) : [blankTee(holeCount, "White")],
      source: "golfapi",
      providerId: detail.externalId,
    });
    setActiveTee(0);
    setScreen("confirm");
  }

  // ── Save (shared by confirm + manual entry) ──────────────────────────────
  async function save() {
    if (!validation.valid || !draft.name.trim()) return;
    const course = await createCourse.mutateAsync({
      name: draft.name.trim(),
      location: draft.location.trim() || undefined,
      holeCount: draft.holeCount,
      par: draft.par,
      handicapIndex: draft.index as number[], // valid ⇒ all numbers
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
          onPickRecent={(c) => onApply({ id: c.id, name: c.name })}
          onManual={() => {
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
          validation={validation}
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
          validation={validation}
          flagged={flagged}
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
  hole_count: number;
  par: number[];
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
    <div className="flex-1 overflow-y-auto" style={{ padding: "16px" }}>
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
          {!searching && results.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>No matches.</p>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left"
              style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
            >
              <span className="min-w-0">
                <span className="block truncate" style={{ fontSize: 15, color: "var(--color-bt-text)" }}>{c.name}</span>
                {c.location && <span className="block truncate" style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>{c.location}</span>}
              </span>
              <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
            </button>
          ))}
        </div>
      ) : (
        recent.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Recent courses</p>
            <div className="flex flex-col gap-2">
              {recent.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onPickRecent(c)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left"
                  style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
                >
                  <span className="min-w-0">
                    <span className="block truncate" style={{ fontSize: 15, color: "var(--color-bt-text)" }}>{c.name}</span>
                    <span className="block truncate" style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
                      {[c.location, `${c.hole_count} holes`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {/* Manual entry — first-class, always present (not an error state). */}
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

// ── Confirm (lookup) ──────────────────────────────────────────────────────────
function ConfirmScreen({
  draft,
  activeTee,
  setActiveTee,
  validation,
  flagged,
  saving,
  onEditHole,
  onUse,
}: {
  draft: Draft;
  activeTee: number;
  setActiveTee: (i: number) => void;
  validation: ReturnType<typeof validateStrokeIndex>;
  flagged: Set<number>;
  saving: boolean;
  onEditHole: (h: number) => void;
  onUse: () => void;
}) {
  const tee = draft.teeSets[activeTee];
  return (
    <>
      <div className="flex-1 overflow-y-auto" style={{ padding: "16px 16px 8px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>{draft.name}</div>
        {draft.location && (
          <div className="flex items-center gap-1" style={{ marginTop: 2 }}>
            <MapPin size={13} style={{ color: "var(--color-bt-text-dim)" }} />
            <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{draft.location}</span>
          </div>
        )}

        {/* Tee chips */}
        {draft.teeSets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {draft.teeSets.map((t, i) => (
              <button
                key={t.name + i}
                onClick={() => setActiveTee(i)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 9999,
                  fontSize: 13,
                  fontWeight: 600,
                  border: `1px solid ${i === activeTee ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                  background: i === activeTee ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                  color: i === activeTee ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        {!validation.valid && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5" style={{ background: "var(--color-bt-warning-faint)", borderColor: "var(--color-bt-warning-border)" }}>
            <AlertTriangle size={15} style={{ color: "var(--color-bt-warning)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: "var(--color-bt-warning)" }}>
              This course&apos;s stroke index is incomplete — a wrong index mis-allocates handicap strokes. Tap the flagged holes to fix before using.
            </span>
          </div>
        )}

        {/* Per-hole rows */}
        <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-bt-border)" }}>
          <HoleHeader />
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
                <Cell w={48} bold>{h}</Cell>
                <Cell w={72} dim>{tee?.yards[i] ?? "—"}</Cell>
                <Cell w={56}>{p}</Cell>
                <span className="flex flex-1 items-center justify-between pr-3">
                  <span style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: bad ? 700 : 500, color: bad ? "var(--color-bt-warning)" : "var(--color-bt-text)" }}>
                    {draft.index[i] ?? "—"}
                  </span>
                  <PencilLine size={13} style={{ color: "var(--color-bt-text-dim)" }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <Footer
        label={validation.valid ? "Use this course" : `${validation.unsetHoles.length + validation.duplicateHoles.length + validation.outOfRangeHoles.length} holes need a valid index`}
        disabled={!validation.valid || saving}
        onClick={onUse}
      />
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
  const setTeeName = (i: number, name: string) =>
    setDraft((d) => ({ ...d, teeSets: d.teeSets.map((t, ti) => (ti === i ? { ...t, name } : t)) }));
  const removeTee = (i: number) => setDraft((d) => ({ ...d, teeSets: d.teeSets.filter((_, ti) => ti !== i) }));

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
          <Field label="Tee sets">
            <div className="flex flex-col gap-2">
              {draft.teeSets.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={t.name}
                    onChange={(e) => setTeeName(i, e.target.value)}
                    placeholder="Name them anything (White, Member…)"
                    className="w-full rounded-xl border px-3 py-2.5 text-sm"
                    style={inputStyle}
                  />
                  {draft.teeSets.length > 1 && (
                    <button onClick={() => removeTee(i)} aria-label="Remove tee" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}>
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addTee} className="flex items-center justify-center gap-1.5 rounded-xl border py-2" style={{ borderStyle: "dashed", borderColor: "var(--color-bt-accent-border)", color: "var(--color-bt-accent)" }}>
                <Plus size={15} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Add tee set</span>
              </button>
            </div>
          </Field>
        </div>
      </div>
      <Footer label="Start entering holes" disabled={!draft.name.trim() || draft.teeSets.every((t) => !t.name.trim())} onClick={onStart} />
    </>
  );
}

// ── Stepped per-hole entry (manual) ───────────────────────────────────────────
function EntryScreen({
  draft,
  hole,
  setHole,
  activeTee,
  setActiveTee,
  validation,
  flagged,
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
  validation: ReturnType<typeof validateStrokeIndex>;
  flagged: Set<number>;
  saving: boolean;
  setPar: (h: number, v: number) => void;
  setIndex: (h: number, v: number) => void;
  setYards: (h: number, v: number | null) => void;
  onSave: () => void;
}) {
  const n = draft.holeCount;
  const completed = draft.index.map((v, i) => (v != null ? i + 1 : 0)).filter(Boolean);
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
        <TeeChips draft={draft} activeTee={activeTee} setActiveTee={setActiveTee} />
        <div style={{ marginTop: 14 }}>
          <HoleEditor
            holeNumber={hole}
            holeCount={n}
            par={draft.par[hole - 1]}
            index={draft.index[hole - 1] ?? null}
            teeName={draft.teeSets[activeTee]?.name || null}
            yards={draft.teeSets[activeTee]?.yards[hole - 1] ?? null}
            swapHint="Reusing an index swaps it with the hole that currently has it."
            onPar={(v) => setPar(hole, v)}
            onIndex={(v) => setIndex(hole, v)}
            onYards={(v) => setYards(hole, v)}
          />
        </div>
      </div>

      {hole < n ? (
        <Footer label={`Next · Hole ${hole + 1}`} onClick={() => setHole(hole + 1)} />
      ) : (
        <Footer
          label={validation.valid ? "Save course" : `${flagged.size} holes need a valid index`}
          disabled={!validation.valid || saving}
          onClick={onSave}
        />
      )}
    </>
  );
}

// ── Single-hole edit (from confirm) ───────────────────────────────────────────
function HoleEditScreen({
  draft,
  hole,
  activeTee,
  flagged,
  setPar,
  setIndex,
  setYards,
  onDone,
}: {
  draft: Draft;
  hole: number;
  activeTee: number;
  flagged: Set<number>;
  setPar: (h: number, v: number) => void;
  setIndex: (h: number, v: number) => void;
  setYards: (h: number, v: number | null) => void;
  onDone: () => void;
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
        <HoleEditor
          holeNumber={hole}
          holeCount={draft.holeCount}
          par={draft.par[hole - 1]}
          index={draft.index[hole - 1] ?? null}
          teeName={draft.teeSets[activeTee]?.name || null}
          yards={draft.teeSets[activeTee]?.yards[hole - 1] ?? null}
          swapHint="Reusing an index swaps it with the hole that currently has it."
          onPar={(v) => setPar(hole, v)}
          onIndex={(v) => setIndex(hole, v)}
          onYards={(v) => setYards(hole, v)}
        />
      </div>
      <Footer label="Done" disabled={flagged.has(hole)} onClick={onDone} />
    </>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
  color: "var(--color-bt-text)",
};

function TeeChips({ draft, activeTee, setActiveTee }: { draft: Draft; activeTee: number; setActiveTee: (i: number) => void }) {
  if (draft.teeSets.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {draft.teeSets.map((t, i) => (
        <button
          key={t.name + i}
          onClick={() => setActiveTee(i)}
          style={{
            padding: "4px 11px",
            borderRadius: 9999,
            fontSize: 12.5,
            fontWeight: 600,
            border: `1px solid ${i === activeTee ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
            background: i === activeTee ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
            color: i === activeTee ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          }}
        >
          {t.name || `Tee ${i + 1}`}
        </button>
      ))}
    </div>
  );
}

function HoleHeader() {
  return (
    <div className="flex items-center" style={{ height: 30, background: "var(--color-bt-card-raised)", borderBottom: "1px solid var(--color-bt-border)" }}>
      <HCell w={48}>Hole</HCell>
      <HCell w={72}>Yds</HCell>
      <HCell w={56}>Par</HCell>
      <span className="flex-1 pr-3 text-center text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Index</span>
    </div>
  );
}
function HCell({ w, children }: { w: number; children: React.ReactNode }) {
  return <span style={{ width: w, textAlign: "center", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-bt-text-dim)" }}>{children}</span>;
}
function Cell({ w, children, bold, dim }: { w: number; children: React.ReactNode; bold?: boolean; dim?: boolean }) {
  return (
    <span style={{ width: w, textAlign: "center", fontSize: 14, fontWeight: bold ? 700 : 500, color: dim ? "var(--color-bt-text-dim)" : "var(--color-bt-text)", fontVariantNumeric: "tabular-nums" }}>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>{label}</label>
      {children}
    </div>
  );
}

function Footer({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="shrink-0" style={{ padding: 16, borderTop: "1px solid var(--color-bt-subtle-border)", background: "var(--color-bt-base)" }}>
      <button
        onClick={onClick}
        disabled={disabled}
        className="w-full disabled:opacity-40"
        style={{ height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}
      >
        {label}
      </button>
    </div>
  );
}
