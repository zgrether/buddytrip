"use client";

import { useMemo } from "react";
import { MapPin, CalendarDays, Users, Mail, Send } from "lucide-react";
import type { TripData } from "../tabs/types";

interface NextStepsPanelProps {
  trip: TripData;
  crewCount: number;
  isOwner: boolean;
  onMakeOfficial?: (message: string) => void;
}

export function NextStepsPanel({
  trip,
  crewCount,
  isOwner,
  onMakeOfficial,
}: NextStepsPanelProps) {
  const steps = useMemo(() => {
    const items: { icon: typeof MapPin; text: string }[] = [];

    if (!trip.locked_destination_title) {
      items.push({
        icon: MapPin,
        text: "Set a destination to move to Planning",
      });
    }

    if (!(trip.start_date && trip.end_date)) {
      items.push({
        icon: CalendarDays,
        text: "Lock a date — your crew will want to know when",
      });
    }

    if (crewCount <= 1) {
      items.push({
        icon: Users,
        text: "Add your crew before sending the RSVP",
      });
    }

    if (!trip.about_message?.trim()) {
      items.push({
        icon: Mail,
        text: "Write your invitation message on the Crew tab",
      });
    }

    return items;
  }, [
    trip.locked_destination_title,
    trip.start_date,
    trip.end_date,
    crewCount,
    trip.about_message,
  ]);

  const allGreen = steps.length === 0;

  // Nothing to show: all steps resolved and user is not owner (no CTA)
  if (allGreen && !isOwner) return null;
  // Nothing to show: all steps resolved, owner, but no callback
  if (allGreen && !onMakeOfficial) return null;

  return (
    <div className="mb-4">
      {steps.length > 0 && (
        <>
          <p
            className="mb-2 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Next steps
          </p>
          <div className="space-y-1">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.text} className="flex items-start gap-2">
                  <Icon
                    size={14}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: "var(--color-bt-accent)" }}
                  />
                  <span
                    className="text-[13px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    {step.text}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {allGreen && isOwner && onMakeOfficial && (
        <button
          onClick={() => onMakeOfficial(trip.about_message!)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 animate-fade-in"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          <Send size={18} />
          Let&apos;s Go! 🎉
        </button>
      )}
    </div>
  );
}
