"use client";

import { ArrowRight, Loader2, Trophy, Users, Zap } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// ── Types ────────────────────────────────────────────────────────────────

interface CompetitionIntroModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivate: () => void;
  isActivating: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * CompetitionIntroModal — owner-facing pitch shown when the Competition
 * panel invitation card is tapped. Replaces the prior inline
 * CompetitionPreviewModal in HomeTab.tsx; visual language updated to
 * match the other intro modals (gradient hero + blob accents + chips +
 * gradient CTA).
 */
export function CompetitionIntroModal({
  isOpen,
  onClose,
  onActivate,
  isActivating,
}: CompetitionIntroModalProps) {
  useModalBackButton(isOpen ? onClose : () => {});
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
      data-testid="competition-intro-modal"
    >
      <div
        className="w-full overflow-y-auto"
        style={{
          maxWidth: 360,
          maxHeight: "90vh",
          background: "var(--color-bt-card)",
          borderRadius: 22,
          border: "1px solid var(--color-bt-border)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            background:
              "linear-gradient(160deg, #150a2e 0%, #1a0f35 50%, #120828 100%)",
            padding: "28px 20px 22px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 6,
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -50,
              left: -50,
              width: 180,
              height: 180,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(167,139,250,0.18) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              bottom: -40,
              right: -40,
              width: 140,
              height: 140,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(45,212,191,0.12) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 16,
              background:
                "linear-gradient(135deg, rgba(167,139,250,0.2), rgba(45,212,191,0.15))",
              border: "1px solid rgba(167,139,250,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 6,
              position: "relative",
              zIndex: 1,
            }}
          >
            <Trophy size={28} style={{ color: "#a78bfa" }} />
          </div>

          <h2
            style={{
              fontSize: 22,
              fontWeight: 900,
              lineHeight: 1.1,
              position: "relative",
              zIndex: 1,
              background:
                "linear-gradient(135deg, #a78bfa, var(--color-bt-accent))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Crown a Champion
          </h2>

          <p
            style={{
              fontSize: 13,
              color: "var(--color-bt-text-dim)",
              maxWidth: 270,
              lineHeight: 1.5,
              position: "relative",
              zIndex: 1,
            }}
          >
            Your group already has a rivalry. Give it a scoreboard, teams,
            and a live leaderboard.
          </p>
        </div>

        {/* Preview — mini leaderboard */}
        <div
          style={{
            margin: "16px 16px 0",
            borderRadius: 14,
            border: "1px solid var(--color-bt-border)",
            overflow: "hidden",
            background: "var(--color-bt-base)",
            padding: "10px 12px",
          }}
        >
          <p
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--color-bt-text-dim)",
              marginBottom: 8,
            }}
          >
            Leaderboard
          </p>
          <TeamBar name="USA" color="#3b82f6" pts={24} maxPts={24} />
          <TeamBar name="EUR" color="#ef4444" pts={18} maxPts={24} />
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            <RoundChip label="Scramble" status="closed" />
            <RoundChip label="Skins" status="active" />
            <RoundChip label="Singles" status="upcoming" />
          </div>
        </div>

        {/* Feature chips */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 6,
            padding: "14px 16px 4px",
          }}
        >
          {[
            { label: "Custom teams", Icon: Users },
            { label: "Live scoring", Icon: Zap },
            { label: "Leaderboard", Icon: Trophy },
          ].map(({ label, Icon }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 11px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              <Icon size={11} style={{ color: "var(--color-bt-accent)" }} />
              {label}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 20px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button
            onClick={onActivate}
            disabled={isActivating}
            data-testid="competition-intro-activate"
            style={{
              width: "100%",
              padding: 13,
              border: "none",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 800,
              cursor: isActivating ? "not-allowed" : "pointer",
              opacity: isActivating ? 0.7 : 1,
              background:
                "linear-gradient(135deg, #a78bfa, var(--color-bt-accent))",
              color: "#0d1f1a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {isActivating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ArrowRight size={16} />
            )}
            Enable Competition Mode
          </button>
          <button
            onClick={onClose}
            style={{
              fontSize: 13,
              color: "var(--color-bt-text-dim)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TeamBar ──────────────────────────────────────────────────────────────

function TeamBar({
  name,
  color,
  pts,
  maxPts,
}: {
  name: string;
  color: string;
  pts: number;
  maxPts: number;
}) {
  const pct = Math.max(0, Math.min(100, (pts / maxPts) * 100));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 4,
      }}
    >
      <span
        style={{
          width: 28,
          fontSize: 10,
          fontWeight: 700,
          color: "var(--color-bt-text)",
        }}
      >
        {name}
      </span>
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 999,
          background: "var(--color-bt-card-raised)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            borderRadius: 999,
          }}
        />
      </div>
      <span
        style={{
          width: 18,
          textAlign: "right",
          fontSize: 10,
          fontWeight: 700,
          color: "var(--color-bt-text)",
        }}
      >
        {pts}
      </span>
    </div>
  );
}

// ── RoundChip ────────────────────────────────────────────────────────────

function RoundChip({
  label,
  status,
}: {
  label: string;
  status: "closed" | "active" | "upcoming";
}) {
  const isActive = status === "active";
  const isDone = status === "closed";
  return (
    <div
      style={{
        flex: 1,
        padding: "4px 6px",
        borderRadius: 8,
        textAlign: "center",
        background: isActive
          ? "var(--color-bt-accent-faint)"
          : "var(--color-bt-card-raised)",
        border: `1px solid ${
          isActive ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"
        }`,
      }}
    >
      <p
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: isActive ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 8,
          color: "var(--color-bt-text-dim)",
        }}
      >
        {isDone ? "✓ done" : isActive ? "▶ live" : "soon"}
      </p>
    </div>
  );
}
