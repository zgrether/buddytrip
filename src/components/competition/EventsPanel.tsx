"use client";

import { useState, useEffect, useRef } from "react";
import {
  Calendar,
  ChevronDown,
  Flag,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

type EventType = "GOLF" | "GENERIC";
type ScoringFormat =
  | "scramble"
  | "stableford"
  | "skins"
  | "match_play"
  | "singles"
  | "sabotage"
  | "other";

interface PointDistribution {
  id?: string;
  position: number;
  label: string;
  points: number;
}

interface EventRow {
  id: string;
  competition_id: string;
  type: EventType;
  title: string;
  description: string | null;
  scoring_format: ScoringFormat | null;
  course_id: string | null;
  is_practice: boolean;
  points_available: number | null;
  day: number | null;
  status: "upcoming" | "active" | "completed";
  point_distributions?: PointDistribution[];
}

const FORMAT_LABELS: Record<ScoringFormat, string> = {
  scramble: "Scramble",
  stableford: "Stableford",
  skins: "Skins",
  match_play: "Match Play",
  singles: "Singles",
  sabotage: "Sabotage",
  other: "Other",
};

// ── EventsPanel ─────────────────────────────────────────────────────────────

export function EventsPanel({ competitionId, tripId, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const eventsTyped = events as EventRow[];
  const totalEvents = eventsTyped.length;
  const practiceCount = eventsTyped.filter((e) => e.is_practice).length;

  const statusText = totalEvents === 0
    ? "Not set up"
    : `${totalEvents} event${totalEvents === 1 ? "" : "s"}${
        practiceCount > 0 ? ` · ${practiceCount} practice` : ""
      }`;
  const headerState = totalEvents === 0 ? "todo" : "inProgress";

  return (
    <CollapsiblePanel
      icon={<Calendar size={16} />}
      label="Events"
      note={statusText}
      state={headerState}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      testId="events-panel"
    >
      <div className="space-y-3">
        {totalEvents === 0 && (
          <div
            className="rounded-xl px-4 py-5 text-center"
            style={{
              background: "var(--color-bt-surface-invitation)",
              border: "1.5px dashed var(--color-bt-border)",
            }}
          >
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              No events yet
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium"
                style={{
                  background: "transparent",
                  color: "var(--color-bt-accent)",
                  border: "1.5px dashed var(--color-bt-accent)",
                }}
              >
                <Plus size={14} />
                Add Event
              </button>
            )}
          </div>
        )}

        {eventsTyped.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            canEdit={canEdit}
            tripId={tripId}
            onEdit={() => setEditing(event)}
          />
        ))}

        {totalEvents > 0 && canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium"
            style={{
              background: "transparent",
              color: "var(--color-bt-accent)",
              border: "1.5px dashed var(--color-bt-accent)",
            }}
          >
            <Plus size={14} />
            Add Event
          </button>
        )}
      </div>

      {(creating || editing) && (
        <EventSheet
          tripId={tripId}
          competitionId={competitionId}
          event={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </CollapsiblePanel>
  );
}

// ── CollapsiblePanel (mirrors TeamsPanel's local one) ────────────────────────

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
    state === "todo" ? "var(--color-bt-text-dim)" : "var(--color-bt-accent)";
  const borderColor =
    state === "todo" ? "var(--color-bt-border)" : "var(--color-bt-accent-border)";
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
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
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

// ── EventCard ───────────────────────────────────────────────────────────────

function EventCard({
  event,
  canEdit,
  tripId,
  onEdit,
}: {
  event: EventRow;
  canEdit: boolean;
  tripId: string;
  onEdit: () => void;
}) {
  const utils = trpc.useUtils();
  const isGolf = event.type === "GOLF";

  const { data: course } = trpc.golfCourses.getById.useQuery(
    { courseId: event.course_id ?? "" },
    { enabled: isGolf && !!event.course_id }
  );

  const remove = trpc.events.delete.useMutation({
    onSettled: () => utils.events.list.invalidate(),
  });

  function handleDelete() {
    if (!confirm(`Delete "${event.title}"?`)) return;
    remove.mutate({ tripId, eventId: event.id });
  }

  const dayLabel = event.day ? `Day ${event.day}` : null;
  const courseName = course && (course as { name?: string }).name;
  const courseMissing = isGolf && !event.is_practice && !event.course_id;

  const distributions = event.point_distributions ?? [];
  const distSummary = distributions.length > 0
    ? distributions
        .slice(0, 3)
        .map((d) => `${ordinalShort(d.position)}: ${d.points}pt${d.points === 1 ? "" : "s"}`)
        .join(" · ")
    : null;

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-3 py-3"
      style={{
        background: event.is_practice
          ? "var(--color-bt-card-raised)"
          : "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
        opacity: event.is_practice ? 0.85 : 1,
      }}
      data-testid={`event-card-${event.id}`}
    >
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        {isGolf ? <Flag size={15} /> : <Star size={15} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {dayLabel ? `${dayLabel} · ${event.title}` : event.title}
          </p>
          {isGolf && event.scoring_format && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{
                background: "var(--color-bt-card)",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              {FORMAT_LABELS[event.scoring_format]}
            </span>
          )}
          {event.is_practice && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{
                background: "var(--color-bt-warning-faint)",
                color: "var(--color-bt-warning)",
              }}
            >
              Practice
            </span>
          )}
        </div>

        {isGolf && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {courseName ?? (event.is_practice ? "No course set" : "")}
          </p>
        )}

        {event.is_practice && (
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-warning)" }}>
            Excluded from points
          </p>
        )}
        {!event.is_practice && distSummary && (
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {distSummary}
            {event.points_available !== null && ` · ${event.points_available}pt total`}
          </p>
        )}
        {courseMissing && (
          <span
            className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: "var(--color-bt-warning-faint)",
              color: "var(--color-bt-warning)",
            }}
            data-testid="event-course-missing"
          >
            Course needed
          </span>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${event.title}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label={`Delete ${event.title}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-danger)" }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── EventSheet ──────────────────────────────────────────────────────────────

function EventSheet({
  tripId,
  competitionId,
  event,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  event: EventRow | null;
  onClose: () => void;
}) {
  const isEdit = !!event;
  const utils = trpc.useUtils();

  const [type, setType] = useState<EventType>(event?.type ?? "GOLF");
  const [title, setTitle] = useState(event?.title ?? "");
  const [day, setDay] = useState<string>(event?.day?.toString() ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>(
    event?.scoring_format ?? "scramble"
  );
  const [isPractice, setIsPractice] = useState(event?.is_practice ?? false);
  const [pointsAvailable, setPointsAvailable] = useState<string>(
    event?.points_available?.toString() ?? ""
  );
  const [positions, setPositions] = useState<PointDistribution[]>(
    event?.point_distributions ?? []
  );
  const [courseId, setCourseId] = useState<string | null>(event?.course_id ?? null);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.events.create.useMutation();
  const update = trpc.events.update.useMutation();
  const setDistributions = trpc.events.setPointDistributions.useMutation();

  const showCourseField = type === "GOLF" && !isPractice;
  const showPoints = !isPractice;

  async function handleSave() {
    setError(null);
    if (!title.trim()) return setError("Title is required");

    const dayValue = day.trim() ? parseInt(day, 10) : null;
    const pointsValue = pointsAvailable.trim()
      ? parseFloat(pointsAvailable)
      : null;

    try {
      let savedId: string;

      if (isEdit && event) {
        const updated = await update.mutateAsync({
          tripId,
          eventId: event.id,
          title: title.trim(),
          description: description.trim() || null,
          scoringFormat: type === "GOLF" ? scoringFormat : null,
          courseId: type === "GOLF" && !isPractice ? courseId : null,
          isPractice,
          pointsAvailable: showPoints ? pointsValue : null,
          day: dayValue,
        });
        savedId = updated.id;
      } else {
        const created = await create.mutateAsync({
          tripId,
          competitionId,
          type,
          title: title.trim(),
          description: description.trim() || undefined,
          scoringFormat: type === "GOLF" ? scoringFormat : undefined,
          courseId: type === "GOLF" && !isPractice && courseId ? courseId : undefined,
          isPractice,
          pointsAvailable: showPoints && pointsValue !== null ? pointsValue : undefined,
          day: dayValue ?? undefined,
        });
        savedId = created.id;
      }

      // Save distributions (or clear them for practice rounds)
      if (showPoints) {
        await setDistributions.mutateAsync({
          tripId,
          eventId: savedId,
          positions: positions.map((p, i) => ({
            position: p.position || i + 1,
            label: p.label,
            points: p.points,
          })),
        });
      } else if (isEdit) {
        // Clear distributions when toggling to practice
        await setDistributions.mutateAsync({
          tripId,
          eventId: savedId,
          positions: [],
        });
      }

      utils.events.list.invalidate({ tripId, competitionId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save event");
    }
  }

  const totalDistPoints = positions.reduce((sum, p) => sum + (p.points || 0), 0);
  const remainingPoints = (parseFloat(pointsAvailable) || 0) - totalDistPoints;

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
            {isEdit ? "Edit Event" : "Add Event"}
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
          {/* Type picker (create only — switching after creation is messy) */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-2">
              <TypeChip
                active={type === "GOLF"}
                onClick={() => setType("GOLF")}
                icon={<Flag size={18} />}
                label="Golf Event"
              />
              <TypeChip
                active={type === "GENERIC"}
                onClick={() => setType("GENERIC")}
                icon={<Star size={18} />}
                label="Other Event"
              />
            </div>
          )}

          <Field label="Title" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === "GOLF"
                  ? "e.g. Day 1 Scramble, Practice Round"
                  : "e.g. Poker Night, Closest to the Pin"
              }
              maxLength={200}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Day" optional helper="Used for ordering — Day 1, Day 2, etc.">
            <input
              type="number"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              min={1}
              className="w-24 rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Description" optional>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Rules, notes, or anything the group needs to know"
              maxLength={2000}
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          {type === "GOLF" && (
            <>
              <Field label="Format" required>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(FORMAT_LABELS) as ScoringFormat[]).map((f) => (
                    <Chip
                      key={f}
                      active={scoringFormat === f}
                      onClick={() => setScoringFormat(f)}
                    >
                      {FORMAT_LABELS[f]}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Toggle
                label="Practice Round"
                helper={isPractice ? "Excluded from tournament points" : undefined}
                value={isPractice}
                onChange={setIsPractice}
              />
            </>
          )}

          {showCourseField && (
            <Field label="Course">
              <CourseSearchField
                courseId={courseId}
                onSelect={setCourseId}
              />
            </Field>
          )}

          {showPoints && (
            <>
              <Field label="Total Points" required>
                <input
                  type="number"
                  min={0}
                  value={pointsAvailable}
                  onChange={(e) => setPointsAvailable(e.target.value)}
                  className="w-32 rounded-lg px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                />
              </Field>

              <Field
                label="Points Distribution"
                helper="Add finishing positions and assign points to each."
              >
                <div className="space-y-1.5">
                  {positions.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={p.label}
                        onChange={(e) => {
                          const next = [...positions];
                          next[i] = { ...next[i], label: e.target.value };
                          setPositions(next);
                        }}
                        placeholder={`${ordinalShort(i + 1)} place`}
                        className="flex-1 rounded-lg px-2 py-1.5 text-sm outline-none"
                        style={{
                          background: "var(--color-bt-card-raised)",
                          color: "var(--color-bt-text)",
                          border: "1px solid var(--color-bt-border)",
                        }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={p.points}
                        onChange={(e) => {
                          const next = [...positions];
                          next[i] = {
                            ...next[i],
                            points: parseFloat(e.target.value) || 0,
                          };
                          setPositions(next);
                        }}
                        className="w-16 rounded-lg px-2 py-1.5 text-sm outline-none"
                        style={{
                          background: "var(--color-bt-card-raised)",
                          color: "var(--color-bt-text)",
                          border: "1px solid var(--color-bt-border)",
                        }}
                      />
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        pts
                      </span>
                      <button
                        type="button"
                        onClick={() => setPositions(positions.filter((_, j) => j !== i))}
                        aria-label={`Remove position ${i + 1}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setPositions([
                        ...positions,
                        {
                          position: positions.length + 1,
                          label: `${ordinalShort(positions.length + 1)} Place`,
                          points: 0,
                        },
                      ])
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium"
                    style={{
                      background: "transparent",
                      color: "var(--color-bt-accent)",
                      border: "1.5px dashed var(--color-bt-accent)",
                    }}
                  >
                    <Plus size={12} />
                    Add Position
                  </button>
                </div>
                {pointsAvailable && (
                  <p
                    className="mt-2 text-[11px]"
                    style={{
                      color:
                        remainingPoints < 0
                          ? "var(--color-bt-danger)"
                          : "var(--color-bt-text-dim)",
                    }}
                  >
                    Points remaining: {remainingPoints}
                  </p>
                )}
              </Field>
            </>
          )}

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
            Save Event
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CourseSearchField ───────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  name: string;
  location: string;
}

function CourseSearchField({
  courseId,
  onSelect,
}: {
  courseId: string | null;
  onSelect: (courseId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualLocation, setManualLocation] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const findOrCreate = trpc.golfCourses.findOrCreate.useMutation();
  const saveDetails = trpc.golfCourses.saveDetails.useMutation();
  const { data: existingCourse } = trpc.golfCourses.getById.useQuery(
    { courseId: courseId ?? "" },
    { enabled: !!courseId }
  );

  // Debounced search
  useEffect(() => {
    if (manualMode || courseId) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/golf-courses/search?q=${encodeURIComponent(query.trim())}`
        );
        const body = (await res.json()) as SearchResult[];
        setResults(body);
        if (body.length === 0 && query.trim().length >= 4) {
          // No data & query is reasonable — likely the API key isn't set.
          setSearchUnavailable(true);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, manualMode, courseId]);

  async function handlePickResult(result: SearchResult) {
    setLoading(true);
    try {
      const detailRes = await fetch(`/api/golf-courses/${result.id}`);
      if (!detailRes.ok) throw new Error("Course detail unavailable");
      const detail = (await detailRes.json()) as {
        externalId: string;
        clubName: string;
        name: string;
        location: string;
        teeBoxes: unknown[];
        holes: unknown[];
      };

      // Use a deterministic-ish "place_id" from the external id so this
      // course shares storage with anyone else who picks the same one.
      const golfCourse = await findOrCreate.mutateAsync({
        placeId: `golfapi:${detail.externalId}`,
        name: detail.name,
        address: detail.location,
      });

      await saveDetails.mutateAsync({
        golfCourseId: golfCourse.id,
        externalId: detail.externalId,
        clubName: detail.clubName,
        holes: detail.holes,
        teeBoxes: detail.teeBoxes,
      });

      onSelect(golfCourse.id);
    } catch (err) {
      console.error(err);
      setSearchUnavailable(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleManualSave() {
    if (!manualName.trim()) return;
    const placeId = `manual:${Date.now()}`;
    const golfCourse = await findOrCreate.mutateAsync({
      placeId,
      name: manualName.trim(),
      address: manualLocation.trim() || undefined,
    });
    onSelect(golfCourse.id);
    setManualMode(false);
  }

  // Already-selected display
  if (courseId && existingCourse) {
    const c = existingCourse as { name?: string; address?: string | null };
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            {c.name}
          </p>
          {c.address && (
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {c.address}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery("");
          }}
          className="text-xs font-medium"
          style={{ color: "var(--color-bt-accent)" }}
        >
          Change
        </button>
      </div>
    );
  }

  if (manualMode || searchUnavailable) {
    return (
      <div className="space-y-2">
        {searchUnavailable && (
          <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Course search unavailable — enter details manually.
          </p>
        )}
        <input
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          placeholder="Course name"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
          }}
        />
        <input
          value={manualLocation}
          onChange={(e) => setManualLocation(e.target.value)}
          placeholder="Location / city (optional)"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
          }}
        />
        <button
          type="button"
          onClick={handleManualSave}
          disabled={!manualName.trim() || findOrCreate.isPending}
          className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          Use this course
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a golf course..."
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-text)",
          border: "1px solid var(--color-bt-border)",
        }}
      />
      {loading && (
        <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          Searching…
        </p>
      )}
      {results.length > 0 && (
        <ul
          className="max-h-48 overflow-y-auto rounded-lg"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => handlePickResult(r)}
                className="flex w-full flex-col px-3 py-2 text-left"
              >
                <span
                  className="text-sm font-semibold"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {r.name}
                </span>
                <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  {r.location}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && !loading && results.length === 0 && (
        <button
          type="button"
          onClick={() => setManualMode(true)}
          className="text-xs font-medium"
          style={{ color: "var(--color-bt-accent)" }}
        >
          Can&rsquo;t find this course? Enter manually
        </button>
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function TypeChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-xl py-3 text-xs font-semibold"
      style={
        active
          ? {
              background: "var(--color-bt-accent-faint)",
              color: "var(--color-bt-accent)",
              border: "1.5px solid var(--color-bt-accent-border)",
            }
          : {
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }
      }
    >
      {icon}
      {label}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs font-semibold"
      style={
        active
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
      {children}
    </button>
  );
}

function Toggle({
  label,
  helper,
  value,
  onChange,
}: {
  label: string;
  helper?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="flex h-5 w-9 items-center rounded-full p-0.5 transition-colors"
        style={{
          background: value ? "var(--color-bt-accent)" : "var(--color-bt-border)",
        }}
      >
        <span
          className="h-4 w-4 rounded-full transition-transform"
          style={{
            background: "var(--color-bt-base)",
            transform: value ? "translateX(16px)" : "translateX(0)",
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
          {label}
        </p>
        {helper && (
          <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {helper}
          </p>
        )}
      </div>
    </button>
  );
}

function Field({
  label,
  required,
  optional,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
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
        {required && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            required
          </span>
        )}
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

function ordinalShort(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
