"use client";

import { useState } from "react";
import { Lightbulb, CalendarDays, CheckCircle, X } from "lucide-react";
import type { TripDisplayStatus } from "@/lib/tripStatus";

interface StageContextBarProps {
  tripId: string;
  stage: string;
  displayStatus: TripDisplayStatus;
  isOwner: boolean;
}

export const STAGE_CONTENT: Record<
  string,
  { icon: React.ReactNode; text: string }
> = {
  idea: {
    icon: <Lightbulb size={14} style={{ color: "var(--color-bt-accent)" }} />,
    text: "Add destination ideas and vote with your crew — then pick one to move to Planning",
  },
  planning: {
    icon: <CalendarDays size={14} style={{ color: "var(--color-bt-accent)" }} />,
    text: "Lock a date and build your crew — when you're ready, hit Let's Go! to send the RSVP",
  },
  going: {
    icon: <CheckCircle size={14} style={{ color: "var(--color-bt-accent)" }} />,
    text: "Track RSVPs, confirm logistics, and get everyone excited",
  },
  now: {
    icon: <CheckCircle size={14} style={{ color: "var(--color-bt-accent)" }} />,
    text: "Track RSVPs, confirm logistics, and get everyone excited",
  },
};

export function StageContextBar({ tripId, stage, displayStatus, isOwner }: StageContextBarProps) {
  const storageKey = `stage-bar-dismissed-${tripId}-${stage}`;
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(storageKey) === "true";
  });

  const showBar = ["idea", "planning", "going", "now"].includes(displayStatus);

  if (!isOwner || !showBar || dismissed) return null;

  const content = STAGE_CONTENT[displayStatus] ?? STAGE_CONTENT[stage];
  if (!content) return null;

  const handleDismiss = () => {
    localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-2.5"
      style={{
        background: "var(--color-bt-card-raised)",
        borderLeft: "3px solid var(--color-bt-accent-border)",
      }}
    >
      <span className="flex-shrink-0">{content.icon}</span>
      <p className="flex-1 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
        {content.text}
      </p>
      <button
        onClick={handleDismiss}
        className="ml-auto flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{ color: "var(--color-bt-text-dim)" }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
