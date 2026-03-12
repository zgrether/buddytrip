"use client";

import { useState } from "react";
import {
  Plus,
  Hotel,
  FileText,
  Flag,
  Zap,
  Lock,
  ChevronRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { TabProps } from "./types";

interface QuickTile {
  id: string;
  label: string;
  value: string;
  icon?: string | null;
  sort_order?: number | null;
}

function TileIcon({ icon }: { icon?: string | null }) {
  const icons: Record<string, React.ReactNode> = {
    hotel: <Hotel size={16} />,
    golf: <Flag size={16} />,
    zap: <Zap size={16} />,
    file: <FileText size={16} />,
  };
  return (
    <span style={{ color: "#00d4aa" }}>
      {icons[icon ?? "file"] ?? <FileText size={16} />}
    </span>
  );
}

function AddTileModal({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const create = trpc.quickInfoTiles.create.useMutation({
    onSuccess: () => {
      utils.quickInfoTiles.list.invalidate({ tripId });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.7)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg rounded-2xl p-6 space-y-4"
        style={{ background: "#161b22", border: "1px solid #30363d" }}
      >
        <h3 className="text-base font-semibold" style={{ color: "#e6edf3" }}>
          Add Info Tile
        </h3>
        <div>
          <input
            placeholder="Label (e.g. Hotel)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "#0d1117", borderColor: "#30363d", color: "#e6edf3" }}
          />
        </div>
        <div>
          <input
            placeholder="Value (e.g. The Westin, Room 412)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "#0d1117", borderColor: "#30363d", color: "#e6edf3" }}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border py-2.5 text-sm"
            style={{ borderColor: "#30363d", color: "#8b949e" }}
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
            style={{ background: "#00d4aa", color: "#0d1117" }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

export function HomeTab({ trip, isOwner }: TabProps) {
  const canEdit = isOwner ?? false; // tiles require Owner per PERMISSIONS.md
  const [showAddTile, setShowAddTile] = useState(false);
  const utils = trpc.useUtils();

  const { data: tiles = [] } = trpc.quickInfoTiles.list.useQuery({
    tripId: trip.id,
  });

  const deleteTile = trpc.quickInfoTiles.remove.useMutation({
    onSuccess: () => utils.quickInfoTiles.list.invalidate({ tripId: trip.id }),
  });

  return (
    <div className="space-y-5 px-4">
      {/* ── Locked destination banner ─────────────────────────────────── */}
      {trip.locked_destination_title && (
        <div
          className="flex items-center gap-3 rounded-xl p-4"
          style={{ background: "#0d2a22", border: "1px solid #00d4aa44" }}
        >
          <Lock size={18} style={{ color: "#00d4aa", flexShrink: 0 }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "#00d4aa" }}>
              Destination locked
            </p>
            <p className="text-xs" style={{ color: "#8b949e" }}>
              {trip.locked_destination_title}
            </p>
          </div>
        </div>
      )}

      {/* ── Quick info tiles ────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "#8b949e" }}>
            Quick Info
          </h2>
          {canEdit && (
            <button
              data-testid="add-tile-btn"
              onClick={() => setShowAddTile(true)}
              className="flex items-center gap-1 text-xs"
              style={{ color: "#00d4aa" }}
            >
              <Plus size={14} /> Add
            </button>
          )}
        </div>

        {tiles.length === 0 ? (
          <p className="text-sm" style={{ color: "#8b949e" }}>
            No quick info yet.{" "}
            {canEdit && "Add tiles for hotel info, tee times, etc."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {(tiles as QuickTile[]).map((tile) => (
              <div
                key={tile.id}
                data-testid={`tile-${tile.id}`}
                className="group relative rounded-xl p-4"
                style={{ background: "#161b22", border: "1px solid #30363d" }}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <TileIcon icon={tile.icon} />
                  <span className="text-xs" style={{ color: "#8b949e" }}>
                    {tile.label}
                  </span>
                </div>
                <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                  {tile.value}
                </p>
                {canEdit && (
                  <button
                    onClick={() => deleteTile.mutate({ tripId: trip.id, tileId: tile.id })}
                    className="absolute right-2 top-2 hidden rounded p-1 group-hover:flex"
                    style={{ color: "#8b949e" }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Accommodation ───────────────────────────────────────────── */}
      {trip.accommodation && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider" style={{ color: "#8b949e" }}>
            Accommodation
          </h2>
          <div
            className="flex items-start gap-3 rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            <Hotel size={18} style={{ color: "#00d4aa", flexShrink: 0 }} />
            <p className="text-sm" style={{ color: "#e6edf3" }}>
              {trip.accommodation}
            </p>
          </div>
        </section>
      )}

      {/* ── Activities ─────────────────────────────────────────────── */}
      {trip.activities && trip.activities.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider" style={{ color: "#8b949e" }}>
            Activities
          </h2>
          <div className="flex flex-wrap gap-2">
            {trip.activities.map((a, i) => (
              <span
                key={i}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: "#161e35", color: "#7c93d4" }}
              >
                {a}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Golf courses ─────────────────────────────────────────────── */}
      {trip.golf_courses && trip.golf_courses.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider" style={{ color: "#8b949e" }}>
            Golf Courses
          </h2>
          <div className="space-y-2">
            {trip.golf_courses.map((c, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl p-3"
                style={{ background: "#161b22", border: "1px solid #30363d" }}
              >
                <Flag size={16} style={{ color: "#00d4aa" }} />
                <span className="text-sm" style={{ color: "#e6edf3" }}>
                  {c}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Notes ──────────────────────────────────────────────────── */}
      {trip.notes && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider" style={{ color: "#8b949e" }}>
            Notes
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            <p className="whitespace-pre-wrap text-sm" style={{ color: "#e6edf3" }}>
              {trip.notes}
            </p>
          </div>
        </section>
      )}

      {/* ── Comparison mode ─────────────────────────────────────────── */}
      {trip.comparison_mode && (
        <div
          className="flex items-center justify-between rounded-xl p-4"
          style={{ background: "#161e35", border: "1px solid #7c93d444" }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: "#7c93d4" }}>
              Destination voting active
            </p>
            <p className="text-xs" style={{ color: "#8b949e" }}>
              Members are voting on destinations
            </p>
          </div>
          <ChevronRight size={16} style={{ color: "#7c93d4" }} />
        </div>
      )}

      {/* ── Edit hint ───────────────────────────────────────────────── */}
      {canEdit && !trip.notes && !trip.accommodation && tiles.length === 0 && (
        <div className="mt-6 text-center">
          <Pencil size={32} className="mx-auto mb-3" style={{ color: "#30363d" }} />
          <p className="text-sm" style={{ color: "#8b949e" }}>
            Add quick-info tiles, accommodation details, and notes from the{" "}
            <span style={{ color: "#00d4aa" }}>More</span> tab.
          </p>
        </div>
      )}

      {showAddTile && (
        <AddTileModal tripId={trip.id} onClose={() => setShowAddTile(false)} />
      )}
    </div>
  );
}
