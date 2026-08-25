import { Checkbox } from "@/components/games/Checkbox";
import { activationCopy, type DevicePushState } from "@/lib/devicePushState";

/**
 * The notifications modal's BODY — the activation control and the slot the
 * category list sits in. Presentational only: props in, callbacks out, no tRPC,
 * no hooks, no data fetching.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * The same reason the scorecard components are (CLAUDE.md #7): the parent owns
 * persistence, the component owns what is on screen. Here it also makes the
 * thing testable at all — the suite runs `environment: "node"` and renders with
 * `renderToStaticMarkup`, so a component reaching for `useDevicePush` could only
 * be tested through a pile of tRPC mocks, and the four states this exists to get
 * right are exactly what would go untested.
 *
 * The category list arrives as a NODE rather than as data because each row owns
 * its own preference mutation. What this module decides is whether the list is
 * rendered AT ALL — which is the part with a real failure mode.
 */
export function NotificationsSheetBody({
  state,
  settling,
  busy,
  onToggleActivation,
  categorySlot,
  sectionLabelStyle,
}: {
  state: DevicePushState;
  /** Browser/server reads still resolving — show neither a claim nor a control. */
  settling: boolean;
  busy: boolean;
  onToggleActivation: () => void;
  /** The category rows. Rendered only when this device is actually subscribed. */
  categorySlot: React.ReactNode;
  sectionLabelStyle: React.CSSProperties;
}) {
  const activation = activationCopy(state);

  // THE TWO RENDER DECISIONS, both stated once and used once.
  //
  // A control appears only where a tap can achieve something. `blocked` and
  // `unsupported` are explanations, and drawing a disabled checkbox beside
  // "Blocked in your browser settings" would invite taps at a control with
  // nothing to wire to — the browser will not re-prompt after a denial, so
  // there is no action left to offer.
  const showActivationToggle = activation.actionable && !settling;
  // Categories exist only when the device is subscribed. Muting a category with
  // no subscription changes nothing, so the switches would be control over
  // nothing.
  const showCategories = state === "on";

  return (
    <>
      <div className="flex w-full items-start gap-3">
        <div className="min-w-0 flex-1">
          <div data-testid="activation-label" style={{ fontSize: 14, color: "var(--color-bt-text)" }}>
            {settling ? "Checking…" : activation.label}
          </div>
          {!settling && (
            <div style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 2 }}>
              {busy ? "Working…" : activation.sub}
            </div>
          )}
        </div>
        {showActivationToggle && (
          <Checkbox
            on={state === "on"}
            onClick={onToggleActivation}
            disabled={busy}
            label="Activate push notifications on this device"
            className="mt-0.5"
          />
        )}
      </div>

      {showCategories && (
        <div className="mt-4" data-testid="category-list">
          <p style={sectionLabelStyle}>Send me</p>
          {/*
            No expander. The categories only exist when the device is on, so the
            collapse this replaced was hiding two different things behind one
            control — a list that did not exist yet, and a list that did. Here
            the first case is an absent block and the second is always visible.
          */}
          {categorySlot}
          <p className="mt-3" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
            Everything starts on. Uncheck anything you would rather not be told about.
          </p>
        </div>
      )}
    </>
  );
}
