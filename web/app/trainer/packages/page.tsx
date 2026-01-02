"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";

type TrainerRow = {
  id: string;
};

type ClientRow = {
  member_id: string;
  members?: { users?: { full_name: string | null } | null } | null;
};

type PackageRow = {
  id: string;
  member_id: string;
  package_name: string;
  total_sessions: number;
  sessions_used: number;
  price: number;
  currency: string;
  expires_at: string | null;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function TrainerPackagesView() {
  const router = useRouter();
  const { session, loading } = useAuthStore();
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [packageName, setPackageName] = useState("10 Sessions");
  const [totalSessions, setTotalSessions] = useState(10);
  const [price, setPrice] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && !session) {
      router.replace(roleRedirectPath(null));
    }
  }, [loading, router, session]);

  useEffect(() => {
    const loadData = async () => {
      if (!session?.user.id) return;
      setLoadingData(true);
      const { data: trainerRow } = await supabaseBrowser
        .from("personal_trainers")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!trainerRow) {
        router.replace("/member");
        return;
      }

      const [{ data: clientRows }, { data: packageRows }] = await Promise.all([
        supabaseBrowser
          .from("trainer_clients")
          .select("member_id, members(users(full_name))")
          .eq("trainer_id", trainerRow.id),
        supabaseBrowser
          .from("trainer_packages")
          .select("id, member_id, package_name, total_sessions, sessions_used, price, currency, expires_at")
          .eq("trainer_id", trainerRow.id)
          .order("created_at", { ascending: false }),
      ]);

      setTrainer(trainerRow as TrainerRow);
      setClients((clientRows ?? []) as ClientRow[]);
      setPackages((packageRows ?? []) as PackageRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [router, session?.user.id]);

  const assignPackage = async () => {
    if (!trainer || !selectedMemberId) return;
    const { data } = await supabaseBrowser
      .from("trainer_packages")
      .insert({
        trainer_id: trainer.id,
        member_id: selectedMemberId,
        package_name: packageName,
        total_sessions: totalSessions,
        sessions_used: 0,
        price,
        currency: "usd",
        expires_at: expiresAt || null,
      })
      .select("id, member_id, package_name, total_sessions, sessions_used, price, currency, expires_at")
      .maybeSingle();

    if (data) {
      setPackages((prev) => [data as PackageRow, ...prev]);
    }
  };

  const decrementSession = async (packageId: string) => {
    const target = packages.find((pkg) => pkg.id === packageId);
    if (!target) return;
    const nextUsed = Math.min(target.sessions_used + 1, target.total_sessions);

    const { data } = await supabaseBrowser
      .from("trainer_packages")
      .update({ sessions_used: nextUsed })
      .eq("id", packageId)
      .select("id, member_id, package_name, total_sessions, sessions_used, price, currency, expires_at")
      .maybeSingle();

    if (data) {
      setPackages((prev) => prev.map((pkg) => (pkg.id === packageId ? (data as PackageRow) : pkg)));
    }
  };

  const nearExpiry = (expiresAtValue: string | null) => {
    if (!expiresAtValue) return false;
    const expires = new Date(expiresAtValue).getTime();
    return expires - Date.now() < 1000 * 60 * 60 * 24 * 14;
  };

  const clientOptions = useMemo(() => clients, [clients]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Training Packages</h1>
          <p className="text-sm text-slate-400">Assign packages and track session usage.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={selectedMemberId}
              onChange={(event) => setSelectedMemberId(event.target.value)}
            >
              <option value="">Select client</option>
              {clientOptions.map((client) => (
                <option key={client.member_id} value={client.member_id}>
                  {client.members?.users?.full_name ?? client.member_id}
                </option>
              ))}
            </select>
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={packageName}
              onChange={(event) => setPackageName(event.target.value)}
              placeholder="Package name"
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              type="number"
              value={totalSessions}
              onChange={(event) => setTotalSessions(Number(event.target.value))}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              type="number"
              value={price}
              onChange={(event) => setPrice(Number(event.target.value))}
              placeholder="Price"
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950" onClick={assignPackage}>
            Assign package
          </button>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="space-y-3">
            {packages.map((pkg) => (
              <div key={pkg.id} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-3 space-y-1">
                <div className="text-sm font-medium">{pkg.package_name}</div>
                <div className="text-xs text-slate-500">
                  {pkg.sessions_used}/{pkg.total_sessions} sessions used
                </div>
                <div className="text-xs text-slate-500">Price: {pkg.price} {pkg.currency.toUpperCase()}</div>
                <div className={`text-xs ${nearExpiry(pkg.expires_at) ? "text-amber-300" : "text-slate-500"}`}>
                  {pkg.expires_at ? `Expires ${new Date(pkg.expires_at).toLocaleDateString()}` : "No expiration"}
                </div>
                <button
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200"
                  onClick={() => decrementSession(pkg.id)}
                >
                  Mark session used
                </button>
              </div>
            ))}
            {packages.length === 0 ? <p className="text-sm text-slate-400">No packages assigned yet.</p> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function TrainerPackagesPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrainerPackagesView />
    </QueryClientProvider>
  );
}
