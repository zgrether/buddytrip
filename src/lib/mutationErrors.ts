/**
 * How a failed mutation is described to the person who tapped the button.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 * These predicates used to live inside `providers.tsx`, where the global
 * `mutationCache.onError` toasted **only** connectivity failures. Its comment
 * said server-rejected mutations were "handled at their call sites" — and the
 * call sites for finalize / correct / re-lock were empty `catch {}` blocks whose
 * own comments said "the global error toast surfaces the failure."
 *
 * Two comments, each delegating to the other, and neither one true. A server
 * rejection produced no toast, no message, no navigation and no state change:
 * **indistinguishable from success.**
 *
 * That went from theoretical to load-bearing when #784 made `games.finish` THROW
 * on a failed results write. Before it, finish swallowed the failure and marked
 * the game complete — a silent *wrong success*. After it, the server is correct
 * and the client eats the rejection — a silent *nothing*. Fixing the server
 * moved the silence one layer out rather than removing it.
 *
 * Extracted into its own module so the predicate that was wrong is directly
 * testable, rather than sealed inside a provider component.
 */

/** The `data.httpStatus` tRPC attaches to a rejection that reached a server. */
function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
  return typeof status === "number" && status > 0 ? status : undefined;
}

/**
 * The request never reached a server (dead zone / bad signal / DNS), as opposed
 * to a server that answered with a rejection. A transport failure carries no
 * HTTP status; a real response does.
 *
 * On a golf course the first case is common and the honest message is "we kept
 * your data" — which is why it stays a separate branch rather than collapsing
 * into the generic server-error path.
 */
export function isConnectivityError(error: unknown): boolean {
  // The absence of an HTTP status IS the signal, and it subsumes the rest.
  //
  // The original had four message sniffs (`fetch`, `network`, `load failed`,
  // `failed to fetch`) OR'd with `httpStatus === undefined`. Because the
  // undefined check was in the same disjunction, those sniffs could never change
  // the answer — anything they matched had already returned true. They read like
  // load-bearing heuristics and were dead. Dropped rather than carried forward,
  // so the one real rule is legible.
  return httpStatusOf(error) === undefined;
}

/** Last-resort copy when the server sent a rejection with nothing readable. */
export const GENERIC_MUTATION_ERROR = "That didn't save — please try again.";

/**
 * Is this "message" actually a serialized PAYLOAD?
 *
 * ── The rule, and why it is about JSON rather than about Zod ───────────────
 *
 * tRPC turns an input-validation failure into a `TRPCError` whose `message` is
 * `JSON.stringify(zodError.issues)` — so the message a surface renders is the
 * issue array itself. Saving a pick'em sheet with nothing picked put this on
 * screen, above the app's own "your sheet is still here":
 *
 *     [ { "origin": "array", "code": "too_small", "minimum": 1,
 *         "inclusive": true, "path": [ "picks" ],
 *         "message": "Too small: expected array to have >=1 items" } ]
 *
 * That is not a pick'em bug. EVERY mutation in the app carries a zod input
 * schema, and every one of them renders like this when the schema rejects, so
 * the fix belongs here rather than at the one call site that was noticed.
 *
 * Keyed on JSON-ness, not on Zod's vocabulary. A message that parses as JSON is
 * a machine payload whatever produced it — an array of issues today, an object
 * from some other layer tomorrow — and no message written for a person parses.
 * Sniffing for `"too_small"` or `"invalid_type"` would fix this instance and
 * miss the next one, which is exactly the shape of the gap.
 *
 * ── What the reader gets instead ───────────────────────────────────────────
 *
 * The generic sentence. A validation failure means the client sent something
 * the schema refuses, which is a contract bug rather than a condition the person
 * can do anything about — and the issue's own `message` ("expected array to have
 * >=1 items") is written for whoever wrote the schema. When such a rejection is
 * something a person SHOULD be able to act on, the fix is a real guard with a
 * real sentence, not a nicer rendering of the payload.
 */
function isSerializedPayload(msg: string): boolean {
  const first = msg[0];
  if (first !== "[" && first !== "{") return false;
  try {
    const parsed = JSON.parse(msg);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    // Starts like JSON and is not — a real sentence in brackets, so keep it.
    return false;
  }
}

/**
 * What to show for a mutation the SERVER rejected.
 *
 * Prefers the server's own message: these are written for people
 * ("Still saving scores — try again in a moment", "That idea isn't in your
 * archive") and are far more useful than a generic string. Falls back only when
 * the message is missing, is obvious internals, or is a serialized payload.
 *
 * Deliberately NOT filtered for "technical-looking" text beyond those cases.
 * A slightly raw message is recoverable; silence is not, and silence is the
 * failure mode this module exists to end.
 */
export function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const msg = raw.trim();
  if (!msg) return GENERIC_MUTATION_ERROR;
  // A stack trace or a bare object stringification helps nobody.
  if (msg.startsWith("[object ") || msg.includes("\n    at ")) return GENERIC_MUTATION_ERROR;
  // Neither does a validation payload — see `isSerializedPayload`.
  if (isSerializedPayload(msg)) return GENERIC_MUTATION_ERROR;
  return msg;
}
