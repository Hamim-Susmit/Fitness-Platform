import { useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type ClassInstance = {
  id: string;
  schedule_id: string;
  gym_id: string;
  class_date: string;
  start_at: string;
  end_at: string;
  capacity: number;
  status: "scheduled" | "canceled" | "completed";
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

export type ClassType = {
  id: string;
  name: string;
  description: string | null;
};

const scheduleCacheKey = (gymId: string, filter: ClassFilter) =>
  `class-schedule:${gymId}:${filter.from}:${filter.to}:${filter.classTypeId ?? "all"}:${filter.instructorId ?? "all"}`;

// TODO: Add offline booking queue for actions that fail while disconnected.
// TODO: Explore background refresh for schedule updates when the app is minimized.

export function useMemberAccessState(memberId?: string) {
  return useQuery<{ access_state: string } | null>({
    queryKey: ["member-access-state", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_subscriptions")
        .select("access_state")
        .eq("member_id", memberId ?? "")
        .maybeSingle();
      return (data ?? null) as { access_state: string } | null;
    },
  });
}

export function useClassTypes(gymId?: string) {
  return useQuery<ClassType[]>({
    queryKey: ["class-types", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data } = await supabase
        .from("class_types")
        .select("id, name, description")
        .eq("gym_id", gymId ?? "")
        .order("name", { ascending: true });
      return (data ?? []) as ClassType[];
    },
  });
}

export function useClassInstances(gymId?: string, filter?: ClassFilter) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!gymId || !filter?.from || !filter?.to) {
      return;
    }

    const key = scheduleCacheKey(gymId, filter);
    AsyncStorage.getItem(key).then((cached) => {
      if (!cached) {
        return;
      }
      const parsed = JSON.parse(cached) as ClassInstance[];
      queryClient.setQueryData(["class-instances", gymId, filter], parsed);
    });
  }, [gymId, filter?.from, filter?.to, filter?.classTypeId, filter?.instructorId, queryClient]);

  return useQuery<ClassInstance[]>({
    queryKey: ["class-instances", gymId, filter],
    enabled: !!gymId && !!filter?.from && !!filter?.to,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      let query = supabase
        .from("class_instances")
        .select(
          "id, schedule_id, gym_id, class_date, start_at, end_at, capacity, status, class_schedules(id, class_type_id, instructor_id, class_types(name), instructors(id, bio, users(full_name)))"
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

      const { data, error } = await query;
      if (error) {
        throw new Error(error.message);
      }
      const instances = (data ?? []) as ClassInstance[];
      if (gymId && filter?.from && filter?.to) {
        const key = scheduleCacheKey(gymId, filter);
        await AsyncStorage.setItem(key, JSON.stringify(instances));
      }
      return instances;
    },
  });
}

export function useClassInstance(instanceId?: string) {
  return useQuery<ClassInstance | null>({
    queryKey: ["class-instance", instanceId],
    enabled: !!instanceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_instances")
        .select(
          "id, schedule_id, gym_id, class_date, start_at, end_at, capacity, status, class_schedules(id, class_type_id, instructor_id, class_types(name), instructors(id, bio, users(full_name)))"
        )
        .eq("id", instanceId ?? "")
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      return (data ?? null) as ClassInstance | null;
    },
  });
}

export function useMemberBookings(memberId?: string, instanceIds?: string[]) {
  return useQuery<{ class_instance_id: string; status: string; id: string; attendance_status: string }[]>({
    queryKey: ["class-bookings", memberId, instanceIds],
    enabled: !!memberId && (instanceIds?.length ?? 0) > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("class_bookings")
        .select("id, class_instance_id, status, attendance_status")
        .eq("member_id", memberId ?? "")
        .in("class_instance_id", instanceIds ?? []);
      return (data ?? []) as { class_instance_id: string; status: string; id: string; attendance_status: string }[];
    },
  });
}

export function useMemberWaitlist(memberId?: string, instanceIds?: string[]) {
  return useQuery<{ class_instance_id: string; status: string; id: string }[]>({
    queryKey: ["class-waitlist", memberId, instanceIds],
    enabled: !!memberId && (instanceIds?.length ?? 0) > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("class_waitlist")
        .select("id, class_instance_id, status")
        .eq("member_id", memberId ?? "")
        .in("class_instance_id", instanceIds ?? []);
      return (data ?? []) as { class_instance_id: string; status: string; id: string }[];
    },
  });
}

export function useBookingMaps(
  bookings?: { class_instance_id: string; status: string; id: string; attendance_status: string }[],
  waitlist?: { class_instance_id: string; status: string; id: string }[]
) {
  return useMemo(() => {
    const bookingMap = new Map<string, { status: string; id: string; attendance_status: string }>();
    const waitlistMap = new Map<string, { status: string; id: string }>();

    (bookings ?? []).forEach((booking) => bookingMap.set(booking.class_instance_id, booking));
    (waitlist ?? []).forEach((entry) => waitlistMap.set(entry.class_instance_id, entry));

    return { bookingMap, waitlistMap };
  }, [bookings, waitlist]);
}

export function useClassBookingCounts(instanceIds?: string[]) {
  return useQuery<{ class_instance_id: string; count: number }[]>({
    queryKey: ["class-booking-counts", instanceIds],
    enabled: (instanceIds?.length ?? 0) > 0,
    queryFn: async () => {
      const { data } = await supabase
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
