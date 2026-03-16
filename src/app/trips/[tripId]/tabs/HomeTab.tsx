"use client";

import { useState } from "react";
import {
  Plus,
  Hotel,
  FileText,
  Flag,
  Zap,
  Lock,
  ChevronRight,
  Pencil,
  Trash2,
  Trophy,
  Check,
  Calendar,
  Users,
  Copy,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDateRange, parseLocalDate } from "@/lib/dates";
import type { TabProps, TripData } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

interface QuickTile {
  id: string;
  label: string;
  value: string;
  icon?: string | null;
  sort_order?: number | null;
}

interface IdeaWithVotes {
  id: string;
  title: string;
  location: string;
  votes: { idea_id: string; user_id: string; created_at: string }[];
}

interface DateWindow {
  id: string;
  start_date: string;
  end_date: string;
  votes: { window_id: string; user_id: string; answer: string }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function TileIcon({ icon }: { icon?: string | null }) {
  const icons: Record<string, React.ReactNode> = {
    hotel: <Hotel size={16} />,
    golf: <Flag size={16} />,
    zap: <Zap size={16} />,
    file: <FileText size={16} />,
  };
  return (
    <span style={{ color: "var(--color-bt-accent)" }}>
      {icons[icon ?? "file"] ?? <FileText size={16} />}
    </span>
  );
}

function daysUntil(dateStr: string): number {
  const target = parseLocalDate(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ── AddTileModal ─────────────────────────────────────────────────────────

function AddTileModal({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const create = trpc.quickInfoTiles.create.useMutation({
    async onMutate(vars) {
      await utils.quickInfoTiles.list.cancel({ tripId });
      const prev = utils.quickInfoTiles.list.getData({ tripId });
      utils.quickInfoTiles.list.setData({ tripId }, [
        ...(prev ?? []),
        {
          id: vars.id,
          trip_id: tripId,
          label: vars.label,
          value: vars.value,
          icon: null,
          sort_order: vars.sortOrder ?? 0,
          created_by: null,
          created_at: new Date().toISOString(),
        },
      ]);
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.quickInfoTiles.list.setData({ tripId }, context.prev);
    },
    onSuccess() {
      onClose();
    },
    onSettled() {
      utils.quickInfoTiles.list.invalidate({ tripId });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg rounded-2xl p-6 space-y-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Add Info Tile
        </h3>
        <input
          placeholder="Label (e.g. Hotel)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
        />
        <input
          placeholder="Value (e.g. The Westin, Room 412)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
        />
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border py-2.5 text-sm"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
          <button
            disabled={!label.trim() || !value.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                tripId,
                id: crypto.randomUUID(),
                label: label.trim(),
                value: value.trim(),
              })
            }
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Destination Comparison Panel ─────────────────────────────────────────

function DestinationComparisonPanel({
  tripId,
  ideas,
  currentUserId,
}: {
  tripId: string;
  ideas: IdeaWithVotes[];
  currentUserId?: string;
}) {
  const router = useRouter();
  const totalVotes = ideas.reduce((sum, idea) => sum + idea.votes.length, 0);
  const maxVotes = Math.max(1, ...ideas.map((i) => i.votes.length));

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Where are we going?
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {ideas.length} idea{ideas.length !== 1 ? "s" : ""} · {totalVotes} vote{totalVotes !== 1 ? "s" : ""} cast
          </p>
        </div>
        <button
          data-testid="full-comparison-view"
          onClick={() => router.push(`/trips/${tripId}/compare`)}
          className="flex items-center gap-1 text-xs font-medium"
          style={{ color: "var(--color-bt-accent)" }}
        >
          Full view <ChevronRight size={14} />
        </button>
      </div>

      {/* Idea rows */}
      <div className="space-y-1 px-4 pb-4">
        {ideas.map((idea) => {
          const pct = (idea.votes.length / maxVotes) * 100;
          const iVoted = idea.votes.some((v) => v.user_id === currentUserId);
          return (
            <div key={idea.id} className="flex items-center gap-3 py-1.5">
              <span
                className="w-24 truncate text-xs font-medium"
                style={{ color: iVoted ? "var(--color-bt-accent)" : "var(--color-bt-text)" }}
              >
                {idea.title}
              </span>
              <div className="flex-1">
                <div
                  className="h-2 rounded-full"
                  style={{ background: "var(--color-bt-base)" }}
                >
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: iVoted ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                      minWidth: idea.votes.length > 0 ? "4px" : "0",
                    }}
                  />
                </div>
              </div>
              <span
                className="w-14 text-right text-xs"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {idea.votes.length} vote{idea.votes.length !== 1 ? "s" : ""}
              </span>
              {iVoted && (
                <span className="text-[10px]" style={{ color: "var(--color-bt-accent)" }}>← mine</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Locked Destination Card ──────────────────────────────────────────────

function LockedDestinationCard({
  trip,
  isOwner,
}: {
  trip: TripData;
  isOwner: boolean;
}) {
  const utils = trpc.useUtils();
  const unlockDest = trpc.trips.unlockDestination.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId: trip.id });
    },
  });

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--color-bt-tag-bg)", border: "1px solid var(--color-bt-accent-border)" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Check size={16} style={{ color: "var(--color-bt-accent)" }} />
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-accent)" }}>
          Destination Locked
        </p>
      </div>
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        {trip.locked_destination_title}
      </p>
      {trip.locked_destination_location && trip.locked_destination_location !== trip.locked_destination_title && (
        <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {trip.locked_destination_location}
        </p>
      )}
      {trip.locked_destination_at && (
        <p className="mt-1 text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
          Locked {new Date(trip.locked_destination_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
      )}
      {isOwner && (
        <button
          data-testid="reopen-vote-btn"
          disabled={unlockDest.isPending}
          onClick={() => unlockDest.mutate({ tripId: trip.id })}
          className="mt-3 text-xs font-medium disabled:opacity-40"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Reopen vote
        </button>
      )}
    </div>
  );
}

// ── Planning Progress Arc ────────────────────────────────────────────────

function PlanningProgressArc({
  trip,
  memberCount,
  membersIn,
  onTabChange,
}: {
  trip: TripData;
  memberCount: number;
  membersIn: number;
  onTabChange?: (tab: string) => void;
}) {
  const hasCompetition = !!trip.event_id;
  const destLocked = !!trip.locked_destination_title;
  const datesSet = !!(trip.start_date && trip.end_date);

  const steps = [
    { label: "Destination locked", done: destLocked, tab: "home" },
    { label: "Dates set", done: datesSet, tab: "schedule" },
    { label: `Crew confirmed (${membersIn} of ${memberCount} in)`, done: membersIn === memberCount && memberCount > 0, tab: "crew" },
    ...(hasCompetition
      ? [{ label: "Competition set up", done: true, tab: "comp" }]
      : []),
  ];

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Planning Progress
      </p>
      <div className="space-y-2">
        {steps.map((step) => (
          <button
            key={step.label}
            onClick={() => onTabChange?.(step.tab)}
            className="flex w-full items-center gap-2.5 text-left"
          >
            <span
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px]"
              style={{
                background: step.done ? "var(--color-bt-accent)" : "var(--color-bt-base)",
                border: step.done ? "none" : "1.5px solid var(--color-bt-border)",
                color: step.done ? "#fff" : "var(--color-bt-text-dim)",
              }}
            >
              {step.done ? <Check size={10} /> : ""}
            </span>
            <span
              className="text-xs"
              style={{
                color: step.done ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
                textDecoration: step.done ? "line-through" : "none",
              }}
            >
              {step.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Date Summary Card ────────────────────────────────────────────────────

function DateSummaryCard({
  trip,
  poll,
  onTabChange,
}: {
  trip: TripData;
  poll: { windows: DateWindow[] } | undefined;
  onTabChange?: (tab: string) => void;
}) {
  const datesSet = !!(trip.start_date && trip.end_date);
  const windows = poll?.windows ?? [];
  const hasPoll = windows.length > 0;

  if (datesSet) {
    const days = trip.start_date ? daysUntil(trip.start_date) : 0;
    return (
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--color-bt-tag-bg)", border: "1px solid var(--color-bt-accent-border)" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Calendar size={14} style={{ color: "var(--color-bt-accent)" }} />
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-accent)" }}>
            Dates Locked
          </p>
        </div>
        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
          {formatDateRange(trip.start_date, trip.end_date)}
        </p>
        {days > 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {days} day{days !== 1 ? "s" : ""} away
          </p>
        )}
      </div>
    );
  }

  if (hasPoll) {
    return (
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar size={14} style={{ color: "var(--color-bt-planning)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Dates — Poll open
            </p>
          </div>
        </div>
        {windows.slice(0, 3).map((w) => {
          const yes = w.votes.filter((v) => v.answer === "yes").length;
          const no = w.votes.filter((v) => v.answer === "no").length;
          const start = parseLocalDate(w.start_date);
          const end = parseLocalDate(w.end_date);
          const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          return (
            <p key={w.id} className="text-xs mb-1" style={{ color: "var(--color-bt-text-dim)" }}>
              {fmt(start)}–{fmt(end)}: {yes} in, {no} no
            </p>
          );
        })}
        <button
          data-testid="see-full-poll"
          onClick={() => onTabChange?.("schedule")}
          className="mt-2 flex items-center gap-1 text-xs font-medium"
          style={{ color: "var(--color-bt-accent)" }}
        >
          See full poll <ChevronRight size={12} />
        </button>
      </div>
    );
  }

  // No dates, no poll
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Calendar size={14} style={{ color: "var(--color-bt-text-dim)" }} />
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Dates
        </p>
      </div>
      <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        Not set yet
      </p>
      <button
        data-testid="go-set-dates"
        onClick={() => onTabChange?.("schedule")}
        className="mt-2 text-xs font-medium"
        style={{ color: "var(--color-bt-accent)" }}
      >
        Set dates →
      </button>
    </div>
  );
}

// ── Quick Info Tiles Section ─────────────────────────────────────────────

function QuickInfoSection({
  tripId,
  canEdit,
}: {
  tripId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [showAddTile, setShowAddTile] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: tiles = [] } = trpc.quickInfoTiles.list.useQuery({ tripId });

  const deleteTile = trpc.quickInfoTiles.remove.useMutation({
    onSuccess: () => utils.quickInfoTiles.list.invalidate({ tripId }),
  });

  function handleCopy(tile: QuickTile) {
    navigator.clipboard.writeText(tile.value).then(() => {
      setCopiedId(tile.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  if (tiles.length === 0 && !canEdit) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Quick Info
        </h2>
        {canEdit && (
          <button
            data-testid="add-tile-btn"
            onClick={() => setShowAddTile(true)}
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--color-bt-accent)" }}
          >
            <Plus size={14} /> Add
          </button>
        )}
      </div>

      {tiles.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No quick info yet. Add tiles for hotel info, tee times, etc.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {(tiles as QuickTile[]).map((tile) => (
            <button
              key={tile.id}
              data-testid={`tile-${tile.id}`}
              onClick={() => handleCopy(tile)}
              className="group relative rounded-xl p-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <TileIcon icon={tile.icon} />
                <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  {tile.label}
                </span>
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
                {copiedId === tile.id ? "Copied!" : tile.value}
              </p>
              {copiedId === tile.id && (
                <Copy size={10} className="absolute right-2 top-2" style={{ color: "var(--color-bt-accent)" }} />
              )}
              {canEdit && copiedId !== tile.id && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTile.mutate({ tripId, tileId: tile.id });
                  }}
                  className="absolute right-1.5 top-1.5 hidden rounded p-0.5 group-hover:flex cursor-pointer"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <Trash2 size={10} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {showAddTile && (
        <AddTileModal tripId={tripId} onClose={() => setShowAddTile(false)} />
      )}
    </section>
  );
}

// ── HomeTab ──────────────────────────────────────────────────────────────

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  onTabChange,
}: TabProps & { onTabChange?: (tab: string) => void }) {
  const router = useRouter();
  const currentUser = useCurrentUser();

  const { data: ideas = [] } = trpc.ideas.list.useQuery({ tripId: trip.id });
  const { data: poll } = trpc.datePoll.get.useQuery({ tripId: trip.id });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });

  const membersIn = members.filter((m) => m.status === "in").length;
  const isComparisonMode = !!trip.comparison_mode && !trip.locked_destination_title;
  const isLocked = !!trip.locked_destination_title;

  return (
    <div className="space-y-4 px-4">
      {/* Destination comparison panel (when voting active) */}
      {isComparisonMode && (
        <DestinationComparisonPanel
          tripId={trip.id}
          ideas={ideas as IdeaWithVotes[]}
          currentUserId={currentUser?.id}
        />
      )}

      {/* Locked destination card */}
      {isLocked && (
        <LockedDestinationCard trip={trip} isOwner={isOwner ?? false} />
      )}

      {/* Quick info tiles */}
      <QuickInfoSection tripId={trip.id} canEdit={canEditProp} />

      {/* Planning progress arc (canEdit only) */}
      {canEditProp && (
        <PlanningProgressArc
          trip={trip}
          memberCount={members.length}
          membersIn={membersIn}
          onTabChange={onTabChange}
        />
      )}

      {/* Date summary card */}
      <DateSummaryCard
        trip={trip}
        poll={poll as { windows: DateWindow[] } | undefined}
        onTabChange={onTabChange}
      />

      {/* Competition setup CTA (Planners only, no event yet) */}
      {canEditProp && !trip.event_id && (
        <div
          className="flex items-center gap-4 rounded-xl p-4"
          style={{ background: "var(--color-bt-tag-bg)", border: "1px solid var(--color-bt-accent-border)" }}
        >
          <Trophy size={24} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Add a competition
            </p>
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Set up teams, rounds, and scoring for this trip.
            </p>
          </div>
          <button
            data-testid="home-setup-competition-btn"
            onClick={() => router.push(`/trips/${trip.id}/competition/setup`)}
            className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Set Up
          </button>
        </div>
      )}

      {/* Empty state hint */}
      {canEditProp && !trip.notes && !trip.accommodation && !isLocked && !isComparisonMode && (
        <div className="mt-4 text-center">
          <Pencil size={32} className="mx-auto mb-3" style={{ color: "var(--color-bt-border)" }} />
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Start planning — set a destination, add dates, or invite your crew.
          </p>
        </div>
      )}
    </div>
  );
}
