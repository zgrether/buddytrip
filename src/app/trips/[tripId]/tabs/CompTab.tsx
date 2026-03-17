"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Users,
  Calendar,
  ChevronRight,
  Flag,
  BarChart3,
  CheckCircle,
  Lock,
  Play,
  Plus,
  Trash2,
  Pencil,
  ArrowLeft,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { TabProps } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────

type RoundFormat = "scramble" | "stableford" | "sabotage" | "skins" | "match_play" | "singles";
type SetupTab = "event" | "teams" | "rounds" | "groups";

interface Team {
  id: string;
  event_id: string;
  name: string;
  short_name: string;
  color: string;
  color_dim: string;
}

interface Round {
  id: string;
  event_id: string;
  day: number;
  title: string;
  course: string;
  format: RoundFormat;
  points_available: number;
  is_closed?: boolean | null;
}

interface Member {
  user_id: string;
  memberId: string;
  isGuest: boolean;
  role: string;
  displayName: string;
  user?: { id: string; name?: string | null; email?: string | null; is_guest?: boolean } | null;
}

interface TeamAssignment {
  event_id: string;
  team_id: string;
  user_id: string;
  memberId: string;
}

interface PlayGroup {
  id: string;
  event_id: string;
  name: string;
  tee_time: string;
  player_ids: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────

const ROUND_FORMATS: { value: RoundFormat; label: string }[] = [
  { value: "scramble", label: "Scramble" },
  { value: "stableford", label: "Stableford" },
  { value: "sabotage", label: "Sabotage" },
  { value: "skins", label: "Skins" },
  { value: "match_play", label: "Match Play" },
  { value: "singles", label: "Singles" },
];

const TEAM_COLORS = [
  { color: "var(--color-bt-danger)", dim: "#7f1d1d", label: "Red" },
  { color: "#3b82f6", dim: "#1e3a8a", label: "Blue" },
  { color: "#22c55e", dim: "#14532d", label: "Green" },
  { color: "var(--color-bt-warning)", dim: "#78350f", label: "Amber" },
  { color: "#a855f7", dim: "#581c87", label: "Purple" },
  { color: "#06b6d4", dim: "#164e63", label: "Cyan" },
];

// ── StatusPill ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const cfg =
    status === "active"
      ? { label: "Active", color: "var(--color-bt-accent)" }
      : status === "submitted"
        ? { label: "Submitted", color: "var(--color-bt-warning)" }
        : status === "closed" || status === "completed"
          ? { label: "Closed", color: "var(--color-bt-text-dim)" }
          : { label: "Upcoming", color: "var(--color-bt-ready)" };

  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${cfg.color}22`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

// ── EventSection ──────────────────────────────────────────────────────────

function EventSection({
  tripId,
  event,
}: {
  tripId: string;
  event: {
    id: string;
    title: string;
    subtitle?: string | null;
    motto?: string | null;
    location: string;
    dates: string;
    competition_type?: string | null;
  } | null;
}) {
  const utils = trpc.useUtils();

  const [title, setTitle] = useState(event?.title ?? "");
  const [subtitle, setSubtitle] = useState(event?.subtitle ?? "");
  const [motto, setMotto] = useState(event?.motto ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [dates, setDates] = useState(event?.dates ?? "");
  const [compType, setCompType] = useState<"RYDER_CUP" | "NORMAL">(
    (event?.competition_type as "RYDER_CUP" | "NORMAL") ?? "RYDER_CUP"
  );

  const upsertEvent = trpc.events.upsert.useMutation({
    onSuccess: () => {
      utils.events.getByTrip.invalidate({ tripId });
      utils.trips.getById.invalidate({ tripId });
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !location.trim() || !dates.trim()) return;
    upsertEvent.mutate({
      tripId,
      id: event?.id ?? crypto.randomUUID(),
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      motto: motto.trim() || undefined,
      location: location.trim(),
      dates: dates.trim(),
      competitionType: compType,
    });
  }

  return (
    <form data-testid="event-form" onSubmit={handleSave} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          Event Name *
        </label>
        <input
          data-testid="event-title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. The Masters Invitational"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          Subtitle
        </label>
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="e.g. Annual Golf Weekend"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          Motto
        </label>
        <input
          value={motto}
          onChange={(e) => setMotto(e.target.value)}
          placeholder="e.g. May the best man win"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            Location *
          </label>
          <input
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Pebble Beach, CA"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            Dates *
          </label>
          <input
            required
            value={dates}
            onChange={(e) => setDates(e.target.value)}
            placeholder="e.g. Jun 15–18, 2026"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          Format
        </label>
        <div className="flex gap-2">
          {(["RYDER_CUP", "NORMAL"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setCompType(t)}
              className="flex-1 rounded-lg py-2 text-xs font-medium transition-all"
              style={{
                background: compType === t ? "var(--color-bt-accent-faint)" : "var(--color-bt-base)",
                border: `1px solid ${compType === t ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                color: compType === t ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              }}
            >
              {t === "RYDER_CUP" ? "Ryder Cup" : "Standard"}
            </button>
          ))}
        </div>
      </div>
      <button
        type="submit"
        data-testid="save-event-btn"
        disabled={upsertEvent.isPending}
        className="w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
        style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
      >
        {upsertEvent.isPending ? "Saving…" : event ? "Update Event" : "Create Event"}
      </button>
    </form>
  );
}

// ── TeamsSection ──────────────────────────────────────────────────────────

function TeamsSection({
  tripId,
  eventId,
  teams,
  members,
  assignments,
}: {
  tripId: string;
  eventId: string;
  teams: Team[];
  members: Member[];
  assignments: TeamAssignment[];
}) {
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShort, setNewShort] = useState("");
  const [colorIdx, setColorIdx] = useState(0);

  const upsertTeam = trpc.teams.upsert.useMutation({
    onSuccess: () => {
      utils.teams.list.invalidate({ tripId, eventId });
      setShowAdd(false);
      setNewName("");
      setNewShort("");
    },
  });

  const assignMember = trpc.teamAssignments.assign.useMutation({
    onSuccess: () => utils.teamAssignments.list.invalidate({ tripId, eventId }),
  });

  const unassignMember = trpc.teamAssignments.remove.useMutation({
    onSuccess: () => utils.teamAssignments.list.invalidate({ tripId, eventId }),
  });

  const assignmentByMember = new Map(assignments.map((a) => [a.memberId, a.team_id]));

  return (
    <div className="space-y-4">
      {teams.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>No teams yet. Add teams below.</p>
      ) : (
        <div className="space-y-2">
          {teams.map((team) => {
            const teamMembers = assignments.filter((a) => a.team_id === team.id);
            return (
              <div
                key={team.id}
                data-testid={`team-row-${team.id}`}
                className="rounded-xl p-3"
                style={{ background: "var(--color-bt-card)", border: `1px solid ${team.color}44` }}
              >
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: team.color }} />
                  <p className="flex-1 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>{team.name}</p>
                  <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    {teamMembers.length} player{teamMembers.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd ? (
        <div
          className="space-y-3 rounded-xl p-4"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>New Team</p>
          <input
            data-testid="team-name-input"
            placeholder="Team name (e.g. Europe)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
          <input
            data-testid="team-short-input"
            placeholder="Short name (e.g. EUR)"
            value={newShort}
            onChange={(e) => setNewShort(e.target.value)}
            maxLength={20}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
          <div className="flex gap-2">
            {TEAM_COLORS.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setColorIdx(i)}
                className="h-7 w-7 rounded-full transition-all"
                style={{
                  background: c.color,
                  outline: colorIdx === i ? `2px solid ${c.color}` : "2px solid transparent",
                  outlineOffset: "2px",
                }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 rounded-lg border py-2 text-sm"
              style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
            >
              Cancel
            </button>
            <button
              data-testid="add-team-btn"
              disabled={!newName.trim() || !newShort.trim() || upsertTeam.isPending}
              onClick={() => {
                const c = TEAM_COLORS[colorIdx];
                upsertTeam.mutate({
                  tripId,
                  id: crypto.randomUUID(),
                  eventId,
                  name: newName.trim(),
                  shortName: newShort.trim(),
                  color: c.color,
                  colorDim: c.dim,
                });
              }}
              className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Add Team
            </button>
          </div>
        </div>
      ) : (
        <button
          data-testid="show-add-team-btn"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
        >
          <Plus size={16} />
          Add Team
        </button>
      )}

      {teams.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            Player Assignments
          </p>
          <div className="space-y-2">
            {members.map((m) => {
              const assignedTeamId = assignmentByMember.get(m.memberId);
              const assignedTeam = teams.find((t) => t.id === assignedTeamId);
              return (
                <div
                  key={m.memberId}
                  data-testid={`player-row-${m.memberId}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
                >
                  <div
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={{
                      background: assignedTeam ? `${assignedTeam.color}22` : "var(--color-bt-base)",
                      color: assignedTeam?.color ?? "var(--color-bt-text-dim)",
                    }}
                  >
                    {m.displayName.charAt(0).toUpperCase()}
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
                    {m.displayName}
                  </p>
                  <select
                    data-testid={`assign-${m.memberId}`}
                    value={assignedTeamId ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "") {
                        if (assignedTeamId) unassignMember.mutate({ tripId, eventId, userId: m.memberId });
                      } else {
                        assignMember.mutate({ tripId, eventId, teamId: val, userId: m.memberId });
                      }
                    }}
                    className="rounded-lg border px-2 py-1 text-xs outline-none"
                    style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                  >
                    <option value="">Unassigned</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.short_name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── RoundsSection ─────────────────────────────────────────────────────────

function RoundsSection({
  tripId,
  eventId,
  rounds,
}: {
  tripId: string;
  eventId: string;
  rounds: Round[];
}) {
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [day, setDay] = useState(String(rounds.length + 1));
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [format, setFormat] = useState<RoundFormat>("stableford");
  const [points, setPoints] = useState("10");

  const createRound = trpc.rounds.create.useMutation({
    onSuccess: () => {
      utils.rounds.list.invalidate({ tripId, eventId });
      setShowAdd(false);
      setTitle("");
      setCourse("");
      setDay(String(rounds.length + 2));
    },
  });

  const removeRound = trpc.rounds.remove.useMutation({
    onSuccess: () => utils.rounds.list.invalidate({ tripId, eventId }),
  });

  return (
    <div className="space-y-3">
      {rounds.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>No rounds yet.</p>
      ) : (
        <div className="space-y-2">
          {rounds.map((round) => (
            <div
              key={round.id}
              data-testid={`round-row-${round.id}`}
              className="flex items-start gap-3 rounded-xl p-3"
              style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
            >
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
              >
                {round.day}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>{round.title}</p>
                <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  {round.course} · {ROUND_FORMATS.find((f) => f.value === round.format)?.label ?? round.format} · {round.points_available} pts
                </p>
              </div>
              <button
                data-testid={`remove-round-${round.id}`}
                onClick={() => removeRound.mutate({ tripId, roundId: round.id })}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd ? (
        <div
          className="space-y-3 rounded-xl p-4"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>Add Round</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Day</label>
              <input
                type="number"
                min={1}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Points</label>
              <input
                type="number"
                min={0}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              />
            </div>
          </div>
          <input
            data-testid="round-title-input"
            placeholder="Round title (e.g. Foursomes)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
          <input
            data-testid="round-course-input"
            placeholder="Course name"
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Format</label>
            <select
              data-testid="round-format-select"
              value={format}
              onChange={(e) => setFormat(e.target.value as RoundFormat)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
            >
              {ROUND_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 rounded-lg border py-2 text-sm"
              style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
            >
              Cancel
            </button>
            <button
              data-testid="save-round-btn"
              disabled={!title.trim() || !course.trim() || createRound.isPending}
              onClick={() => {
                createRound.mutate({
                  tripId,
                  id: crypto.randomUUID(),
                  eventId,
                  day: Number(day),
                  title: title.trim(),
                  course: course.trim(),
                  format,
                  pointsAvailable: Number(points),
                });
              }}
              className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Add Round
            </button>
          </div>
        </div>
      ) : (
        <button
          data-testid="show-add-round-btn"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
        >
          <Plus size={16} />
          Add Round
        </button>
      )}
    </div>
  );
}

// ── GroupsSection ─────────────────────────────────────────────────────────

function GroupsSection({
  tripId,
  eventId,
  playGroups,
  members,
  teams,
  assignments,
}: {
  tripId: string;
  eventId: string;
  playGroups: PlayGroup[];
  members: Member[];
  teams: Team[];
  assignments: TeamAssignment[];
}) {
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTeeTime, setNewTeeTime] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTeeTime, setEditTeeTime] = useState("");
  const [editPlayerIds, setEditPlayerIds] = useState<string[]>([]);

  const assignedMemberIds = new Set(assignments.map((a) => a.memberId));
  const assignedMembers = members.filter((m) => assignedMemberIds.has(m.memberId));
  const teamByMemberId = new Map(assignments.map((a) => [a.memberId, teams.find((t) => t.id === a.team_id)]));

  const createGroup = trpc.playGroups.create.useMutation({
    onSuccess: () => {
      utils.playGroups.list.invalidate({ tripId, eventId });
      setShowAdd(false);
      setNewName("");
      setNewTeeTime("");
      setSelectedPlayerIds([]);
    },
  });

  const deleteGroup = trpc.playGroups.delete.useMutation({
    onSuccess: () => utils.playGroups.list.invalidate({ tripId, eventId }),
  });

  const updateGroup = trpc.playGroups.update.useMutation({
    onSuccess: () => {
      utils.playGroups.list.invalidate({ tripId, eventId });
      setEditingGroupId(null);
    },
  });

  function startEdit(group: PlayGroup) {
    setEditingGroupId(group.id);
    setEditName(group.name);
    setEditTeeTime(group.tee_time);
    setEditPlayerIds(group.player_ids);
  }

  function toggleEditPlayer(id: string) {
    setEditPlayerIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function togglePlayer(id: string) {
    setSelectedPlayerIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  if (assignedMembers.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          Assign players to teams first before creating play groups.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {playGroups.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>No play groups yet.</p>
      ) : (
        <div className="space-y-2">
          {playGroups.map((group) => (
            <div
              key={group.id}
              data-testid={`group-row-${group.id}`}
              className="rounded-xl"
              style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
            >
              {editingGroupId === group.id ? (
                <div className="space-y-3 p-3">
                  <input
                    data-testid={`edit-group-name-${group.id}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                    placeholder="Group name"
                  />
                  <input
                    data-testid={`edit-group-tee-time-${group.id}`}
                    value={editTeeTime}
                    onChange={(e) => setEditTeeTime(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                    placeholder="Tee time"
                  />
                  <div className="space-y-1.5">
                    <label className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Players</label>
                    {assignedMembers.map((m) => {
                      const team = teamByMemberId.get(m.memberId);
                      const checked = editPlayerIds.includes(m.memberId);
                      return (
                        <label
                          key={m.memberId}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2"
                          style={{
                            background: checked ? "var(--color-bt-accent-faint)" : "var(--color-bt-base)",
                            border: `1px solid ${checked ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                          }}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleEditPlayer(m.memberId)} className="accent-bt-accent" />
                          {team && <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: team.color }} />}
                          <span className="text-sm" style={{ color: "var(--color-bt-text)" }}>{m.displayName}</span>
                          {team && <span className="ml-auto text-xs" style={{ color: team.color }}>{team.short_name}</span>}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingGroupId(null)}
                      className="flex-1 rounded-lg border py-2 text-sm"
                      style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                    >
                      Cancel
                    </button>
                    <button
                      data-testid={`save-edit-group-${group.id}`}
                      disabled={!editName.trim() || !editTeeTime.trim() || editPlayerIds.length === 0 || updateGroup.isPending}
                      onClick={() => updateGroup.mutate({ tripId, groupId: group.id, name: editName.trim(), teeTime: editTeeTime.trim(), playerIds: editPlayerIds })}
                      className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                      style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>{group.name}</p>
                    <p className="mb-1.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>{group.tee_time}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.player_ids.map((uid) => {
                        const m = members.find((x) => x.memberId === uid);
                        const name = m?.displayName ?? uid.slice(0, 6);
                        const team = teamByMemberId.get(uid);
                        return (
                          <span
                            key={uid}
                            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                            style={{
                              background: team ? `${team.color}22` : "var(--color-bt-base, #0d1117)22",
                              color: team?.color ?? "var(--color-bt-text-dim)",
                              border: `1px solid ${team?.color ?? "var(--color-bt-border)"}44`,
                            }}
                          >
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: team?.color ?? "var(--color-bt-text-dim)" }} />
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button
                      data-testid={`edit-group-${group.id}`}
                      onClick={() => startEdit(group)}
                      className="flex h-6 w-6 items-center justify-center rounded-full"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      data-testid={`delete-group-${group.id}`}
                      onClick={() => deleteGroup.mutate({ tripId, groupId: group.id })}
                      disabled={deleteGroup.isPending}
                      className="flex h-6 w-6 items-center justify-center rounded-full disabled:opacity-40"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd ? (
        <div
          className="space-y-3 rounded-xl p-4"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>Add Play Group</p>
          <input
            data-testid="group-name-input"
            placeholder="Group name (e.g. Group 1)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
          <input
            data-testid="group-tee-time-input"
            placeholder="Tee time (e.g. 8:00 AM)"
            value={newTeeTime}
            onChange={(e) => setNewTeeTime(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
          <div>
            <label className="mb-1.5 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Players</label>
            <div className="space-y-1.5">
              {assignedMembers.map((m) => {
                const team = teamByMemberId.get(m.memberId);
                const checked = selectedPlayerIds.includes(m.memberId);
                return (
                  <label
                    key={m.memberId}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2"
                    style={{
                      background: checked ? "var(--color-bt-accent-faint)" : "var(--color-bt-base)",
                      border: `1px solid ${checked ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => togglePlayer(m.memberId)} className="accent-bt-accent" />
                    {team && <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: team.color }} />}
                    <span className="text-sm" style={{ color: "var(--color-bt-text)" }}>{m.displayName}</span>
                    {team && <span className="ml-auto text-xs" style={{ color: team.color }}>{team.short_name}</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setShowAdd(false); setNewName(""); setNewTeeTime(""); setSelectedPlayerIds([]); }}
              className="flex-1 rounded-lg border py-2 text-sm"
              style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
            >
              Cancel
            </button>
            <button
              data-testid="save-group-btn"
              disabled={!newName.trim() || !newTeeTime.trim() || selectedPlayerIds.length === 0 || createGroup.isPending}
              onClick={() => {
                createGroup.mutate({
                  tripId,
                  id: crypto.randomUUID(),
                  eventId,
                  name: newName.trim(),
                  teeTime: newTeeTime.trim(),
                  playerIds: selectedPlayerIds,
                });
              }}
              className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Add Group
            </button>
          </div>
        </div>
      ) : (
        <button
          data-testid="show-add-group-btn"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
        >
          <Plus size={16} />
          Add Play Group
        </button>
      )}
    </div>
  );
}

// ── CompTab ───────────────────────────────────────────────────────────────

const FORMAT_LABEL: Record<string, string> = {
  scramble: "Scramble",
  stableford: "Stableford",
  sabotage: "Sabotage",
  skins: "Skins",
  match_play: "Match Play",
  singles: "Singles",
};

const SETUP_TABS: { id: SetupTab; label: string; Icon: typeof Trophy }[] = [
  { id: "event", label: "Event", Icon: Trophy },
  { id: "teams", label: "Teams", Icon: Users },
  { id: "rounds", label: "Rounds", Icon: Calendar },
  { id: "groups", label: "Groups", Icon: Flag },
];

export function CompTab({ trip, canEdit }: TabProps) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<"view" | "setup">("view");
  const [setupTab, setSetupTab] = useState<SetupTab>("event");

  const { data: event, isLoading: eventLoading } = trpc.events.getByTrip.useQuery({ tripId: trip.id });
  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId: trip.id, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );
  const { data: rounds = [] } = trpc.rounds.list.useQuery(
    { tripId: trip.id, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId: trip.id, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );
  const { data: playGroups = [] } = trpc.playGroups.list.useQuery(
    { tripId: trip.id, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  const closeRound = trpc.rounds.update.useMutation({
    async onMutate(vars) {
      const eventId = event?.id ?? "";
      await utils.rounds.list.cancel({ tripId: trip.id, eventId });
      const prev = utils.rounds.list.getData({ tripId: trip.id, eventId });
      utils.rounds.list.setData({ tripId: trip.id, eventId }, (prev ?? []).map((r) =>
        r.id === vars.roundId ? { ...r, status: vars.status ?? r.status } : r
      ));
      return { prev };
    },
    onError(_err, _vars, context) {
      const eventId = event?.id ?? "";
      if (context?.prev !== undefined) utils.rounds.list.setData({ tripId: trip.id, eventId }, context.prev);
    },
    onSettled() {
      utils.rounds.list.invalidate({ tripId: trip.id, eventId: event?.id ?? "" });
    },
  });

  const activateRound = trpc.rounds.activate.useMutation({
    async onMutate(vars) {
      const eventId = event?.id ?? "";
      await utils.rounds.list.cancel({ tripId: trip.id, eventId });
      const prev = utils.rounds.list.getData({ tripId: trip.id, eventId });
      utils.rounds.list.setData({ tripId: trip.id, eventId }, (prev ?? []).map((r) => {
        if (r.id === vars.roundId) return { ...r, status: "active" };
        if (r.status === "active") return { ...r, status: "submitted" };
        return r;
      }));
      return { prev };
    },
    onError(_err, _vars, context) {
      const eventId = event?.id ?? "";
      if (context?.prev !== undefined) utils.rounds.list.setData({ tripId: trip.id, eventId }, context.prev);
    },
    onSettled() {
      utils.rounds.list.invalidate({ tripId: trip.id, eventId: event?.id ?? "" });
    },
  });

  // ── Loading ─────────────────────────────────────────────────────────────
  if (eventLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  // ── Setup mode ──────────────────────────────────────────────────────────
  if (mode === "setup" && canEdit) {
    return (
      <div className="space-y-0">
        {/* Back header */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <button
            onClick={() => setMode("view")}
            className="flex items-center gap-1.5 text-sm font-medium"
            style={{ color: "var(--color-bt-accent)" }}
          >
            <ArrowLeft size={16} />
            {event ? "Back to Competition" : "Cancel"}
          </button>
          <span className="ml-auto text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            {event ? "Manage Competition" : "New Competition"}
          </span>
        </div>

        {/* Setup sub-tabs */}
        <div
          className="flex border-b"
          style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
        >
          {SETUP_TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              data-testid={`setup-tab-${id}`}
              onClick={() => setSetupTab(id)}
              className="flex flex-1 items-center justify-center gap-1.5 py-3 text-xs transition-colors"
              style={{
                color: setupTab === id ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                borderBottom: setupTab === id ? "2px solid var(--color-bt-accent)" : "2px solid transparent",
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Setup content */}
        <div className="p-4">
          {setupTab === "event" && (
            <EventSection tripId={trip.id} event={event ?? null} />
          )}
          {setupTab === "teams" && !event && (
            <div className="py-8 text-center">
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>Create an event first.</p>
            </div>
          )}
          {setupTab === "teams" && event && (
            <TeamsSection
              tripId={trip.id}
              eventId={event.id}
              teams={teams as Team[]}
              members={members as Member[]}
              assignments={assignments as TeamAssignment[]}
            />
          )}
          {setupTab === "rounds" && !event && (
            <div className="py-8 text-center">
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>Create an event first.</p>
            </div>
          )}
          {setupTab === "rounds" && event && (
            <RoundsSection tripId={trip.id} eventId={event.id} rounds={rounds as Round[]} />
          )}
          {setupTab === "groups" && !event && (
            <div className="py-8 text-center">
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>Create an event first.</p>
            </div>
          )}
          {setupTab === "groups" && event && (
            <GroupsSection
              tripId={trip.id}
              eventId={event.id}
              playGroups={playGroups as PlayGroup[]}
              members={members as Member[]}
              teams={teams as Team[]}
              assignments={assignments as TeamAssignment[]}
            />
          )}
        </div>
      </div>
    );
  }

  // ── No event yet ─────────────────────────────────────────────────────────
  if (!event) {
    return (
      <div className="space-y-4 px-4">
        <button
          data-testid="setup-competition-btn"
          onClick={() => { setSetupTab("event"); setMode("setup"); }}
          className="w-full rounded-xl p-6 text-center"
          style={{ border: "2px dashed var(--color-bt-border)", background: "transparent" }}
        >
          <Trophy size={28} className="mx-auto mb-3" style={{ color: "var(--color-bt-text-dim)" }} />
          <p className="mb-1 text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Set Up Competition
          </p>
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {canEdit
              ? "Define teams, rounds, and scoring for your group competition."
              : "Waiting for a planner to set up the competition."}
          </p>
        </button>
      </div>
    );
  }

  // ── Event overview ────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 px-4">
      {/* Event header card */}
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={16} style={{ color: "var(--color-bt-accent)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>{event.title}</p>
          </div>
          <StatusPill status={event.status ?? "upcoming"} />
        </div>
        {event.subtitle && (
          <p className="mb-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>{event.subtitle}</p>
        )}
        {event.motto && (
          <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            &ldquo;{event.motto}&rdquo;
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {event.location && (
            <span className="flex items-center gap-1"><Flag size={10} />{event.location}</span>
          )}
          {event.dates && (
            <span className="flex items-center gap-1"><Calendar size={10} />{event.dates}</span>
          )}
        </div>

        <button
          data-testid="view-leaderboard-btn"
          onClick={() => router.push(`/trips/${trip.id}/leaderboard`)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          <BarChart3 size={14} />
          View Leaderboard
        </button>

        {canEdit && (
          <button
            data-testid="edit-competition-btn"
            onClick={() => { setSetupTab("event"); setMode("setup"); }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
          >
            Manage Competition
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      {/* Teams */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Teams ({teams.length})
        </h2>
        {teams.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            No teams yet.{canEdit && " Add teams from Manage Competition."}
          </p>
        ) : (
          <div className="space-y-2">
            {teams.map((team) => (
              <div
                key={team.id}
                data-testid={`team-${team.id}`}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: team.color ?? "var(--color-bt-text-dim)" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>{team.name}</p>
                  <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>{team.short_name}</p>
                </div>
                <Users size={14} style={{ color: "var(--color-bt-text-dim)" }} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rounds */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Rounds ({rounds.length})
        </h2>
        {rounds.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            No rounds yet.{canEdit && " Add rounds from Manage Competition."}
          </p>
        ) : (
          <div className="space-y-2">
            {rounds.map((round) => {
              const statusColor =
                round.status === "active" ? "var(--color-bt-accent)"
                  : round.status === "submitted" ? "var(--color-bt-warning)"
                    : "var(--color-bt-text-dim)";
              return (
                <div
                  key={round.id}
                  data-testid={`round-${round.id}`}
                  className="rounded-xl px-4 py-3"
                  style={{
                    background: "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                    borderLeft: `3px solid ${statusColor}`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>{round.title}</p>
                    <StatusPill status={round.status} />
                  </div>
                  <div className="mt-1 flex gap-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    <span>{round.course}</span>
                    <span>{FORMAT_LABEL[round.format] ?? round.format}</span>
                    {round.points_available > 0 && <span>{round.points_available} pts</span>}
                  </div>

                  {canEdit && round.status === "upcoming" && (
                    <button
                      data-testid={`activate-round-${round.id}`}
                      onClick={() => activateRound.mutate({ roundId: round.id, tripId: trip.id, eventId: event.id })}
                      disabled={activateRound.isPending}
                      className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
                      style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent-border)" }}
                    >
                      <Play size={11} />
                      Make Current
                    </button>
                  )}

                  {canEdit && round.status === "submitted" && (
                    <button
                      data-testid={`close-round-${round.id}`}
                      onClick={() => closeRound.mutate({ roundId: round.id, tripId: trip.id, status: "closed" })}
                      disabled={closeRound.isPending}
                      className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
                      style={{ background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44" }}
                    >
                      <CheckCircle size={12} />
                      Close Round ✓
                    </button>
                  )}

                  {round.status === "closed" && (
                    <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      <Lock size={10} />
                      Closed ✓
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
