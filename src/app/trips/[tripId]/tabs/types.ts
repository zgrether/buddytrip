import type { TripRole } from "@/server/middleware";

export interface TripData {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  cost_tier?: string | null;
  image_url?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  poll_mode?: boolean | null;
  travel_enabled?: boolean | null;
  accommodation?: string | null;
  notes?: string | null;
  activities?: string[] | null;
  golf_courses?: string[] | null;
  comparison_mode?: boolean | null;
  locked_destination_title?: string | null;
  locked_destination_location?: string | null;
  locked_destination_at?: string | null;
  about_message?: string | null;
  /** Panel activation flag — owner taps the invitation card to flip this on. */
  itinerary_enabled?: boolean | null;
  created_at?: string | null;
}

export interface TabProps {
  trip: TripData;
  role: TripRole | null;
  canEdit: boolean;
  isOwner?: boolean;
  /**
   * Role is NOT YET KNOWN — a third state, distinct from owner and from member.
   * `role`/`canEdit`/`isOwner` all read as unprivileged while pending, so any
   * surface that branches on them must consult this before treating "not owner"
   * as "member". Optional: surfaces that don't branch on role can ignore it.
   */
  roleLoading?: boolean;
  /** In-place tab switcher exposed so cross-tab CTAs (e.g. Agenda's
   *  "Enable competition →") can navigate without doing a full page
   *  reload. Optional — tabs that don't need it can ignore. */
  onTabChange?: (
    tab: "home" | "crew" | "lodging" | "schedule" | "expenses" | "comp"
  ) => void;
}

export interface CatalogIdea {
  id: string;
  title: string;
  location: string;
  description: string;
  image_url?: string | null;
  cost_tier?: string | null;
  categories: string[];
  group_types: string[];
  trip_length?: string | null;
  region?: string | null;
  golf_courses: string[];
  activities: string[];
  accommodation?: string | null;
  tips?: string | null;
  sort_order: number;
}
