"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";

interface FrequentTripmate {
  id: string;
  name: string | null;
  nickname: string | null;
  email: string | null;
}

export function useFrequentTripmates(currentTripId: string, currentUserId: string) {
  return useQuery({
    queryKey: ["frequent-tripmates", currentUserId, currentTripId],
    queryFn: async (): Promise<FrequentTripmate[]> => {
      const supabase = createClient();

      // Get all trips current user has been on (excluding current trip)
      const { data: myTrips } = await supabase
        .from("trip_members")
        .select("trip_id")
        .eq("user_id", currentUserId)
        .neq("trip_id", currentTripId);

      if (!myTrips?.length) return [];

      const tripIds = myTrips.map((t) => t.trip_id);

      // Get all members of those trips (excluding current user)
      const { data: tripmates } = await supabase
        .from("trip_members")
        .select("user_id, users(id, name, nickname, email)")
        .in("trip_id", tripIds)
        .neq("user_id", currentUserId);

      if (!tripmates?.length) return [];

      // Count frequency per user
      const counts: Record<string, { user: FrequentTripmate; count: number }> = {};
      for (const tm of tripmates) {
        const uid = tm.user_id;
        if (!uid) continue;
        const user = Array.isArray(tm.users) ? tm.users[0] : tm.users;
        if (!user) continue;
        if (!counts[uid]) counts[uid] = { user: user as FrequentTripmate, count: 0 };
        counts[uid].count++;
      }

      // Get current trip's attendee IDs to exclude
      const { data: currentAttendees } = await supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", currentTripId);

      const alreadyOn = new Set(currentAttendees?.map((a) => a.user_id) ?? []);

      // Return top 8, sorted by frequency, excluding already-on-trip users
      return Object.values(counts)
        .filter((c) => !alreadyOn.has(c.user.id))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((c) => c.user);
    },
    enabled: !!currentUserId && !!currentTripId,
  });
}
