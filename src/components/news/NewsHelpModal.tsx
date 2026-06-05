"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Type,
  Users,
  Trophy,
  Image as ImageIcon,
  ListOrdered,
  Pin,
  type LucideIcon,
} from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { NewsBlockView } from "@/components/news/NewsBlock";
import type { NewsBlock } from "@/lib/news";

// ── NewsHelpModal ───────────────────────────────────────────────────────────
//
// "How posts work" — explains the closed set of block types with a one-line
// description and a live example of each (rendered through the real block
// renderer, so the example always matches what ships). Opened from the
// composer's help button. Portaled above the News drawer.

interface CatalogEntry {
  name: string;
  icon: LucideIcon;
  desc: string;
  demo: NewsBlock;
}

const CATALOG: CatalogEntry[] = [
  {
    name: "Text",
    icon: Type,
    desc: "A paragraph — the everyday update. Plain text for now (rich formatting is coming).",
    demo: { type: "text", text: "Tee times are tight — be at the first tee 10 minutes early." },
  },
  {
    name: "@Crew",
    icon: Users,
    desc: "Tag people from the roster. A labeled row of avatar + name pills (captains, pairings). On-team members show their team color.",
    demo: {
      type: "crew",
      label: "Pairing",
      people: [
        { name: "Brad", initials: "BG", color: "#3b82f6" },
        { name: "Buddy", initials: "BB", color: "#2dd4bf" },
      ],
    },
  },
  {
    name: "Teams",
    icon: Trophy,
    desc: "The team draw, pulled straight from the Competition — you never retype rosters.",
    demo: {
      type: "teams",
      teams: [
        { name: "The Usual Suspects", color: "#3b82f6", players: ["Brad G", "Tyler L", "JD S"] },
        { name: "Buddy's Last Stand", color: "#2dd4bf", players: ["Buddy B", "Bill G", "Charlie P"] },
      ],
    },
  },
  {
    name: "Media",
    icon: ImageIcon,
    desc: "Paste a YouTube/Vimeo link for a video card, or an image/GIF link to show it inline. Recaps, course photos, hype clips.",
    demo: { type: "media", kind: "video", title: "BBMI 2024 — The Annual Recap", meta: "Charlie Piper · 8 min" },
  },
  {
    name: "Steps",
    icon: ListOrdered,
    desc: "A numbered how-to — rules, scoring, day-of logistics.",
    demo: {
      type: "steps",
      steps: [
        { label: "Scores", body: "enter your own after each hole." },
        { label: "Leaderboard", body: "live all week — tap the trophy." },
      ],
    },
  },
  {
    name: "Callout",
    icon: Pin,
    desc: "One highlighted line in caution-amber — the must-not-miss thing.",
    demo: { type: "callout", text: "Read this before you pack. Yes, all of it." },
  },
];

interface NewsHelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewsHelpModal({ open, onClose }: NewsHelpModalProps) {
  useModalBackButton(onClose, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // SSR-safe portal target (see AboutModal for the containing-block note).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How posts work"
      // z-[60] so it sits above the News drawer (z-50).
      className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="animate-fade-in flex max-h-[88vh] w-full max-w-[460px] flex-col overflow-hidden rounded-t-[18px] lg:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex flex-shrink-0 items-center gap-2 px-[18px] py-3"
          style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-bt-text)" }}>
            How posts work
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Intro */}
        <p
          className="flex-shrink-0 px-[18px] pt-3"
          style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--color-bt-text-dim)" }}
        >
          A post is a stack of blocks. Add as many as you like, in any order, then drag to
          reorder. These are the six block types:
        </p>

        {/* Catalog */}
        <div className="flex flex-col gap-3 overflow-y-auto px-[18px] py-3">
          {CATALOG.map(({ name, icon: Icon, desc, demo }) => (
            <div
              key={name}
              style={{
                border: "1px solid var(--color-bt-border)",
                borderRadius: 12,
                background: "var(--color-bt-card)",
                padding: 12,
              }}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <Icon size={15} style={{ color: "var(--color-bt-accent)" }} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-bt-text)" }}>
                  {name}
                </span>
              </div>
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "var(--color-bt-text-dim)",
                }}
              >
                {desc}
              </p>
              <NewsBlockView block={demo} />
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
