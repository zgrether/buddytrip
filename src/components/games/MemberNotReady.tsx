"use client";

import { Hourglass } from "lucide-react";

/**
 * MemberNotReady — the §8 "member taps a not-ready game" surface.
 *
 * When a crew member opens a game that isn't scoring yet, they get this warm,
 * game-led message — NOT the owner's setup machinery (pairings/foursomes/course
 * pickers) and NOT an empty scoreboard. Lead with the game, not the absence:
 * "<Game> is still being set up." Conceal-the-machinery voice.
 *
 * Owners/organizers and the game's delegate never see this — they get the
 * setup/scoring surface. It's purely the member-facing not-ready state.
 */
export function MemberNotReady({ gameName }: { gameName?: string | null }) {
  const name = gameName?.trim() || "This game";
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{ paddingTop: 80 }}
      data-testid="member-not-ready"
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
          marginBottom: 16,
        }}
      >
        <Hourglass size={24} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>
        {name} is still being set up
      </div>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-bt-text-dim)",
          marginTop: 6,
          maxWidth: 280,
          lineHeight: 1.5,
        }}
      >
        Your organizer is getting this one ready. Check back in a bit and it&apos;ll
        be here.
      </p>
    </div>
  );
}
