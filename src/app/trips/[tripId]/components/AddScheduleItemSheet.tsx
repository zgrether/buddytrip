"use client";

import { useState } from "react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";

interface AddScheduleItemSheetProps {
  tripId: string;
  onClose: () => void;
}

export function AddScheduleItemSheet({ tripId, onClose }: AddScheduleItemSheetProps) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);

  const create = trpc.schedule.create.useMutation({
    onSuccess: () => {
      utils.schedule.list.invalidate({ tripId });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) return;
    create.mutate({
      tripId,
      title: title.trim(),
      detail: detail.trim() || undefined,
      scheduledDate: scheduledDate || undefined,
      scheduledTime: scheduledTime || undefined,
      isConfirmed,
    });
  };

  const inputStyle = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-t-2xl p-5 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="text-lg font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Add Schedule Item
        </h2>

        <input
          type="text"
          placeholder="Title (e.g. Dinner at The Grill)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-3 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        <textarea
          placeholder="Detail (optional)"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          className="mt-2 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        <div className="mt-2 flex gap-2">
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={inputStyle}
          />
          {scheduledDate && (
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="w-32 rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          )}
        </div>

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

        <button
          onClick={handleSubmit}
          disabled={create.isPending || !title.trim()}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {create.isPending ? "Adding..." : "Add item"}
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
