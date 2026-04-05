"use client";

import { Check } from "lucide-react";
import type { TripDisplayStatus } from "@/lib/tripStatus";

interface ProgressStepperProps {
  stage: string;
  displayStatus: TripDisplayStatus;
  countdownText?: string | null;
  /** Called when a future step circle is tapped. Key is the step key ("idea"|"planning"|"going"|"done"). */
  onStepClick?: (stepKey: string) => void;
}

const STEPS = [
  { key: "idea",     label: "Idea",     color: "var(--color-bt-planning)" },
  { key: "planning", label: "Planning", color: "var(--color-bt-accent)"   },
  { key: "going",    label: "Ready",    color: "var(--color-bt-ready)"    },
  { key: "done",     label: "Done",     color: "var(--color-bt-warning)"  },
] as const;

function getCurrentIndex(stage: string, displayStatus: TripDisplayStatus): number {
  if (displayStatus === "past" || displayStatus === "saved") return 3;
  if (displayStatus === "now" || stage === "going") return 2;
  if (stage === "planning") return 1;
  return 0;
}

type StepState = "completed" | "current" | "future";

function getStepState(stepIndex: number, currentIndex: number): StepState {
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "current";
  return "future";
}

export function ProgressStepper({ stage, displayStatus, countdownText, onStepClick }: ProgressStepperProps) {
  const currentIndex = getCurrentIndex(stage, displayStatus);

  return (
    <div className="pt-3 pb-3">
      {/* Stepper row */}
      <div className="flex items-center">
        {STEPS.map((step, i) => {
          const state = getStepState(i, currentIndex);
          const isLast = i === STEPS.length - 1;
          const isTappable = onStepClick && state === "future" && i === currentIndex + 1;

          const circleStyle: React.CSSProperties =
            state === "current"
              ? { background: step.color, border: "none", color: "#ffffff" }
              : state === "completed"
              ? { background: "transparent", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)" }
              : { background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)" };

          return (
            <div key={step.key} className={`flex items-center ${isLast ? "" : "flex-1"}`}>
              {/* Circle */}
              <div className="flex flex-col items-center">
                <div
                  onClick={isTappable ? () => onStepClick(step.key) : undefined}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold lg:h-7 lg:w-7${isTappable ? " cursor-pointer transition-opacity hover:opacity-80" : ""}`}
                  style={circleStyle}
                >
                  {state === "completed" ? (
                    <Check size={12} strokeWidth={2.5} />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>

                {/* Label — desktop only */}
                <span
                  className="mt-1 hidden text-xs lg:block"
                  style={{
                    color: state === "current" ? step.color : "var(--color-bt-text-dim)",
                    fontWeight: state === "current" ? 500 : 400,
                  }}
                >
                  {step.label}
                </span>
              </div>

              {/* Connecting line — always gray */}
              {!isLast && (
                <div
                  className="mx-1 h-0.5 flex-1 rounded-full lg:mx-2"
                  style={{ background: "var(--color-bt-border)" }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: active step label centered below */}
      <p
        className="mt-1.5 text-center text-xs font-medium lg:hidden"
        style={{ color: STEPS[currentIndex].color }}
      >
        {STEPS[currentIndex].label}
      </p>

      {/* NOW countdown */}
      {countdownText && (
        <p
          className="mt-1 text-center text-xs"
          style={{ color: "var(--color-bt-warning)" }}
        >
          {countdownText}
        </p>
      )}
    </div>
  );
}
