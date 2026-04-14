"use client";

import { useMemo } from "react";
import { MapPin, CalendarDays, Users } from "lucide-react";
import type { TripData } from "../tabs/types";

interface NextStepsPanelProps {
  trip: TripData;
  crewCount: number;
  isOwner: boolean;
}

export function NextStepsPanel({
  trip,
  crewCount,
  isOwner,
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

    return items;
  }, [
    trip.locked_destination_title,
    trip.start_date,
    trip.end_date,
    crewCount,
  ]);

  if (steps.length === 0) return null;

  return (
    <div className="mb-4">
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
    </div>
  );
}
