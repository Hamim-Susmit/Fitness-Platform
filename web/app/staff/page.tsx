"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Header from "../../components/Header";
import QRScanner from "../../components/QRScanner";
import CheckinsList from "../../components/CheckinsList";
import { supabaseBrowser } from "../../lib/supabase-browser";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../lib/auth";
import { callEdgeFunction } from "../../lib/api";
import { roleRedirectPath, isStaffRole } from "../../lib/roles";
import { useRealtimeCheckins } from "../../lib/useRealtimeCheckins";
import type { Checkin, StaffProfile } from "../../lib/types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function StaffDashboard() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { message, status, setToast } = useToastStore();
  const queryCache = useQueryClient();
  const [gymId, setGymId] = useState<string | null>(null);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  const { data: staffProfile } = useQuery<StaffProfile | null>({
    queryKey: ["staff-profile", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("staff")
        .select("id, user_id, gym_id, staff_role")
        .eq("user_id", session?.user.id ?? "")
        .maybeSingle();
      return (data ?? null) as StaffProfile | null;
    },
  });

  useEffect(() => {
    if (staffProfile?.gym_id) {
      setGymId(staffProfile.gym_id);
    }
  }, [staffProfile?.gym_id]);

  const todayRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const {
    data: checkins = [],
    isLoading: checkinsLoading,
    isError: checkinsError,
  } = useQuery<Checkin[]>({
    queryKey: ["staff-checkins", gymId, todayRange.start],
    enabled: !!gymId,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("checkins")
        .select("id, member_id, gym_id, checked_in_at, source, staff_id")
        .eq("gym_id", gymId ?? "")
        .gte("checked_in_at", todayRange.start)
        .lte("checked_in_at", todayRange.end)
        .order("checked_in_at", { ascending: false });
      return (data ?? []) as Checkin[];
    },
  });

  const handleRealtimeInsert = useCallback(
    (newCheckin: Checkin) => {
      queryCache.setQueryData<Checkin[]>(
        ["staff-checkins", gymId, todayRange.start],
        (existing = []) => {
          if (existing.some((checkin) => checkin.id === newCheckin.id)) {
            return existing;
          }
          return [newCheckin, ...existing];
        }
      );
    },
    [gymId, queryCache, todayRange.start]
  );

  useRealtimeCheckins(gymId, handleRealtimeInsert);

  const validateToken = useMutation({
    mutationFn: async (token: string) => {
      const response = await callEdgeFunction<{ checkin_id: string }>("validate_qr_token", { body: { token } });
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to validate token");
      }
      return response.data;
    },
    onSuccess: () => {
      setToast("Check-in confirmed!", "success");
      setTimeout(() => setToast(null, null), 3000);
    },
    onError: (error) => {
      setToast(error.message ?? "Invalid token", "error");
      setTimeout(() => setToast(null, null), 3000);
    },
  });

  const handleScan = (token: string) => {
    if (validateToken.isPending) return;
    validateToken.mutate(token);
  };

  if (loading || !session) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold mb-2">Scan Member QR</h2>
            <p className="text-sm text-slate-400 mb-4">
              Point the scanner at the member&apos;s QR code to validate check-in.
            </p>
            <QRScanner onScan={handleScan} />
          </div>
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
        </section>
        <section>
          <CheckinsList checkins={checkins} title="Today's Check-ins" />
          {checkinsLoading ? (
            <p className="mt-3 text-sm text-slate-400">Loading check-ins...</p>
          ) : null}
          {checkinsError ? (
            <p className="mt-3 text-sm text-rose-400">Unable to load check-ins.</p>
          ) : null}
          {!checkinsLoading && !checkinsError && checkins.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No check-ins yet today.</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}

export default function StaffPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <StaffDashboard />
    </QueryClientProvider>
  );
}
