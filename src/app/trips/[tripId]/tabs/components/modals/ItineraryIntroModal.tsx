"use client";

import { ArrowRight, Calendar, Home, Loader2, MapPin, Plane } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// ── Types ────────────────────────────────────────────────────────────────

interface ItineraryIntroModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivate: () => void;
  isActivating: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * ItineraryIntroModal — owner-facing pitch shown when the Itinerary panel
 * invitation card is tapped. Read-only preview + "Add Itinerary" CTA that
 * fires the parent's onActivate (which in turn calls trips.enableItinerary).
 *
 * Visual language: dark gradient hero with teal/blue blob accents. Hex
 * values inside the gradient art are intentional (token system covers
 * structural surfaces, not gradient art — same precedent as
 * UnlockAdvancedModal).
 */
export function ItineraryIntroModal({
  isOpen,
  onClose,
  onActivate,
  isActivating,
}: ItineraryIntroModalProps) {
  useModalBackButton(onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
      data-testid="itinerary-intro-modal"
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
              "linear-gradient(160deg, #0d2030 0%, #0f1f35 50%, #131525 100%)",
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
                "radial-gradient(circle, rgba(45,212,191,0.18) 0%, transparent 70%)",
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
                "radial-gradient(circle, rgba(96,165,250,0.14) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 16,
              background:
                "linear-gradient(135deg, rgba(45,212,191,0.2), rgba(96,165,250,0.2))",
              border: "1px solid rgba(45,212,191,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 6,
              position: "relative",
              zIndex: 1,
            }}
          >
            <Calendar size={28} style={{ color: "var(--color-bt-accent)" }} />
          </div>

          <h2
            style={{
              fontSize: 22,
              fontWeight: 900,
              lineHeight: 1.1,
              position: "relative",
              zIndex: 1,
              background:
                "linear-gradient(135deg, var(--color-bt-accent), #60a5fa)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Your Trip, Day by Day
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
            Lodging check-ins, travel arrivals, and scheduled events — all
            woven into one timeline automatically.
          </p>
        </div>

        {/* Preview card — two day sections */}
        <div
          style={{
            margin: "16px 16px 0",
            borderRadius: 14,
            border: "1px solid var(--color-bt-border)",
            overflow: "hidden",
            background: "var(--color-bt-base)",
          }}
        >
          <PreviewDay
            label="Day 1"
            isToday
            items={[
              { kind: "lodging", text: "Check in lodging", time: "3:00 PM" },
              { kind: "travel", text: "Travel arrival", time: "5:30 PM" },
              { kind: "event", text: "Welcome dinner", time: "7:30 PM" },
            ]}
          />
          <div style={{ borderTop: "1px solid var(--color-bt-border)" }}>
            <PreviewDay
              label="Day 2"
              items={[{ kind: "event", text: "Tee time", time: "8:00 AM" }]}
            />
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
            { label: "Day-by-day view", Icon: Calendar },
            { label: "Travel woven in", Icon: Plane },
            { label: "Lodging auto-added", Icon: Home },
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
            data-testid="itinerary-intro-activate"
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
                "linear-gradient(135deg, var(--color-bt-accent), #60a5fa)",
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
            Add Itinerary
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

// ── PreviewDay ────────────────────────────────────────────────────────────

function PreviewDay({
  label,
  isToday,
  items,
}: {
  label: string;
  isToday?: boolean;
  items: Array<{ kind: "lodging" | "travel" | "event"; text: string; time: string }>;
}) {
  return (
    <div style={{ padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {isToday && (
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-bt-accent)",
            }}
          />
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: isToday ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it, i) => (
          <PreviewRow key={i} kind={it.kind} text={it.text} time={it.time} />
        ))}
      </div>
    </div>
  );
}

function PreviewRow({
  kind,
  text,
  time,
}: {
  kind: "lodging" | "travel" | "event";
  text: string;
  time: string;
}) {
  const palette = {
    lodging: { color: "#60a5fa", border: "rgba(96,165,250,0.25)", Icon: Home },
    travel: { color: "var(--color-bt-accent)", border: "var(--color-bt-accent-border)", Icon: Plane },
    event: { color: "var(--color-bt-text-dim)", border: "var(--color-bt-border)", Icon: MapPin },
  }[kind];
  const { color, border, Icon } = palette;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "5px 8px",
        borderRadius: 8,
        border: `1px solid ${border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Icon size={12} style={{ color }} />
        <span
          style={{
            fontSize: 11,
            color: "var(--color-bt-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </span>
      </div>
      <span style={{ fontSize: 10, color: "var(--color-bt-text-dim)", flexShrink: 0 }}>
        {time}
      </span>
    </div>
  );
}
