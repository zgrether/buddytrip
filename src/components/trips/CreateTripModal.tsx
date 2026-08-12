"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { ScrollLock } from "@/hooks/useScrollLock";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import type { DestinationMode } from "@/components/DestinationPicker";
import { CreateTripFlow } from "./CreateTripFlow";

/**
 * Creating a trip, as an overlay over wherever you already are.
 *
 * ── Both platforms, and why that isn't the spec ─────────────────────────────
 * The brief said desktop navigated to `/trips/new` while mobile presented the
 * same flow as a modal, and asked for desktop to match. Mobile did NOT: every
 * entry point on both platforms did a `router.push("/trips/new")`. So there was
 * no existing presentation to match, and "make them agree" had two readings —
 * modal on desktop only (which would have CREATED the divergence the brief
 * believed it was fixing) or modal on both. Both, confirmed with Zach.
 *
 * ── The seventh dismiss implementation, not the eighth (#861) ───────────────
 * Structure, scrim strengths, drag handle, close button and back-button
 * handling are all lifted from `AddIdeasModal` (`IdeaZonePanel.tsx`), which
 * already hosts `EmptyStateOnboarding` — half of this very flow — in exactly
 * this shape. Nothing new is invented here: `useModalBackButton` pushes the
 * phantom history entry and owns the modal stack, `ScrollLock` handles nested
 * overlays, and the mobile/desktop split is the same pair of `lg:hidden` /
 * `hidden lg:flex` siblings rather than a JS branch.
 *
 * Back dismisses it, and that is the whole reason to use the shared hook rather
 * than a scrim and a boolean: the flow it replaced was a ROUTE, where back
 * worked for free. An overlay that swallowed back would be a regression
 * dressed as a polish pass.
 *
 * ── The route did not go ────────────────────────────────────────────────────
 * `/trips/new` still exists and renders the same `CreateTripFlow`. It is not a
 * legacy fallback — `auth/callback` redirects every organic signup there with a
 * server-side 302. See the note on the page itself.
 */
export function CreateTripModal({
  initialMode = null,
  onClose,
}: {
  initialMode?: DestinationMode;
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const router = useRouter();
  const [error, setError] = useState("");

  // The trip page is a route, so landing on it means leaving this overlay
  // behind — close first so the phantom history entry is popped by our own
  // cleanup rather than left in the stack ahead of the navigation.
  const onCreated = (tripId: string) => {
    onClose();
    router.push(`/trips/${tripId}`);
  };

  const body = (
    <>
      {error && (
        <div
          className="mb-6 rounded-lg border px-4 py-3 text-sm"
          style={{
            background: "var(--color-bt-danger-bg)",
            borderColor: "var(--color-bt-danger-border)",
            color: "var(--color-bt-danger)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}
      <CreateTripFlow initialMode={initialMode} onCreated={onCreated} onError={setError} />
    </>
  );

  return (
    <ScrollLock>
      {/* Mobile — bottom sheet */}
      <div
        className="fixed inset-0 z-50 flex items-end lg:hidden"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
        data-testid="create-trip-modal"
      >
        <div
          className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Start a trip"
        >
          {/* Drag handle */}
          <div className="flex shrink-0 justify-center pb-2 pt-3">
            <div className="h-1 w-8 rounded-full" style={{ background: "var(--color-bt-border)" }} />
          </div>
          <CloseButton onClose={onClose} />
          <div className="overflow-y-auto px-5 pb-8 pt-2">{body}</div>
        </div>
      </div>

      {/* Desktop — centered modal */}
      <div
        className="fixed inset-0 z-50 hidden items-start justify-center overflow-y-auto px-4 pt-16 lg:flex"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
        data-testid="create-trip-modal-desktop"
      >
        <div
          className="relative max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Start a trip"
        >
          <CloseButton onClose={onClose} />
          <div className="px-8 py-8">{body}</div>
        </div>
      </div>
    </ScrollLock>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close"
      className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      <X size={16} />
    </button>
  );
}
