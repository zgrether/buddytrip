"use client";

import { useState, useMemo } from "react";
import {
  ChevronDown,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { UserAvatar } from "@/components/UserAvatar";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
  isOwner?: boolean;
}

interface Team {
  id: string;
  name: string;
  short_name: string;
  color: string;
  color_dim: string;
}

interface Assignment {
  competition_id: string;
  user_id: string;
  team_id: string;
}

interface Member {
  user_id: string | null;
  memberId: string;
  displayName: string;
  isGuest?: boolean;
  user?: { avatar_url?: string | null } | null;
}

// ── Team color palette (intentional team identity hex per STYLE_GUIDE §7) ───
const TEAM_COLORS: Array<{ color: string; colorDim: string; label: string }> = [
  { color: "#3b82f6", colorDim: "#0a1a2a", label: "Blue" },
  { color: "#22c55e", colorDim: "#0a2a0f", label: "Green" },
  { color: "#a855f7", colorDim: "#1a0a2a", label: "Purple" },
  { color: "#06b6d4", colorDim: "#0a1f2a", label: "Cyan" },
  { color: "#ef4444", colorDim: "#2a0a0a", label: "Red" },
  { color: "#f59e0b", colorDim: "#2a1f00", label: "Amber" },
  { color: "#ec4899", colorDim: "#2a0a1a", label: "Pink" },
  { color: "#f97316", colorDim: "#2a1200", label: "Orange" },
];

// ── TeamsPanel ──────────────────────────────────────────────────────────────

export function TeamsPanel({ competitionId, tripId, canEdit, isOwner }: Props) {
  const [open, setOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const totalMembers = members.length;
  const assignedCount = assignments.length;
  const teamsExist = teams.length > 0;
  const allAssigned = teamsExist && totalMembers > 0 && assignedCount === totalMembers;

  // Status text for the closed-state header
  const statusText = !teamsExist
    ? "Not set up"
    : `${teams.length} team${teams.length === 1 ? "" : "s"} · ${assignedCount} of ${totalMembers} assigned`;

  const headerState = !teamsExist ? "todo" : allAssigned ? "done" : "inProgress";

  return (
    <CollapsiblePanel
      icon={<Users size={16} />}
      label="Teams"
      note={statusText}
      state={headerState}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      testId="teams-panel"
    >
      <div className="space-y-4">
        {!teamsExist && (
          <NoTeamsInvitation
            canEdit={canEdit}
            onAddTeam={() => setCreating(true)}
          />
        )}

        {teamsExist && (
          <>
            <div className="space-y-2">
              {(teams as Team[]).map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  members={members as Member[]}
                  assignments={assignments as Assignment[]}
                  canEdit={canEdit}
                  isOwner={!!isOwner}
                  onEdit={() => setEditingTeam(team)}
                  tripId={tripId}
                />
              ))}
            </div>

            {canEdit && (
              <DashedAddButton onClick={() => setCreating(true)} label="Add Team" />
            )}

            <AssignMembersSection
              tripId={tripId}
              competitionId={competitionId}
              members={members as Member[]}
              teams={teams as Team[]}
              assignments={assignments as Assignment[]}
              canEdit={canEdit}
            />
          </>
        )}
      </div>

      {(creating || editingTeam) && (
        <TeamSheet
          tripId={tripId}
          competitionId={competitionId}
          team={editingTeam}
          onClose={() => {
            setCreating(false);
            setEditingTeam(null);
          }}
        />
      )}
    </CollapsiblePanel>
  );
}

// ── CollapsiblePanel (matches PlanningRow visual specs) ─────────────────────

function CollapsiblePanel({
  icon,
  label,
  note,
  state,
  open,
  onToggle,
  testId,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  state: "done" | "inProgress" | "todo";
  open: boolean;
  onToggle: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  const labelColor =
    state === "done"
      ? "var(--color-bt-accent)"
      : state === "inProgress"
      ? "var(--color-bt-accent)"
      : "var(--color-bt-text-dim)";
  const borderColor =
    state === "done"
      ? "var(--color-bt-accent-border)"
      : state === "inProgress"
      ? "var(--color-bt-accent-border)"
      : "var(--color-bt-border)";
  const bg = state === "done" ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)";

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        boxShadow: "var(--shadow-raised)",
      }}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span style={{ color: labelColor }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold leading-tight"
            style={{ color: labelColor }}
          >
            {label}
          </p>
          <p
            className="mt-0.5 text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {note}
          </p>
        </div>
        <ChevronDown
          size={15}
          style={{
            color: "var(--color-bt-text-dim)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms",
          }}
        />
      </button>
      {open && (
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

// ── NoTeamsInvitation ───────────────────────────────────────────────────────

function NoTeamsInvitation({
  canEdit,
  onAddTeam,
}: {
  canEdit: boolean;
  onAddTeam: () => void;
}) {
  return (
    <div
      className="rounded-xl px-4 py-5 text-center"
      style={{
        background: "var(--color-bt-surface-invitation)",
        border: "1.5px dashed var(--color-bt-border)",
      }}
    >
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        No teams yet
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onAddTeam}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium"
          style={{
            background: "transparent",
            color: "var(--color-bt-accent)",
            border: "1.5px dashed var(--color-bt-accent)",
          }}
        >
          <Plus size={14} />
          Add Team
        </button>
      )}
    </div>
  );
}

// ── DashedAddButton ─────────────────────────────────────────────────────────

function DashedAddButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium"
      style={{
        background: "transparent",
        color: "var(--color-bt-accent)",
        border: "1.5px dashed var(--color-bt-accent)",
      }}
    >
      <Plus size={14} />
      {label}
    </button>
  );
}

// ── TeamCard ────────────────────────────────────────────────────────────────

function TeamCard({
  team,
  members,
  assignments,
  canEdit,
  isOwner,
  onEdit,
  tripId,
}: {
  team: Team;
  members: Member[];
  assignments: Assignment[];
  canEdit: boolean;
  isOwner: boolean;
  onEdit: () => void;
  tripId: string;
}) {
  const utils = trpc.useUtils();
  const teamMemberIds = assignments
    .filter((a) => a.team_id === team.id)
    .map((a) => a.user_id);
  const teamMembers = members.filter((m) =>
    teamMemberIds.includes(m.user_id ?? m.memberId)
  );

  const deleteTeam = trpc.teams.delete.useMutation({
    onSettled: () => {
      utils.teams.list.invalidate();
      utils.teamAssignments.list.invalidate();
    },
  });

  function handleDelete() {
    if (!confirm(`Delete team "${team.name}"? This will unassign its members.`)) return;
    deleteTeam.mutate({ tripId, teamId: team.id });
  }

  const visible = teamMembers.slice(0, 5);
  const overflow = Math.max(0, teamMembers.length - 5);

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid={`team-card-${team.id}`}
    >
      <span
        className="h-6 w-6 flex-shrink-0 rounded-full"
        style={{ background: team.color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className="truncate text-sm font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            {team.name}
          </p>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold"
            style={{
              background: "var(--color-bt-card)",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            {team.short_name}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {visible.map((m) => (
            <UserAvatar
              key={m.memberId}
              name={m.displayName}
              avatarUrl={m.user?.avatar_url ?? null}
              size="sm"
            />
          ))}
          {overflow > 0 && (
            <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
              +{overflow}
            </span>
          )}
          <span className="ml-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {teamMembers.length} member{teamMembers.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${team.name}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <Pencil size={13} />
        </button>
      )}
      {isOwner && (
        <button
          type="button"
          onClick={handleDelete}
          aria-label={`Delete ${team.name}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ color: "var(--color-bt-danger)" }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

// ── AssignMembersSection ────────────────────────────────────────────────────

function AssignMembersSection({
  tripId,
  competitionId,
  members,
  teams,
  assignments,
  canEdit,
}: {
  tripId: string;
  competitionId: string;
  members: Member[];
  teams: Team[];
  assignments: Assignment[];
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();

  const assignmentByUser = useMemo(() => {
    const map = new Map<string, string>(); // userId → teamId
    for (const a of assignments) map.set(a.user_id, a.team_id);
    return map;
  }, [assignments]);

  const assign = trpc.teamAssignments.assign.useMutation({
    onSettled: () => utils.teamAssignments.list.invalidate(),
  });

  function handleSelect(userId: string, value: string) {
    if (!value) return;
    assign.mutate({ tripId, competitionId, userId, teamId: value });
  }

  return (
    <div>
      <p
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Assign Members
      </p>
      <div className="space-y-1.5">
        {members.map((m) => {
          const userId = m.user_id ?? m.memberId;
          const currentTeam = assignmentByUser.get(userId) ?? "";
          return (
            <div
              key={userId}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <UserAvatar
                name={m.displayName}
                avatarUrl={m.user?.avatar_url ?? null}
                size="sm"
              />
              <span
                className="flex-1 truncate text-sm"
                style={{ color: "var(--color-bt-text)" }}
              >
                {m.displayName}
              </span>
              <select
                value={currentTeam}
                onChange={(e) => handleSelect(userId, e.target.value)}
                disabled={!canEdit}
                className="rounded-md px-2 py-1 text-xs"
                style={{
                  background: "var(--color-bt-card)",
                  color: currentTeam ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
                  border: "1px solid var(--color-bt-border)",
                }}
                aria-label={`Team for ${m.displayName}`}
              >
                <option value="">Unassigned</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TeamSheet (create + edit) ───────────────────────────────────────────────

function TeamSheet({
  tripId,
  competitionId,
  team,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  team: Team | null;
  onClose: () => void;
}) {
  const isEdit = !!team;
  const utils = trpc.useUtils();

  const [name, setName] = useState(team?.name ?? "");
  const [shortName, setShortName] = useState(team?.short_name ?? "");
  const [paletteIdx, setPaletteIdx] = useState(() => {
    if (!team) return 0;
    const idx = TEAM_COLORS.findIndex((c) => c.color === team.color);
    return idx >= 0 ? idx : 0;
  });
  const [error, setError] = useState<string | null>(null);

  const create = trpc.teams.create.useMutation({
    onSettled: () => utils.teams.list.invalidate(),
  });
  const update = trpc.teams.update.useMutation({
    onSettled: () => utils.teams.list.invalidate(),
  });

  async function handleSave() {
    setError(null);
    const trimmed = name.trim();
    const sn = shortName.trim().toUpperCase();
    if (!trimmed) return setError("Team name is required");
    if (!sn) return setError("Short name is required");
    if (sn.length > 4) return setError("Short name must be 4 characters or fewer");

    const palette = TEAM_COLORS[paletteIdx];
    try {
      if (isEdit && team) {
        await update.mutateAsync({
          tripId,
          teamId: team.id,
          name: trimmed,
          shortName: sn,
          color: palette.color,
          colorDim: palette.colorDim,
        });
      } else {
        await create.mutateAsync({
          tripId,
          competitionId,
          name: trimmed,
          shortName: sn,
          color: palette.color,
          colorDim: palette.colorDim,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save team");
    }
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
            {isEdit ? "Edit Team" : "Add Team"}
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
          <Field label="Team Name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Team Hammer"
              maxLength={100}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Short Name" required helper="Used on scorecards — e.g. USA, EUR, FIRE">
            <input
              value={shortName}
              onChange={(e) => setShortName(e.target.value.toUpperCase())}
              placeholder="HAM"
              maxLength={4}
              className="w-full rounded-lg px-3 py-2 text-sm uppercase outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {TEAM_COLORS.map((c, i) => (
                <button
                  key={c.color}
                  type="button"
                  onClick={() => setPaletteIdx(i)}
                  aria-label={`${c.label}${paletteIdx === i ? " (selected)" : ""}`}
                  className="h-8 w-8 rounded-full transition-transform"
                  style={{
                    background: c.color,
                    transform: paletteIdx === i ? "scale(1.15)" : "scale(1)",
                    border:
                      paletteIdx === i
                        ? "2px solid var(--color-bt-text)"
                        : "1px solid var(--color-bt-border)",
                  }}
                />
              ))}
            </div>
          </Field>

          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={create.isPending || update.isPending}
            className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Save Team
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
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
        {required && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            required
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
