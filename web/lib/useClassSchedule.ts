import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "./supabase-browser";
import { callEdgeFunction } from "./api";

export type ClassInstance = {
  id: string;
  schedule_id: string;
  gym_id: string;
  class_date: string;
  start_at: string;
  end_at: string;
  capacity: number;
  status: "scheduled" | "canceled" | "completed";
  checkin_method: "manual" | "qr" | "hybrid";
  class_schedules: {
    id: string;
    class_type_id: string;
    instructor_id: string | null;
    class_types: { name: string } | null;
    instructors: { id: string; bio: string | null; users: { full_name: string | null } | null } | null;
  } | null;
};

export type ClassFilter = {
  from: string;
  to: string;
  classTypeId?: string;
  instructorId?: string;
};

export function useMemberAccessState(memberId?: string) {
  return useQuery<{ access_state: string } | null>({
    queryKey: ["member-access-state", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("member_subscriptions")
        .select("access_state")
        .eq("member_id", memberId ?? "")
        .maybeSingle();
      return (data ?? null) as { access_state: string } | null;
    },
  });
}

export function useClassInstances(gymId?: string, filter?: ClassFilter) {
  return useQuery<ClassInstance[]>({
    queryKey: ["class-instances", gymId, filter],
    enabled: !!gymId && !!filter?.from && !!filter?.to,
    queryFn: async () => {
      let query = supabaseBrowser
        .from("class_instances")
        .select(
          "id, schedule_id, gym_id, class_date, start_at, end_at, capacity, status, checkin_method, class_schedules(id, class_type_id, instructor_id, class_types(name), instructors(id, bio, users(full_name)))"
        )
        .eq("gym_id", gymId ?? "")
        .gte("start_at", `${filter?.from}T00:00:00Z`)
        .lte("start_at", `${filter?.to}T23:59:59Z`)
        .order("start_at", { ascending: true });

      if (filter?.classTypeId) {
        query = query.eq("class_schedules.class_type_id", filter.classTypeId);
      }
      if (filter?.instructorId) {
        query = query.eq("class_schedules.instructor_id", filter.instructorId);
      }

      const { data } = await query;
      return (data ?? []) as ClassInstance[];
    },
  });
}

export function useMemberBookings(memberId?: string, instanceIds?: string[]) {
  return useQuery<{ class_instance_id: string; status: string; id: string }[]>({
    queryKey: ["class-bookings", memberId, instanceIds],
    enabled: !!memberId && (instanceIds?.length ?? 0) > 0,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("class_bookings")
        .select("id, class_instance_id, status")
        .eq("member_id", memberId ?? "")
        .in("class_instance_id", instanceIds ?? []);
      return (data ?? []) as { class_instance_id: string; status: string; id: string }[];
    },
  });
}

export function useMemberWaitlist(memberId?: string, instanceIds?: string[]) {
  return useQuery<{ class_instance_id: string; status: string; id: string }[]>({
    queryKey: ["class-waitlist", memberId, instanceIds],
    enabled: !!memberId && (instanceIds?.length ?? 0) > 0,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("class_waitlist")
        .select("id, class_instance_id, status")
        .eq("member_id", memberId ?? "")
        .in("class_instance_id", instanceIds ?? []);
      return (data ?? []) as { class_instance_id: string; status: string; id: string }[];
    },
  });
}

export function useJoinWaitlist() {
  return useMutation({
    mutationFn: async (classInstanceId: string) => {
      const response = await callEdgeFunction<{ waitlist: unknown }>("join_waitlist", {
        body: { class_instance_id: classInstanceId },
      });
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to join waitlist");
      }
      return response.data;
    },
  });
}

export function useBookingMaps(
  bookings?: { class_instance_id: string; status: string; id: string }[],
  waitlist?: { class_instance_id: string; status: string; id: string }[]
) {
  return useMemo(() => {
    const bookingMap = new Map<string, { status: string; id: string }>();
    const waitlistMap = new Map<string, { status: string; id: string }>();

    (bookings ?? []).forEach((booking) => bookingMap.set(booking.class_instance_id, booking));
    (waitlist ?? []).forEach((entry) => waitlistMap.set(entry.class_instance_id, entry));

    return { bookingMap, waitlistMap };
  }, [bookings, waitlist]);
}

export function useStaffBookingCounts(instanceIds?: string[]) {
  return useQuery<{ class_instance_id: string; count: number }[]>({
    queryKey: ["class-booking-counts", instanceIds],
    enabled: (instanceIds?.length ?? 0) > 0,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("class_bookings")
        .select("class_instance_id")
        .in("class_instance_id", instanceIds ?? [])
        .eq("status", "booked");

      const counts = new Map<string, number>();
      (data ?? []).forEach((row) => {
        counts.set(row.class_instance_id, (counts.get(row.class_instance_id) ?? 0) + 1);
      });

      return Array.from(counts.entries()).map(([class_instance_id, count]) => ({
        class_instance_id,
        count,
      }));
    },
  });
}
