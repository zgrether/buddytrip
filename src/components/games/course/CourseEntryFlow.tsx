"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import {
  NewCourseScreen, EntryScreen, ConfirmScreen, HoleEditScreen,
  blankDraft, type Draft,
} from "./CoursePicker";
import {
  getCourseDetail, parFromDetail, indexFromDetail, teeSetsFromDetail,
} from "@/lib/courseService";
import { validateStrokeIndex, applyStrokeIndexSwap } from "@/lib/courseIndex";

const blankTee = (n: number, name: string) => ({ name, yards: Array(n).fill(null) });

/**
 * CourseEntryFlow (W-COURSESPLIT-01) — the MANUAL-ENTRY half of the old fused
 * CoursePicker, extracted as a standalone flow: `new → per-hole entry → confirm →
 * save`. Owns the mutable `draft`; reuses the (now exported) entry screens. This
 * is the heavy "place" — it renders as its own page (`/courses/new`). A `provider`
 * id seeds it from a golfcourseapi pull (review-before-save); absent → a blank
 * manual build.
 *
 * On save it persists a GLOBAL `courses` row (course data isn't trip-scoped) and
 * hands the caller `{ id, name, teeName }` to apply to the game + return. The
 * picker half (search/select existing) stays inline on the Course row; only this
 * heavy build navigates.
 */
export function CourseEntryFlow({
  providerId,
  saving,
  onSave,
  onCancel,
}: {
  /** golfcourseapi summary id → seed the draft from a pull (review). Null → blank. */
  providerId?: string | null;
  /** The parent's create+apply is in-flight (disables the primary CTA). */
  saving?: boolean;
  /** Persist + apply + return. Receives the finished draft as a create payload. */
  onSave: (payload: {
    name: string; location?: string; holeCount: 9 | 18; par: number[];
    handicapIndex?: number[]; hasStrokeIndex: boolean;
    teeSets: Draft["teeSets"]; source: Draft["source"]; providerId?: string;
    teeName?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [screen, setScreen] = useState<"new" | "entry" | "confirm">(providerId ? "confirm" : "new");
  const [draft, setDraft] = useState<Draft>(() => blankDraft(18));
  const [activeTee, setActiveTee] = useState(0);
  const [hole, setHole] = useState(1);
  const [editingHole, setEditingHole] = useState<number | null>(null);
  const [indexOptedIn, setIndexOptedIn] = useState(false);
  const [pulling, setPulling] = useState(!!providerId);

  const recordApiCall = trpc.courses.recordApiCall.useMutation();
  const utils = trpc.useUtils();

  // Seed from a golfcourseapi pull (gated by the daily cap, like the old picker).
  // At cap or on a missing detail, fall back to a blank manual build.
  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    (async () => {
      const gate = await recordApiCall.mutateAsync().catch(() => ({ permitted: false }));
      await utils.courses.apiUsage.invalidate();
      const detail = gate.permitted ? await getCourseDetail(providerId).catch(() => null) : null;
      if (cancelled) return;
      if (!detail || detail.holes.length === 0) { setPulling(false); setScreen("new"); return; }
      const holeCount = (detail.holes.length >= 18 ? 18 : 9) as 9 | 18;
      const tees = teeSetsFromDetail(detail);
      const pulledIndex = indexFromDetail(detail).slice(0, holeCount);
      const cleanIndex = validateStrokeIndex(pulledIndex, holeCount).valid ? pulledIndex : Array(holeCount).fill(null);
      setDraft({
        name: detail.name, location: detail.location, holeCount,
        par: parFromDetail(detail).slice(0, holeCount), index: cleanIndex, hasStrokeIndex: true,
        teeSets: tees.length ? tees.map((t) => ({ ...t, yards: t.yards.slice(0, holeCount) })) : [blankTee(holeCount, "White")],
        source: "golfcourseapi", providerId: detail.externalId,
      });
      setPulling(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const validation = useMemo(() => validateStrokeIndex(draft.index, draft.holeCount), [draft.index, draft.holeCount]);
  const indexStarted = draft.hasStrokeIndex && draft.index.some((v) => v != null);
  const indexUsable = !indexStarted || validation.valid;
  const flagged = useMemo(
    () => (indexStarted && !validation.valid
      ? new Set([...validation.unsetHoles, ...validation.duplicateHoles, ...validation.outOfRangeHoles])
      : new Set<number>()),
    [validation, indexStarted]
  );

  const setPar = (h: number, v: number) => setDraft((d) => ({ ...d, par: d.par.map((p, i) => (i === h - 1 ? v : p)) }));
  const setIndex = (h: number, v: number) => setDraft((d) => ({ ...d, index: applyStrokeIndexSwap(d.index, h - 1, v) }));
  const setYards = (h: number, v: number | null) => setDraft((d) => ({
    ...d, teeSets: d.teeSets.map((t, ti) => (ti === activeTee ? { ...t, yards: t.yards.map((y, i) => (i === h - 1 ? v : y)) } : t)),
  }));

  function save() {
    if (!indexUsable || !draft.name.trim()) return;
    onSave({
      name: draft.name.trim(), location: draft.location.trim() || undefined, holeCount: draft.holeCount,
      par: draft.par, handicapIndex: validation.valid ? (draft.index as number[]) : undefined,
      hasStrokeIndex: validation.valid, teeSets: draft.teeSets, source: draft.source, providerId: draft.providerId,
      teeName: draft.teeSets[activeTee]?.name?.trim() || undefined,
    });
  }

  const holeShown = editingHole ?? (screen === "entry" ? hole : null);
  const title = holeShown != null ? (draft.name.trim() || "New course") : screen === "new" ? "New course" : "Course summary";
  const subtitle = holeShown != null ? `Hole ${holeShown} of ${draft.holeCount}` : screen === "confirm" ? "Review what you entered" : null;
  const back = () => {
    if (editingHole != null) return setEditingHole(null);
    if (screen === "entry") return setScreen("new");
    if (screen === "confirm") return providerId ? onCancel() : setScreen("entry");
    onCancel();
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
        <div className="flex min-w-0 flex-col items-center text-center">
          <div className="max-w-full truncate" style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>}
        </div>
        <button onClick={onCancel} aria-label="Close" className="flex h-9 w-9 items-center justify-center">
          <X size={20} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>
      </header>

      {pulling ? (
        <div className="flex flex-1 items-center justify-center" style={{ color: "var(--color-bt-text-dim)", fontSize: 14 }}>Pulling scorecard…</div>
      ) : editingHole != null ? (
        <HoleEditScreen
          draft={draft} hole={editingHole} activeTee={activeTee} setActiveTee={setActiveTee}
          flagged={flagged} indexOptedIn={indexOptedIn} onOptInIndex={() => setIndexOptedIn(true)}
          setPar={setPar} setIndex={setIndex} setYards={setYards} onDone={() => setEditingHole(null)}
        />
      ) : screen === "new" ? (
        <NewCourseScreen draft={draft} setDraft={setDraft} onStart={() => { setHole(1); setScreen("entry"); }} />
      ) : screen === "confirm" ? (
        <ConfirmScreen
          draft={draft} mode="use" activeTee={activeTee} setActiveTee={setActiveTee}
          indexUsable={indexUsable} flagged={flagged} saving={!!saving}
          onEditHole={(h) => setEditingHole(h)} onPrimary={save}
        />
      ) : (
        <EntryScreen
          draft={draft} hole={hole} setHole={setHole} activeTee={activeTee} setActiveTee={setActiveTee}
          indexOptedIn={indexOptedIn} onOptInIndex={() => setIndexOptedIn(true)} indexUsable={indexUsable}
          setPar={setPar} setIndex={setIndex} setYards={setYards} onReview={() => setScreen("confirm")}
        />
      )}
    </div>
  );
}
