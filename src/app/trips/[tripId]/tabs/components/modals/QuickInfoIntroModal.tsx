"use client";

import { AlertTriangle, ArrowRight, Bell, Info, Loader2, Plus } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// ── Types ────────────────────────────────────────────────────────────────

interface QuickInfoIntroModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivate: () => void;
  isActivating: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * QuickInfoIntroModal — owner-facing pitch for Quick Info tiles. The CTA
 * fires onActivate which (per spec) drops the user into the add-first-tile
 * flow; the parent panel handles the actual tile-creation UI.
 */
export function QuickInfoIntroModal({
  isOpen,
  onClose,
  onActivate,
  isActivating,
}: QuickInfoIntroModalProps) {
  useModalBackButton(onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
      data-testid="quick-info-intro-modal"
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
              "linear-gradient(160deg, #1a1500 0%, #1f1a00 50%, #151000 100%)",
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
                "radial-gradient(circle, rgba(251,191,36,0.18) 0%, transparent 70%)",
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
                "radial-gradient(circle, rgba(251,191,36,0.10) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 16,
              background:
                "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(251,191,36,0.1))",
              border: "1px solid rgba(251,191,36,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 6,
              position: "relative",
              zIndex: 1,
            }}
          >
            <Info size={28} style={{ color: "#fbbf24" }} />
          </div>

          <h2
            style={{
              fontSize: 22,
              fontWeight: 900,
              lineHeight: 1.1,
              position: "relative",
              zIndex: 1,
              background: "linear-gradient(135deg, #fbbf24, #fb923c)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            The Stuff Everyone Asks
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
            Door codes, check-in times, WiFi passwords, addresses — pin
            anything the crew will need at a glance.
          </p>
        </div>

        {/* Preview — 2x3 tile grid + crew alert row */}
        <div
          style={{
            margin: "16px 16px 0",
            borderRadius: 14,
            border: "1px solid var(--color-bt-border)",
            overflow: "hidden",
            background: "var(--color-bt-base)",
            padding: 10,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 6,
            }}
          >
            <PreviewTile label="Door code" value="1234#" />
            <PreviewTile label="Check-in" value="3:00 PM" />
            <PreviewTile label="WiFi" value="BT_Guest" />
            <PreviewTile label="Address" value="42 Oak St" />
            <PreviewTile label="Check-out" value="11:00 AM" />
            <PreviewTile label="Host" value="Brad · 555" />
          </div>
          <div
            style={{
              marginTop: 6,
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--color-bt-warning-faint)",
              border: "1px solid var(--color-bt-warning-border)",
              borderLeft: "3px solid var(--color-bt-warning)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <AlertTriangle size={12} style={{ color: "var(--color-bt-warning)" }} />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-bt-warning)",
              }}
            >
              Alert · Bring photo ID for check-in
            </span>
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
            { label: "Always visible", Icon: Info },
            { label: "Crew alerts", Icon: Bell },
            { label: "Add anything", Icon: Plus },
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
            data-testid="quick-info-intro-activate"
            style={{
              width: "100%",
              padding: 13,
              border: "none",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 800,
              cursor: isActivating ? "not-allowed" : "pointer",
              opacity: isActivating ? 0.7 : 1,
              background: "linear-gradient(135deg, #fbbf24, #fb923c)",
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
            Enable Quick Info Tiles
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

// ── PreviewTile ──────────────────────────────────────────────────────────

function PreviewTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        borderRadius: 8,
        padding: "6px 8px",
        opacity: 0.85,
      }}
    >
      <p style={{ fontSize: 8, color: "var(--color-bt-text-dim)", marginBottom: 2 }}>
        {label}
      </p>
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "var(--color-bt-text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </p>
    </div>
  );
}
