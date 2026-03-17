"use client";

import { useState } from "react";
import {
  Plus,
  Hotel,
  FileText,
  Flag,
  Zap,
  ChevronRight,
  Pencil,
  X,
  Trophy,
  Check,
  Calendar,
  Users,
  MapPin,
  ThumbsUp,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { formatDateRange } from "@/lib/dates";
import { getTripStatus } from "@/components/StatusBadge";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-sm rounded-2xl p-5 space-y-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Add Info Tile
          </h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>
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

// ── EditTileModal ─────────────────────────────────────────────────────────

function EditTileModal({
  tripId,
  tile,
  onClose,
}: {
  tripId: string;
  tile: QuickTile;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [label, setLabel] = useState(tile.label);
  const [value, setValue] = useState(tile.value);

  const update = trpc.quickInfoTiles.update.useMutation({
    onSuccess() { onClose(); },
    onSettled() { utils.quickInfoTiles.list.invalidate({ tripId }); },
  });

  const remove = trpc.quickInfoTiles.remove.useMutation({
    onSuccess() { onClose(); },
    onSettled() { utils.quickInfoTiles.list.invalidate({ tripId }); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-sm rounded-2xl p-5 space-y-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Edit Tile
          </h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>
        <input
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
        />
        <input
          placeholder="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
        />
        <div className="flex gap-3">
          <button
            onClick={() => remove.mutate({ tripId, tileId: tile.id })}
            disabled={remove.isPending || update.isPending}
            className="rounded-xl border px-4 py-2.5 text-sm disabled:opacity-40"
            style={{ borderColor: "var(--color-bt-danger)", color: "var(--color-bt-danger)" }}
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border py-2.5 text-sm"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
          <button
            disabled={!label.trim() || !value.trim() || update.isPending}
            onClick={() => update.mutate({ tripId, tileId: tile.id, label: label.trim(), value: value.trim() })}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Competition Panel ─────────────────────────────────────────────────────

function CompetitionPanel({ trip, canEdit }: { trip: TripData; canEdit: boolean }) {
  const router = useRouter();
  const hasComp = !!trip.event_id;

  const { data: event } = trpc.events.getByTrip.useQuery(
    { tripId: trip.id },
    { enabled: hasComp }
  );

  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId: trip.id, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  const { data: scoreRows = [] } = trpc.groupResults.listScoresByEvent.useQuery(
    { tripId: trip.id, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  // Aggregate total points per team, sorted descending
  const teamTotals = teams
    .map((t) => ({
      ...t,
      total: scoreRows
        .filter((r) => r.team_id === t.id)
        .reduce((sum, r) => sum + (r.total_points ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total);

  if (hasComp && event) {
    return (
      <button
        data-testid="competition-panel"
        onClick={() => router.push(`/trips/${trip.id}/leaderboard`)}
        className="w-full rounded-xl p-4 text-left"
        style={{ background: "var(--color-bt-tag-bg)", border: "1px solid var(--color-bt-accent-border)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Trophy size={16} style={{ color: "var(--color-bt-accent)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-accent)" }}>
              {event.title ?? "Competition"}
            </p>
          </div>
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--color-bt-accent)" }}>
            Leaderboard <ChevronRight size={14} />
          </span>
        </div>
        {teamTotals.length > 0 ? (
          <div className="flex gap-3">
            {teamTotals.map((team) => (
              <div
                key={team.id}
                className="flex-1 rounded-lg p-2 text-center"
                style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
              >
                <p
                  className="text-[10px] font-semibold truncate mb-0.5"
                  style={{ color: team.color }}
                >
                  {team.short_name}
                </p>
                <p className="text-lg font-bold" style={{ color: "var(--color-bt-text)" }}>
                  {team.total}
                </p>
                <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>pts</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>No scores yet</p>
        )}
      </button>
    );
  }

  if (!hasComp && canEdit) {
    return (
      <button
        data-testid="home-setup-competition-btn"
        onClick={() => router.push(`/trips/${trip.id}/competition/setup`)}
        className="w-full rounded-xl p-4 text-center"
        style={{ border: "2px dashed var(--color-bt-border)", background: "transparent" }}
      >
        <Trophy size={20} className="mx-auto mb-2" style={{ color: "var(--color-bt-text-dim)" }} />
        <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Add a Competition
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-bt-text-dim)" }}>
          Your group already has a rivalry. Give it a scoreboard.
        </p>
      </button>
    );
  }

  return null;
}

// ── Quick Info Tiles Section ─────────────────────────────────────────────

function QuickInfoSection({
  tripId,
  isOwner,
}: {
  tripId: string;
  isOwner: boolean;
}) {
  const [showAddTile, setShowAddTile] = useState(false);
  const [editingTile, setEditingTile] = useState<QuickTile | null>(null);

  const { data: tiles = [] } = trpc.quickInfoTiles.list.useQuery({ tripId });

  if (tiles.length === 0 && !isOwner) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Quick Info
        </h2>
        {isOwner && (
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
            <div
              key={tile.id}
              data-testid={`tile-${tile.id}`}
              className="group relative rounded-xl p-3"
              style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <TileIcon icon={tile.icon} />
                <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  {tile.label}
                </span>
              </div>
              <p className="text-xs font-medium pr-4" style={{ color: "var(--color-bt-text)" }}>
                {tile.value}
              </p>
              {isOwner && (
                <button
                  data-testid={`tile-edit-${tile.id}`}
                  onClick={() => setEditingTile(tile)}
                  className="absolute right-1.5 top-1.5 rounded p-0.5"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <Pencil size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddTile && (
        <AddTileModal tripId={tripId} onClose={() => setShowAddTile(false)} />
      )}
      {editingTile && (
        <EditTileModal
          tripId={tripId}
          tile={editingTile}
          onClose={() => setEditingTile(null)}
        />
      )}

    </section>
  );
}

// ── Planning Arc ─────────────────────────────────────────────────────────

type ArcCardState = "done" | "inProgress" | "none";

function ArcCard({
  icon,
  label,
  note,
  state,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  state: ArcCardState;
  onClick: () => void;
}) {
  const isDone = state === "done";
  const isInProgress = state === "inProgress";

  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-32 rounded-xl p-3 text-left"
      style={{
        background: isDone
          ? "var(--color-bt-tag-bg)"
          : isInProgress
          ? "var(--color-bt-warning-faint)"
          : "var(--color-bt-card)",
        border: `1px solid ${
          isDone
            ? "var(--color-bt-accent-border)"
            : isInProgress
            ? "var(--color-bt-warning-border)"
            : "var(--color-bt-border)"
        }`,
      }}
    >
      <div className="mb-2">
        {isDone ? (
          <Check size={16} style={{ color: "var(--color-bt-accent)" }} />
        ) : (
          <span
            style={{
              color: isInProgress ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)",
            }}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className="text-xs font-semibold mb-1"
        style={{
          color: isDone
            ? "var(--color-bt-accent)"
            : isInProgress
            ? "var(--color-bt-warning)"
            : "var(--color-bt-text-dim)",
        }}
      >
        {label}
      </p>
      <p className="text-[10px] leading-tight" style={{ color: "var(--color-bt-text-dim)" }}>
        {note}
      </p>
    </button>
  );
}

function PlanningArc({
  trip,
  ideas,
  poll,
  tripMembers,
  reservations,
  onTabChange,
}: {
  trip: TripData;
  ideas: IdeaWithVotes[];
  poll: { windows: { id: string; start_date: string; end_date: string }[] } | undefined;
  tripMembers: { status: string }[];
  reservations: unknown[];
  onTabChange?: (tab: string) => void;
}) {
  const router = useRouter();

  // Destination card
  const destLocked = !!trip.locked_destination_title;
  const destVoting = !!trip.comparison_mode && !trip.locked_destination_title;
  const destState: ArcCardState = destLocked ? "done" : destVoting ? "inProgress" : "none";
  const destNote = destLocked
    ? trip.locked_destination_title!
    : destVoting
    ? `${ideas.length} idea${ideas.length !== 1 ? "s" : ""} · voting`
    : "Not set";

  // Dates card
  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollOpen = (poll?.windows.length ?? 0) > 0 && !datesLocked;
  const datesState: ArcCardState = datesLocked ? "done" : pollOpen ? "inProgress" : "none";
  const datesNote = datesLocked
    ? formatDateRange(trip.start_date, trip.end_date)
    : pollOpen
    ? `Poll active · ${poll!.windows.length} option${poll!.windows.length !== 1 ? "s" : ""}`
    : "Not set";

  // Crew card
  const confirmed = tripMembers.filter((m) => m.status === "in").length;
  const hasAnyone = tripMembers.length > 1;
  const crewState: ArcCardState = confirmed >= 4 ? "done" : hasAnyone && confirmed < 4 ? "inProgress" : "none";
  const crewNote = `${confirmed} confirmed`;

  // Schedule card
  const bookingCount = reservations.length;
  const scheduleState: ArcCardState = bookingCount > 0 ? "inProgress" : "none";
  const scheduleNote =
    bookingCount > 0
      ? `${bookingCount} booking${bookingCount !== 1 ? "s" : ""}`
      : "Not booked yet";

  return (
    <section>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Planning
      </p>
      <div
        className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4"
        style={{ scrollbarWidth: "none" }}
      >
        <ArcCard
          icon={<MapPin size={16} />}
          label="Destination"
          note={destNote}
          state={destState}
          onClick={() => router.push(`/trips/${trip.id}/compare`)}
        />
        <ArcCard
          icon={<Calendar size={16} />}
          label="Dates"
          note={datesNote}
          state={datesState}
          onClick={() => onTabChange?.("schedule")}
        />
        <ArcCard
          icon={<Users size={16} />}
          label="Crew"
          note={crewNote}
          state={crewState}
          onClick={() => onTabChange?.("crew")}
        />
        <ArcCard
          icon={<Hotel size={16} />}
          label="Logistics"
          note={scheduleNote}
          state={scheduleState}
          onClick={() => onTabChange?.("schedule")}
        />
      </div>
    </section>
  );
}

// ── Destination Voting Panel ──────────────────────────────────────────────

function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function MiniIdeaHero({
  idea,
  tripId,
  totalMembers,
}: {
  idea: IdeaWithVotes;
  tripId: string;
  totalMembers: number;
}) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();

  const vote = trpc.ideas.vote.useMutation({
    async onMutate({ ideaId }) {
      await utils.ideas.list.cancel({ tripId });
      const prev = utils.ideas.list.getData({ tripId });
      utils.ideas.list.setData({ tripId }, (prev ?? []).map((i) => {
        if (i.id !== ideaId) return i;
        const alreadyVoted = i.votes.some((v: { user_id: string }) => v.user_id === currentUser?.id);
        return {
          ...i,
          votes: alreadyVoted
            ? i.votes.filter((v: { user_id: string }) => v.user_id !== currentUser?.id)
            : [...i.votes, { idea_id: ideaId, user_id: currentUser?.id ?? "", created_at: new Date().toISOString() }],
        };
      }));
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.ideas.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.ideas.list.invalidate({ tripId });
    },
  });

  const isVoted = !!currentUser?.id && idea.votes.some((v) => v.user_id === currentUser.id);
  const voteCount = idea.votes.length;
  const votePercent = totalMembers > 0 ? (voteCount / totalMembers) * 100 : 0;
  const hue = hashToHue((idea.location ?? idea.title).toLowerCase());

  return (
    <div
      className="flex w-40 flex-shrink-0 flex-col overflow-hidden rounded-xl"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 55%, 35%) 0%, hsl(${(hue + 30) % 360}, 45%, 25%) 100%)`,
      }}
    >
      <div className="px-3 pb-1 pt-3">
        <p className="truncate text-sm font-bold text-white">{idea.title}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-white/60">
          <MapPin size={10} />
          {idea.location}
        </p>
      </div>

      <div className="px-3 pb-1">
        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.15)" }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${votePercent}%`, background: "rgba(255,255,255,0.75)" }}
          />
        </div>
        <p className="mt-0.5 text-[10px] text-white/50">
          {voteCount} vote{voteCount !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="p-3 pt-1">
        <button
          onClick={() => vote.mutate({ tripId, ideaId: idea.id })}
          disabled={vote.isPending}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium transition-all disabled:opacity-40"
          style={{
            background: isVoted ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)",
            border: `1px solid ${isVoted ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)"}`,
            color: "rgba(255,255,255,0.9)",
          }}
        >
          <ThumbsUp size={10} />
          {isVoted ? "Voted" : "Vote"}
        </button>
      </div>
    </div>
  );
}

function DestinationVotingPanel({
  trip,
  ideas,
  totalMembers,
  canEdit,
}: {
  trip: TripData;
  ideas: IdeaWithVotes[];
  totalMembers: number;
  canEdit: boolean;
}) {
  const router = useRouter();

  if (!trip.comparison_mode || !!trip.locked_destination_title) return null;
  if (ideas.length === 0) return null;

  return (
    <section
      className="rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Where are we going?
        </p>
        <button
          onClick={() => router.push(`/trips/${trip.id}/compare`)}
          className="flex items-center gap-0.5 text-xs font-medium"
          style={{ color: "var(--color-bt-accent)" }}
        >
          Full view
          <ChevronRight size={13} />
        </button>
      </div>

      {/* Mini hero cards */}
      <div
        className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2"
        style={{ scrollbarWidth: "none" }}
      >
        {ideas.map((idea) => (
          <MiniIdeaHero
            key={idea.id}
            idea={idea}
            tripId={trip.id}
            totalMembers={totalMembers}
          />
        ))}

        {/* Add another destination */}
        {canEdit && (
          <button
            onClick={() => router.push(`/trips/${trip.id}/compare`)}
            className="flex w-32 flex-shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            <Plus size={18} />
            <span className="text-center text-xs leading-tight">Add destination</span>
          </button>
        )}
      </div>

      <p className="mt-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        {ideas.length} idea{ideas.length !== 1 ? "s" : ""} · voting in progress
      </p>
    </section>
  );
}

// ── About Card ───────────────────────────────────────────────────────────

function AboutCard({ trip, onEdit }: { trip: TripData; onEdit?: () => void }) {
  if (!trip.description) return null;

  return (
    <section
      className="rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          About
        </p>
        {onEdit && (
          <button
            data-testid="edit-trip-details-btn"
            onClick={onEdit}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-black/10"
            style={{ color: "var(--color-bt-text-dim)" }}
            aria-label="Edit trip details"
          >
            <Pencil size={12} />
          </button>
        )}
      </div>
      <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
        {trip.description}
      </p>
    </section>
  );
}

// ── HomeTab ──────────────────────────────────────────────────────────────

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  onTabChange,
  onEdit,
}: TabProps & { onTabChange?: (tab: string) => void; onEdit?: () => void }) {
  const { data: ideas = [] } = trpc.ideas.list.useQuery({ tripId: trip.id });
  const { data: poll } = trpc.datePoll.get.useQuery({ tripId: trip.id });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId: trip.id });

  const status = getTripStatus(trip);
  const isCompleted = status === "past";
  const showPlanningArc = canEditProp && !isCompleted;

  return (
    <div className="space-y-4 px-4">
      {/* 1. Competition panel */}
      <CompetitionPanel trip={trip} canEdit={canEditProp} />

      {/* 2. Quick Info Tiles */}
      <QuickInfoSection tripId={trip.id} isOwner={!!isOwner} />

      {/* 2b. Destination voting panel — visible to all when comparison mode active */}
      <DestinationVotingPanel
        trip={trip}
        ideas={ideas as IdeaWithVotes[]}
        totalMembers={members.length}
        canEdit={canEditProp}
      />

      {/* 3. Planning Arc — canEdit only, hidden when completed */}
      {showPlanningArc && (
        <PlanningArc
          trip={trip}
          ideas={ideas as IdeaWithVotes[]}
          poll={poll}
          tripMembers={members}
          reservations={reservations}
          onTabChange={onTabChange}
        />
      )}

      {/* 4. About card */}
      <AboutCard trip={trip} onEdit={canEditProp ? onEdit : undefined} />

    </div>
  );
}
