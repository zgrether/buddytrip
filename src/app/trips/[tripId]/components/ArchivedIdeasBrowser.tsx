"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { MapPin, Flag, Check, Plus, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ideaGradient } from "@/lib/temporalGradient";

/**
 * Shape returned by `archivedIdeas.list`. Intentionally a local alias rather
 * than a shared type — the archive schema is owned by the archivedIdeas
 * router and we don't want the rest of the app depending on it.
 */
export interface ArchivedIdea {
  id: string;
  title: string;
  location: string;
  description: string;
  cost_tier: string | null;
  image_url: string | null;
  golf_courses: string[];
  activities: string[];
  accommodation: string | null;
  notes: string | null;
  pros: string[];
  cons: string[];
  source_idea_id: string | null;
  original_trip_id: string | null;
  original_trip_title: string | null;
  archived_at: string;
}

interface ArchivedIdeasBrowserProps {
  /** Click handler — the parent decides whether to stage the imported copy. */
  onSelect: (idea: ArchivedIdea) => void;
  /** Local IDs (not archive row IDs) that are currently staged. Used for
   *  the "already added" checkmark; the staged ID convention is `arch-<id>`. */
  selectedIds: Set<string>;
  /** Management mode — swaps the "+" affordance for a Remove button and the
   *  title to the management heading. Used on the profile page. */
  mode?: "import" | "manage";
  /** Hide the heading entirely (e.g. when the caller wraps in its own header). */
  hideHeader?: boolean;
}

const TILE_WIDTH = 160;
const GAP = 10;
const INITIAL_ROWS = 2;
const INITIAL_FALLBACK = 8;

export function ArchivedIdeasBrowser({
  onSelect,
  selectedIds,
  mode = "import",
  hideHeader = false,
}: ArchivedIdeasBrowserProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [expanded, setExpanded] = useState(false);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState<number | null>(null);

  // Column measurement — mirrors CatalogBrowser so the two grids snap to the
  // same row cadence when stacked. Floor to multiples of `columns` so we
  // never show a partial trailing row above the Show-all button.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    const cols = Math.max(1, Math.floor((width + GAP) / (TILE_WIDTH + GAP)));
    setColumns((prev) => (prev === cols ? prev : cols));
  });

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

  const { data: ideas = [], isLoading } = trpc.archivedIdeas.list.useQuery();

  // Nothing in the archive — render nothing. Import-mode callers don't want
  // a dead section; manage-mode renders its own empty state above us.
  if (!isLoading && ideas.length === 0) return null;

  let visibleCount: number;
  if (expanded) {
    visibleCount = ideas.length;
  } else if (columns != null) {
    const target = Math.min(columns * INITIAL_ROWS, ideas.length);
    visibleCount = target < columns ? target : Math.floor(target / columns) * columns;
  } else {
    visibleCount = Math.min(INITIAL_FALLBACK, ideas.length);
  }
  const visibleIdeas = ideas.slice(0, visibleCount);
  const hasMore = ideas.length > visibleCount;

  const heading = mode === "manage" ? "Archived ideas" : "My archived ideas";

  return (
    <div>
      {!hideHeader && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {heading}
          </h3>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin" size={20} style={{ color: "var(--color-bt-text-dim)" }} />
        </div>
      )}

      {!isLoading && ideas.length > 0 && (
        <div
          ref={gridRef}
          className="grid gap-2.5 justify-center"
          style={{ gridTemplateColumns: `repeat(auto-fill, ${TILE_WIDTH}px)` }}
        >
          {visibleIdeas.map((idea, index) => {
            const stagedId = `arch-${idea.id}`;
            const isSelected = selectedIds.has(stagedId);
            // Same-season reruns produce legit duplicates (same title/location).
            // Surface the archive date so users can tell copies apart in the
            // tile grid without opening each one.
            const archivedDate = new Date(idea.archived_at);
            const dateLabel = Number.isNaN(archivedDate.getTime())
              ? ""
              : archivedDate.toLocaleDateString(undefined, { month: "short", year: "numeric" });
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
                    <div className="h-full w-full" style={{ background: ideaGradient(index, isDark) }} />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

                  {mode === "import" && isSelected && (
                    <div className="absolute right-2 top-2">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full"
                        style={{ background: "var(--color-bt-accent)" }}
                      >
                        <Check size={14} color="white" strokeWidth={3} />
                      </span>
                    </div>
                  )}

                  {mode === "import" && !isSelected && (
                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full"
                        style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(4px)" }}
                      >
                        <Plus size={14} color="white" strokeWidth={2.5} />
                      </span>
                    </div>
                  )}
                </div>

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
                      <span className="font-semibold" style={{ color: "var(--color-bt-accent)" }}>
                        {idea.cost_tier}
                      </span>
                    )}
                    {idea.golf_courses.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Flag size={8} /> {idea.golf_courses.length} course
                        {idea.golf_courses.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {dateLabel && <span className="ml-auto">{dateLabel}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!isLoading && hasMore && !expanded && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => setExpanded(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{ background: "var(--color-bt-dim-faint)", color: "var(--color-bt-text)" }}
          >
            Show all {ideas.length} archived ideas ↓
          </button>
        </div>
      )}
    </div>
  );
}
