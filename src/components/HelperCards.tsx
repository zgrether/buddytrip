"use client";

import { MapPin, CalendarDays, DollarSign, Trophy } from "lucide-react";
import Link from "next/link";

const HELPER_FEATURES = [
  {
    icon: MapPin,
    iconBg: "rgba(99,102,241,0.15)",
    iconColor: "#818cf8",
    title: "Plan together",
    body: "Vote on where to go, agree on dates. Everyone weighs in; the owner locks it.",
  },
  {
    icon: CalendarDays,
    iconBg: "rgba(45,212,191,0.12)",
    iconColor: "var(--color-bt-accent)",
    title: "One itinerary",
    body: "Lodging, tee times, dinners — all in one place. Everyone sees the same thing.",
  },
  {
    icon: DollarSign,
    iconBg: "rgba(251,146,60,0.13)",
    iconColor: "#fb923c",
    title: "Split fairly",
    body: "Log who paid, split however makes sense. No spreadsheet, no awkward follow-up.",
  },
  {
    icon: Trophy,
    iconBg: "rgba(251,191,36,0.12)",
    iconColor: "#fbbf24",
    title: "Compete",
    body: "Teams, events, live scoring. Weight the last round heavier so it stays interesting.",
  },
] as const;

export function HelperCards() {
  return (
    <div className="mx-auto w-full max-w-[642px]">
      <p
        className="mb-3 text-center text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Here&rsquo;s what BuddyTrip does
      </p>
      <div className="grid grid-cols-2 gap-3">
        {HELPER_FEATURES.map(({ icon: Icon, iconBg, iconColor, title, body }) => (
          <div
            key={title}
            className="h-[143px] rounded-2xl p-4 text-left"
            style={{ background: "var(--color-bt-card)" }}
          >
            <div
              className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: iconBg }}
            >
              <Icon size={18} strokeWidth={1.75} style={{ color: iconColor }} />
            </div>
            <div
              className="mb-1 text-[13px] font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {title}
            </div>
            <div
              className="text-[12px] leading-[1.55]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HelperCardsWithLink({ showCards }: { showCards: boolean }) {
  return (
    <div className="mt-10">
      {showCards && <HelperCards />}
      <div className={`text-center ${showCards ? "mt-6" : "mt-2"}`}>
        <Link
          href="/#how-it-works"
          className="text-[13px]"
          style={{ color: "var(--color-bt-accent)" }}
        >
          See how BuddyTrip works →
        </Link>
      </div>
    </div>
  );
}
