"use client";

import { useState, useMemo } from "react";
import {
  ChevronDown,
  LayoutGrid,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { UserAvatar } from "@/components/UserAvatar";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

interface EventRow {
  id: string;
  type: "GOLF" | "GENERIC";
  title: string;
  day: number | null;
  is_practice: boolean;
}

interface PlayGroup {
  id: string;
  event_id: string;
  name: string | null;
  tee_time: string | null;
  player_ids: string[];
}

interface Member {
  user_id: string | null;
  memberId: string;
  displayName: string;
  user?: { avatar_url?: string | null } | null;
}

interface Team {
  id: string;
  name: string;
  color: string;
}

interface Assignment {
  user_id: string;
  team_id: string;
}

// ── GroupsPanel ─────────────────────────────────────────────────────────────

export function GroupsPanel({ competitionId, tripId, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<PlayGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);

  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const golfEvents = (events as EventRow[])
    .filter((e) => e.type === "GOLF")
    .sort((a, b) => (a.day ?? 99) - (b.day ?? 99));

  // Initialize selected event when data loads
  const selectedEventId = activeEventId ?? golfEvents[0]?.id ?? null;

  return (
    <CollapsiblePanel
      icon={<LayoutGrid size={16} />}
      label="Groups"
      note={summarizeStatus(golfEvents.length)}
      state={golfEvents.length === 0 ? "todo" : "inProgress"}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      locked={golfEvents.length === 0}
      lockedNote="Add golf events first"
      testId="groups-panel"
    >
      {golfEvents.length > 0 && (
        <div className="space-y-3">
          {/* Event selector tabs */}
          <div className="flex flex-wrap gap-1.5">
            {golfEvents.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setActiveEventId(e.id)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
                style={
                  selectedEventId === e.id
                    ? {
                        background: "var(--color-bt-accent)",
                        color: "var(--color-bt-base)",
                      }
                    : {
                        background: "var(--color-bt-card-raised)",
                        color: "var(--color-bt-text)",
                        border: "1px solid var(--color-bt-border)",
                      }
                }
              >
                {e.day ? `Day ${e.day}` : e.title}
              </button>
            ))}
          </div>

          {selectedEventId && (
            <EventGroups
              tripId={tripId}
              competitionId={competitionId}
              eventId={selectedEventId}
              canEdit={canEdit}
              onAddGroup={() => setCreating(true)}
              onEditGroup={setEditingGroup}
              onAutoGenerate={() => setAutoOpen(true)}
            />
          )}
        </div>
      )}

      {(creating || editingGroup) && selectedEventId && (
        <GroupSheet
          tripId={tripId}
          competitionId={competitionId}
          eventId={selectedEventId}
          group={editingGroup}
          onClose={() => {
            setCreating(false);
            setEditingGroup(null);
          }}
        />
      )}

      {autoOpen && selectedEventId && (
        <AutoGenerateSheet
          tripId={tripId}
          competitionId={competitionId}
          eventId={selectedEventId}
          onClose={() => setAutoOpen(false)}
        />
      )}
    </CollapsiblePanel>
  );
}

// ── EventGroups (the per-event view inside the panel) ───────────────────────

function EventGroups({
  tripId,
  competitionId,
  eventId,
  canEdit,
  onAddGroup,
  onEditGroup,
  onAutoGenerate,
}: {
  tripId: string;
  competitionId: string;
  eventId: string;
  canEdit: boolean;
  onAddGroup: () => void;
  onEditGroup: (g: PlayGroup) => void;
  onAutoGenerate: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: groups = [] } = trpc.playGroups.list.useQuery({ tripId, eventId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: teams = [] } = trpc.teams.list.useQuery({ tripId, competitionId });
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery({
    tripId,
    competitionId,
  });

  const remove = trpc.playGroups.delete.useMutation({
    onSettled: () => utils.playGroups.list.invalidate(),
  });

  if (groups.length === 0) {
    return (
      <div
        className="rounded-xl px-4 py-5 text-center"
        style={{
          background: "var(--color-bt-surface-invitation)",
          border: "1.5px dashed var(--color-bt-border)",
        }}
      >
        <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Groups not set for this event
        </p>
        {canEdit && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={onAutoGenerate}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
              }}
            >
              <Sparkles size={14} />
              Auto-Generate Groups
            </button>
            <button
              type="button"
              onClick={onAddGroup}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "0.5px solid var(--color-bt-border)",
              }}
            >
              <Plus size={14} />
              Add Group Manually
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {(groups as PlayGroup[]).map((g, i) => (
          <GroupCard
            key={g.id}
            group={g}
            index={i + 1}
            members={members as Member[]}
            teams={teams as Team[]}
            assignments={assignments as Assignment[]}
            canEdit={canEdit}
            onEdit={() => onEditGroup(g)}
            onDelete={() => {
              if (!confirm(`Delete ${g.name ?? `Group ${i + 1}`}?`)) return;
              remove.mutate({ tripId, groupId: g.id });
            }}
          />
        ))}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onAddGroup}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium"
          style={{
            background: "transparent",
            color: "var(--color-bt-accent)",
            border: "1.5px dashed var(--color-bt-accent)",
          }}
        >
          <Plus size={14} />
          Add Group
        </button>
      )}
    </>
  );
}

// ── GroupCard ───────────────────────────────────────────────────────────────

function GroupCard({
  group,
  index,
  members,
  teams,
  assignments,
  canEdit,
  onEdit,
  onDelete,
}: {
  group: PlayGroup;
  index: number;
  members: Member[];
  teams: Team[];
  assignments: Assignment[];
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const teamColorByUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignments) {
      const team = teams.find((t) => t.id === a.team_id);
      if (team) map.set(a.user_id, team.color);
    }
    return map;
  }, [assignments, teams]);

  const groupMembers = group.player_ids
    .map((id) => members.find((m) => (m.user_id ?? m.memberId) === id))
    .filter((m): m is Member => !!m);

  const displayName = group.name ?? `Group ${index}`;

  return (
    <div
      className="rounded-xl px-3 py-3"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid={`play-group-${group.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {displayName}
            </p>
            {group.tee_time && (
              <span
                className="text-xs"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                · {group.tee_time}
              </span>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-shrink-0 gap-1">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${displayName}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${displayName}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ color: "var(--color-bt-danger)" }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        {groupMembers.map((m) => {
          const id = m.user_id ?? m.memberId;
          const color = teamColorByUser.get(id);
          return (
            <div key={id} className="flex flex-col items-center gap-1">
              <div className="relative">
                <UserAvatar
                  name={m.displayName}
                  avatarUrl={m.user?.avatar_url ?? null}
                  size="md"
                />
                {color && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full"
                    style={{
                      background: color,
                      border: "2px solid var(--color-bt-card-raised)",
                    }}
                  />
                )}
              </div>
              <span
                className="text-[10px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {m.displayName.split(" ")[0]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── GroupSheet (create + edit) ──────────────────────────────────────────────

function GroupSheet({
  tripId,
  competitionId,
  eventId,
  group,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  eventId: string;
  group: PlayGroup | null;
  onClose: () => void;
}) {
  const isEdit = !!group;
  const utils = trpc.useUtils();

  const [name, setName] = useState(group?.name ?? "");
  const [teeTime, setTeeTime] = useState(group?.tee_time ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(group?.player_ids ?? [])
  );
  const [error, setError] = useState<string | null>(null);

  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: groups = [] } = trpc.playGroups.list.useQuery({ tripId, eventId });
  const { data: teams = [] } = trpc.teams.list.useQuery({ tripId, competitionId });
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery({
    tripId,
    competitionId,
  });

  const create = trpc.playGroups.create.useMutation({
    onSettled: () => utils.playGroups.list.invalidate(),
  });
  const update = trpc.playGroups.update.useMutation({
    onSettled: () => utils.playGroups.list.invalidate(),
  });

  const teamColorByUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignments as Assignment[]) {
      const team = (teams as Team[]).find((t) => t.id === a.team_id);
      if (team) map.set(a.user_id, team.color);
    }
    return map;
  }, [assignments, teams]);

  // Members who are already in another group for this event
  const usersInOtherGroups = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups as PlayGroup[]) {
      if (g.id === group?.id) continue;
      g.player_ids.forEach((id) => set.add(id));
    }
    return set;
  }, [groups, group?.id]);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    try {
      if (isEdit && group) {
        await update.mutateAsync({
          tripId,
          groupId: group.id,
          name: name.trim() || null,
          teeTime: teeTime.trim() || null,
          playerIds: Array.from(selected),
        });
      } else {
        await create.mutateAsync({
          tripId,
          eventId,
          name: name.trim() || undefined,
          teeTime: teeTime.trim() || undefined,
          playerIds: Array.from(selected),
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save group");
    }
  }

  const overlapWarning = Array.from(selected).some((id) => usersInOtherGroups.has(id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            {isEdit ? "Edit Group" : "Add Group"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <Field label="Name" optional helper={`Defaults to "Group N" if blank`}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group 1"
              maxLength={100}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Tee Time" optional>
            <input
              value={teeTime}
              onChange={(e) => setTeeTime(e.target.value)}
              placeholder="8:00 AM"
              maxLength={40}
              className="w-32 rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Members">
            <div className="space-y-1.5">
              {(members as Member[]).map((m) => {
                const id = m.user_id ?? m.memberId;
                const checked = selected.has(id);
                const inOther = usersInOtherGroups.has(id);
                const color = teamColorByUser.get(id);
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(id)}
                      className="h-4 w-4"
                    />
                    <UserAvatar
                      name={m.displayName}
                      avatarUrl={m.user?.avatar_url ?? null}
                      size="sm"
                    />
                    <span
                      className="flex-1 text-sm"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {m.displayName}
                    </span>
                    {color && (
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: color }}
                        aria-hidden
                      />
                    )}
                    {inOther && checked && (
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--color-bt-warning)" }}
                      >
                        already in another
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {overlapWarning && (
              <p className="mt-2 text-[11px]" style={{ color: "var(--color-bt-warning)" }}>
                Heads up: some selected members are already in another group for this event.
              </p>
            )}
          </Field>

          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="border-t p-4"
          style={{ borderColor: "var(--color-bt-border)" }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={create.isPending || update.isPending}
            className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            Save Group
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AutoGenerateSheet ───────────────────────────────────────────────────────

type Arrangement = "random" | "by-team" | "mixed";

function AutoGenerateSheet({
  tripId,
  competitionId,
  eventId,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  eventId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [groupSize, setGroupSize] = useState(4);
  const [arrangement, setArrangement] = useState<Arrangement>("random");

  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: teams = [] } = trpc.teams.list.useQuery({ tripId, competitionId });
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery({
    tripId,
    competitionId,
  });

  const create = trpc.playGroups.create.useMutation();

  const memberIds = (members as Member[]).map((m) => m.user_id ?? m.memberId);
  const teamCount = Math.ceil(memberIds.length / groupSize);
  const remainder = memberIds.length % groupSize;

  function generateGroups(): string[][] {
    const ids = [...memberIds];

    if (arrangement === "random") {
      shuffle(ids);
      return chunk(ids, groupSize);
    }

    if (arrangement === "by-team") {
      // Group by team, then chunk each team's members
      const teamBuckets: Record<string, string[]> = { _unassigned: [] };
      for (const m of memberIds) {
        const a = (assignments as Assignment[]).find((x) => x.user_id === m);
        if (a) (teamBuckets[a.team_id] = teamBuckets[a.team_id] ?? []).push(m);
        else teamBuckets._unassigned.push(m);
      }
      const result: string[][] = [];
      for (const bucket of Object.values(teamBuckets)) {
        shuffle(bucket);
        result.push(...chunk(bucket, groupSize));
      }
      return result;
    }

    // mixed — round-robin members across groups, by team rotation
    const teamBuckets: string[][] = (teams as Team[]).map((t) =>
      (assignments as Assignment[])
        .filter((a) => a.team_id === t.id)
        .map((a) => a.user_id)
    );
    const unassigned = memberIds.filter(
      (id) => !(assignments as Assignment[]).some((a) => a.user_id === id)
    );
    teamBuckets.forEach(shuffle);
    shuffle(unassigned);

    const groupCount = Math.ceil(memberIds.length / groupSize);
    const out: string[][] = Array.from({ length: groupCount }, () => []);
    let cursor = 0;
    for (const bucket of teamBuckets) {
      for (const id of bucket) {
        out[cursor].push(id);
        cursor = (cursor + 1) % groupCount;
      }
    }
    for (const id of unassigned) {
      out[cursor].push(id);
      cursor = (cursor + 1) % groupCount;
    }
    return out.filter((g) => g.length > 0);
  }

  async function handleGenerate() {
    const groups = generateGroups();
    await Promise.all(
      groups.map((playerIds, i) =>
        create.mutateAsync({
          tripId,
          eventId,
          name: `Group ${i + 1}`,
          playerIds,
        })
      )
    );
    utils.playGroups.list.invalidate();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            Auto-Generate Groups
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <Field label="Group Size">
            <div className="flex gap-1.5">
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setGroupSize(n)}
                  className="flex-1 rounded-lg py-2 text-sm font-semibold"
                  style={
                    groupSize === n
                      ? {
                          background: "var(--color-bt-accent)",
                          color: "var(--color-bt-base)",
                        }
                      : {
                          background: "var(--color-bt-card-raised)",
                          color: "var(--color-bt-text)",
                          border: "1px solid var(--color-bt-border)",
                        }
                  }
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {memberIds.length} members →{" "}
              {remainder === 0
                ? `${teamCount} groups of ${groupSize}`
                : `${teamCount - 1} groups of ${groupSize}, 1 group of ${remainder}`}
            </p>
          </Field>

          <Field label="Arrangement">
            <div className="space-y-1.5">
              {(
                [
                  { id: "random", label: "Random", helper: "Shuffle every member" },
                  { id: "by-team", label: "By team", helper: "Keep teammates together" },
                  {
                    id: "mixed",
                    label: "Mixed",
                    helper: "One member from each team per group",
                  },
                ] as Array<{ id: Arrangement; label: string; helper: string }>
              ).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setArrangement(a.id)}
                  className="w-full rounded-lg px-3 py-2 text-left"
                  style={
                    arrangement === a.id
                      ? {
                          background: "var(--color-bt-accent-faint)",
                          border: "1.5px solid var(--color-bt-accent-border)",
                        }
                      : {
                          background: "var(--color-bt-card-raised)",
                          border: "1px solid var(--color-bt-border)",
                        }
                  }
                >
                  <p
                    className="text-sm font-medium"
                    style={{
                      color:
                        arrangement === a.id
                          ? "var(--color-bt-accent)"
                          : "var(--color-bt-text)",
                    }}
                  >
                    {a.label}
                  </p>
                  <p
                    className="text-[11px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    {a.helper}
                  </p>
                </button>
              ))}
            </div>
          </Field>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={create.isPending || memberIds.length === 0}
            className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            <Sparkles className="mr-1.5 inline" size={14} />
            Generate Groups
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function summarizeStatus(golfEventCount: number): string {
  if (golfEventCount === 0) return "No golf events yet";
  return `${golfEventCount} golf event${golfEventCount === 1 ? "" : "s"}`;
}

// ── CollapsiblePanel (locked variant) ───────────────────────────────────────

function CollapsiblePanel({
  icon,
  label,
  note,
  state,
  open,
  onToggle,
  testId,
  locked,
  lockedNote,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  state: "done" | "inProgress" | "todo";
  open: boolean;
  onToggle: () => void;
  testId?: string;
  locked?: boolean;
  lockedNote?: string;
  children: React.ReactNode;
}) {
  const labelColor =
    locked || state === "todo"
      ? "var(--color-bt-text-dim)"
      : "var(--color-bt-accent)";
  const borderColor =
    locked || state === "todo"
      ? "var(--color-bt-border)"
      : "var(--color-bt-accent-border)";
  const bg = state === "done" ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)";

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        boxShadow: "var(--shadow-raised)",
        opacity: locked ? 0.7 : 1,
      }}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={locked ? undefined : onToggle}
        disabled={locked}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left disabled:cursor-not-allowed"
      >
        <span style={{ color: labelColor }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold leading-tight"
            style={{ color: labelColor }}
          >
            {label}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {locked ? lockedNote ?? note : note}
          </p>
        </div>
        {!locked && (
          <ChevronDown
            size={15}
            style={{
              color: "var(--color-bt-text-dim)",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 200ms",
            }}
          />
        )}
      </button>
      {open && !locked && (
        <div
          className="px-4 pb-4 pt-3"
          style={{ borderTop: `1px solid ${borderColor}` }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ── Field ───────────────────────────────────────────────────────────────────

function Field({
  label,
  optional,
  helper,
  children,
}: {
  label: string;
  optional?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <label
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {label}
        </label>
        {optional && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            optional
          </span>
        )}
      </div>
      {children}
      {helper && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {helper}
        </p>
      )}
    </div>
  );
}
