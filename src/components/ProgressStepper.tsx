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
  { key: "idea", label: "Idea" },
  { key: "planning", label: "Planning" },
  { key: "going", label: "Ready" },
  { key: "done", label: "Done" },
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

          return (
            <div key={step.key} className={`flex items-center ${isLast ? "" : "flex-1"}`}>
              {/* Circle */}
              <div className="flex flex-col items-center">
                <div
                  onClick={isTappable ? () => onStepClick(step.key) : undefined}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold lg:h-7 lg:w-7${isTappable ? " cursor-pointer transition-opacity hover:opacity-80" : ""}`}
                  style={{
                    background:
                      state === "completed" || state === "current"
                        ? "var(--color-bt-accent)"
                        : "var(--color-bt-card-raised)",
                    color:
                      state === "completed" || state === "current"
                        ? "var(--color-bt-base)"
                        : "var(--color-bt-text-dim)",
                    border:
                      state === "future"
                        ? "1.5px solid var(--color-bt-border)"
                        : "none",
                  }}
                >
                  {state === "completed" ? (
                    <Check size={14} strokeWidth={3} />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>

                {/* Label — desktop only */}
                <span
                  className="mt-1 hidden text-xs lg:block"
                  style={{
                    color:
                      state === "current"
                        ? "var(--color-bt-accent)"
                        : "var(--color-bt-text-dim)",
                    fontWeight: state === "current" ? 500 : 400,
                  }}
                >
                  {step.label}
                </span>
              </div>

              {/* Connecting line */}
              {!isLast && (
                <div
                  className="mx-1 h-0.5 flex-1 rounded-full lg:mx-2"
                  style={{
                    background:
                      state === "completed"
                        ? "var(--color-bt-accent)"
                        : "var(--color-bt-border)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: active step label centered below */}
      <p
        className="mt-1.5 text-center text-xs font-medium lg:hidden"
        style={{ color: "var(--color-bt-accent)" }}
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
