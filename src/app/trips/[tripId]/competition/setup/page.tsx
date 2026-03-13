"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Flag,
  Plus,
  Trash2,
  Trophy,
  Users,
  Calendar,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";

// ── Types ─────────────────────────────────────────────────────────────────

type RoundFormat =
  | "scramble"
  | "stableford"
  | "sabotage"
  | "skins"
  | "match_play"
  | "singles";

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
  role: string;
  user?: { id: string; name?: string | null; email?: string | null } | null;
}

interface TeamAssignment {
  event_id: string;
  team_id: string;
  user_id: string;
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
  { color: "#ef4444", dim: "#7f1d1d", label: "Red" },
  { color: "#3b82f6", dim: "#1e3a8a", label: "Blue" },
  { color: "#22c55e", dim: "#14532d", label: "Green" },
  { color: "#f59e0b", dim: "#78350f", label: "Amber" },
  { color: "#a855f7", dim: "#581c87", label: "Purple" },
  { color: "#06b6d4", dim: "#164e63", label: "Cyan" },
];

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
    <form
      data-testid="event-form"
      onSubmit={handleSave}
      className="space-y-3"
    >
      <div>
        <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
          Event Name *
        </label>
        <input
          data-testid="event-title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. The Masters Invitational"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            background: "#0d1117",
            borderColor: "#30363d",
            color: "#e6edf3",
          }}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
          Subtitle
        </label>
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="e.g. Annual Golf Weekend"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            background: "#0d1117",
            borderColor: "#30363d",
            color: "#e6edf3",
          }}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
          Motto
        </label>
        <input
          value={motto}
          onChange={(e) => setMotto(e.target.value)}
          placeholder="e.g. May the best man win"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            background: "#0d1117",
            borderColor: "#30363d",
            color: "#e6edf3",
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
            Location *
          </label>
          <input
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Pebble Beach, CA"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "#0d1117",
              borderColor: "#30363d",
              color: "#e6edf3",
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
            Dates *
          </label>
          <input
            required
            value={dates}
            onChange={(e) => setDates(e.target.value)}
            placeholder="e.g. Jun 15–18, 2026"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "#0d1117",
              borderColor: "#30363d",
              color: "#e6edf3",
            }}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
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
                background: compType === t ? "#00d4aa22" : "#0d1117",
                border: `1px solid ${compType === t ? "#00d4aa" : "#30363d"}`,
                color: compType === t ? "#00d4aa" : "#8b949e",
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
        style={{ background: "#00d4aa", color: "#0d1117" }}
      >
        {upsertEvent.isPending
          ? "Saving…"
          : event
            ? "Update Event"
            : "Create Event"}
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

  const assignmentByUser = new Map(
    assignments.map((a) => [a.user_id, a.team_id])
  );

  return (
    <div className="space-y-4">
      {/* Team list */}
      {teams.length === 0 ? (
        <p className="text-sm" style={{ color: "#8b949e" }}>
          No teams yet. Add teams below.
        </p>
      ) : (
        <div className="space-y-2">
          {teams.map((team) => {
            const teamMembers = assignments.filter(
              (a) => a.team_id === team.id
            );
            return (
              <div
                key={team.id}
                data-testid={`team-row-${team.id}`}
                className="rounded-xl p-3"
                style={{
                  background: "#161b22",
                  border: `1px solid ${team.color}44`,
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full flex-shrink-0"
                    style={{ background: team.color }}
                  />
                  <p
                    className="flex-1 text-sm font-medium"
                    style={{ color: "#e6edf3" }}
                  >
                    {team.name}
                  </p>
                  <span
                    className="text-xs"
                    style={{ color: "#8b949e" }}
                  >
                    {teamMembers.length} player
                    {teamMembers.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add team form */}
      {showAdd ? (
        <div
          className="space-y-3 rounded-xl p-4"
          style={{ background: "#161b22", border: "1px solid #30363d" }}
        >
          <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
            New Team
          </p>
          <input
            data-testid="team-name-input"
            placeholder="Team name (e.g. Europe)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "#0d1117",
              borderColor: "#30363d",
              color: "#e6edf3",
            }}
          />
          <input
            data-testid="team-short-input"
            placeholder="Short name (e.g. EUR)"
            value={newShort}
            onChange={(e) => setNewShort(e.target.value)}
            maxLength={20}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "#0d1117",
              borderColor: "#30363d",
              color: "#e6edf3",
            }}
          />
          {/* Color picker */}
          <div className="flex gap-2">
            {TEAM_COLORS.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setColorIdx(i)}
                className="h-7 w-7 rounded-full transition-all"
                style={{
                  background: c.color,
                  outline:
                    colorIdx === i
                      ? `2px solid ${c.color}`
                      : "2px solid transparent",
                  outlineOffset: "2px",
                }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 rounded-lg border py-2 text-sm"
              style={{ borderColor: "#30363d", color: "#8b949e" }}
            >
              Cancel
            </button>
            <button
              data-testid="add-team-btn"
              disabled={
                !newName.trim() || !newShort.trim() || upsertTeam.isPending
              }
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
              style={{ background: "#00d4aa", color: "#0d1117" }}
            >
              Add Team
            </button>
          </div>
        </div>
      ) : (
        <button
          data-testid="show-add-team-btn"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-white/5"
          style={{ borderColor: "#30363d", color: "#00d4aa" }}
        >
          <Plus size={16} />
          Add Team
        </button>
      )}

      {/* Player assignments */}
      {teams.length > 0 && (
        <div>
          <p
            className="mb-2 text-sm font-medium"
            style={{ color: "#e6edf3" }}
          >
            Player Assignments
          </p>
          <div className="space-y-2">
            {members.map((m) => {
              const name =
                m.user?.name ?? m.user?.email ?? `User ${m.user_id.slice(0, 6)}`;
              const assignedTeamId = assignmentByUser.get(m.user_id);
              const assignedTeam = teams.find((t) => t.id === assignedTeamId);

              return (
                <div
                  key={m.user_id}
                  data-testid={`player-row-${m.user_id}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "#161b22", border: "1px solid #30363d" }}
                >
                  <div
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={{
                      background: assignedTeam
                        ? `${assignedTeam.color}22`
                        : "#0d1117",
                      color: assignedTeam?.color ?? "#8b949e",
                    }}
                  >
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <p
                    className="min-w-0 flex-1 truncate text-sm"
                    style={{ color: "#e6edf3" }}
                  >
                    {name}
                  </p>
                  <select
                    data-testid={`assign-${m.user_id}`}
                    value={assignedTeamId ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "") {
                        if (assignedTeamId) {
                          unassignMember.mutate({
                            tripId,
                            eventId,
                            userId: m.user_id,
                          });
                        }
                      } else {
                        assignMember.mutate({
                          tripId,
                          eventId,
                          teamId: val,
                          userId: m.user_id,
                        });
                      }
                    }}
                    className="rounded-lg border px-2 py-1 text-xs outline-none"
                    style={{
                      background: "#0d1117",
                      borderColor: "#30363d",
                      color: "#e6edf3",
                    }}
                  >
                    <option value="">Unassigned</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.short_name}
                      </option>
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
        <p className="text-sm" style={{ color: "#8b949e" }}>
          No rounds yet.
        </p>
      ) : (
        <div className="space-y-2">
          {rounds.map((round) => (
            <div
              key={round.id}
              data-testid={`round-row-${round.id}`}
              className="flex items-start gap-3 rounded-xl p-3"
              style={{ background: "#161b22", border: "1px solid #30363d" }}
            >
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: "#00d4aa22", color: "#00d4aa" }}
              >
                {round.day}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                  {round.title}
                </p>
                <p className="text-xs" style={{ color: "#8b949e" }}>
                  {round.course} ·{" "}
                  {ROUND_FORMATS.find((f) => f.value === round.format)?.label ??
                    round.format}{" "}
                  · {round.points_available} pts
                </p>
              </div>
              <button
                data-testid={`remove-round-${round.id}`}
                onClick={() =>
                  removeRound.mutate({ tripId, roundId: round.id })
                }
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                style={{ color: "#8b949e" }}
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
          style={{ background: "#161b22", border: "1px solid #30363d" }}
        >
          <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
            Add Round
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Day
              </label>
              <input
                type="number"
                min={1}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Points
              </label>
              <input
                type="number"
                min={0}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                }}
              />
            </div>
          </div>
          <input
            data-testid="round-title-input"
            placeholder="Round title (e.g. Day 1 — Foursomes)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "#0d1117",
              borderColor: "#30363d",
              color: "#e6edf3",
            }}
          />
          <input
            data-testid="round-course-input"
            placeholder="Course name"
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "#0d1117",
              borderColor: "#30363d",
              color: "#e6edf3",
            }}
          />
          <div>
            <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
              Format
            </label>
            <select
              data-testid="round-format-select"
              value={format}
              onChange={(e) => setFormat(e.target.value as RoundFormat)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                background: "#0d1117",
                borderColor: "#30363d",
                color: "#e6edf3",
              }}
            >
              {ROUND_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 rounded-lg border py-2 text-sm"
              style={{ borderColor: "#30363d", color: "#8b949e" }}
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
              style={{ background: "#00d4aa", color: "#0d1117" }}
            >
              Add Round
            </button>
          </div>
        </div>
      ) : (
        <button
          data-testid="show-add-round-btn"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-white/5"
          style={{ borderColor: "#30363d", color: "#00d4aa" }}
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

  const assignedUserIds = new Set(assignments.map((a) => a.user_id));
  // Only show players who have been assigned to a team
  const assignedMembers = members.filter((m) =>
    assignedUserIds.has(m.user_id)
  );

  const teamByUserId = new Map(
    assignments.map((a) => [a.user_id, teams.find((t) => t.id === a.team_id)])
  );

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

  function togglePlayer(userId: string) {
    setSelectedPlayerIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  }

  if (assignedMembers.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm" style={{ color: "#8b949e" }}>
          Assign players to teams first before creating play groups.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {playGroups.length === 0 ? (
        <p className="text-sm" style={{ color: "#8b949e" }}>
          No play groups yet.
        </p>
      ) : (
        <div className="space-y-2">
          {playGroups.map((group) => (
            <div
              key={group.id}
              data-testid={`group-row-${group.id}`}
              className="flex items-start gap-3 rounded-xl p-3"
              style={{ background: "#161b22", border: "1px solid #30363d" }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                  {group.name}
                </p>
                <p className="mb-1.5 text-xs" style={{ color: "#8b949e" }}>
                  {group.tee_time}
                </p>
                {/* Player dots */}
                <div className="flex flex-wrap gap-1.5">
                  {group.player_ids.map((uid) => {
                    const m = members.find((x) => x.user_id === uid);
                    const name =
                      m?.user?.name ??
                      m?.user?.email ??
                      uid.slice(0, 6);
                    const team = teamByUserId.get(uid);
                    return (
                      <span
                        key={uid}
                        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                        style={{
                          background: team ? `${team.color}22` : "#0d111722",
                          color: team?.color ?? "#8b949e",
                          border: `1px solid ${team?.color ?? "#30363d"}44`,
                        }}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: team?.color ?? "#8b949e" }}
                        />
                        {name}
                      </span>
                    );
                  })}
                </div>
              </div>
              <button
                data-testid={`delete-group-${group.id}`}
                onClick={() =>
                  deleteGroup.mutate({ tripId, groupId: group.id })
                }
                disabled={deleteGroup.isPending}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                style={{ color: "#8b949e" }}
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
          style={{ background: "#161b22", border: "1px solid #30363d" }}
        >
          <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
            Add Play Group
          </p>
          <input
            data-testid="group-name-input"
            placeholder="Group name (e.g. Group 1)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "#0d1117",
              borderColor: "#30363d",
              color: "#e6edf3",
            }}
          />
          <input
            data-testid="group-tee-time-input"
            placeholder="Tee time (e.g. 8:00 AM)"
            value={newTeeTime}
            onChange={(e) => setNewTeeTime(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "#0d1117",
              borderColor: "#30363d",
              color: "#e6edf3",
            }}
          />
          {/* Player checkboxes — only team-assigned members */}
          <div>
            <label className="mb-1.5 block text-xs" style={{ color: "#8b949e" }}>
              Players
            </label>
            <div className="space-y-1.5">
              {assignedMembers.map((m) => {
                const name =
                  m.user?.name ??
                  m.user?.email ??
                  `User ${m.user_id.slice(0, 6)}`;
                const team = teamByUserId.get(m.user_id);
                const checked = selectedPlayerIds.includes(m.user_id);
                return (
                  <label
                    key={m.user_id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2"
                    style={{
                      background: checked ? "#00d4aa11" : "#0d1117",
                      border: `1px solid ${checked ? "#00d4aa44" : "#30363d"}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePlayer(m.user_id)}
                      className="accent-[#00d4aa]"
                    />
                    {team && (
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ background: team.color }}
                      />
                    )}
                    <span className="text-sm" style={{ color: "#e6edf3" }}>
                      {name}
                    </span>
                    {team && (
                      <span className="ml-auto text-xs" style={{ color: team.color }}>
                        {team.short_name}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowAdd(false);
                setNewName("");
                setNewTeeTime("");
                setSelectedPlayerIds([]);
              }}
              className="flex-1 rounded-lg border py-2 text-sm"
              style={{ borderColor: "#30363d", color: "#8b949e" }}
            >
              Cancel
            </button>
            <button
              data-testid="save-group-btn"
              disabled={
                !newName.trim() ||
                !newTeeTime.trim() ||
                selectedPlayerIds.length === 0 ||
                createGroup.isPending
              }
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
              style={{ background: "#00d4aa", color: "#0d1117" }}
            >
              Add Group
            </button>
          </div>
        </div>
      ) : (
        <button
          data-testid="show-add-group-btn"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-white/5"
          style={{ borderColor: "#30363d", color: "#00d4aa" }}
        >
          <Plus size={16} />
          Add Play Group
        </button>
      )}
    </div>
  );
}

// ── CompetitionSetupPage ──────────────────────────────────────────────────

type SetupTab = "event" | "teams" | "rounds" | "groups";

export default function CompetitionSetupPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  useTripRole(tripId);

  const [activeTab, setActiveTab] = useState<SetupTab>("event");

  const { data: event, isLoading: eventLoading } =
    trpc.events.getByTrip.useQuery({ tripId });

  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  const { data: rounds = [] } = trpc.rounds.list.useQuery(
    { tripId, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  const { data: playGroups = [] } = trpc.playGroups.list.useQuery(
    { tripId, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  if (eventLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "#0d1117" }}
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: "#00d4aa", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const TABS: { id: SetupTab; label: string; Icon: typeof Trophy }[] = [
    { id: "event", label: "Event", Icon: Trophy },
    { id: "teams", label: "Teams", Icon: Users },
    { id: "rounds", label: "Rounds", Icon: Calendar },
    { id: "groups", label: "Groups", Icon: Flag },
  ];

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "#0d1117", color: "#e6edf3" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-3 px-4"
        style={{ background: "#161b22", borderBottom: "1px solid #30363d" }}
      >
        <button
          onClick={() => router.push(`/trips/${tripId}`)}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10"
          style={{ color: "#e6edf3" }}
          aria-label="Back to trip"
        >
          <ArrowLeft size={20} />
        </button>
        <h1
          data-testid="setup-heading"
          className="flex-1 text-base font-semibold"
          style={{ color: "#e6edf3" }}
        >
          Competition Setup
        </h1>
      </header>

      {/* Tab bar */}
      <div
        className="flex border-b"
        style={{ background: "#161b22", borderColor: "#30363d" }}
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            data-testid={`setup-tab-${id}`}
            onClick={() => setActiveTab(id)}
            className="flex flex-1 items-center justify-center gap-1.5 py-3 text-sm transition-colors"
            style={{
              color: activeTab === id ? "#00d4aa" : "#8b949e",
              borderBottom: activeTab === id ? "2px solid #00d4aa" : "2px solid transparent",
            }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="flex-1 p-4">
        {activeTab === "event" && (
          <EventSection tripId={tripId} event={event ?? null} />
        )}

        {activeTab === "teams" && !event && (
          <div className="py-8 text-center">
            <p className="text-sm" style={{ color: "#8b949e" }}>
              Create an event first before adding teams.
            </p>
          </div>
        )}
        {activeTab === "teams" && event && (
          <TeamsSection
            tripId={tripId}
            eventId={event.id}
            teams={teams as Team[]}
            members={members as Member[]}
            assignments={assignments as TeamAssignment[]}
          />
        )}

        {activeTab === "rounds" && !event && (
          <div className="py-8 text-center">
            <p className="text-sm" style={{ color: "#8b949e" }}>
              Create an event first before adding rounds.
            </p>
          </div>
        )}
        {activeTab === "rounds" && event && (
          <RoundsSection
            tripId={tripId}
            eventId={event.id}
            rounds={rounds as Round[]}
          />
        )}

        {activeTab === "groups" && !event && (
          <div className="py-8 text-center">
            <p className="text-sm" style={{ color: "#8b949e" }}>
              Create an event first before adding play groups.
            </p>
          </div>
        )}
        {activeTab === "groups" && event && (
          <GroupsSection
            tripId={tripId}
            eventId={event.id}
            playGroups={playGroups as PlayGroup[]}
            members={members as Member[]}
            teams={teams as Team[]}
            assignments={assignments as TeamAssignment[]}
          />
        )}
      </main>
    </div>
  );
}
