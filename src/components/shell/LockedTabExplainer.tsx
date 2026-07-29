"use client";

import { type FC } from "react";
import { Calendar, Trophy, MessageCircle, type LucideIcon } from "lucide-react";

/**
 * What a tab (or the Chat action) says when there's no trip selected.
 *
 * The tab is tappable rather than inert (AppTabBar) because this copy is the
 * only place a first-time crew member learns what a Cup even is. It explains and
 * offers the one action that unlocks it; it never navigates on its own.
 *
 * `chat` is included even though Chat is no longer an `AppView` (Phase 6 — it's
 * a tab-bar action, not a destination): the explainer content is about what the
 * FEATURE does, which is still worth surfacing when a locked Chat action is
 * tapped with no trip in context. Hence a standalone type here rather than
 * `Exclude<AppView, "home">`.
 */
export type LockedExplainerView = "trip" | "cup" | "chat";

const COPY: Record<LockedExplainerView, { Icon: LucideIcon; head: string; body: string }> = {
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
  view: LockedExplainerView;
  /** Omit to render the copy WITHOUT the action. `/dashboard` at `lg+` does
   *  that: the rail beside it already is the picker, so a "Pick a trip" button
   *  pointing at nothing in particular would be noise. */
  onPickTrip?: () => void;
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
      {onPickTrip && (
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
      )}
    </div>
  );
};

/**
 * ContextIntro — what `/dashboard`'s CONTENT AREA shows at `lg+`.
 *
 * On desktop the rail is the context picker, so nothing-selected in the tab strip
 * is the accurate state, not a bug. The actual defect was that the rail and the
 * content area listed the same trips twice. This replaces the duplicate list with
 * the three explainers — the SAME `LockedTabExplainer` copy the locked tabs use,
 * rendered together — so the content area says what Trip, Cup and Chat will scope
 * to once you pick from the rail.
 *
 * No CTA on any of the three: the picker is the rail, immediately to the left.
 *
 * Mobile `/dashboard` is untouched — Home is a tab there and the trip list is the
 * body. This is swapped by `lg:hidden` / `hidden lg:block` in AppShell, one tree,
 * so crossing the breakpoint reflows and never remounts.
 */
export const ContextIntro: FC = () => (
  <div className="px-4 py-10" data-testid="context-intro">
    <div className="mx-auto max-w-3xl text-center">
      <h1 className="text-[19px] font-semibold" style={{ letterSpacing: "-0.01em" }}>
        Pick a trip to get started
      </h1>
      <p className="mx-auto mt-1.5 text-[13px]" style={{ color: "var(--color-bt-text-dim)", maxWidth: 420 }}>
        Choose one from the left. Everything below scopes to whichever trip you&apos;re in.
      </p>
    </div>
    <div className="mx-auto mt-2 grid max-w-4xl gap-2 md:grid-cols-3">
      {(["trip", "cup", "chat"] as const).map((v) => (
        <LockedTabExplainer key={v} view={v} />
      ))}
    </div>
  </div>
);
