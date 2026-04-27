"use client";

import { useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { AddTileModal, QuickInfoSection } from "../../../components/QuickInfoSection";
import { QuickInfoIntroModal } from "../modals/QuickInfoIntroModal";

// ── Types ────────────────────────────────────────────────────────────────

interface QuickInfoPanelProps {
  tripId: string;
  isOwner: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * QuickInfoPanel — home tab panel for owner-curated tiles (door codes,
 * check-in times, WiFi passwords, etc.).
 *
 * State machine:
 *   1. Member, no tiles  → render nothing (Quick Info is owner-curated)
 *   2. Owner, no tiles   → invitation card → opens QuickInfoIntroModal,
 *                           which routes through to the existing
 *                           QuickInfoSection's empty-state add flow
 *   3. Tiles exist       → render QuickInfoSection directly (no panel
 *                           shell). The section already owns its QUICK INFO
 *                           header + add button + tile grid; the +Add and
 *                           edit affordances inside QuickInfoSection are
 *                           already gated by isOwner so member-mode just
 *                           drops them automatically.
 */
export function QuickInfoPanel({ tripId, isOwner }: QuickInfoPanelProps) {
  const [introOpen, setIntroOpen] = useState(false);
  const [addTileOpen, setAddTileOpen] = useState(false);
  const { data: tiles = [] } = trpc.quickInfoTiles.list.useQuery({ tripId });
  const hasItems = tiles.length > 0;

  // ── State 3: live (no panel shell — section is its own surface) ──────
  if (hasItems) {
    return <QuickInfoSection tripId={tripId} isOwner={isOwner} />;
  }

  // ── State 1: member, no tiles ────────────────────────────────────────
  if (!isOwner) {
    return null;
  }

  // ── State 2: owner, no tiles, invitation ─────────────────────────────
  return (
    <>
      <InvitationCard
        Icon={Info}
        title="Add Quick Info"
        body="Door codes, check-in times — the stuff everyone asks about, pinned for the crew."
        onClick={() => setIntroOpen(true)}
        testId="quick-info-invitation"
      />
      <QuickInfoIntroModal
        isOpen={introOpen}
        onClose={() => setIntroOpen(false)}
        onActivate={() => {
          // Drop straight into the add-first-tile flow — close the intro
          // and open AddTileModal back to back.
          setIntroOpen(false);
          setAddTileOpen(true);
        }}
        isActivating={false}
      />
      {addTileOpen && (
        <AddTileModal tripId={tripId} onClose={() => setAddTileOpen(false)} />
      )}
    </>
  );
}

// ── InvitationCard ───────────────────────────────────────────────────────

function InvitationCard({
  Icon,
  title,
  body,
  onClick,
  testId,
}: {
  Icon: typeof Info;
  title: string;
  body: string;
  onClick: () => void;
  testId?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={testId}
      className="w-full rounded-xl px-4 py-5 text-left transition-colors"
      style={{
        background: hover
          ? "var(--color-bt-accent-faint)"
          : "var(--color-bt-surface-invitation)",
        border: `1.5px dashed ${
          hover ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"
        }`,
        cursor: "pointer",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: "var(--color-bt-text)" }}>
            {title}
          </p>
          <p
            className="mt-1 text-xs leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {body}
          </p>
        </div>
        <ArrowRight
          size={16}
          style={{
            color: "var(--color-bt-accent)",
            flexShrink: 0,
            opacity: hover ? 1 : 0,
            transition: "opacity 150ms",
          }}
        />
      </div>
    </button>
  );
}

