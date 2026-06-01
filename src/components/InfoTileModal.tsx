"use client";

import { useState, type FC } from "react";
import {
  Lock,
  Wifi,
  DoorOpen,
  KeyRound,
  Hash,
  Car,
  Bell,
  AlertTriangle,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import type { LucideIcon } from "lucide-react";

// ── Shared types + icon map ───────────────────────────────────────────────

/** Tile shape the modal sees — kept minimal so we can re-import from the
 *  dock without dragging server types around. Matches the columns selected
 *  by `quickInfoTiles.list`. */
export interface QuickTile {
  id: string;
  label: string;
  value: string;
  icon?: string | null;
  is_alert?: boolean | null;
  sort_order?: number | null;
}

/** The fixed glyph set surfaced in the icon picker. Spec calls for ~6 in a
 *  single row — keep this list short and let the label-inference path in the
 *  dock handle everything else. */
const PICKER_ICONS: Array<{ key: string; Icon: LucideIcon; label: string }> = [
  { key: "lock", Icon: Lock, label: "Lock" },
  { key: "wifi", Icon: Wifi, label: "Wi-Fi" },
  { key: "door", Icon: DoorOpen, label: "Door" },
  { key: "key", Icon: KeyRound, label: "Key" },
  { key: "hash", Icon: Hash, label: "Code" },
  { key: "car", Icon: Car, label: "Car" },
];

/** Resolve a picker key (or null) into a renderable glyph component. */
function iconFor(key: string | null | undefined): LucideIcon {
  return PICKER_ICONS.find((p) => p.key === key)?.Icon ?? Hash;
}

// ── Live preview chip ─────────────────────────────────────────────────────
//
// Renders the actual tile-as-it-will-look on a navy → teal gradient strip,
// so the owner sees the result before saving. Mirrors the chip style used by
// TripHeaderDock so what the modal previews is what the dock will render.

const PreviewChip: FC<{
  label: string;
  value: string;
  iconKey: string | null;
  isAlert: boolean;
}> = ({ label, value, iconKey, isAlert }) => {
  const Glyph = isAlert ? Bell : iconFor(iconKey);
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background:
          "linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(13,31,26,0.92) 65%, rgba(20,184,166,0.55) 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.10), 0 6px 18px rgba(0,0,0,0.30)",
      }}
    >
      <div className="flex justify-center">
        <span
          className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5"
          style={{
            background: isAlert
              ? "rgba(251,191,36,0.12)"
              : "rgba(255,255,255,0.06)",
            border: `1px solid ${isAlert ? "rgba(251,191,36,0.40)" : "rgba(255,255,255,0.10)"}`,
            color: "#ffffff",
          }}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{
              background: isAlert
                ? "rgba(251,191,36,0.18)"
                : "var(--color-bt-accent-faint)",
              color: isAlert ? "#fbbf24" : "var(--color-bt-accent)",
            }}
          >
            <Glyph size={13} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <span className="flex flex-col leading-tight">
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.10em]"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              {label.trim() || "Label"}
            </span>
            <span
              className="font-mono text-[13px]"
              style={{ color: "#ffffff" }}
            >
              {value.trim() || "value"}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
};

// ── Field label ───────────────────────────────────────────────────────────

const FieldLabel: FC<{ children: React.ReactNode }> = ({ children }) => (
  <p
    className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
    style={{ color: "var(--color-bt-text-dim)" }}
  >
    {children}
  </p>
);

// ── Icon picker row ───────────────────────────────────────────────────────
//
// One row of selectable glyphs. Selected = teal. Kept to 6 buttons so the
// row never wraps at the modal's 380px width.

const IconPicker: FC<{
  value: string | null;
  onChange: (next: string) => void;
}> = ({ value, onChange }) => {
  return (
    <div className="flex items-center justify-between gap-2">
      {PICKER_ICONS.map(({ key, Icon, label }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            aria-label={label}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-all"
            style={{
              background: active
                ? "var(--color-bt-accent-faint)"
                : "var(--color-bt-card-raised)",
              border: `1px solid ${
                active
                  ? "var(--color-bt-accent-border)"
                  : "var(--color-bt-border)"
              }`,
              color: active
                ? "var(--color-bt-accent)"
                : "var(--color-bt-text-dim)",
            }}
          >
            <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};

// ── Alert toggle row ──────────────────────────────────────────────────────
//
// Whole row turns amber when on, signaling that the tile will sort to the
// front of the dock and render in amber.

const AlertToggleRow: FC<{
  value: boolean;
  onChange: (next: boolean) => void;
}> = ({ value, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors"
    style={{
      borderColor: value
        ? "var(--color-bt-warning-border)"
        : "var(--color-bt-border)",
      background: value
        ? "var(--color-bt-warning-faint)"
        : "var(--color-bt-card-raised)",
    }}
  >
    <span className="flex items-center gap-2.5">
      <AlertTriangle
        size={15}
        style={{
          color: value
            ? "var(--color-bt-warning)"
            : "var(--color-bt-text-dim)",
        }}
      />
      <span className="flex flex-col leading-tight">
        <span
          className="text-sm font-semibold"
          style={{
            color: value ? "var(--color-bt-warning)" : "var(--color-bt-text)",
          }}
        >
          Mark as crew alert
        </span>
        <span
          className="text-[11px]"
          style={{
            color: value
              ? "var(--color-bt-warning)"
              : "var(--color-bt-text-dim)",
            opacity: value ? 0.85 : 1,
          }}
        >
          Turns amber and sorts to the front.
        </span>
      </span>
    </span>
    <span
      className="inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition-colors"
      style={{
        background: value
          ? "var(--color-bt-warning)"
          : "var(--color-bt-border)",
      }}
    >
      <span
        className="h-4 w-4 rounded-full transition-transform"
        style={{
          background: "#ffffff",
          transform: value ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </span>
  </button>
);

// ── InfoTileModal (Add + Edit unified) ────────────────────────────────────
//
// One component so the surface stays consistent. `tile` undefined → Add
// mode; provided → Edit mode (delete button surfaces in the footer).

export function InfoTileModal({
  tripId,
  tile,
  onClose,
}: {
  tripId: string;
  tile?: QuickTile;
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();
  const isEditing = !!tile;

  const [label, setLabel] = useState(tile?.label ?? "");
  const [value, setValue] = useState(tile?.value ?? "");
  const [iconKey, setIconKey] = useState<string | null>(tile?.icon ?? null);
  const [isAlert, setIsAlert] = useState(!!tile?.is_alert);
  /** Two-step delete: first tap on the quiet "Delete" arms; the footer
   *  swaps to a confirm prompt + Cancel + Delete row (same canonical
   *  pattern as ConfirmDeleteButton, fitted to the spec's quiet-text
   *  idle state). */
  const [deleteArmed, setDeleteArmed] = useState(false);

  const invalidate = () =>
    utils.quickInfoTiles.list.invalidate({ tripId });

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
          icon: vars.icon ?? null,
          sort_order: vars.sortOrder ?? 0,
          is_alert: vars.isAlert ?? false,
          created_by: null,
          created_at: new Date().toISOString(),
        },
      ]);
      return { prev };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.prev !== undefined)
        utils.quickInfoTiles.list.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      onClose();
    },
    onSettled() {
      invalidate();
    },
  });

  const update = trpc.quickInfoTiles.update.useMutation({
    onSuccess() {
      onClose();
    },
    onSettled() {
      invalidate();
    },
  });

  const remove = trpc.quickInfoTiles.remove.useMutation({
    onSuccess() {
      onClose();
    },
    onSettled() {
      invalidate();
    },
  });

  const trimmedLabel = label.trim();
  const trimmedValue = value.trim();
  const canSubmit =
    !!trimmedLabel &&
    !!trimmedValue &&
    !create.isPending &&
    !update.isPending;

  const handleSave = () => {
    if (!canSubmit) return;
    if (isEditing && tile) {
      update.mutate({
        tripId,
        tileId: tile.id,
        label: trimmedLabel,
        value: trimmedValue,
        icon: iconKey,
        isAlert,
      });
    } else {
      create.mutate({
        tripId,
        id: crypto.randomUUID(),
        label: trimmedLabel,
        value: trimmedValue,
        icon: iconKey,
        isAlert,
      });
    }
  };

  const handleDelete = () => {
    if (!tile) return;
    remove.mutate({ tripId, tileId: tile.id });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Scrim */}
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? "Edit info tile" : "Add info tile"}
        className="relative w-full max-w-[380px] rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h3
              className="text-base font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {isEditing ? "Edit info tile" : "Add info tile"}
            </h3>
            <p
              className="mt-0.5 text-[12px] leading-snug"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Quick references the crew taps a lot — codes, wifi, addresses.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 pb-4">
          <PreviewChip
            label={label}
            value={value}
            iconKey={iconKey}
            isAlert={isAlert}
          />

          <div>
            <FieldLabel>Icon</FieldLabel>
            <IconPicker value={iconKey} onChange={setIconKey} />
          </div>

          <div>
            <FieldLabel>Label</FieldLabel>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Door code"
              maxLength={100}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
              style={{
                background: "var(--color-bt-card-raised)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </div>

          <div>
            <FieldLabel>Value</FieldLabel>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="1234#"
              maxLength={500}
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:ring-1"
              style={{
                background: "var(--color-bt-card-raised)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </div>

          <AlertToggleRow value={isAlert} onChange={setIsAlert} />
        </div>

        {/* Footer — swaps into the two-step delete-confirm row when armed
            (Edit mode only). Idle state matches the spec: quiet red text
            "Delete" on the left + Cancel / Save on the right. */}
        <div
          className="flex items-center gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          {deleteArmed && isEditing ? (
            <div
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5"
              style={{
                background: "var(--color-bt-danger-faint)",
                border: "1px solid var(--color-bt-danger-border)",
              }}
            >
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium"
                style={{ color: "var(--color-bt-danger)" }}
              >
                Delete this tile?
              </span>
              <button
                type="button"
                onClick={() => setDeleteArmed(false)}
                disabled={remove.isPending}
                className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                style={{
                  background: "transparent",
                  color: "var(--color-bt-text-dim)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={remove.isPending}
                className="rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
                style={{
                  background: "var(--color-bt-danger)",
                  color: "#ffffff",
                }}
              >
                {remove.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          ) : (
            <>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => setDeleteArmed(true)}
                  disabled={remove.isPending}
                  className="text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ color: "var(--color-bt-danger)" }}
                >
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSubmit}
                className="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-on-accent)",
                }}
              >
                {isEditing ? "Save" : "Add tile"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Re-exports used by the dock to keep glyph resolution consistent ───────
export { iconFor, PICKER_ICONS };
