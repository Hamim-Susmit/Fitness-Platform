import { useQuery } from "@tanstack/react-query";
import { callEdgeFunction } from "../api";

export type GymAnalyticsRange = { from: string; to: string };

export type GymAnalyticsSummary = {
  total_checkins: number;
  unique_members: number;
  avg_checkins_per_member: number;
  avg_fill_rate: number;
  avg_attendance_rate: number;
  no_show_rate: number;
};

export type GymAnalyticsTimeSeries = {
  date: string;
  checkins: number;
  classes: number;
  avg_fill_rate: number;
  avg_attendance_rate: number;
};

export type GymAnalyticsClassType = {
  class_type_id: string;
  name: string;
  sessions: number;
  avg_fill_rate: number;
  avg_attendance_rate: number;
};

export type GymAnalyticsInstructor = {
  instructor_id: string;
  name: string;
  sessions: number;
  fill_rate: number;
  attendance_rate: number;
};

export type GymAnalyticsResponse = {
  summary: GymAnalyticsSummary;
  time_series: GymAnalyticsTimeSeries[];
  top_class_types: GymAnalyticsClassType[];
  top_instructors: GymAnalyticsInstructor[];
};

export function useGymAnalytics(gymId: string | null, range: GymAnalyticsRange | null) {
  return useQuery({
    queryKey: ["gym-analytics", gymId, range?.from, range?.to],
    enabled: !!gymId && !!range?.from && !!range?.to,
    queryFn: async () => {
      const response = await callEdgeFunction<GymAnalyticsResponse>("get-gym-analytics", {
        body: {
          gym_id: gymId,
          range,
        },
      });

      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to load gym analytics");
      }

      return response.data;
    },
  });
}
