"use client";

import { Home, Users, MapPin } from "lucide-react";

// ── Mini thumbnails for steps 2–4 ────────────────────────────────────────
//
// Tiny stylized previews — not literal screenshots, just enough visual
// cue per step so the grid scans at a glance. SetDatesFlipCard owns its
// own calendar thumbnail since it sits inside a flipping container.

export function LodgingThumbnail() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Home size={18} strokeWidth={1.8} />
      <div className="flex h-2 w-14 rounded-sm" style={{ background: "currentColor", opacity: 0.25 }} />
      <div className="flex h-1.5 w-10 rounded-sm" style={{ background: "currentColor", opacity: 0.4 }} />
    </div>
  );
}

export function CrewThumbnail() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Users size={18} strokeWidth={1.8} />
      <div className="flex gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: "currentColor",
              opacity: i === 0 ? 0.85 : i === 1 ? 0.65 : 0.35,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function AgendaThumbnail() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <MapPin size={18} strokeWidth={1.8} />
      <div className="space-y-[3px]">
        {[14, 10, 12].map((w, i) => (
          <div
            key={i}
            className="h-1 rounded-sm"
            style={{
              width: w * 2,
              background: "currentColor",
              opacity: 0.45 - i * 0.1,
            }}
          />
        ))}
      </div>
    </div>
  );
}
