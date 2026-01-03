"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../lib/roles";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type FailedPaymentRow = {
  payment_id: string;
  member_id: string;
  gym_id: string | null;
  plan_id: string | null;
  failed_at: string;
  failure_reason: string | null;
  retry_status: string | null;
  attempt_count: number | null;
};

type MemberRow = { id: string; users?: { full_name: string | null } | null };

type GymRow = { id: string; name: string };

type PlanRow = { id: string; name: string };

function FailedPaymentsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, role, loading } = useAuthStore();
  const [failedPayments, setFailedPayments] = useState<FailedPaymentRow[]>([]);
  const [memberRows, setMemberRows] = useState<MemberRow[]>([]);
  const [gymRows, setGymRows] = useState<GymRow[]>([]);
  const [planRows, setPlanRows] = useState<PlanRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const planFilter = searchParams?.get("planId");
  const gymFilter = searchParams?.get("gymId");

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
      setLoadingData(true);
      let query = supabaseBrowser
        .from("failed_payments_mv")
        .select("payment_id, member_id, gym_id, plan_id, failed_at, failure_reason, retry_status, attempt_count")
        .order("failed_at", { ascending: false });

      if (planFilter) {
        query = query.eq("plan_id", planFilter);
      }
      if (gymFilter) {
        query = query.eq("gym_id", gymFilter);
      }

      const { data: failedRows } = await query;
      const rows = (failedRows ?? []) as FailedPaymentRow[];
      setFailedPayments(rows);

      const memberIds = Array.from(new Set(rows.map((row) => row.member_id)));
      const gymIds = Array.from(new Set(rows.map((row) => row.gym_id).filter(Boolean))) as string[];
      const planIds = Array.from(new Set(rows.map((row) => row.plan_id).filter(Boolean))) as string[];

      const [{ data: members }, { data: gyms }, { data: plans }] = await Promise.all([
        memberIds.length
          ? supabaseBrowser.from("members").select("id, users(full_name)").in("id", memberIds)
          : Promise.resolve({ data: [] }),
        gymIds.length ? supabaseBrowser.from("gyms").select("id, name").in("id", gymIds) : Promise.resolve({ data: [] }),
        planIds.length
          ? supabaseBrowser.from("membership_plans").select("id, name").in("id", planIds)
          : Promise.resolve({ data: [] }),
      ]);

      setMemberRows((members ?? []) as MemberRow[]);
      setGymRows((gyms ?? []) as GymRow[]);
      setPlanRows((plans ?? []) as PlanRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [gymFilter, planFilter]);

  const memberMap = useMemo(() => {
    return new Map(memberRows.map((row) => [row.id, row.users?.full_name ?? "Member"]));
  }, [memberRows]);

  const gymMap = useMemo(() => {
    return new Map(gymRows.map((row) => [row.id, row.name]));
  }, [gymRows]);

  const planMap = useMemo(() => {
    return new Map(planRows.map((row) => [row.id, row.name]));
  }, [planRows]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Failed Payments</h1>
          <p className="text-sm text-slate-400">Retry status and follow-ups. Keep PII minimal in exports.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Member</th>
                  <th className="py-2 text-left">Gym</th>
                  <th className="py-2 text-left">Plan</th>
                  <th className="py-2 text-left">Failed at</th>
                  <th className="py-2 text-left">Reason</th>
                  <th className="py-2 text-left">Retry status</th>
                  <th className="py-2 text-left">Attempts</th>
                  <th className="py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {failedPayments.map((row) => (
                  <tr key={row.payment_id}>
                    <td className="py-3 text-white">{memberMap.get(row.member_id) ?? "Member"}</td>
                    <td className="py-3 text-slate-300">{row.gym_id ? gymMap.get(row.gym_id) ?? "Gym" : "—"}</td>
                    <td className="py-3 text-slate-300">{row.plan_id ? planMap.get(row.plan_id) ?? "Plan" : "—"}</td>
                    <td className="py-3 text-slate-300">{new Date(row.failed_at).toLocaleString()}</td>
                    <td className="py-3 text-slate-300">{row.failure_reason ?? "payment_failed"}</td>
                    <td className="py-3 text-slate-300">{row.retry_status ?? "unknown"}</td>
                    <td className="py-3 text-slate-300">{row.attempt_count ?? 1}</td>
                    <td className="py-3 text-slate-300">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
                          onClick={() => router.push(`/staff/members/${row.member_id}`)}
                        >
                          View member
                        </button>
                        <button
                          className="rounded-md border border-emerald-500/60 px-3 py-1 text-xs text-emerald-200 hover:border-emerald-400"
                          onClick={() => window.alert("Resend email queued for finance ops.")}
                        >
                          Resend email
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {failedPayments.length === 0 ? (
                  <tr>
                    <td className="py-4 text-slate-400" colSpan={8}>
                      No failed payments found for the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function FailedPaymentsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <FailedPaymentsView />
    </QueryClientProvider>
  );
}
