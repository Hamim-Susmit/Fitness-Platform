"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "../supabase-browser";
import { callEdgeFunction } from "../api";

export type ClassInstance = {
  id: string;
  gym_id: string;
  start_at: string;
  end_at: string;
  capacity: number;
  status: "scheduled" | "canceled" | "completed";
  class_schedules: {
    id: string;
    instructor_id: string | null;
    class_types: { name: string } | null;
    instructors: { users: { full_name: string | null } | null } | null;
  } | null;
};

export type RosterMember = {
  booking_id: string;
  member_id: string;
  member_name: string;
  status: string;
  attendance_status: string;
  attendance_marked_at: string | null;
  booking_type: "plan" | "drop-in";
};

export type WaitlistMember = {
  waitlist_id: string;
  member_id: string;
  member_name: string;
  status: string;
  position: number;
};

type RosterResponse = {
  instance: ClassInstance;
  roster: RosterMember[];
  waitlist: WaitlistMember[];
};

export function useClassInstance(instanceId?: string) {
  const queryClient = useQueryClient();

  const instanceQuery = useQuery<ClassInstance | null>({
    queryKey: ["class-instance", instanceId],
    enabled: !!instanceId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("class_instances")
        .select(
          "id, gym_id, start_at, end_at, capacity, status, class_schedules(id, instructor_id, class_types(name), instructors(users(full_name)))"
        )
        .eq("id", instanceId ?? "")
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? null) as ClassInstance | null;
    },
  });

  const rosterQuery = useQuery<RosterResponse | null>({
    queryKey: ["class-roster", instanceId],
    enabled: !!instanceId,
    queryFn: async () => {
      const response = await callEdgeFunction<RosterResponse>("manage-class-roster", {
        body: { action: "GET_ROSTER", instance_id: instanceId },
      });
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to load roster");
      }
      return response.data;
    },
  });

  const rescheduleQuery = useQuery<{ created_at: string } | null>({
    queryKey: ["class-instance-reschedule", instanceId],
    enabled: !!instanceId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("class_instance_events")
        .select("created_at")
        .eq("instance_id", instanceId ?? "")
        .eq("event_type", "CLASS_RESCHEDULED")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? null) as { created_at: string } | null;
    },
  });

  useEffect(() => {
    if (!instanceId) return;

    const channel = supabaseBrowser
      .channel(`class-roster-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "class_bookings", filter: `class_instance_id=eq.${instanceId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["class-roster", instanceId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "class_waitlist", filter: `class_instance_id=eq.${instanceId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["class-roster", instanceId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "class_instances", filter: `id=eq.${instanceId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["class-instance", instanceId] });
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [instanceId, queryClient]);

  const roster = rosterQuery.data?.roster ?? [];
  const waitlist = rosterQuery.data?.waitlist ?? [];

  const stats = useMemo(() => {
    const bookedCount = roster.filter((entry) => entry.status === "booked").length;
    const attendedCount = roster.filter((entry) => entry.attendance_status === "checked_in").length;
    const waitlistCount = waitlist.length;
    return { bookedCount, attendedCount, waitlistCount };
  }, [roster, waitlist]);

  return {
    instance: instanceQuery.data ?? rosterQuery.data?.instance ?? null,
    roster,
    waitlist,
    stats,
    rescheduledAt: rescheduleQuery.data?.created_at ?? null,
    isLoading: instanceQuery.isLoading || rosterQuery.isLoading,
    isError: instanceQuery.isError || rosterQuery.isError,
    refetch: () => {
      instanceQuery.refetch();
      rosterQuery.refetch();
      rescheduleQuery.refetch();
    },
  };
}
