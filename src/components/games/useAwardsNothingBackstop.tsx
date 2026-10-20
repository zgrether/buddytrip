"use client";

import { useState, type ReactNode } from "react";
import { AWARD_WORD } from "@/lib/vocabulary";
import { PickemFinalizePrompt } from "./pickem/PickemFinalizePrompt";

/**
 * The finish-time backstop (#1668, #1639 c): a game whose points are on offer
 * and would award none still finishes, but asks first.
 *
 * ONE copy for every format. Stroke and skins each grew the same state, the
 * same branch on the finalize handler and the same prompt markup; the formats
 * that show projected points in their header take the same question, and a
 * fifth private copy is how they would come to word it differently (CLAUDE.md
 * #24).
 *
 * The view decides `awardsNothing` from the SAME numbers its header or summary
 * shows, so the prompt never disagrees with what is on screen. The view renders
 * `prompt` wherever it likes; it is portaled.
 */
export function useAwardsNothingBackstop({
  awardsNothing,
  finalize,
  pending,
}: {
  awardsNothing: boolean;
  finalize: () => unknown;
  pending: boolean;
}): { onFinalize: () => void; prompt: ReactNode } {
  const [asking, setAsking] = useState(false);
  const onFinalize = () => {
    if (awardsNothing) setAsking(true);
    else void finalize();
  };
  const prompt = asking ? (
    <PickemFinalizePrompt
      title={AWARD_WORD.none}
      confirmLabel="Finish anyway"
      cancelLabel="Cancel"
      pending={pending}
      onConfirm={() => {
        setAsking(false);
        void finalize();
      }}
      onCancel={() => setAsking(false)}
    />
  ) : null;
  return { onFinalize, prompt };
}
