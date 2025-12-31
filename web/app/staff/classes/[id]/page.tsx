"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { callEdgeFunction } from "../../../../lib/api";
import { useClassInstance } from "../../../../lib/hooks/useClassInstance";
import { useRosterActions } from "../../../../lib/hooks/useRosterActions";

// TODO: Instructor performance analytics.
// TODO: Per-class revenue reporting.
// TODO: CSV export of roster.
// TODO: Bulk attendance import.
// TODO: Substitute instructor mode.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function ClassManagementConsole() {
  const router = useRouter();
  const params = useParams();
  const instanceId = params?.id as string | undefined;
  const { session, role, loading } = useAuthStore();
  const { message, status, setToast } = useToastStore();
  const queryCache = useQueryClient();
  const { instance, roster, waitlist, stats, rescheduledAt, isLoading, isError, refetch } = useClassInstance(instanceId);
  const { markAttended, removeMember, promoteFromWaitlist } = useRosterActions(instanceId);
  const [capacity, setCapacity] = useState<number | "">("");
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role === "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    if (instance) {
      setCapacity(instance.capacity);
      setStartTime(new Date(instance.start_at).toISOString().slice(0, 16));
      setEndTime(new Date(instance.end_at).toISOString().slice(0, 16));
    }
  }, [instance]);

  const instanceStatus = instance?.status ?? "scheduled";
  const isCanceled = instanceStatus !== "scheduled";
  const isPast = instance ? new Date(instance.end_at).getTime() < Date.now() : false;
  const editsDisabled = isCanceled || isPast;
  const bookedCount = stats.bookedCount;
  const waitlistCount = stats.waitlistCount;
  const attendedCount = stats.attendedCount;
  const isFull = instance ? bookedCount >= instance.capacity : false;

  const updateCapacity = useMutation({
    mutationFn: async () => {
      const response = await callEdgeFunction("manage-class-instance", {
        body: { action: "UPDATE_CAPACITY", instance_id: instanceId, new_capacity: Number(capacity) },
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: () => {
      setToast("Capacity updated", "success");
      queryCache.invalidateQueries({ queryKey: ["class-instance", instanceId] });
      setTimeout(() => setToast(null, null), 3000);
    },
    onError: (error) => {
      setToast(error.message, "error");
      setTimeout(() => setToast(null, null), 3000);
    },
  });

  const rescheduleClass = useMutation({
    mutationFn: async () => {
      const response = await callEdgeFunction("manage-class-instance", {
        body: { action: "RESCHEDULE", instance_id: instanceId, start_time: startTime, end_time: endTime },
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: () => {
      setToast("Class rescheduled", "success");
      queryCache.invalidateQueries({ queryKey: ["class-instance", instanceId] });
      queryCache.invalidateQueries({ queryKey: ["class-instance-reschedule", instanceId] });
      setTimeout(() => setToast(null, null), 3000);
    },
    onError: (error) => {
      setToast(error.message, "error");
      setTimeout(() => setToast(null, null), 3000);
    },
  });

  const cancelClass = useMutation({
    mutationFn: async () => {
      const response = await callEdgeFunction("manage-class-instance", {
        body: { action: "CANCEL_CLASS", instance_id: instanceId, reason: cancelReason || undefined },
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: () => {
      setToast("Class cancelled", "success");
      queryCache.invalidateQueries({ queryKey: ["class-instance", instanceId] });
      setCancelOpen(false);
      setCancelReason("");
      setTimeout(() => setToast(null, null), 3000);
    },
    onError: (error) => {
      setToast(error.message, "error");
      setTimeout(() => setToast(null, null), 3000);
    },
  });

  if (loading || !session) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <main className="mx-auto max-w-5xl px-6 py-8">
          <p className="text-sm text-slate-400">Loading class details...</p>
        </main>
      </div>
    );
  }

  if (isError || !instance) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <main className="mx-auto max-w-5xl px-6 py-8">
          <p className="text-sm text-rose-400">Unable to load class details.</p>
        </main>
      </div>
    );
  }

  const className = instance.class_schedules?.class_types?.name ?? "Class";
  const instructorName = instance.class_schedules?.instructors?.users?.full_name ?? "Staff";
  const start = new Date(instance.start_at);
  const end = new Date(instance.end_at);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {message ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              status === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            {message}
          </div>
        ) : null}
        {isCanceled ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            This class is cancelled. Roster edits are locked except attendance.
          </div>
        ) : null}
        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">{className}</h1>
                <p className="text-sm text-slate-400">Instructor: {instructorName}</p>
              </div>
              <div className="text-sm text-slate-300">
                {start.toLocaleDateString()} · {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-300">
              <span className="rounded-full bg-slate-800 px-2 py-1">Capacity {instance.capacity}</span>
              <span className="rounded-full bg-slate-800 px-2 py-1">Booked {bookedCount}</span>
              <span className="rounded-full bg-slate-800 px-2 py-1">Waitlist {waitlistCount}</span>
              <span className="rounded-full bg-slate-800 px-2 py-1">Attended {attendedCount}</span>
              {rescheduledAt ? (
                <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-200">Updated</span>
              ) : null}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
            <h2 className="text-lg font-semibold">Actions</h2>
            <div>
              <label className="text-xs uppercase text-slate-400">Capacity</label>
              <div className="mt-2 flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value === "" ? "" : Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  disabled={editsDisabled}
                />
                <button
                  className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
                  onClick={() => updateCapacity.mutate()}
                  disabled={editsDisabled || updateCapacity.isPending || capacity === ""}
                >
                  {updateCapacity.isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-400">Reschedule</label>
              <div className="mt-2 grid gap-2">
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  disabled={editsDisabled}
                />
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  disabled={editsDisabled}
                />
                <button
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-white disabled:opacity-60"
                  onClick={() => rescheduleClass.mutate()}
                  disabled={editsDisabled || rescheduleClass.isPending}
                >
                  {rescheduleClass.isPending ? "Rescheduling..." : "Reschedule"}
                </button>
              </div>
            </div>
            <div>
              <button
                className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 disabled:opacity-60"
                onClick={() => setCancelOpen(true)}
                disabled={editsDisabled || cancelClass.isPending}
              >
                Cancel Class
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Roster</h2>
            <button
              className="text-xs text-slate-400 hover:text-slate-200"
              onClick={refetch}
              disabled={isLoading}
            >
              Refresh
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Member</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-left">Booking</th>
                  <th className="py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {roster.map((entry) => {
                  const attended = entry.attendance_status === "checked_in";
                  return (
                    <tr key={entry.booking_id}>
                      <td className="py-3 text-white">{entry.member_name}</td>
                      <td className="py-3 text-slate-300">
                        {attended ? "Attended" : entry.status === "booked" ? "Booked" : entry.status}
                      </td>
                      <td className="py-3 text-slate-300 capitalize">{entry.booking_type}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 disabled:opacity-60"
                            onClick={() => markAttended.mutate(entry.booking_id)}
                            disabled={markAttended.isPending || attended}
                          >
                            {attended ? "Attended" : "Mark Attended"}
                          </button>
                          <button
                            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 disabled:opacity-60"
                            onClick={() => removeMember.mutate(entry.booking_id)}
                            disabled={removeMember.isPending || editsDisabled}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {waitlist.map((entry) => (
                  <tr key={entry.waitlist_id}>
                    <td className="py-3 text-white">{entry.member_name}</td>
                    <td className="py-3 text-amber-200">Waitlist #{entry.position}</td>
                    <td className="py-3 text-slate-300">Waitlist</td>
                    <td className="py-3">
                      <button
                        className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 disabled:opacity-60"
                        onClick={() => promoteFromWaitlist.mutate(entry.waitlist_id)}
                        disabled={promoteFromWaitlist.isPending || editsDisabled || isFull}
                      >
                        Promote
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {cancelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h3 className="text-lg font-semibold text-white">Cancel class?</h3>
            <p className="mt-2 text-sm text-slate-400">This will notify booked members.</p>
            <textarea
              className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100"
              rows={3}
              placeholder="Optional reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200"
                onClick={() => setCancelOpen(false)}
              >
                Keep
              </button>
              <button
                className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={() => cancelClass.mutate()}
                disabled={cancelClass.isPending}
              >
                {cancelClass.isPending ? "Canceling..." : "Cancel class"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ClassManagementPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ClassManagementConsole />
    </QueryClientProvider>
  );
}
