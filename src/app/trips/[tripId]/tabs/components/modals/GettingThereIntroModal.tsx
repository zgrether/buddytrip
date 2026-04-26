"use client";

import { ArrowRight, Car, Loader2, Map, Plane } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// ── Types ────────────────────────────────────────────────────────────────

interface GettingThereIntroModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivate: () => void;
  isActivating: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * GettingThereIntroModal — owner-facing pitch shown when the Getting There
 * panel invitation card is tapped. Read-only preview of arrival rows + CTA
 * that fires trips.enableGettingThere via the parent.
 */
export function GettingThereIntroModal({
  isOpen,
  onClose,
  onActivate,
  isActivating,
}: GettingThereIntroModalProps) {
  useModalBackButton(isOpen ? onClose : () => {});
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
      data-testid="getting-there-intro-modal"
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
              "linear-gradient(160deg, #0d1f2e 0%, #0f2535 50%, #0d1a2a 100%)",
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
                "radial-gradient(circle, rgba(96,165,250,0.18) 0%, transparent 70%)",
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
                "linear-gradient(135deg, rgba(96,165,250,0.2), rgba(45,212,191,0.2))",
              border: "1px solid rgba(96,165,250,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 6,
              position: "relative",
              zIndex: 1,
            }}
          >
            <Plane size={28} style={{ color: "#60a5fa" }} />
          </div>

          <h2
            style={{
              fontSize: 22,
              fontWeight: 900,
              lineHeight: 1.1,
              position: "relative",
              zIndex: 1,
              background:
                "linear-gradient(135deg, #60a5fa, var(--color-bt-accent))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            No One Left Behind
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
            Everyone shares when they&apos;re arriving. Coordinate pickups,
            dinner times, and tee slots around real arrival times.
          </p>
        </div>

        {/* Preview card — three arrival rows */}
        <div
          style={{
            margin: "16px 16px 0",
            borderRadius: 14,
            border: "1px solid var(--color-bt-border)",
            overflow: "hidden",
            background: "var(--color-bt-base)",
          }}
        >
          <ArrivalRow
            name="Zach"
            detail="Delta 1733"
            time="3:42 PM"
            mode="flying"
          />
          <ArrivalRow
            name="Brad"
            detail="driving from Charlotte"
            time="~6:00 PM"
            mode="driving"
          />
          <ArrivalRow
            name="Rob"
            detail="Delta 847"
            time="5:30 PM"
            mode="flying"
            last
          />
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
            { label: "Arrival times", Icon: Plane },
            { label: "Flight details", Icon: Plane },
            { label: "Driving routes", Icon: Car },
            { label: "On the itinerary", Icon: Map },
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
            data-testid="getting-there-intro-activate"
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
                "linear-gradient(135deg, #60a5fa, var(--color-bt-accent))",
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
            Set Up Getting There
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

// ── ArrivalRow ────────────────────────────────────────────────────────────

function ArrivalRow({
  name,
  detail,
  time,
  mode,
  last,
}: {
  name: string;
  detail: string;
  time: string;
  mode: "flying" | "driving";
  last?: boolean;
}) {
  const isFlying = mode === "flying";
  const Icon = isFlying ? Plane : Car;
  const badgeStyle = isFlying
    ? {
        background: "var(--color-bt-accent-faint)",
        color: "var(--color-bt-accent)",
        border: "1px solid var(--color-bt-accent-border)",
      }
    : {
        background: "var(--color-bt-warning-faint)",
        color: "var(--color-bt-warning)",
        border: "1px solid var(--color-bt-warning-border)",
      };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderBottom: last ? undefined : "1px solid var(--color-bt-border)",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--color-bt-text)",
            marginBottom: 2,
          }}
        >
          {name}{" "}
          <span style={{ fontWeight: 400, color: "var(--color-bt-text-dim)" }}>
            · {detail}
          </span>
        </p>
        <p style={{ fontSize: 10, color: "var(--color-bt-text-dim)" }}>{time}</p>
      </div>
      <span
        style={{
          ...badgeStyle,
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: "2px 7px",
          borderRadius: 999,
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          flexShrink: 0,
        }}
      >
        <Icon size={9} />
        {isFlying ? "Flying" : "Driving"}
      </span>
    </div>
  );
}
