"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../lib/roles";
import { useActiveGym } from "../../../lib/useActiveGym";

type InstructorProfile = { id: string; gym_id: string };

type ClassInstance = {
  id: string;
  start_at: string;
  end_at: string;
  capacity: number;
  status: string;
  class_schedules: {
    instructor_id: string | null;
    class_types: { name: string } | null;
    instructors: { users: { full_name: string | null } | null } | null;
  } | null;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function ClassesList() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const { activeGymId, loading: gymsLoading } = useActiveGym();

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role === "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  const { data: instructorProfile } = useQuery<InstructorProfile | null>({
    queryKey: ["instructor-profile", session?.user.id],
    enabled: !!session?.user.id && !isStaffRole(role),
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("instructors")
        .select("id, gym_id")
        .eq("user_id", session?.user.id ?? "")
        .eq("active", true)
        .maybeSingle();
      return (data ?? null) as InstructorProfile | null;
    },
  });

  useEffect(() => {
    if (instructorProfile?.gym_id) {
      setInstructorId(instructorProfile.id);
    }
  }, [instructorProfile]);

  const today = useMemo(() => new Date().toISOString(), []);

  const { data: instances = [], isLoading } = useQuery<ClassInstance[]>({
    queryKey: ["staff-classes", activeGymId, instructorId],
    enabled: !!activeGymId,
    queryFn: async () => {
      let query = supabaseBrowser
        .from("class_instances")
        .select(
          "id, start_at, end_at, capacity, status, class_schedules(instructor_id, class_types(name), instructors(users(full_name)))"
        )
        .gte("start_at", today)
        .order("start_at", { ascending: true });

      if (instructorId) {
        query = query.eq("class_schedules.instructor_id", instructorId);
      } else if (activeGymId) {
        query = query.eq("gym_id", activeGymId);
      }

      const { data } = await query;
      return (data ?? []) as ClassInstance[];
    },
  });

  const instanceIds = useMemo(() => instances.map((instance) => instance.id), [instances]);

  const { data: bookings = [] } = useQuery<{ class_instance_id: string }[]>({
    queryKey: ["staff-classes-bookings", instanceIds],
    enabled: instanceIds.length > 0,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("class_bookings")
        .select("class_instance_id")
        .in("class_instance_id", instanceIds)
        .eq("status", "booked");
      return (data ?? []) as { class_instance_id: string }[];
    },
  });

  const { data: waitlist = [] } = useQuery<{ class_instance_id: string }[]>({
    queryKey: ["staff-classes-waitlist", instanceIds],
    enabled: instanceIds.length > 0,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("class_waitlist")
        .select("class_instance_id")
        .in("class_instance_id", instanceIds)
        .eq("status", "waiting");
      return (data ?? []) as { class_instance_id: string }[];
    },
  });

  const bookingCounts = useMemo(() => {
    const map = new Map<string, number>();
    bookings.forEach((row) => map.set(row.class_instance_id, (map.get(row.class_instance_id) ?? 0) + 1));
    return map;
  }, [bookings]);

  const waitlistCounts = useMemo(() => {
    const map = new Map<string, number>();
    waitlist.forEach((row) => map.set(row.class_instance_id, (map.get(row.class_instance_id) ?? 0) + 1));
    return map;
  }, [waitlist]);

  if (loading || !session) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Upcoming Classes</h1>
            <p className="text-sm text-slate-400">Manage rosters, attendance, and updates.</p>
          </div>
          <div className="text-xs text-slate-500">Switch locations from the header.</div>
        </div>
        {!gymsLoading && !activeGymId ? (
          <p className="mt-6 text-sm text-slate-400">No active gym access — contact support.</p>
        ) : null}
        {isLoading ? <p className="mt-6 text-sm text-slate-400">Loading classes...</p> : null}
        {!isLoading && instances.length === 0 ? (
          <p className="mt-6 text-sm text-slate-400">No upcoming classes found.</p>
        ) : null}
        <div className="mt-6 grid gap-4">
          {instances.map((instance) => {
            const className = instance.class_schedules?.class_types?.name ?? "Class";
            const instructorName = instance.class_schedules?.instructors?.users?.full_name ?? "Staff";
            const booked = bookingCounts.get(instance.id) ?? 0;
            const waiting = waitlistCounts.get(instance.id) ?? 0;
            const start = new Date(instance.start_at);
            const end = new Date(instance.end_at);

            return (
              <Link
                key={instance.id}
                href={`/staff/classes/${instance.id}`}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-700"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{className}</h2>
                    <p className="text-sm text-slate-400">Instructor: {instructorName}</p>
                  </div>
                  <span className="text-sm text-slate-400">
                    {start.toLocaleDateString()} · {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-300">
                  <span className="rounded-full bg-slate-800 px-2 py-1">Capacity {instance.capacity}</span>
                  <span className="rounded-full bg-slate-800 px-2 py-1">Booked {booked}</span>
                  <span className="rounded-full bg-slate-800 px-2 py-1">Waitlist {waiting}</span>
                  {instance.status !== "scheduled" ? (
                    <span className="rounded-full bg-rose-500/10 px-2 py-1 text-rose-300">{instance.status}</span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export default function StaffClassesPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ClassesList />
    </QueryClientProvider>
  );
}
