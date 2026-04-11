"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";

interface AddScheduleItemSheetProps {
  tripId: string;
  itemType: "general" | "golf";
  onClose: () => void;
}

export function AddScheduleItemSheet({ tripId, itemType, onClose }: AddScheduleItemSheetProps) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);

  // Golf fields
  const [courseName, setCourseName] = useState("");
  const [courseLocation, setCourseLocation] = useState("");
  const [teeTimes, setTeeTimes] = useState<string[]>([""]);

  const create = trpc.schedule.create.useMutation({
    onSuccess: () => {
      utils.schedule.list.invalidate({ tripId });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) return;

    const filteredTeeTimes = teeTimes.filter((t) => t.trim());

    create.mutate({
      tripId,
      itemType,
      title: title.trim(),
      detail: detail.trim() || undefined,
      scheduledDate: scheduledDate || undefined,
      scheduledTime: itemType === "general" && scheduledTime ? scheduledTime : undefined,
      isConfirmed: scheduledDate ? isConfirmed : false,
      // Golf
      courseName: itemType === "golf" && courseName.trim() ? courseName.trim() : undefined,
      courseLocation: itemType === "golf" && courseLocation.trim() ? courseLocation.trim() : undefined,
      teeTimes: itemType === "golf" && filteredTeeTimes.length > 0 ? filteredTeeTimes : undefined,
    });
  };

  const addTeeTime = () => setTeeTimes((prev) => [...prev, ""]);
  const removeTeeTime = (idx: number) =>
    setTeeTimes((prev) => prev.filter((_, i) => i !== idx));
  const updateTeeTime = (idx: number, val: string) =>
    setTeeTimes((prev) => prev.map((t, i) => (i === idx ? val : t)));

  const inputStyle = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  const isGolf = itemType === "golf";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl p-5 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="text-lg font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {isGolf ? "Add Golf Round" : "Add Schedule Item"}
        </h2>

        {/* Title */}
        <input
          type="text"
          placeholder={isGolf ? "Title (e.g. Day 1 — Morning Round)" : "Title (e.g. Dinner at The Grill)"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-3 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        {/* Golf: course name + location */}
        {isGolf && (
          <>
            <input
              type="text"
              placeholder="Golf course name"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Course address or location (for GPS link)"
              value={courseLocation}
              onChange={(e) => setCourseLocation(e.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />

            {/* Tee times */}
            <p
              className="mt-3 mb-1.5 text-xs font-medium"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Tee times
            </p>
            <div className="space-y-1.5">
              {teeTimes.map((t, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={t}
                    onChange={(e) => updateTeeTime(idx, e.target.value)}
                    className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
                    style={inputStyle}
                  />
                  {teeTimes.length > 1 && (
                    <button
                      onClick={() => removeTeeTime(idx)}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
                      style={{ color: "var(--color-bt-text-dim)" }}
                      aria-label="Remove tee time"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addTeeTime}
              className="mt-1.5 flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-80"
              style={{ color: "var(--color-bt-accent)" }}
            >
              <Plus size={12} />
              Add tee time
            </button>
          </>
        )}

        {/* General: detail */}
        {!isGolf && (
          <textarea
            placeholder="Detail (optional)"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
            className="mt-2 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={inputStyle}
          />
        )}

        {/* Date + time */}
        <div className="mt-2 flex gap-2">
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={inputStyle}
          />
          {!isGolf && scheduledDate && (
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="w-32 rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          )}
        </div>

        {/* Confirmed checkbox — only when date is set */}
        {scheduledDate && (
          <label className="mt-3 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isConfirmed}
              onChange={(e) => setIsConfirmed(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
              Confirmed
            </span>
          </label>
        )}

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={create.isPending || !title.trim()}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {create.isPending ? "Adding..." : isGolf ? "Add golf round" : "Add item"}
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
