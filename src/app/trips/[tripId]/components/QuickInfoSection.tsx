"use client";

import { useState } from "react";
import { AlertTriangle, FileText, Flag, Hotel, Pencil, Plus, X, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// ── Types ────────────────────────────────────────────────────────────────

export interface QuickTile {
  id: string;
  label: string;
  value: string;
  icon?: string | null;
  sort_order?: number | null;
  is_alert?: boolean | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function TileIcon({ icon, tone = "accent" }: { icon?: string | null; tone?: "accent" | "warning" }) {
  const icons: Record<string, React.ReactNode> = {
    hotel: <Hotel size={16} />,
    golf: <Flag size={16} />,
    zap: <Zap size={16} />,
    file: <FileText size={16} />,
  };
  return (
    <span style={{ color: tone === "warning" ? "var(--color-bt-warning)" : "var(--color-bt-accent)" }}>
      {icons[icon ?? "file"] ?? <FileText size={16} />}
    </span>
  );
}

// ── AlertToggle ──────────────────────────────────────────────────────────
// Shared control for "mark this as a crew alert" in Add/Edit modals. When
// on, the tile renders in warning-yellow and is slightly larger, so it
// stands out among the neutral info tiles.

function AlertToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left"
      style={{
        borderColor: value ? "var(--color-bt-warning-border)" : "var(--color-bt-border)",
        background: value ? "var(--color-bt-warning-faint)" : "var(--color-bt-base)",
      }}
    >
      <span className="flex items-center gap-2">
        <AlertTriangle
          size={14}
          style={{ color: value ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)" }}
        />
        <span
          className="text-sm"
          style={{ color: value ? "var(--color-bt-warning)" : "var(--color-bt-text)" }}
        >
          Mark as crew alert
        </span>
      </span>
      <span
        className="inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors"
        style={{ background: value ? "var(--color-bt-warning)" : "var(--color-bt-border)" }}
      >
        <span
          className="h-4 w-4 rounded-full bg-white transition-transform"
          style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
    </button>
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
  const [isAlert, setIsAlert] = useState(false);

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
          is_alert: vars.isAlert ?? false,
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
        <AlertToggle value={isAlert} onChange={setIsAlert} />
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
                isAlert,
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
  const [isAlert, setIsAlert] = useState(!!tile.is_alert);

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
        <AlertToggle value={isAlert} onChange={setIsAlert} />
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
            onClick={() =>
              update.mutate({
                tripId,
                tileId: tile.id,
                label: label.trim(),
                value: value.trim(),
                isAlert,
              })
            }
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

// ── QuickInfoSection ─────────────────────────────────────────────────────
// Owner-configured grab-bag of going-stage details (door codes, check-in
// times, street addresses, crew alerts). Crew reads; owner edits via
// Add/Edit tile modals. Tiles flagged as alerts render in warning-yellow
// and slightly larger to draw attention. Renders nothing for non-owners
// when no tiles exist.

export function QuickInfoSection({
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

  // Sort: alerts first, then by existing sort_order / created_at (server-ordered).
  const sortedTiles = [...(tiles as QuickTile[])].sort((a, b) => {
    const aAlert = a.is_alert ? 1 : 0;
    const bAlert = b.is_alert ? 1 : 0;
    return bAlert - aAlert;
  });

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
            Door codes, check-in times, street addresses, and crew alerts — the stuff everyone always asks about.
          </p>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {sortedTiles.map((tile) => {
            const alert = !!tile.is_alert;
            // Alert tiles span two columns on the 3-col grid so they read
            // bigger without breaking the layout. They also use warning
            // tokens + left border stripe to match the prior OwnerAlertPanel.
            return (
              <div
                key={tile.id}
                data-testid={`tile-${tile.id}`}
                className={`group relative rounded-xl ${alert ? "col-span-2 p-4" : "p-3"}`}
                style={
                  alert
                    ? {
                        background: "var(--color-bt-warning-faint)",
                        border: "1px solid var(--color-bt-warning-border)",
                        borderLeft: "3px solid var(--color-bt-warning)",
                      }
                    : {
                        background: "var(--color-bt-card)",
                        border: "1px solid var(--color-bt-border)",
                      }
                }
              >
                <div className="mb-1 flex items-center gap-1.5">
                  {alert ? (
                    <AlertTriangle size={14} style={{ color: "var(--color-bt-warning)" }} />
                  ) : (
                    <TileIcon icon={tile.icon} />
                  )}
                  <span
                    className={alert ? "text-[11px] font-semibold uppercase tracking-wider" : "text-[10px]"}
                    style={{ color: alert ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)" }}
                  >
                    {alert ? `Alert · ${tile.label}` : tile.label}
                  </span>
                </div>
                <p
                  className={`${alert ? "text-sm" : "text-xs"} font-medium pr-4`}
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {tile.value}
                </p>
                {isOwner && (
                  <button
                    data-testid={`tile-edit-${tile.id}`}
                    onClick={() => setEditingTile(tile)}
                    className="absolute right-1.5 top-1.5 rounded p-0.5"
                    style={{ color: alert ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)" }}
                  >
                    <Pencil size={10} />
                  </button>
                )}
              </div>
            );
          })}
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
