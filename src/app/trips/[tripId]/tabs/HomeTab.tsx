"use client";

import { useState, Fragment } from "react";
import { UserAvatar } from "@/components/UserAvatar";
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
  Users,
  MapPin,
  ThumbsUp,
  Loader2,
  Minus,
  Edit2,
  Bell,
  Mail,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { formatDateRange, parseLocalDate } from "@/lib/dates";
import { getTripStatus } from "@/components/StatusBadge";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { hashToHue } from "@/components/LocationHero";
import { PendingActionsCard } from "@/components/PendingActionsCard";
import IdeaZonePanel from "../components/IdeaZonePanel";
import { PlanningRow, type ArcCardState } from "../components/PlanningRow";
import { DatesPlanningRow } from "../components/DatesPlanningRow";
import { LodgingPanel } from "../components/LodgingPanel";
import { TravelPanel } from "../components/TravelPanel";
import { TravelEntryForm } from "../components/TravelEntryForm";
import { ItineraryPanel } from "../components/ItineraryPanel";
import type { TripDisplayStatus } from "@/lib/tripStatus";
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
  useModalBackButton(onClose);
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
  useModalBackButton(onClose);
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

// ── Competition Preview Modal ─────────────────────────────────────────────

function CompetitionPreviewModal({
  onConfirm,
  onDismiss,
}: {
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  useModalBackButton(onDismiss);
  const mockTeams = [
    { short: "USA", color: "#3b82f6", pts: 24, maxPts: 24 },
    { short: "EUR", color: "#ef4444", pts: 18, maxPts: 24 },
  ];
  const mockRounds = [
    { title: "Scramble", status: "closed" as const },
    { title: "Skins", status: "active" as const },
    { title: "Singles", status: "upcoming" as const },
  ];
  const features = ["Custom teams", "Live scoring", "Play groups", "Leaderboard"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      onClick={onDismiss}
    >
      <div className="absolute inset-0" style={{ background: "var(--color-bt-overlay)" }} />
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-2xl"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Epic gradient header */}
        <div
          className="px-5 pb-6 pt-8 text-center"
          style={{
            background:
              "linear-gradient(160deg, hsl(220,65%,18%) 0%, hsl(260,55%,14%) 50%, hsl(20,75%,16%) 100%)",
          }}
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)" }}
          >
            <Trophy size={30} style={{ color: "hsl(45,100%,65%)" }} />
          </div>
          <p className="text-xl font-bold text-white">Competition Mode</p>
          <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
            Turn your trip into a tournament
          </p>

          {/* Mini scoreboard preview */}
          <div
            className="mt-5 rounded-xl p-3 text-left"
            style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>
              Leaderboard
            </p>
            <div className="space-y-2 mb-3">
              {mockTeams.map((t) => (
                <div key={t.short} className="flex items-center gap-2.5">
                  <div
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-white"
                    style={{ background: t.color }}
                  >
                    {t.short}
                  </div>
                  <div className="flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.1)", height: 6 }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(t.pts / t.maxPts) * 100}%`, background: t.color }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs font-bold text-white">{t.pts}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              {mockRounds.map((r) => {
                const isActive = r.status === "active";
                const isDone = r.status === "closed";
                return (
                  <div
                    key={r.title}
                    className="flex-1 rounded-lg px-1.5 py-1 text-center"
                    style={{
                      background: isActive ? "rgba(99,200,120,0.15)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isActive ? "rgba(99,200,120,0.35)" : "rgba(255,255,255,0.1)"}`,
                    }}
                  >
                    <p className="truncate text-[9px] font-semibold" style={{ color: isActive ? "#6bc87a" : "rgba(255,255,255,0.55)" }}>
                      {r.title}
                    </p>
                    <p className="text-[8px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {isDone ? "✓ done" : isActive ? "▶ live" : "soon"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 px-5 py-4">
          {features.map((f) => (
            <span
              key={f}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
              style={{
                background: "var(--color-bt-accent-faint)",
                border: "1px solid var(--color-bt-accent-border)",
                color: "var(--color-bt-accent)",
              }}
            >
              <Check size={10} />
              {f}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-2 px-5 pb-6">
          <button
            data-testid="competition-preview-confirm"
            onClick={onConfirm}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            <Trophy size={15} />
            Let&apos;s Go!
          </button>
          <button
            data-testid="competition-preview-dismiss"
            onClick={onDismiss}
            className="w-full py-2.5 text-sm"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SetDestinationModal ──────────────────────────────────────────────────

function SetDestinationModal({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  const lock = trpc.trips.lockDestination.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      onClose();
    },
    onError(e) {
      setError(e.message ?? "Failed to save");
    },
  });

  const handleSave = () => {
    const t = title.trim();
    if (!t) return;
    lock.mutate({ tripId, title: t, location: t });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-sm space-y-4 rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Set Destination
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={15} />
          </button>
        </div>

        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2.5"
          style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)" }}
        >
          <MapPin size={15} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Scottsdale, AZ"
            maxLength={200}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--color-bt-text)" }}
          />
        </div>

        {error && (
          <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
            {error}
          </p>
        )}

        <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          Once set, the destination can only be changed from the trip settings.
        </p>

        <button
          onClick={handleSave}
          disabled={lock.isPending || !title.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {lock.isPending && <Loader2 size={14} className="animate-spin" />}
          Set Destination
        </button>
      </div>
    </div>
  );
}

// ── ChangeDestinationModal ────────────────────────────────────────────────

// ── RSVP Panel (GOING/NOW stage Home tab) ────────────────────────────────

const RSVP_OPTIONS = [
  { value: "in" as const, label: "In", icon: Check, selectedBg: "var(--color-bt-vote-yes)", selectedText: "var(--color-bt-vote-yes-text)" },
  { value: "maybe" as const, label: "Maybe", icon: Minus, selectedBg: "var(--color-bt-vote-maybe)", selectedText: "#ffffff" },
  { value: "out" as const, label: "Can't make it", icon: X, selectedBg: "var(--color-bt-vote-no)", selectedText: "#ffffff" },
];

function RsvpPanel({
  tripId,
  members,
  currentUserId,
}: {
  tripId: string;
  members: { user_id: string | null; rsvp_status?: string | null }[];
  currentUserId: string | null;
}) {
  const utils = trpc.useUtils();

  const setRsvp = trpc.tripMembers.setRsvpStatus.useMutation({
    async onMutate(vars) {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData({ tripId }, (old) =>
        old?.map((m) =>
          m.user_id === currentUserId ? { ...m, rsvp_status: vars.rsvpStatus } : m
        )
      );
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev) utils.tripMembers.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  const myMember = members.find((m) => m.user_id === currentUserId);
  const myRsvp = (myMember as { rsvp_status?: string | null } | undefined)?.rsvp_status ?? null;

  const inCount = members.filter((m) => (m as { rsvp_status?: string | null }).rsvp_status === "in").length;
  const maybeCount = members.filter((m) => (m as { rsvp_status?: string | null }).rsvp_status === "maybe").length;
  const outCount = members.filter((m) => (m as { rsvp_status?: string | null }).rsvp_status === "out").length;
  const pendingCount = members.filter((m) => (m as { rsvp_status?: string | null }).rsvp_status == null).length;

  return (
    <div
      className="mx-4 rounded-xl px-4 py-4 lg:mx-0"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <p className="mb-3 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
        Are you in?
      </p>

      <div className="flex gap-2">
        {RSVP_OPTIONS.map((opt) => {
          const isSelected = myRsvp === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => setRsvp.mutate({ tripId, rsvpStatus: opt.value })}
              disabled={setRsvp.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
              style={{
                background: isSelected ? opt.selectedBg : "var(--color-bt-card-raised)",
                color: isSelected ? opt.selectedText : "var(--color-bt-text)",
                border: isSelected ? "none" : "1px solid var(--color-bt-border)",
              }}
            >
              <Icon size={14} />
              {opt.label}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
        {inCount} in · {maybeCount} maybe · {outCount} out · {pendingCount} pending
      </p>

      {/* Travel entry — only when RSVP is "in" */}
      {myRsvp === "in" && (
        <TravelEntryForm
          tripId={tripId}
          currentTravel={myMember as TravelEntryFormProps["currentTravel"]}
        />
      )}
    </div>
  );
}

type TravelEntryFormProps = Parameters<typeof TravelEntryForm>[0];

// ── ChangeDestinationModal ────────────────────────────────────────────────

function ChangeDestinationModal({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();
  const [destination, setDestination] = useState("");

  const changeDest = trpc.trips.changeDestination.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[400px] rounded-t-2xl p-6 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Change destination
        </h2>

        <div
          className="mt-3 flex items-start gap-2 rounded-xl px-4 py-3"
          style={{ background: "var(--color-bt-warning-bg, rgba(217,119,6,0.1))" }}
        >
          <span style={{ color: "var(--color-bt-warning)" }}>⚠</span>
          <p className="text-xs" style={{ color: "var(--color-bt-warning)" }}>
            Changing the destination will reset any date poll responses.
          </p>
        </div>

        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="New destination"
          autoFocus
          className="mt-4 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={{
            background: "var(--color-bt-card-raised)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && destination.trim()) {
              changeDest.mutate({ tripId, destination: destination.trim() });
            }
          }}
        />

        <button
          onClick={() => changeDest.mutate({ tripId, destination: destination.trim() })}
          disabled={!destination.trim() || changeDest.isPending}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {changeDest.isPending ? "Updating..." : "Update destination"}
        </button>

        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Competition Panel ─────────────────────────────────────────────────────

function CompetitionPanel({
  trip,
  canEdit,
  onSetupComp,
}: {
  trip: TripData;
  canEdit: boolean;
  onSetupComp?: () => void;
}) {
  const router = useRouter();
  const [showPreview, setShowPreview] = useState(false);
  const hasComp = !!trip.event_id;

  const { data: event } = trpc.events.getByTrip.useQuery(
    { tripId: trip.id },
    { enabled: hasComp }
  );

  // Use trip.event_id (available immediately from the trip object) so teams
  // and scores fire in parallel with events.getByTrip instead of waiting for
  // it to resolve first — eliminates the 2-step waterfall.
  const knownEventId = event?.id ?? trip.event_id ?? "";

  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId: trip.id, eventId: knownEventId },
    { enabled: !!knownEventId }
  );

  const { data: scoreRows = [] } = trpc.groupResults.listScoresByEvent.useQuery(
    { tripId: trip.id, eventId: knownEventId },
    { enabled: !!knownEventId }
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
      <>
        <button
          data-testid="home-setup-competition-btn"
          onClick={() => setShowPreview(true)}
          className="w-full rounded-xl p-4 text-center"
          style={{ border: "1.5px dashed var(--color-bt-border)", background: "var(--color-bt-surface-invitation)" }}
        >
          <Trophy size={20} className="mx-auto mb-2" style={{ color: "var(--color-bt-text-dim)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Add a Competition
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-bt-text-dim)" }}>
            Your group already has a rivalry. Give it a scoreboard.
          </p>
        </button>
        {showPreview && (
          <CompetitionPreviewModal
            onConfirm={() => { setShowPreview(false); onSetupComp?.(); }}
            onDismiss={() => setShowPreview(false)}
          />
        )}
      </>
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
      {tiles.length > 0 && (
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
      )}

      {tiles.length === 0 ? (
        <button
          data-testid="quick-info-empty-btn"
          onClick={() => setShowAddTile(true)}
          className="w-full rounded-xl p-4"
          style={{ border: "1.5px dashed var(--color-bt-border)", background: "var(--color-bt-surface-invitation)" }}
        >
          {/* Skeleton tile previews */}
          <div className="mb-3 flex justify-center gap-2">
            {[
              { label: "Door code", value: "1234#" },
              { label: "Check-in", value: "3:00 PM" },
              { label: "Address", value: "42 Oak St" },
            ].map((ex) => (
              <div
                key={ex.label}
                className="flex-1 rounded-lg p-2 text-left opacity-40"
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <p className="text-[9px] mb-0.5" style={{ color: "var(--color-bt-text-dim)" }}>{ex.label}</p>
                <p className="text-[10px] font-medium" style={{ color: "var(--color-bt-text)" }}>{ex.value}</p>
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Add Quick Info
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-bt-text-dim)" }}>
            Door codes, check-in times, street addresses — the stuff everyone always asks about.
          </p>
        </button>
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

// ── Planning Section (expandable rows) ───────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// ─────────────────────────────────────────────────────────────────────────

function PlanningSection({
  trip,
  ideas,
  tripMembers,
  reservations,
  canEdit,
  isOwner,
  onTabChange,
}: {
  trip: TripData;
  ideas: IdeaWithVotes[];
  tripMembers: { user_id: string | null; status: string; displayName: string; isGuest?: boolean; role?: string }[];
  reservations: unknown[];
  canEdit: boolean;
  isOwner: boolean;
  onTabChange?: (tab: string) => void;
}) {
  // Auto-expand dates only when a poll is genuinely open — not if dates are
  // already locked (guards against stale date_poll_active in the DB).
  const [openRow, setOpenRow] = useState<string | null>(
    trip.date_poll_active && !trip.start_date ? "dates" : null
  );
  const [showSetDest, setShowSetDest] = useState(false);
  // Edge case: PLANNING stage with no locked destination (old data / migration artifact).
  // Initialize open so the owner is prompted to fix it immediately on mount.
  const [showChangeDest, setShowChangeDest] = useState(
    (trip.stage ?? "idea") === "planning" && !trip.locked_destination_title && canEdit
  );
  const stage = trip.stage ?? "idea";
  const toggle = (key: string) => setOpenRow((prev) => (prev === key ? null : key));

  // ── Destination ──────────────────────────────────────────────────────
  const isLocked = !!trip.locked_destination_title;
  const isExploring = !!trip.comparison_mode && !isLocked;
  const destState: ArcCardState = isLocked ? "done" : isExploring ? "inProgress" : "none";
  const destNote = isLocked
    ? trip.locked_destination_title!
    : isExploring
    ? `${ideas.length} idea${ideas.length !== 1 ? "s" : ""} · voting`
    : "Not set yet";

  // ── Crew (computed first — Dates depends on crew count) ──────────────
  const confirmedMembers = tripMembers.filter((m) =>
    m.status === "in" || m.status === "likely" || m.status === "maybe" || m.status === "out"
  );
  const confirmed = confirmedMembers.length;
  const invitedCount = tripMembers.filter((m) => m.status === "invited").length;
  const draftCount = tripMembers.filter((m) => m.status === "draft").length;
  const hasAnyone = tripMembers.length > 1;
  const crewState: ArcCardState = confirmed >= 1 ? "done" : hasAnyone ? "inProgress" : "none";
  const crewNote = `${confirmed} confirmed`;

  // ── Logistics ─────────────────────────────────────────────────────────
  const _bookingCount = reservations.length;
  const _scheduleNote = _bookingCount > 0
    ? `${_bookingCount} booking${_bookingCount !== 1 ? "s" : ""}`
    : "Not booked yet";

  return (
    <section className="space-y-2">
      <p
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Planning
      </p>

      {/* ── Destination — hidden once set (shown in header, edit in settings) ── */}
      {!isLocked && (
        <PlanningRow
          icon={<MapPin size={16} />}
          label="Destination"
          note={destNote}
          state={destState}
          isOpen={openRow === "dest"}
          onToggle={() => toggle("dest")}
        >
          {/* No destination set */}
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Where are you headed? Set a destination or brainstorm ideas with the crew.
            </p>

            <div className="flex flex-col gap-2">
              {canEdit && (
                <button
                  onClick={() => setShowSetDest(true)}
                  className="flex w-full items-center justify-center rounded-xl py-2.5 text-sm font-semibold transition-opacity"
                  style={{
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                  }}
                >
                  Set destination
                </button>
              )}
              {ideas.length > 0 && (
                <div
                  className="w-full overflow-hidden rounded-xl border"
                  style={{ borderColor: "var(--color-bt-border)" }}
                >
                  <p
                    className="px-3 pt-2.5 text-xs font-medium"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    {ideas.length} idea{ideas.length !== 1 ? "s" : ""} under consideration
                  </p>
                  <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-2">
                    {ideas.slice(0, 5).map((idea) => {
                      const hue = hashToHue((idea.location ?? idea.title).toLowerCase());
                      return (
                        <div
                          key={idea.id}
                          className="w-full rounded-lg px-2.5 py-1.5"
                          style={{
                            background: `linear-gradient(135deg, hsl(${hue}, 50%, 18%), hsl(${(hue + 40) % 360}, 40%, 10%))`,
                          }}
                        >
                          <p className="truncate text-xs font-medium text-white">
                            {idea.title}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

          </div>
        </PlanningRow>
      )}

      {/* ── Crew — visible in IDEA stage only ── */}
      {stage !== "planning" && (
        <PlanningRow
          icon={<Users size={16} />}
          label="Crew"
          note={crewNote}
          state={crewState}
          isOpen={openRow === "crew"}
          onToggle={() => toggle("crew")}
        >
          <div className="space-y-3">
            {confirmedMembers.length > 0 && (
              <div className="flex -space-x-2">
                {confirmedMembers.slice(0, 5).map((m) => (
                  <div key={m.user_id} className="rounded-full ring-2 ring-[var(--color-bt-card)]">
                    <UserAvatar name={m.displayName} avatarUrl={null} size="md" />
                  </div>
                ))}
                {confirmedMembers.length > 5 && (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-[var(--color-bt-card)] text-xs"
                    style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                  >
                    +{confirmedMembers.length - 5}
                  </div>
                )}
              </div>
            )}
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {confirmed} confirmed
              {invitedCount > 0 && ` \u00b7 ${invitedCount} invited`}
              {draftCount > 0 && ` \u00b7 ${draftCount} not yet invited`}
            </p>
            <button
              onClick={() => onTabChange?.("crew")}
              className="text-xs font-medium"
              style={{ color: "var(--color-bt-accent)" }}
            >
              {canEdit ? "Manage crew \u2192" : "View crew \u2192"}
            </button>
          </div>
        </PlanningRow>
      )}

      {/* ── Dates — hidden once locked (shown in header, edit in settings; ── */}
      {/*    re-open a poll via settings → Reopen poll to revisit options) ── */}
      {!(trip.start_date && trip.end_date) && (
        <DatesPlanningRow
          trip={trip}
          canEdit={canEdit}
          isOwner={isOwner}
          isOpen={openRow === "dates"}
          onToggle={() => toggle("dates")}
          onTabChange={onTabChange}
        />
      )}
      {/* ── Lodging ── */}
      <LodgingPanel
        tripId={trip.id}
        canEdit={canEdit}
        isOpen={openRow === "lodging"}
        onToggle={() => toggle("lodging")}
      />
      {/* ── Travel ── */}
      <TravelPanel
        tripId={trip.id}
        isOpen={openRow === "travel"}
        onToggle={() => toggle("travel")}
      />


      {/* Modals rendered outside PlanningRows so they aren't gated by isOpen */}
      {showSetDest && (
        <SetDestinationModal
          tripId={trip.id}
          onClose={() => setShowSetDest(false)}
        />
      )}
      {showChangeDest && (
        <ChangeDestinationModal
          tripId={trip.id}
          onClose={() => setShowChangeDest(false)}
        />
      )}
    </section>
  );
}

// ── About Panel (GOING / NOW / PAST) ────────────────────────────────────

function AboutPanel({ tripId, aboutMessage, canEdit, isPast }: { tripId: string; aboutMessage?: string | null; canEdit: boolean; isPast: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(aboutMessage ?? "");
  const [notifyState, setNotifyState] = useState<"idle" | "confirm" | "sending" | "success" | "error">("idle");
  const utils = trpc.useUtils();

  const update = trpc.trips.updateAboutMessage.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      setEditing(false);
    },
  });

  const notifyCrew = trpc.tripMembers.notifyCrewAboutUpdate.useMutation({
    onSuccess() {
      setNotifyState("success");
      setTimeout(() => setNotifyState("idle"), 2000);
    },
    onError() {
      setNotifyState("error");
      setTimeout(() => setNotifyState("idle"), 3000);
    },
  });

  if (!aboutMessage && !canEdit) return null;

  const showNotifyButton = canEdit && !isPast && !editing && !!aboutMessage?.trim();

  return (
    <>
      <div
        className="mx-4 rounded-xl p-5 lg:mx-0"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        {/* Header row */}
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            About
          </p>
          <div className="flex items-center gap-2">
            {showNotifyButton && (
              notifyState === "success" ? (
                <p className="text-xs font-medium" style={{ color: "var(--color-bt-accent)" }}>
                  Crew notified ✓
                </p>
              ) : notifyState === "error" ? (
                <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
                  Couldn&apos;t send — try again
                </p>
              ) : (
                <button
                  onClick={() => setNotifyState("confirm")}
                  disabled={notifyState === "sending"}
                  className="flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                >
                  <Bell size={13} />
                  Notify Crew
                </button>
              )
            )}
            {canEdit && !editing && (
              <button
                onClick={() => { setDraft(aboutMessage ?? ""); setEditing(true); }}
                className="flex items-center justify-center rounded p-0.5 transition-opacity hover:opacity-70"
                style={{ color: "var(--color-bt-text-dim)" }}
                aria-label="Edit about message"
              >
                <Edit2 size={14} />
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <>
            <div className="relative">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                autoFocus
                className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
              {draft && (
                <button
                  onClick={() => setDraft("")}
                  className="absolute right-2 top-2 rounded p-0.5 transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                  aria-label="Clear"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => update.mutate({ tripId, aboutMessage: draft.trim() || null })}
                disabled={update.isPending}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {update.isPending ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-4 py-1.5 text-sm transition-opacity hover:opacity-70"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          aboutMessage && (
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-bt-text)" }}>
              {aboutMessage}
            </p>
          )
        )}
      </div>

      {/* Notify crew confirmation modal */}
      {notifyState === "confirm" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
          style={{ background: "var(--color-bt-overlay)" }}
          onClick={() => setNotifyState("idle")}
        >
          <div
            className="w-full max-w-[400px] rounded-t-2xl p-6 lg:rounded-2xl"
            style={{ background: "var(--color-bt-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Send out this update?
            </h2>
            {aboutMessage && (
              <p
                className="mt-3 rounded-xl px-4 py-3 text-sm leading-relaxed"
                style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
              >
                {aboutMessage}
              </p>
            )}
            <button
              onClick={() => { setNotifyState("sending"); notifyCrew.mutate({ tripId }); }}
              className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Yes, notify crew
            </button>
            <button
              onClick={() => setNotifyState("idle")}
              className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── HomeTab ──────────────────────────────────────────────────────────────

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  onTabChange,
  onEnableComp,
  onOpenChat,
  onMakeOfficial,
}: TabProps & { displayStatus?: TripDisplayStatus; onTabChange?: (tab: string) => void; onEnableComp?: () => void; onOpenChat?: () => void; onMakeOfficial?: (message: string) => void }) {
  const { data: ideas = [] } = trpc.ideas.list.useQuery({ tripId: trip.id });
  const { data: poll } = trpc.datePoll.get.useQuery({ tripId: trip.id });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId: trip.id });
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const [interstitialDismissed, setInterstitialDismissed] = useState(false);

  // Vote mutation for the pending-actions interstitial (same optimistic pattern as DatesSection)
  const interstitialVote = trpc.datePoll.vote.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId: trip.id });
      const prev = utils.datePoll.get.getData({ tripId: trip.id });
      utils.datePoll.get.setData({ tripId: trip.id }, (old) => {
        if (!old) return old;
        return {
          ...old,
          windows: old.windows.map((w) => {
            if (w.id !== vars.windowId) return w;
            const existing = w.votes.find((v) => v.user_id === currentUser?.id);
            if (existing?.answer === vars.answer) {
              return { ...w, votes: w.votes.filter((v) => v.user_id !== currentUser?.id) };
            }
            if (existing) {
              return {
                ...w,
                votes: w.votes.map((v) =>
                  v.user_id === currentUser?.id ? { ...v, answer: vars.answer } : v
                ),
              };
            }
            return {
              ...w,
              votes: [...w.votes, { window_id: vars.windowId, user_id: currentUser?.id ?? "", answer: vars.answer, created_at: new Date().toISOString() }],
            };
          }),
        };
      });
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.datePoll.get.setData({ tripId: trip.id }, context.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId: trip.id });
    },
  });

  const status = getTripStatus(trip);
  const _isCompleted = status === "past";
  const isLocked = !!trip.locked_destination_title;
  const _isExploring = !!trip.comparison_mode && !isLocked;
  const isBlank = !trip.comparison_mode && !isLocked;
  const stage = trip.stage ?? "idea";

  // Pending-actions interstitial: show when member has no votes on an open poll
  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollWindows = poll?.windows ?? [];
  const hasNoVotes = pollWindows.length > 0 && pollWindows.every(
    (w) => !w.votes.some((v) => v.user_id === currentUser?.id)
  );
  const showDateInterstitial =
    !isOwner &&
    !canEditProp &&
    !datesLocked &&
    pollWindows.length > 0 &&
    hasNoVotes &&
    !interstitialDismissed;
  const ownerMember = members.find((m) => m.role === "Owner");
  const ownerFirstName = ownerMember?.displayName?.split(" ")[0] ?? "The organizer";

  // IDEA stage: render IdeaZonePanel only — no planning rows
  if (stage === "idea") {
    return (
      <IdeaZonePanel
        trip={trip}
        canEdit={canEditProp}
        isOwner={!!isOwner}
        onTabChange={onTabChange}
        onOpenChat={onOpenChat}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* 0. Pending-actions interstitial for members with open action items */}
      {showDateInterstitial && (
        <PendingActionsCard
          title="Your input is needed"
          description={`${ownerFirstName} is asking everyone to weigh in on dates. Takes 30 seconds.`}
          onDismiss={() => setInterstitialDismissed(true)}
        >
          <div className="space-y-3">
            {pollWindows.map((w) => {
              const myVote = w.votes.find((v) => v.user_id === currentUser?.id)?.answer ?? null;
              const startFmt = parseLocalDate(w.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const endFmt = parseLocalDate(w.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <div key={w.id}>
                  <p className="mb-1.5 text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {startFmt}–{endFmt}
                  </p>
                  <div className="flex gap-2">
                    {([
                      { label: "✓ Works", answer: "yes" as const },
                      { label: "~ Maybe", answer: "maybe" as const },
                      { label: "✗ Can't", answer: "no" as const },
                    ]).map(({ label, answer }) => {
                      const isActive = myVote === answer;
                      const colorMap = {
                        yes: { color: "var(--color-bt-accent)", border: "var(--color-bt-accent)" },
                        maybe: { color: "var(--color-bt-warning)", border: "var(--color-bt-warning)" },
                        no: { color: "var(--color-bt-danger)", border: "var(--color-bt-danger)" },
                      };
                      const c = colorMap[answer];
                      return (
                        <button
                          key={answer}
                          onClick={() => interstitialVote.mutate({ tripId: trip.id, windowId: w.id, answer })}
                          className="flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium transition-all"
                          style={{
                            background: "var(--color-bt-state-fill)",
                            border: isActive ? `2px solid ${c.border}` : "1px solid var(--color-bt-border)",
                            color: isActive ? c.color : "var(--color-bt-text-dim)",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </PendingActionsCard>
      )}

      {/* ── Two-column desktop layout (going/now/past stages) ─────────── */}
      <div className={(stage === "going" || status === "now" || status === "past") ? "lg:grid lg:grid-cols-[1fr_320px] lg:gap-6" : ""}>
        {/* ── Left column: primary planning content ─────────────────── */}
        <div className="space-y-4">
          {/* ── GOING / NOW / PAST stage: About panel ──────────────── */}
          {(stage === "going" || status === "now" || status === "past") && (
            <AboutPanel tripId={trip.id} aboutMessage={trip.about_message} canEdit={canEditProp} isPast={status === "past"} />
          )}

          {/* ── GOING / NOW stage: RSVP panel ──────────────────────── */}
          {(stage === "going" || status === "now") && (
            <RsvpPanel tripId={trip.id} members={members} currentUserId={currentUser?.id ?? null} />
          )}

          {/* ── Itinerary panel — read-only confirmed-only timeline ── */}
          {stage !== "idea" && stage !== "planning" && (
            <ItineraryPanel
              tripId={trip.id}
              tripStartDate={trip.start_date}
              stage={stage}
              status={status}
              onTabChange={onTabChange}
            />
          )}

          {/* ── Planning rows — gated by stage ────────────────────── */}
          {(isBlank || isLocked) && (stage === "idea" || stage === "planning") && (
            <PlanningSection
              trip={trip}
              ideas={ideas as IdeaWithVotes[]}
              tripMembers={members}
              reservations={reservations}
              canEdit={canEditProp}
              isOwner={!!isOwner}
              onTabChange={onTabChange}
            />
          )}

          {/* ── GOING/NOW: planning rows — logistics stays editable ── */}
          {(stage === "going" || status === "now" || status === "past") && (isBlank || isLocked) && (
            <PlanningSection
              trip={trip}
              ideas={ideas as IdeaWithVotes[]}
              tripMembers={members}
              reservations={reservations}
              canEdit={canEditProp}
              isOwner={!!isOwner}
              onTabChange={onTabChange}
            />
          )}

          {/* Competition panel — only in READY stage and beyond */}
          {stage !== "idea" && stage !== "planning" && (
            <CompetitionPanel
              trip={trip}
              canEdit={canEditProp}
              onSetupComp={onEnableComp}
            />
          )}
        </div>

        {/* ── Right column: going/now/past stages only ───────────────── */}
        {(stage === "going" || status === "now" || status === "past") && (
          <div className="mt-4 space-y-4 lg:mt-0">
            <QuickInfoSection tripId={trip.id} isOwner={!!isOwner} />
            {trip.start_date && trip.end_date && (
              <div
                className="rounded-xl p-4"
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                  Dates
                </p>
                <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  {formatDateRange(trip.start_date, trip.end_date)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
