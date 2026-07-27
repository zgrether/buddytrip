"use client";

import { type FC } from "react";
import { Calendar, Trophy, MessageCircle, type LucideIcon } from "lucide-react";
import type { AppView } from "./useAppView";

/**
 * What a tab says when there's no trip selected.
 *
 * The tab is tappable rather than inert (AppTabBar) because this copy is the
 * only place a first-time crew member learns what a Cup even is. It explains and
 * offers the one action that unlocks it; it never navigates on its own.
 */

const COPY: Record<Exclude<AppView, "home">, { Icon: LucideIcon; head: string; body: string }> = {
  trip: {
    Icon: Calendar,
    head: "Trips hold the plan",
    body: "Crew, dates, lodging, the schedule, and who owes what — everything you sort out before anyone gets in a car.",
  },
  cup: {
    Icon: Trophy,
    head: "Cups turn games into a competition",
    body: "Build teams, set matches, assign points. Scores roll up to one standing the whole crew can watch.",
  },
  chat: {
    Icon: MessageCircle,
    head: "Chat keeps it in one place",
    body: "Trash talk, logistics, and the photo from the bunker — kept with the trip it belongs to.",
  },
};

export const LockedTabExplainer: FC<{
  view: Exclude<AppView, "home">;
  onPickTrip: () => void;
}> = ({ view, onPickTrip }) => {
  const { Icon, head, body } = COPY[view];
  return (
    <div className="px-6 py-14 text-center" data-testid={`locked-explainer-${view}`}>
      <div
        className="mx-auto mb-4 grid h-13 w-13 place-items-center rounded-2xl"
        style={{
          height: 52,
          width: 52,
          background: "var(--color-bt-card)",
          border: "1px dashed var(--color-bt-border)",
          color: "var(--color-bt-text-dim)",
        }}
      >
        <Icon size={24} />
      </div>
      <h2 className="mb-2 text-[16.5px] font-semibold" style={{ letterSpacing: "-0.01em" }}>
        {head}
      </h2>
      <p
        className="mx-auto text-[13px] leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)", maxWidth: 268 }}
      >
        {body}
      </p>
      <button
        type="button"
        onClick={onPickTrip}
        className="mt-5 rounded-[10px] px-5 py-2.5 text-[13.5px] font-semibold"
        style={{
          background: "transparent",
          color: "var(--color-bt-accent)",
          border: "1px solid var(--color-bt-accent-border)",
        }}
        data-testid="locked-pick-trip"
      >
        Pick a trip
      </button>
    </div>
  );
};
