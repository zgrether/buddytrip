import { describe, it, expect, vi, afterEach } from "vitest";
import { currentPushEndpoint } from "./pushClient";

/**
 * `currentPushEndpoint` ALWAYS SETTLES.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * It used to `await navigator.serviceWorker.ready` unguarded. That promise does
 * not reject when no worker is registered — it never settles at all. So the
 * await hung, `useDevicePush` never set `probed`, and the notifications row read
 * **"Checking…" forever**, with no state, no explanation and no way forward.
 *
 * Found by opening the surface in a browser, not by a test: dev registers no
 * service worker at all (`ServiceWorkerRegistration` is production-only), so the
 * row is stuck 100% of the time locally. But it is reachable in PRODUCTION too —
 * registration is fire-and-forget with a swallowed `.catch`, and
 * `'serviceWorker' in navigator` is true in exactly the cases that then fail
 * (private browsing, a 404 on /sw.js, a partitioned storage context). The
 * `unsupported` state is derived BEFORE any of that and never catches it.
 *
 * ── Why the assertion is "resolves null" and not "does not hang" ────────────
 * A test cannot observe a hang directly — it can only time out, which reads as
 * infrastructure flake and gets retried away. Driving a fake clock past the
 * timeout and asserting a CONCRETE returned value makes the failure mode
 * unambiguous: without the race, the `await` below never resolves and the test
 * fails on vitest's own timeout with the promise still pending.
 */

type NavStub = { serviceWorker: { ready: Promise<unknown> } };

function stubNavigator(ready: Promise<unknown>) {
  vi.stubGlobal("window", {} as unknown);
  vi.stubGlobal("navigator", { serviceWorker: { ready } } satisfies NavStub);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("currentPushEndpoint — never hangs on serviceWorker.ready", () => {
  it("resolves null when no worker ever activates", async () => {
    vi.useFakeTimers();
    // A promise that NEVER settles — precisely what the browser hands back when
    // nothing is registered. Not a rejection; there is no error to catch.
    stubNavigator(new Promise(() => {}));

    const pending = currentPushEndpoint();
    await vi.advanceTimersByTimeAsync(3100);

    expect(await pending).toBeNull();
  });

  it("still reads a real subscription when the worker IS ready", async () => {
    // The control: the timeout must not have replaced the actual read. Without
    // this, deleting the `ready` await entirely and always returning null would
    // pass the test above.
    stubNavigator(
      Promise.resolve({
        pushManager: { getSubscription: async () => ({ endpoint: "https://push.test/abc" }) },
      })
    );

    expect(await currentPushEndpoint()).toBe("https://push.test/abc");
  });

  it("resolves null when the worker is ready but nothing is subscribed", async () => {
    stubNavigator(
      Promise.resolve({ pushManager: { getSubscription: async () => null } })
    );

    expect(await currentPushEndpoint()).toBeNull();
  });

  it("resolves null rather than throwing when the subscription read fails", async () => {
    stubNavigator(
      Promise.resolve({
        pushManager: {
          getSubscription: async () => {
            throw new Error("storage partitioned");
          },
        },
      })
    );

    expect(await currentPushEndpoint()).toBeNull();
  });
});
