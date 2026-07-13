"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, AlertTriangle, PencilLine, ChevronRight, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { searchCourses, teeColor, type CourseSummary } from "@/lib/courseService";
import { manualEntryVisible, dedupeApiCourses } from "@/lib/courseSearch";
import type { RecentCourse } from "./CoursePicker";

/**
 * CourseSearchPanel (W-COURSESPLIT-01) — the PICKER half of the old fused
 * CoursePicker, as inline accordion content on the Course row. **Read-only w.r.t.
 * course data**: it searches (local typeahead + the explicit golfcourseapi call) +
 * recents and SELECTS a saved course → `onApply` (the parent's `applyCourse`,
 * live). It never owns a draft.
 *
 * The two draft-requiring paths NAVIGATE to the heavy entry page (`/courses/new`):
 * "Add course manually" (blank) and selecting an API result (seeded by a pull).
 * That's the clean cut — the picker stays inline + read-only; all building happens
 * on the page. Multi-tee saved courses expand a tee chooser before applying (the
 * applied tee is what the row's loud value shows).
 */
export function CourseSearchPanel({
  tripId, gameId, onApply, mode = "front", busy = false,
}: {
  tripId: string;
  gameId: string;
  /** Apply a SAVED course (the parent runs applyCourse / setBackNine). */
  onApply: (course: { id: string; name: string; teeName?: string }) => void;
  /** "back" (W-9HOLE-01) → pick the BACK nine: restrict to 9-hole courses, hide
   *  the golfcourseapi search (a back nine is a saved/manual 9-holer), and the
   *  entry page lands in back-slot mode. Default "front" (the whole course). */
  mode?: "front" | "back";
  /** The parent's apply mutation is in flight — disable + spinner the tapped tee
   *  so a tee-select gives IMMEDIATE feedback instead of looking frozen while the
   *  apply + refresh runs. */
  busy?: boolean;
}) {
  const back = mode === "back";
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [apiResults, setApiResults] = useState<CourseSummary[]>([]);
  const [apiSearching, setApiSearching] = useState(false);
  const [apiSearched, setApiSearched] = useState(false);
  // The saved course whose tee chooser is expanded (multi-tee select-before-apply).
  const [teePickFor, setTeePickFor] = useState<RecentCourse | null>(null);
  // The tee label currently being applied — drives the per-tee spinner (feedback).
  const [pendingTee, setPendingTee] = useState<string | null>(null);

  const recent = trpc.courses.list.useQuery({ limit: 8 });
  const apiUsage = trpc.courses.apiUsage.useQuery(undefined, { staleTime: 0 });
  const recordApiCall = trpc.courses.recordApiCall.useMutation();
  const utils = trpc.useUtils();
  const atCap = apiUsage.data?.atCap ?? false;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const localSearch = trpc.courses.search.useQuery({ q: debounced, limit: 10 }, { enabled: debounced.length >= 2 });

  const onQueryChange = (v: string) => { setQuery(v); setApiResults([]); setApiSearched(false); setTeePickFor(null); };

  async function searchFullDatabase() {
    const q = query.trim();
    if (q.length < 2 || apiSearching || atCap) return;
    setApiSearching(true);
    const gate = await recordApiCall.mutateAsync().catch(() => ({ permitted: false }));
    await utils.courses.apiUsage.invalidate();
    if (!gate.permitted) { setApiSearching(false); return; }
    const r = await searchCourses(q).catch(() => []);
    setApiResults(r);
    setApiSearched(true);
    setApiSearching(false);
  }

  // Select a SAVED course. FRONT: one tee → apply; many → tee chooser. BACK: the
  // back nine INHERITS the front's tee (pin #3), so never prompt — apply with no
  // teeName and let setBackNine resolve it (match front's tee, fall back to first).
  function selectSaved(c: RecentCourse) {
    if (back) { onApply({ id: c.id, name: c.name }); return; }
    const tees = c.tee_sets ?? [];
    if (tees.length <= 1) { onApply({ id: c.id, name: c.name, teeName: tees[0]?.name?.trim() || undefined }); return; }
    setTeePickFor(c);
  }
  const entryHref = (provider?: string) =>
    `/courses/new?trip=${encodeURIComponent(tripId)}&game=${encodeURIComponent(gameId)}${back ? "&slot=back" : ""}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`;

  // The back nine must be a 9-hole course — filter the saved lists to nines.
  const nine = (cs: RecentCourse[]) => (back ? cs.filter((c) => c.hole_count === 9) : cs);
  const local = nine((localSearch.data as RecentCourse[]) ?? []);
  const recents = nine((recent.data as RecentCourse[]) ?? []);
  const showResults = query.trim().length >= 2;
  // Dedup API results against the user's SAVED courses by name (§10 stage 3): a
  // course already saved shows in the local list above, so don't double-list it.
  const apiDeduped = useMemo(
    () => dedupeApiCourses(apiResults, [...local, ...recents].map((c) => c.name)),
    [apiResults, local, recents]
  );
  const courseSub = useMemo(() => (c: RecentCourse) => {
    const par = (c.par ?? []).reduce<number>((a, p) => a + p, 0);
    return [c.location, par ? `Par ${par}` : "", `${c.hole_count} holes`].filter(Boolean).join(" · ");
  }, []);

  // Tee chooser (multi-tee saved course).
  if (teePickFor) {
    return (
      <div data-testid="course-tee-picker" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setTeePickFor(null)} className="text-[13px]" style={{ color: "var(--color-bt-accent)" }}>‹ Back</button>
          <span className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>{teePickFor.name}</span>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Choose a tee</span>
        <div className="flex flex-wrap gap-2">
          {(teePickFor.tee_sets ?? []).map((t, i) => {
            const label = t.name || `Tee ${i + 1}`;
            const isPending = busy && pendingTee === label;
            return (
              <button
                key={i}
                onClick={() => { setPendingTee(label); onApply({ id: teePickFor.id, name: teePickFor.name, teeName: t.name?.trim() || undefined }); }}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm disabled:opacity-60"
                style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
              >
                {isPending ? (
                  <Loader2 size={13} className="animate-spin" style={{ color: "var(--color-bt-text-dim)" }} />
                ) : (
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: teeColor(label) }} />
                )}
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="course-search-panel" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border px-3" style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}>
        <Search size={16} style={{ color: "var(--color-bt-text-dim)" }} />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!back && !localSearch.isFetching && local.length === 0) void searchFullDatabase(); } }}
          placeholder={back ? "Search your 9-hole courses" : "Search your courses"}
          className="w-full bg-transparent py-2.5 text-sm outline-none"
          style={{ color: "var(--color-bt-text)" }}
        />
      </div>

      {showResults ? (
        <>
          <div className="flex flex-col gap-2">
            {localSearch.isFetching && local.length === 0 && <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>Searching your courses…</p>}
            {!localSearch.isFetching && local.length === 0 && <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>No saved courses match.</p>}
            {local.map((c) => <PickRow key={c.id} name={c.name} sub={courseSub(c)} onClick={() => selectSaved(c)} />)}
          </div>

          {/* The golfcourseapi search is front-only — a back nine is a saved or
              hand-entered 9-holer (API results carry no hole-count to filter). */}
          {back ? null : atCap ? (
            <div className="flex items-start gap-2 rounded-xl border px-3 py-2.5" style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}>
              <AlertTriangle size={15} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)" }}>Course search is temporarily unavailable — add the course manually below.</span>
            </div>
          ) : (
            <button
              onClick={() => void searchFullDatabase()}
              disabled={apiSearching}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3 disabled:opacity-50"
              style={{ borderColor: "var(--color-bt-border)", background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
            >
              <Search size={15} style={{ color: "var(--color-bt-text-dim)" }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{apiSearching ? "Searching the full database…" : "Don't see it? Search the full course database →"}</span>
            </button>
          )}

          {apiSearched && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>From the course database</p>
              {apiDeduped.length === 0 ? (
                // Empty (§10 / pin #4): no dead end — the manual-entry button
                // surfaces directly below (gated on apiSearched). Distinguish a
                // truly-empty return from "all matches already saved above". Copy
                // is honest placeholder; final voice pending Zach.
                <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>
                  {apiResults.length === 0 ? "No courses found — add it manually below." : "Everything matching is already in your courses above."}
                </p>
              ) : (
                // Picking an API result NAVIGATES to the entry page (it needs a pull
                // + review before it becomes a saved course).
                apiDeduped.map((c) => <PickRow key={c.id} name={c.name} sub={c.location} onClick={() => router.push(entryHref(c.id))} />)
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {recents.length > 0 && <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>{back ? "Your 9-hole courses" : "Recent courses"}</p>}
          {recents.map((c) => <PickRow key={c.id} name={c.name} sub={courseSub(c)} onClick={() => selectSaved(c)} />)}
          {back && recents.length === 0 && <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>No saved 9-hole courses yet — add one below.</p>}
        </div>
      )}

      {/* Manual entry timing (§10 / pin #4): FRONT mode gates this behind the
          full-database search — hidden on recents + while live-filtering, shown
          only once the user has searched (incl. an EMPTY result, so a no-match
          query still has a path forward). BACK mode has no API stage (a back nine
          is a saved/manual 9-holer), so the button stays available throughout. */}
      {manualEntryVisible({ back, apiSearched }) && (
        <button
          onClick={() => router.push(entryHref())}
          data-testid="course-add-manually"
          className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3"
          style={{ borderColor: "var(--color-bt-accent-border)", borderStyle: "dashed", color: "var(--color-bt-accent)", background: "transparent" }}
        >
          <PencilLine size={16} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>{back ? "Add a 9-hole course manually" : "Add course manually"}</span>
        </button>
      )}
    </div>
  );
}

function PickRow({ name, sub, onClick }: { name: string; sub?: string | null; onClick: () => void }) {
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
