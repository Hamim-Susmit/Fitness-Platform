"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { evaluateReferralReward } from "../../../lib/referrals/rewards";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type ReferralRow = {
  id: string;
  referrer_member_id: string;
  referred_member_id: string | null;
  referred_email: string;
  referral_code: string;
  status: string;
  created_at: string;
};

function AdminReferralsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [search, setSearch] = useState("");
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "owner")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadData = async () => {
      setLoadingData(true);
      let query = supabaseBrowser
        .from("referrals")
        .select("id, referrer_member_id, referred_member_id, referred_email, referral_code, status, created_at")
        .order("created_at", { ascending: false });

      if (search) {
        query = query.or(`referred_email.ilike.%${search}%,referrer_member_id.eq.${search},referred_member_id.eq.${search}`);
      }

      const { data } = await query;
      setReferrals((data ?? []) as ReferralRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [search]);

  const issueRewards = async (referralId: string) => {
    await evaluateReferralReward(referralId);
  };

  const exportCsv = () => {
    const headers = ["id", "referrer_member_id", "referred_member_id", "referred_email", "referral_code", "status", "created_at"];
    const lines = [headers.join(",")];
    referrals.forEach((row) => {
      lines.push(headers.map((key) => String((row as any)[key] ?? "")).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "referrals.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Referral Admin</h1>
          <p className="text-sm text-slate-400">Review referrals and manually issue rewards.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-wrap gap-3 items-center">
          <input
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm flex-1 min-w-[220px]"
            placeholder="Search by email or member id"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200" onClick={exportCsv}>
            Export CSV
          </button>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Referrer</th>
                  <th className="py-2 text-left">Referred email</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-left">Created</th>
                  <th className="py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {referrals.map((row) => (
                  <tr key={row.id}>
                    <td className="py-3 text-slate-200">{row.referrer_member_id}</td>
                    <td className="py-3 text-slate-300">{row.referred_email}</td>
                    <td className="py-3 text-slate-300">{row.status}</td>
                    <td className="py-3 text-slate-300">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="py-3 text-slate-300">
                      <button
                        className="rounded-md border border-emerald-500/60 px-2 py-1 text-xs text-emerald-200"
                        onClick={() => issueRewards(row.id)}
                      >
                        Issue rewards
                      </button>
                    </td>
                  </tr>
                ))}
                {referrals.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-slate-400">No referrals found.</td>
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

export default function AdminReferralsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminReferralsView />
    </QueryClientProvider>
  );
}
