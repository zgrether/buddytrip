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
 * What to show for a mutation the SERVER rejected.
 *
 * Prefers the server's own message: these are written for people
 * ("Still saving scores — try again in a moment", "That idea isn't in your
 * archive") and are far more useful than a generic string. Falls back only when
 * the message is missing or is obvious internals.
 *
 * Deliberately NOT filtered for "technical-looking" text beyond the empty case.
 * A slightly raw message is recoverable; silence is not, and silence is the
 * failure mode this module exists to end.
 */
export function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const msg = raw.trim();
  if (!msg) return GENERIC_MUTATION_ERROR;
  // A stack trace or a bare object stringification helps nobody.
  if (msg.startsWith("[object ") || msg.includes("\n    at ")) return GENERIC_MUTATION_ERROR;
  return msg;
}
