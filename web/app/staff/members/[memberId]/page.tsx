"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

type MemberProfile = {
  id: string;
  user_id: string;
  joined_at: string;
  users?: { full_name: string | null } | null;
};

type ActivitySummary = {
  member_id: string;
  first_checkin_at: string | null;
  last_checkin_at: string | null;
  total_checkins: number;
  visits_last_30_days: number;
  visits_last_90_days: number;
  avg_days_between_visits: number | null;
};

type EngagementScore = {
  member_id: string;
  engagement_score: number;
  engagement_band: "LOW" | "MEDIUM" | "HIGH";
};

type SubscriptionStatus = {
  member_id: string;
  current_status: string;
  active_plan_id: string | null;
  since: string | null;
};

type CheckinRow = {
  checked_in_at: string;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function MemberAnalyticsView() {
  const router = useRouter();
  const params = useParams();
  const memberId = params?.memberId as string | undefined;
  const { session, role, loading } = useAuthStore();
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [engagement, setEngagement] = useState<EngagementScore | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [checkins, setCheckins] = useState<CheckinRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadData = async () => {
      if (!memberId) return;
      setLoadingData(true);
      const { data: memberRow } = await supabaseBrowser
        .from("members")
        .select("id, user_id, joined_at, users(full_name)")
        .eq("id", memberId)
        .maybeSingle();
      setMember((memberRow ?? null) as MemberProfile | null);

      const [{ data: activityRow }, { data: engagementRow }, { data: subscriptionRow }, { data: checkinRows }] =
        await Promise.all([
          supabaseBrowser.from("member_activity_summary_mv").select("*").eq("member_id", memberId).maybeSingle(),
          supabaseBrowser.from("member_engagement_scores_v").select("*").eq("member_id", memberId).maybeSingle(),
          supabaseBrowser.from("member_subscription_status_mv").select("*").eq("member_id", memberId).maybeSingle(),
          supabaseBrowser
            .from("checkins")
            .select("checked_in_at")
            .eq("member_id", memberId)
            .gte("checked_in_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
            .order("checked_in_at", { ascending: true }),
        ]);

      setActivity((activityRow ?? null) as ActivitySummary | null);
      setEngagement((engagementRow ?? null) as EngagementScore | null);
      setSubscription((subscriptionRow ?? null) as SubscriptionStatus | null);
      setCheckins((checkinRows ?? []) as CheckinRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [memberId]);

  const visitsByWeek = useMemo(() => {
    const buckets = new Map<string, number>();
    checkins.forEach((checkin) => {
      const date = new Date(checkin.checked_in_at);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    });
    return Array.from(buckets.entries()).map(([week, count]) => ({ week, count }));
  }, [checkins]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">{member?.users?.full_name ?? "Member"}</h1>
            <p className="text-sm text-slate-400">Member analytics and engagement insights.</p>
          </div>
          <div className="flex gap-3 text-sm">
            <button
              className="rounded-md bg-slate-800 px-4 py-2 text-slate-200"
              onClick={() => router.push(`/staff/members/${memberId}`)}
            >
              Overview
            </button>
            <button className="rounded-md bg-emerald-600 px-4 py-2 text-white">Analytics</button>
            <button
              className="rounded-md bg-slate-800 px-4 py-2 text-slate-200"
              onClick={() => router.push(`/staff/members/${memberId}/billing`)}
            >
              Billing
            </button>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Total check-ins", value: activity?.total_checkins ?? 0 },
            { label: "Visits (30d)", value: activity?.visits_last_30_days ?? 0 },
            { label: "Visits (90d)", value: activity?.visits_last_90_days ?? 0 },
            { label: "Avg days between", value: activity?.avg_days_between_visits?.toFixed(1) ?? "—" },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-400">{metric.label}</div>
              <div className="text-2xl font-semibold">{metric.value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Engagement score</h2>
            <div className="mt-4 text-3xl font-semibold">
              {engagement?.engagement_score ?? 0} <span className="text-sm text-slate-400">({engagement?.engagement_band ?? "LOW"})</span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Subscription status</h2>
            <div className="mt-4 text-sm text-slate-300">
              <div>Status: {subscription?.current_status ?? "EXPIRED"}</div>
              <div>Since: {subscription?.since ? new Date(subscription.since).toLocaleDateString() : "—"}</div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Visits (last 90 days)</h2>
          <div className="mt-4 space-y-2 text-sm text-slate-400">
            {visitsByWeek.length ? (
              visitsByWeek.map((row) => (
                <div key={row.week} className="flex items-center justify-between">
                  <span>{row.week}</span>
                  <span>{row.count}</span>
                </div>
              ))
            ) : (
              <div>No check-ins in the last 90 days.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function MemberAnalyticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberAnalyticsView />
    </QueryClientProvider>
  );
}
