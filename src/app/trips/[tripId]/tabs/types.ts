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
  stage?: string | null;
  stage_advanced_to_planning_at?: string | null;
  stage_advanced_to_going_at?: string | null;
  about_message?: string | null;
  /** Panel activation flags — owner taps the invitation card to flip these on. */
  itinerary_enabled?: boolean | null;
  getting_there_enabled?: boolean | null;
  quick_info_enabled?: boolean | null;
  /** When false, the Travel Plans panel is hidden from non-owners. Defaults to true. */
  travel_plans_crew_visible?: boolean | null;
  /** @deprecated — column kept in DB but no longer read; the dismiss workflow
   *  has been retired in favor of the standard enable/disable activation flow. */
  quick_info_dismissed?: boolean | null;
  trip_status_override?: string | null;
  series_id?: string | null;
  created_at?: string | null;
  last_blast_sent_at?: string | null;
}

export interface TabProps {
  trip: TripData;
  role: TripRole | null;
  canEdit: boolean;
  isOwner?: boolean;
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
