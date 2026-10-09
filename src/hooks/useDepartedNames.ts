"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import { departedMap } from "@/lib/departedNames";

/**
 * userId -> the name the crew saw, for everyone who has LEFT this trip (PR 8d).
 * Merge it into a name map with `withDeparted` — for LOOKUP, never membership.
 *
 * Default cache policy rather than STRUCTURE_QUERY: a departure happens on some
 * other device as often as this one, and a name should not wait for a remount to
 * arrive. Removal also invalidates it on the device that did it (MemberEditor).
 */
export function useDepartedNames(tripId: string | null | undefined): ReadonlyMap<string, string> {
  const q = trpc.tripMembers.departedNames.useQuery({ tripId: tripId ?? "" }, { enabled: !!tripId });
  return useMemo(() => departedMap(q.data), [q.data]);
}
