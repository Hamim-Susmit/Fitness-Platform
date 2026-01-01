"use client";

import { useQuery } from "@tanstack/react-query";
import { callEdgeFunction } from "../api";

export type DateRangeOption = "7d" | "30d" | "90d";

export type AnalyticsMetrics = {
  avg_fill_rate: number;
  avg_attendance_rate: number;
  avg_no_show_rate: number;
  avg_waitlist_count: number;
};

export type TrendPoint = {
  date: string;
  bookings: number;
  attendance: number;
  waitlist: number;
};

export type TopClass = {
  class_type_id: string;
  gym_id: string;
  total_sessions: number;
  avg_fill_rate: number;
  avg_attendance_rate: number;
};

export type InstructorPerformance = {
  instructor_id: string;
  total_sessions: number;
  avg_attendance_rate: number;
  avg_fill_rate: number;
  member_feedback_score: number;
};

const rangeToDates = (range: DateRangeOption) => {
  const end = new Date();
  const start = new Date();
  if (range === "7d") start.setDate(end.getDate() - 6);
  if (range === "30d") start.setDate(end.getDate() - 29);
  if (range === "90d") start.setDate(end.getDate() - 89);
  return { start: start.toISOString(), end: end.toISOString() };
};

export function useClassTrends(gymId?: string, range: DateRangeOption = "30d") {
  const dateRange = rangeToDates(range);

  return useQuery<{ metrics: AnalyticsMetrics; trends: TrendPoint[]; top_classes: TopClass[]; instructor_performance: InstructorPerformance[] }>(
    {
      queryKey: ["class-trends", gymId, range],
      enabled: !!gymId,
      queryFn: async () => {
        const response = await callEdgeFunction("get-class-analytics", {
          body: { action: "GYM_TRENDS", gym_id: gymId, date_range: dateRange },
        });
        if (response.error || !response.data) {
          throw new Error(response.error ?? "Unable to load analytics");
        }
        return response.data as {
          metrics: AnalyticsMetrics;
          trends: TrendPoint[];
          top_classes: TopClass[];
          instructor_performance: InstructorPerformance[];
        };
      },
    }
  );
}

export function useClassTypeSummary(classTypeId?: string, range: DateRangeOption = "30d") {
  const dateRange = rangeToDates(range);

  return useQuery<{ total_sessions: number; avg_fill_rate: number; avg_attendance_rate: number; avg_waitlist_count: number }>(
    {
      queryKey: ["class-type-summary", classTypeId, range],
      enabled: !!classTypeId,
      queryFn: async () => {
        const response = await callEdgeFunction("get-class-analytics", {
          body: { action: "CLASS_TYPE_SUMMARY", class_type_id: classTypeId, date_range: dateRange },
        });
        if (response.error || !response.data) {
          throw new Error(response.error ?? "Unable to load class type summary");
        }
        return response.data as {
          total_sessions: number;
          avg_fill_rate: number;
          avg_attendance_rate: number;
          avg_waitlist_count: number;
        };
      },
    }
  );
}

export function useInstructorSummary(instructorId?: string, range: DateRangeOption = "30d") {
  const dateRange = rangeToDates(range);

  return useQuery<{ total_sessions: number; avg_fill_rate: number; avg_attendance_rate: number }>(
    {
      queryKey: ["instructor-summary", instructorId, range],
      enabled: !!instructorId,
      queryFn: async () => {
        const response = await callEdgeFunction("get-class-analytics", {
          body: { action: "INSTRUCTOR_SUMMARY", instructor_id: instructorId, date_range: dateRange },
        });
        if (response.error || !response.data) {
          throw new Error(response.error ?? "Unable to load instructor summary");
        }
        return response.data as { total_sessions: number; avg_fill_rate: number; avg_attendance_rate: number };
      },
    }
  );
}
