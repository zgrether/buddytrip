/**
 * Is a realtime channel dead, given the status Supabase just delivered to its
 * subscribe callback? The ONE answer for the four ref-counted hooks
 * (`useRealtimeChat`, `useRealtimeMembers`, `useRealtimeMyDelegations`,
 * `useRealtimeScoreEvents`), each of which logs when it is (CLAUDE.md #22: a
 * dead subscription must say so).
 *
 * `CHANNEL_ERROR` and `TIMED_OUT` always mean dead. `CLOSED` means dead only
 * when nobody closed it on purpose: supabase-js also delivers `CLOSED` after our
 * own `removeChannel`, so before this every intentional teardown (React's
 * double mount in dev, leaving a trip in production) logged a false "not live"
 * per channel, and a channel that genuinely closed read exactly the same (#1565).
 *
 * `tornDown` is the hook's own record that it released the channel. It belongs
 * to the registry ENTRY, not the topic, so a fresh channel on the same topic
 * after a teardown starts out live.
 */
export function isDeadChannel(status: string, tornDown: boolean): boolean {
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") return true;
  return status === "CLOSED" && !tornDown;
}
