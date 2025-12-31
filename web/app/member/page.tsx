"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Header from "../../components/Header";
import QRDisplay from "../../components/QRDisplay";
import CheckinsList from "../../components/CheckinsList";
import { supabaseBrowser } from "../../lib/supabase-browser";
import { loadSessionAndRole, useAuthStore, useTokenStore } from "../../lib/auth";
import type { Checkin, MemberProfile } from "../../lib/types";

const queryClient = new QueryClient();

function MemberDashboard() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { token, expiresAt, setToken } = useTokenStore();
  const [now, setNow] = useState(Date.now());
  const queryCache = useQueryClient();

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      router.replace("/login");
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: member } = useQuery<MemberProfile | null>({
    queryKey: ["member-profile", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("members")
        .select("id, user_id, gym_id, status")
        .eq("user_id", session?.user.id ?? "")
        .maybeSingle();
      return (data ?? null) as MemberProfile | null;
    },
  });

  const { data: checkins = [] } = useQuery<Checkin[]>({
    queryKey: ["member-checkins", member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("checkins")
        .select("id, member_id, gym_id, checked_in_at, source, staff_id")
        .eq("member_id", member?.id ?? "")
        .order("checked_in_at", { ascending: false })
        .limit(10);
      return (data ?? []) as Checkin[];
    },
  });

  const generateToken = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabaseBrowser.functions.invoke("generate_qr_token");
      if (error) {
        throw error;
      }
      return data as { token: string; expires_at: string };
    },
    onSuccess: (data) => {
      setToken(data.token, data.expires_at);
      queryCache.invalidateQueries({ queryKey: ["member-checkins"] });
    },
  });

  const expiresInSeconds = useMemo(() => {
    if (!expiresAt) return null;
    const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
    return diff;
  }, [expiresAt, now]);

  useEffect(() => {
    if (expiresInSeconds !== null && expiresInSeconds <= 0) {
      setToken(null, null);
    }
  }, [expiresInSeconds, setToken]);

  if (loading || !session) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold mb-2">Your Check-in QR</h2>
            <p className="text-sm text-slate-400">
              Generate a new QR token each time you enter the gym. Tokens expire after 2 minutes.
            </p>
            <div className="mt-4">
              <QRDisplay token={token} expiresInSeconds={expiresInSeconds} />
            </div>
            <button
              onClick={() => generateToken.mutate()}
              className="mt-4 rounded-lg bg-cyan-500 text-slate-950 px-4 py-2 font-semibold hover:bg-cyan-400"
              disabled={generateToken.isPending}
            >
              {generateToken.isPending ? "Generating..." : "Refresh Token"}
            </button>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h3 className="text-lg font-semibold mb-2">Membership Status</h3>
            <p className="text-sm text-slate-300">
              Status: <span className="font-semibold">{member?.status ?? "unknown"}</span>
            </p>
            <p className="text-xs text-slate-500 mt-2">Need help? Contact staff at the front desk.</p>
          </div>
        </section>
        <section>
          <CheckinsList checkins={checkins} title="Visit History" />
        </section>
      </main>
    </div>
  );
}

export default function MemberPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberDashboard />
    </QueryClientProvider>
  );
}
