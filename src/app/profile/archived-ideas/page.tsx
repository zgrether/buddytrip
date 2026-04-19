"use client";

import Link from "next/link";
import { ArrowLeft, Trash2, MapPin, Flag, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { trpc } from "@/lib/trpc-client";
import { TopNav } from "@/components/TopNav";
import { ideaGradient } from "@/lib/temporalGradient";

/**
 * Archived destination ideas management page.
 *
 * Lists every idea the current user has archived (across all their trips)
 * and lets them delete entries permanently. Import/reuse happens from the
 * Add-Destination-Ideas flow inside a trip, not from here.
 */
export default function ArchivedIdeasPage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const utils = trpc.useUtils();

  const { data: ideas = [], isLoading } = trpc.archivedIdeas.list.useQuery();
  const removeArchived = trpc.archivedIdeas.remove.useMutation({
    onSuccess: () => {
      utils.archivedIdeas.list.invalidate();
    },
  });

  const handleRemove = (id: string, title: string) => {
    // Simple confirm is enough — the destructive action is recoverable
    // only by re-archiving from a trip, and the list surface already
    // telegraphs this is a management page.
    if (!window.confirm(`Permanently delete "${title}" from your archive?`)) return;
    removeArchived.mutate({ archivedIdeaId: id });
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--color-bt-base)" }}>
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link
          href="/profile"
          className="mb-4 inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ArrowLeft size={14} /> Back to profile
        </Link>

        <h1 className="mb-1 text-2xl font-bold" style={{ color: "var(--color-bt-text)" }}>
          Archived destination ideas
        </h1>
        <p className="mb-6 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          Ideas you&apos;ve saved for future trips. Delete anything you no longer want to see in the add-ideas flow.
        </p>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin" size={24} style={{ color: "var(--color-bt-text-dim)" }} />
          </div>
        )}

        {!isLoading && ideas.length === 0 && (
          <div
            className="rounded-xl p-8 text-center"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              You don&apos;t have any archived ideas yet. When you remove an idea from a trip, you can archive
              it instead of deleting it — archived ideas will appear here.
            </p>
          </div>
        )}

        {!isLoading && ideas.length > 0 && (
          <ul className="flex flex-col gap-3">
            {ideas.map((idea, index) => {
              const archivedDate = new Date(idea.archived_at);
              const dateLabel = Number.isNaN(archivedDate.getTime())
                ? ""
                : archivedDate.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
              return (
                <li
                  key={idea.id}
                  className="flex gap-3 overflow-hidden rounded-xl"
                  style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
                >
                  <div className="relative h-[96px] w-[120px] flex-shrink-0 overflow-hidden">
                    {idea.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={idea.image_url}
                        alt={idea.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-full w-full" style={{ background: ideaGradient(index, isDark) }} />
                    )}
                  </div>
                  <div className="flex flex-1 items-center gap-3 py-2.5 pr-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                        {idea.title}
                      </p>
                      <p
                        className="mt-0.5 flex items-center gap-1 text-[11px]"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        <MapPin size={10} /> {idea.location}
                      </p>
                      <div
                        className="mt-1 flex flex-wrap items-center gap-2 text-[11px]"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        {idea.cost_tier && (
                          <span className="font-semibold" style={{ color: "var(--color-bt-accent)" }}>
                            {idea.cost_tier}
                          </span>
                        )}
                        {idea.golf_courses.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Flag size={10} /> {idea.golf_courses.length} course
                            {idea.golf_courses.length !== 1 ? "s" : ""}
                          </span>
                        )}
                        {idea.original_trip_title && (
                          <span className="truncate">from {idea.original_trip_title}</span>
                        )}
                        {dateLabel && <span className="ml-auto">Archived {dateLabel}</span>}
                      </div>
                    </div>
                    <button
                      data-testid={`delete-archived-idea-${idea.id}`}
                      onClick={() => handleRemove(idea.id, idea.title)}
                      disabled={removeArchived.isPending}
                      aria-label={`Delete ${idea.title} permanently`}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-40"
                      style={{ color: "var(--color-bt-danger)" }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
