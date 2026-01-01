"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { useActiveGym } from "../../../../lib/useActiveGym";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

type MemberRow = {
  id: string;
  user_id: string;
  joined_at: string;
  users?: { full_name: string | null } | null;
};

type ActivitySummary = {
  member_id: string;
  last_checkin_at: string | null;
  visits_last_30_days: number;
  visits_last_90_days: number;
};

type SubscriptionStatus = {
  member_id: string;
  current_status: string;
};

type EngagementScore = {
  member_id: string;
  engagement_score: number;
  engagement_band: "LOW" | "MEDIUM" | "HIGH";
};

type CohortRow = {
  cohort_month: string;
  retention_30d_percent: number;
  retention_90d_percent: number;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const ranges = [
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

function AnalyticsMembersView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { activeGymId } = useActiveGym();
  const [rangeDays, setRangeDays] = useState(90);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [activity, setActivity] = useState<ActivitySummary[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionStatus[]>([]);
  const [engagement, setEngagement] = useState<EngagementScore[]>([]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
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
      if (!activeGymId) return;
      setLoadingData(true);
      const { data: memberRows } = await supabaseBrowser
        .from("members")
        .select("id, user_id, joined_at, users(full_name)")
        .eq("gym_id", activeGymId)
        .order("joined_at", { ascending: false });
      const memberIds = (memberRows ?? []).map((row) => row.id);
      setMembers((memberRows ?? []) as MemberRow[]);

      if (memberIds.length) {
        const [{ data: activityRows }, { data: subscriptionRows }, { data: engagementRows }] = await Promise.all([
          supabaseBrowser
            .from("member_activity_summary_mv")
            .select("member_id, last_checkin_at, visits_last_30_days, visits_last_90_days")
            .in("member_id", memberIds),
          supabaseBrowser
            .from("member_subscription_status_mv")
            .select("member_id, current_status")
            .in("member_id", memberIds),
          supabaseBrowser
            .from("member_engagement_scores_v")
            .select("member_id, engagement_score, engagement_band")
            .in("member_id", memberIds),
        ]);

        setActivity((activityRows ?? []) as ActivitySummary[]);
        setSubscriptions((subscriptionRows ?? []) as SubscriptionStatus[]);
        setEngagement((engagementRows ?? []) as EngagementScore[]);
      } else {
        setActivity([]);
        setSubscriptions([]);
        setEngagement([]);
      }

      const { data: cohortRows } = await supabaseBrowser
        .from("monthly_signup_cohorts_v")
        .select("cohort_month, retention_30d_percent, retention_90d_percent")
        .order("cohort_month", { ascending: false })
        .limit(6);
      setCohorts((cohortRows ?? []) as CohortRow[]);

      setLoadingData(false);
    };

    loadData();
  }, [activeGymId]);

  const activityMap = useMemo(() => new Map(activity.map((row) => [row.member_id, row])), [activity]);
  const subscriptionMap = useMemo(() => new Map(subscriptions.map((row) => [row.member_id, row])), [subscriptions]);
  const engagementMap = useMemo(() => new Map(engagement.map((row) => [row.member_id, row])), [engagement]);

  const activeMembers = subscriptions.filter((row) => row.current_status === "ACTIVE").length;
  const returningMembers = activity.filter((row) => row.visits_last_30_days > 0).length;
  const atRiskMembers = engagement.filter((row) => row.engagement_band === "LOW").length;
  const newSignups = members.filter((member) => {
    const joined = new Date(member.joined_at).getTime();
    return joined >= Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  }).length;

  const engagementDistribution = useMemo(() => {
    return {
      HIGH: engagement.filter((row) => row.engagement_band === "HIGH").length,
      MEDIUM: engagement.filter((row) => row.engagement_band === "MEDIUM").length,
      LOW: engagement.filter((row) => row.engagement_band === "LOW").length,
    };
  }, [engagement]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Member Analytics</h1>
            <p className="text-sm text-slate-400">Engagement and retention insights for your active gym.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Range</span>
            <select
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
              value={rangeDays}
              onChange={(event) => setRangeDays(Number(event.target.value))}
            >
              {ranges.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Active members", value: activeMembers },
            { label: "Returning members", value: returningMembers },
            { label: "At-risk members", value: atRiskMembers },
            { label: "New signups", value: newSignups },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-400">{card.label}</div>
              <div className="text-2xl font-semibold">{card.value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Engagement distribution</h2>
            <div className="mt-4 space-y-3 text-sm">
              {(["HIGH", "MEDIUM", "LOW"] as const).map((band) => (
                <div key={band} className="flex items-center gap-3">
                  <span className="w-16 text-slate-400">{band}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{
                        width: `${members.length ? (engagementDistribution[band] / members.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-slate-300">{engagementDistribution[band]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Retention curve</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-400">
              {cohorts.length ? (
                cohorts.map((cohort) => (
                  <div key={cohort.cohort_month} className="flex items-center justify-between">
                    <span>{new Date(cohort.cohort_month).toLocaleDateString()}</span>
                    <span>{cohort.retention_30d_percent}% / {cohort.retention_90d_percent}%</span>
                  </div>
                ))
              ) : (
                <div>No cohort data available.</div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Members</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Member</th>
                  <th className="px-3 py-2 text-left">Last check-in</th>
                  <th className="px-3 py-2 text-left">Engagement</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {members.map((member) => {
                  const activityRow = activityMap.get(member.id);
                  const engagementRow = engagementMap.get(member.id);
                  const subscriptionRow = subscriptionMap.get(member.id);
                  return (
                    <tr key={member.id}>
                      <td className="px-3 py-2">{member.users?.full_name ?? "Member"}</td>
                      <td className="px-3 py-2 text-slate-400">
                        {activityRow?.last_checkin_at
                          ? new Date(activityRow.last_checkin_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {engagementRow?.engagement_score ?? 0} ({engagementRow?.engagement_band ?? "LOW"})
                      </td>
                      <td className="px-3 py-2 text-slate-400">{subscriptionRow?.current_status ?? "EXPIRED"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          className="text-emerald-300 hover:text-emerald-200"
                          onClick={() => router.push(`/staff/members/${member.id}`)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                      No members found for this gym.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function AnalyticsMembersPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsMembersView />
    </QueryClientProvider>
  );
}
