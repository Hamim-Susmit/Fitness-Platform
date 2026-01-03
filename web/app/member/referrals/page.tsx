"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { formatReferralLink, getOrCreateReferralCode } from "../../../lib/referrals/generator";
import { createReferralInvite } from "../../../lib/referrals/workflow";

type ReferralRow = {
  id: string;
  referred_email: string;
  status: string;
  created_at: string;
};

type RewardRow = {
  id: string;
  reward_type: string;
  reward_value: number | null;
  status: string;
  issued_at: string;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function ReferralsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [email, setEmail] = useState("");
  const [loadingData, setLoadingData] = useState(true);

  const referralCode = useMemo(() => (session?.user.id ? getOrCreateReferralCode(session.user.id) : ""), [session?.user.id]);
  const referralLink = referralCode ? formatReferralLink(referralCode) : "";

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
      const [{ data: referralRows }, { data: rewardRows }] = await Promise.all([
        supabaseBrowser
          .from("referrals")
          .select("id, referred_email, status, created_at")
          .eq("referrer_member_id", session.user.id)
          .order("created_at", { ascending: false }),
        supabaseBrowser
          .from("referral_rewards")
          .select("id, reward_type, reward_value, status, issued_at")
          .eq("referrer_member_id", session.user.id)
          .order("issued_at", { ascending: false }),
      ]);

      setReferrals((referralRows ?? []) as ReferralRow[]);
      setRewards((rewardRows ?? []) as RewardRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [session?.user.id]);

  const sendInvite = async () => {
    if (!session?.user.id || !email || !referralCode) return;
    const result = await createReferralInvite(session.user.id, email, referralCode);
    if (result.ok && result.data) {
      setReferrals((prev) => [result.data as ReferralRow, ...prev]);
      setEmail("");
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Referrals</h1>
          <p className="text-sm text-slate-400">Invite friends and earn rewards when they activate.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="text-sm text-slate-300">Referral code: {referralCode}</div>
          <div className="text-xs text-slate-400">Share link: {referralLink}</div>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="Friend email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950" onClick={sendInvite}>
            Send invite
          </button>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Referral history</h2>
          {referrals.map((referral) => (
            <div key={referral.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-200">{maskEmail(referral.referred_email)}</div>
              <div className="text-xs text-slate-500">Status: {referral.status}</div>
            </div>
          ))}
          {referrals.length === 0 ? <p className="text-sm text-slate-400">No referrals yet.</p> : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Rewards</h2>
          {rewards.map((reward) => (
            <div key={reward.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-200">{reward.reward_type}</div>
              <div className="text-xs text-slate-500">Value: {reward.reward_value ?? "—"}</div>
              <div className="text-xs text-slate-500">Status: {reward.status}</div>
            </div>
          ))}
          {rewards.length === 0 ? <p className="text-sm text-slate-400">No rewards yet.</p> : null}
        </section>
      </main>
    </div>
  );
}

export default function ReferralsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReferralsView />
    </QueryClientProvider>
  );
}
