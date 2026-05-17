"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { MapPin, Flag, Check, Plus, Loader2, SlidersHorizontal, X, ArrowUpDown } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ideaGradient } from "@/lib/temporalGradient";
import type { CatalogIdea } from "@/app/trips/[tripId]/tabs/types";

interface CatalogBrowserProps {
  onSelect: (idea: CatalogIdea) => void;
  selectedIds: Set<string>;
  /** Optional header title rendered inline on the same row as the filter pill (right-justified). */
  title?: string;
}

const ACTIVITY_FILTERS = [
  { label: "All", value: null },
  { label: "Golf", value: "golf" },
  { label: "Beach", value: "beach" },
  { label: "Ski", value: "ski" },
  { label: "City", value: "city" },
  { label: "Adventure", value: "adventure" },
];

const BUDGET_FILTERS = [
  { label: "$", value: "$" },
  { label: "$$", value: "$$" },
  { label: "$$$", value: "$$$" },
  { label: "$$$$", value: "$$$$" },
];

type SortKey = "name" | "state";
type SortDir = "asc" | "desc";
const SORT_OPTIONS: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: "name", dir: "asc", label: "Name (A–Z)" },
  { key: "name", dir: "desc", label: "Name (Z–A)" },
  { key: "state", dir: "asc", label: "State (A–Z)" },
  { key: "state", dir: "desc", label: "State (Z–A)" },
];

/**
 * Parse the trailing state/region segment from a "City, ST" location string.
 * If there's no comma (e.g. "Southeast", "Pacific Northwest"), fall back
 * to the trimmed whole string so the entry still sorts cleanly — it just
 * ranks by its own name among the real state codes.
 */
function extractState(location: string): string {
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : location.trim();
}

export function CatalogBrowser({ onSelect, selectedIds, title }: CatalogBrowserProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [budgetFilter, setBudgetFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sortOpen, setSortOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  // Close the sort menu on outside click.
  useEffect(() => {
    if (!sortOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [sortOpen]);
  const LIMIT = 100;
  const TILE_WIDTH = 160;
  const GAP = 10; // gap-2.5 = 0.625rem = 10px
  const INITIAL_ROWS = 2;
  const INITIAL_FALLBACK = 8;

  // Measure the grid container so we only ever show full rows —
  // `repeat(auto-fill, 160px)` can leave trailing blank cells if the
  // raw slice count doesn't match the actual column count.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState<number | null>(null);

  // Initial measurement runs in useLayoutEffect — React synchronously
  // re-renders after the setState inside this hook, so the correct
  // column count is applied before the browser paints. Without this the
  // modal flashed the 8-tile fallback for one frame at non-standalone
  // widths (e.g. 5-col modal showing 5 + 3 partial).
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    const cols = Math.max(1, Math.floor((width + GAP) / (TILE_WIDTH + GAP)));
    setColumns((prev) => (prev === cols ? prev : cols));
  });

  // Subscribe to subsequent size changes (window resize, modal open,
  // sidebar toggle) so we re-snap without remount.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const cols = Math.max(1, Math.floor((width + GAP) / (TILE_WIDTH + GAP)));
      setColumns((prev) => (prev === cols ? prev : cols));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasActiveFilter = activityFilter !== null || budgetFilter !== null;
  const activeFilterSummary = (() => {
    const parts: string[] = [];
    if (activityFilter) {
      const label = ACTIVITY_FILTERS.find((f) => f.value === activityFilter)?.label;
      if (label) parts.push(label);
    }
    if (budgetFilter) parts.push(budgetFilter);
    return parts.length > 0 ? parts.join(" · ") : "All destinations";
  })();

  const { data: rawCatalogIdeas = [], isLoading } =
    trpc.ideas.catalogList.useQuery({
      categories: activityFilter ? [activityFilter] : undefined,
      costTier: budgetFilter ?? undefined,
      limit: LIMIT,
      offset: 0,
    });

  // Sort client-side — dataset is bounded (≤ LIMIT) and sort keys are
  // cheap strings, so no need to push this down to the server.
  const catalogIdeas = (() => {
    const sorted = [...rawCatalogIdeas].sort((a, b) => {
      const av = sortKey === "name" ? a.title : extractState(a.location);
      const bv = sortKey === "name" ? b.title : extractState(b.location);
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      // Tiebreak state sort by title so in-state destinations stay grouped alphabetically.
      if (cmp === 0 && sortKey === "state") {
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      }
      return cmp;
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  })();

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.key === sortKey && o.dir === sortDir)?.label ?? "Sort";

  // Visible count = full rows only. The bug we're avoiding: with
  // auto-fill, column count varies by width, so a hard-coded slice can
  // leave a partial trailing row right above "Show all" that looks like
  // missing tiles. Always floor the collapsed count to a multiple of
  // columns; expanded view shows the full dataset (the real last row
  // may be partial, but that's expected when you've asked for all).
  let visibleCount: number;
  if (expanded) {
    visibleCount = catalogIdeas.length;
  } else if (columns != null) {
    const target = Math.min(columns * INITIAL_ROWS, catalogIdeas.length);
    // Floor to whole rows. If we don't even have one full row, just show what's there.
    visibleCount =
      target < columns ? target : Math.floor(target / columns) * columns;
  } else {
    // Pre-measurement fallback — intentionally small; resnaps on first RO tick.
    visibleCount = Math.min(INITIAL_FALLBACK, catalogIdeas.length);
  }
  const visibleIdeas = catalogIdeas.slice(0, visibleCount);
  const hasMore = catalogIdeas.length > visibleCount;

  const resetFilters = () => {
    setActivityFilter(null);
    setBudgetFilter(null);
    setExpanded(false);
  };

  const handleFilterActivity = (value: string | null) => {
    setActivityFilter(value);
    setExpanded(false);
  };

  const handleFilterBudget = (value: string | null) => {
    setBudgetFilter((prev) => (prev === value ? null : value));
    setExpanded(false);
  };

  return (
    <div>
      {/* Header row — optional title on the left, filter pill right-justified. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {title && (
          <h3
            className="text-base font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            {title}
          </h3>
        )}
        <div className="ml-auto flex items-center gap-2">
        {/* Sort dropdown — compact pill with a popover menu. */}
        <div className="relative" ref={sortMenuRef}>
          <button
            type="button"
            onClick={() => setSortOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors"
            style={{
              background: "var(--color-bt-dim-faint)",
              color: "var(--color-bt-text-dim)",
            }}
            aria-expanded={sortOpen}
            aria-haspopup="menu"
          >
            <ArrowUpDown size={12} />
            <span>{currentSortLabel}</span>
          </button>
          {sortOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 min-w-[160px] overflow-hidden rounded-lg shadow-lg"
              style={{
                background: "var(--color-bt-card)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              {SORT_OPTIONS.map((opt) => {
                const active = opt.key === sortKey && opt.dir === sortDir;
                return (
                  <button
                    key={`${opt.key}-${opt.dir}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setSortKey(opt.key);
                      setSortDir(opt.dir);
                      setSortOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors"
                    style={{
                      background: active ? "var(--color-bt-dim-faint)" : "transparent",
                      color: active ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <span>{opt.label}</span>
                    {active && <Check size={12} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors"
          style={{
            background: hasActiveFilter
              ? "var(--color-bt-accent)"
              : "var(--color-bt-dim-faint)",
            color: hasActiveFilter
              ? "var(--color-bt-base)"
              : "var(--color-bt-text-dim)",
          }}
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal size={12} />
          <span>{activeFilterSummary}</span>
        </button>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={resetFilters}
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
            aria-label="Clear filters"
          >
            <X size={12} /> Clear
          </button>
        )}
        </div>
      </div>

      {filtersOpen && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 mb-3">
          {ACTIVITY_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => handleFilterActivity(f.value)}
              className="flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background:
                  activityFilter === f.value
                    ? "var(--color-bt-accent)"
                    : "var(--color-bt-dim-faint)",
                color:
                  activityFilter === f.value
                    ? "var(--color-bt-base)"
                    : "var(--color-bt-text-dim)",
              }}
            >
              {f.label}
            </button>
          ))}

          {/* Divider */}
          <span
            className="shrink-0 self-center text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            ·
          </span>

          {BUDGET_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => handleFilterBudget(f.value)}
              className="flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background:
                  budgetFilter === f.value
                    ? "var(--color-bt-accent)"
                    : "var(--color-bt-dim-faint)",
                color:
                  budgetFilter === f.value
                    ? "var(--color-bt-base)"
                    : "var(--color-bt-text-dim)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2
            className="animate-spin"
            size={24}
            style={{ color: "var(--color-bt-text-dim)" }}
          />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && catalogIdeas.length === 0 && (
        <div className="py-8 text-center">
          <p
            className="text-sm mb-2"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            No ideas match these filters.
          </p>
          <button
            onClick={resetFilters}
            className="text-sm font-medium"
            style={{ color: "var(--color-bt-accent)" }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Responsive grid — 2 cols on mobile, 4 on desktop so cards stay
          the compact mobile size and twice as many fit per row. */}
      {!isLoading && catalogIdeas.length > 0 && (
        <div
          ref={gridRef}
          className="grid gap-2.5 justify-center"
          style={{ gridTemplateColumns: `repeat(auto-fill, ${TILE_WIDTH}px)` }}
        >
          {visibleIdeas.map((idea, index) => {
            const isSelected = selectedIds.has(idea.id);
            return (
              <button
                key={idea.id}
                type="button"
                onClick={() => onSelect(idea)}
                className="group flex flex-col overflow-hidden rounded-xl text-left transition-all"
                style={{
                  background: "var(--color-bt-card)",
                  border: isSelected
                    ? "2px solid var(--color-bt-accent)"
                    : "1px solid var(--color-bt-border)",
                }}
              >
                {/* Image / gradient fallback */}
                <div className="relative h-[140px] w-full overflow-hidden">
                  {idea.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={idea.image_url}
                      alt={idea.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="h-full w-full"
                      style={{
                        background: ideaGradient(index, isDark),
                      }}
                    />
                  )}
                  {/* Overlay gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

                  {/* Selected checkmark */}
                  {isSelected && (
                    <div className="absolute right-2 top-2">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full"
                        style={{
                          background: "var(--color-bt-accent)",
                        }}
                      >
                        <Check size={14} color="white" strokeWidth={3} />
                      </span>
                    </div>
                  )}

                  {/* Add icon (when not selected) */}
                  {!isSelected && (
                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full"
                        style={{
                          background: "rgba(255,255,255,0.2)",
                          backdropFilter: "blur(4px)",
                        }}
                      >
                        <Plus size={14} color="white" strokeWidth={2.5} />
                      </span>
                    </div>
                  )}
                </div>

                {/* Card body */}
                <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                  <h4
                    className="text-xs font-semibold leading-tight line-clamp-2"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {idea.title}
                  </h4>
                  <p
                    className="flex items-center gap-1 text-[10px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    <MapPin size={8} /> {idea.location}
                  </p>
                  <div
                    className="flex items-center gap-1.5 text-[10px] mt-0.5"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    {idea.cost_tier && (
                      <span
                        className="font-semibold"
                        style={{ color: "var(--color-bt-accent)" }}
                      >
                        {idea.cost_tier}
                      </span>
                    )}
                    {idea.golf_courses.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Flag size={8} /> {idea.golf_courses.length} course
                        {idea.golf_courses.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Expand — once opened, stays open (no "show less") */}
      {!isLoading && hasMore && !expanded && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => setExpanded(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              background: "var(--color-bt-dim-faint)",
              color: "var(--color-bt-text)",
            }}
          >
            Show all {catalogIdeas.length} destinations ↓
          </button>
        </div>
      )}
    </div>
  );
}
