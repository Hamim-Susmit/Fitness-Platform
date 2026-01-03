"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { syncProviderForMember } from "../../../lib/fitness/sync";
import type { FitnessProvider } from "../../../lib/fitness/adapters/baseAdapter";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

type FitnessAccountRow = {
  id: string;
  provider: FitnessProvider;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  updated_at: string;
};

type ProviderMeta = {
  key: FitnessProvider;
  label: string;
  description: string;
  connectHint: string;
  canConnectOnWeb: boolean;
};

const PROVIDERS: ProviderMeta[] = [
  {
    key: "APPLE_HEALTH",
    label: "Apple Health",
    description: "Sync steps, calories, and heart rate from your iPhone.",
    connectHint: "Connect via the mobile app.",
    canConnectOnWeb: false,
  },
  {
    key: "GOOGLE_FIT",
    label: "Google Fit",
    description: "Sync daily summaries from your Android device.",
    connectHint: "Connect via the mobile app.",
    canConnectOnWeb: false,
  },
  {
    key: "FITBIT",
    label: "Fitbit",
    description: "Import daily activity summaries from Fitbit.",
    connectHint: "OAuth connection required.",
    canConnectOnWeb: true,
  },
  {
    key: "GARMIN",
    label: "Garmin",
    description: "Garmin integration available soon.",
    connectHint: "Coming soon.",
    canConnectOnWeb: false,
  },
  {
    key: "STRAVA",
    label: "Strava",
    description: "Sync daily summaries from Strava.",
    connectHint: "OAuth connection required.",
    canConnectOnWeb: true,
  },
];

function MemberFitnessConnectionsView() {
  const { session, role, loading } = useAuthStore();
  const { message, status, setToast } = useToastStore();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<FitnessAccountRow[]>([]);
  const [lastSyncByProvider, setLastSyncByProvider] = useState<Record<FitnessProvider, string | null>>({
    APPLE_HEALTH: null,
    GOOGLE_FIT: null,
    FITBIT: null,
    GARMIN: null,
    STRAVA: null,
  });
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [syncingProvider, setSyncingProvider] = useState<FitnessProvider | null>(null);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      window.location.href = roleRedirectPath(role);
    }
  }, [loading, role, session]);

  useEffect(() => {
    const loadMember = async () => {
      if (!session?.user?.id) return;
      const { data: member } = await supabaseBrowser
        .from("members")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      setMemberId(member?.id ?? null);
    };

    loadMember();
  }, [session?.user?.id]);

  const refreshAccounts = useCallback(async () => {
    if (!memberId) return;
    setLoadingAccounts(true);
    const { data: accountsData } = await supabaseBrowser
      .from("fitness_accounts")
      .select("id, provider, status, updated_at")
      .eq("member_id", memberId)
      .order("updated_at", { ascending: false });

    setAccounts((accountsData ?? []) as FitnessAccountRow[]);

    const { data: metrics } = await supabaseBrowser
      .from("fitness_daily_metrics")
      .select("provider, updated_at")
      .eq("member_id", memberId)
      .order("updated_at", { ascending: false });

    const syncMap: Record<FitnessProvider, string | null> = {
      APPLE_HEALTH: null,
      GOOGLE_FIT: null,
      FITBIT: null,
      GARMIN: null,
      STRAVA: null,
    };

    (metrics ?? []).forEach((row) => {
      if (!syncMap[row.provider as FitnessProvider]) {
        syncMap[row.provider as FitnessProvider] = row.updated_at;
      }
    });

    setLastSyncByProvider(syncMap);
    setLoadingAccounts(false);
  }, [memberId]);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  const accountsByProvider = useMemo(() => {
    return new Map(accounts.map((account) => [account.provider, account]));
  }, [accounts]);

  const handleConnect = async (provider: FitnessProvider) => {
    if (!memberId) return;
    setSyncingProvider(provider);
    try {
      const { data: existing } = await supabaseBrowser
        .from("fitness_accounts")
        .select("id")
        .eq("member_id", memberId)
        .eq("provider", provider)
        .maybeSingle();

      if (!existing) {
        await supabaseBrowser.from("fitness_accounts").insert({
          member_id: memberId,
          provider,
          external_user_id: `${provider.toLowerCase()}-${memberId}`,
          access_token: "encrypted_token_placeholder",
          refresh_token: null,
          status: "CONNECTED",
        });
      } else {
        await supabaseBrowser
          .from("fitness_accounts")
          .update({ status: "CONNECTED" })
          .eq("id", existing.id);
      }

      setToast(`${provider} connected`, "success");
      await refreshAccounts();
    } catch (error) {
      setToast("Unable to connect provider", "error");
      console.error(error);
    } finally {
      setTimeout(() => setToast(null, null), 3000);
      setSyncingProvider(null);
    }
  };

  const handleDisconnect = async (provider: FitnessProvider) => {
    const account = accountsByProvider.get(provider);
    if (!account) return;
    await supabaseBrowser
      .from("fitness_accounts")
      .update({ status: "DISCONNECTED" })
      .eq("id", account.id);
    setToast(`${provider} disconnected`, "success");
    await refreshAccounts();
    setTimeout(() => setToast(null, null), 3000);
  };

  const handleSync = async (provider: FitnessProvider) => {
    if (!memberId) return;
    setSyncingProvider(provider);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 6);
    try {
      await syncProviderForMember(memberId, provider, {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
      });
      setToast(`${provider} synced`, "success");
      await refreshAccounts();
    } catch (error) {
      setToast("Sync failed", "error");
      console.error(error);
    } finally {
      setTimeout(() => setToast(null, null), 3000);
      setSyncingProvider(null);
    }
  };

  if (loading || loadingAccounts) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        {message ? (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              status === "success" ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"
            }`}
          >
            {message}
          </div>
        ) : null}
        <div>
          <h1 className="text-3xl font-semibold">Fitness Connections</h1>
          <p className="text-sm text-slate-400">
            Connect wearable providers to import daily summaries. Data stays private and can be disconnected anytime.
          </p>
        </div>

        <div className="grid gap-4">
          {PROVIDERS.map((provider) => {
            const account = accountsByProvider.get(provider.key);
            const lastSync = lastSyncByProvider[provider.key];
            return (
              <div key={provider.key} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{provider.label}</h2>
                    <p className="text-sm text-slate-400">{provider.description}</p>
                    <p className="text-xs text-slate-500 mt-1">{provider.connectHint}</p>
                  </div>
                  <div className="text-right text-sm text-slate-300">
                    <div>Status: {account?.status ?? "DISCONNECTED"}</div>
                    <div>Last sync: {lastSync ? new Date(lastSync).toLocaleString() : "—"}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {provider.canConnectOnWeb ? (
                    account?.status === "CONNECTED" ? (
                      <>
                        <button
                          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                          onClick={() => handleSync(provider.key)}
                          disabled={syncingProvider === provider.key}
                        >
                          {syncingProvider === provider.key ? "Syncing..." : "Sync Now"}
                        </button>
                        <button
                          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200"
                          onClick={() => handleDisconnect(provider.key)}
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold"
                        onClick={() => handleConnect(provider.key)}
                      >
                        Connect
                      </button>
                    )
                  ) : (
                    <button className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-400" disabled>
                      {provider.connectHint}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MemberFitnessConnectionsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberFitnessConnectionsView />
    </QueryClientProvider>
  );
}
