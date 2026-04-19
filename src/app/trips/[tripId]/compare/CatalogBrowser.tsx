// TODO: Move this file to src/app/trips/[tripId]/components/ when compare/ directory is cleaned up.
"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { MapPin, Flag, Check, Plus, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ideaGradient } from "@/lib/temporalGradient";
import type { CatalogIdea } from "@/app/trips/[tripId]/tabs/types";

interface CatalogBrowserProps {
  onSelect: (idea: CatalogIdea) => void;
  selectedIds: Set<string>;
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

export function CatalogBrowser({ onSelect, selectedIds }: CatalogBrowserProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [budgetFilter, setBudgetFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 100;
  const INITIAL_COUNT = 8;

  const { data: catalogIdeas = [], isLoading } =
    trpc.ideas.catalogList.useQuery({
      categories: activityFilter ? [activityFilter] : undefined,
      costTier: budgetFilter ?? undefined,
      limit: LIMIT,
      offset: 0,
    });

  const visibleIdeas = expanded ? catalogIdeas : catalogIdeas.slice(0, INITIAL_COUNT);
  const hasMore = catalogIdeas.length > INITIAL_COUNT;

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
      {/* Filter chips — the intro heading and helper copy live in the
          parent (EmptyStateOnboarding) so the catalog imagery stays near
          the top of the modal. */}
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
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
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

      {/* Expand / collapse */}
      {!isLoading && hasMore && (
        <div className="mt-3 flex justify-center">
          {!expanded ? (
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
          ) : (
            <button
              onClick={() => setExpanded(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                background: "var(--color-bt-dim-faint)",
                color: "var(--color-bt-text)",
              }}
            >
              Show less ↑
            </button>
          )}
        </div>
      )}
    </div>
  );
}
