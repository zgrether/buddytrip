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
  date_set_method?: "direct" | "poll" | null;
  date_poll_active?: boolean | null;
  date_poll_state?: "draft" | "active" | "closed" | null;
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
  owner_alert?: string | null;
  owner_alert_set_at?: string | null;
  owner_alert_set_by?: string | null;
  trip_status_override?: string | null;
  event_id?: string | null;
  series_id?: string | null;
  created_at?: string | null;
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
