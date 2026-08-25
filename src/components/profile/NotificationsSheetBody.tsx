import { CheckboxBox } from "@/components/games/Checkbox";
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
  onTestSend,
  testBusy = false,
  testResult = null,
}: {
  state: DevicePushState;
  /** Browser/server reads still resolving — show neither a claim nor a control. */
  settling: boolean;
  busy: boolean;
  onToggleActivation: () => void;
  /** The category rows. Rendered only when this device is actually subscribed. */
  categorySlot: React.ReactNode;
  sectionLabelStyle: React.CSSProperties;
  /** Fire a self-only test push. Omitted → the whole section is absent. */
  onTestSend?: () => void;
  testBusy?: boolean;
  /** The last result, already turned into copy by `testSendMessage`. */
  testResult?: { message: string; tone: "success" | "error" } | null;
}) {
  const activation = activationCopy(state);

  // THE THREE RENDER DECISIONS, each stated once and used once.
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
  // Same gate as the categories, and for a stronger version of the same reason:
  // a test send with no subscription cannot produce a notification, so the
  // button would be an experiment whose result is known in advance. It is the
  // states BELOW `on` that need explaining, and the activation control above
  // already does that.
  const showTestSend = state === "on" && !!onTestSend;

  const activationSub = settling ? null : busy ? "Working…" : activation.sub || null;
  const activationBody = (
    <>
      <div className="min-w-0 flex-1">
        <div data-testid="activation-label" style={{ fontSize: 14, color: "var(--color-bt-text)" }}>
          {settling ? "Checking…" : activation.label}
        </div>
        {activationSub && (
          <div style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 2 }}>
            {activationSub}
          </div>
        )}
      </div>
      {showActivationToggle && <CheckboxBox on={state === "on"} className="mt-0.5" />}
    </>
  );

  return (
    <>
      {/*
        THE WHOLE ROW IS THE CONTROL, not just the box. A 20px target beside a
        300px one that does nothing invites taps on the words — and the words are
        where the eye goes. `role="checkbox"` therefore lives on the row and
        `CheckboxBox` is a picture of the state, because a button inside a button
        is invalid HTML.

        Where there is nothing to toggle (blocked / unsupported / still settling)
        this renders as a plain div rather than a disabled button: the states
        that offer no action should not look like an action that failed.
      */}
      {showActivationToggle ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={state === "on"}
          aria-label="Activate push notifications on this device"
          onClick={onToggleActivation}
          disabled={busy}
          className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-60"
        >
          {activationBody}
        </button>
      ) : (
        <div className="flex w-full items-start gap-3">{activationBody}</div>
      )}

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

      {/*
        THE SELF-TEST — the one control here that answers "is this device
        actually receiving?", which no amount of server-side logging can.

        `notifications.testSend` has existed and been production-safe since Push
        Phase 2 ("a permanent self-service 'is push working?' diagnostic"), and
        nothing has ever called it: `push_send_log` holds ZERO `test_send` rows.
        A diagnostic with no way to run it is not a diagnostic, and its absence
        is why a chat investigation had to be conducted through chat messages
        fighting a 30-minute coalescing gate for a signal this button produces on
        demand, to one device, in a second.

        Deliberately NOT a toast. The result is the point — it is read, compared
        against whether a notification actually appeared, and often read twice —
        and a toast that dismisses itself takes the answer away mid-sentence.
      */}
      {showTestSend && (
        <div className="mt-4" data-testid="test-send">
          <p style={sectionLabelStyle}>Check this device</p>
          <button
            type="button"
            onClick={onTestSend}
            disabled={testBusy}
            className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-60"
            style={{ borderTop: "0.5px solid var(--color-bt-border)" }}
          >
            <div className="min-w-0 flex-1">
              <div style={{ fontSize: 14, color: "var(--color-bt-text)" }}>
                {testBusy ? "Sending…" : "Send a test notification"}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 2 }}>
                {/* Says the SCOPE, because the fear this answers is "will this
                    buzz fifteen people?". It cannot: the procedure reads the
                    caller's own subscriptions and has no parameter for anyone
                    else. */}
                Goes only to your own devices — nobody else is notified.
              </div>
            </div>
          </button>
          {testResult && (
            <p
              data-testid="test-send-result"
              className="mt-2"
              style={{
                fontSize: 11,
                lineHeight: 1.45,
                color:
                  testResult.tone === "success"
                    ? "var(--color-bt-text-dim)"
                    : "var(--color-bt-danger)",
              }}
            >
              {testResult.message}
            </p>
          )}
        </div>
      )}
    </>
  );
}
