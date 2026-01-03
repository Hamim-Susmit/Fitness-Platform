"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { computeStreakStatus } from "../../../lib/gamification/streaks";

type StreakRow = {
  id: string;
  streak_type: string;
  current_count: number;
  longest_count: number;
  last_event_at: string | null;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function StreaksView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [streaks, setStreaks] = useState<StreakRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadData = async () => {
      if (!session?.user.id) return;
      setLoadingData(true);
      const rows = await computeStreakStatus(session.user.id);
      setStreaks(rows as StreakRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [session?.user.id]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Streaks</h1>
          <p className="text-sm text-slate-400">Your current and longest streaks by activity.</p>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          {streaks.map((streak) => (
            <div key={streak.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <div className="text-sm font-medium">{streak.streak_type}</div>
              <div className="text-xs text-slate-400">Current: {streak.current_count}</div>
              <div className="text-xs text-slate-400">Longest: {streak.longest_count}</div>
              <div className="text-xs text-slate-500">
                Last activity: {streak.last_event_at ? new Date(streak.last_event_at).toLocaleDateString() : "—"}
              </div>
            </div>
          ))}
          {streaks.length === 0 ? <p className="text-sm text-slate-400">No streaks tracked yet.</p> : null}
        </section>
      </main>
    </div>
  );
}

export default function StreaksPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <StreaksView />
    </QueryClientProvider>
  );
}
