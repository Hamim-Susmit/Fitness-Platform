"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";

type ClientRow = {
  id: string;
  member_id: string;
  members?: { user_id: string; users?: { full_name: string | null } | null } | null;
};

type TrainerRow = {
  id: string;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function TrainerClientsView() {
  const router = useRouter();
  const { session, loading } = useAuthStore();
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
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

      const { data: clientRows } = await supabaseBrowser
        .from("trainer_clients")
        .select("id, member_id, members(user_id, users(full_name))")
        .eq("trainer_id", trainerRow.id)
        .order("created_at", { ascending: false });

      setTrainer((trainerRow ?? null) as TrainerRow | null);
      setClients((clientRows ?? []) as ClientRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [router, session?.user.id]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Your Clients</h1>
          <p className="text-sm text-slate-400">Manage assigned clients and jump to progress notes.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="space-y-3">
            {clients.map((client) => (
              <div key={client.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-3">
                <div>
                  <div className="text-sm font-medium">{client.members?.users?.full_name ?? "Member"}</div>
                  <div className="text-xs text-slate-500">Member ID: {client.member_id}</div>
                </div>
                <div className="flex gap-2 text-xs">
                  <Link className="rounded-md border border-slate-700 px-2 py-1 text-slate-200" href={`/trainer/clients/${client.member_id}/notes`}>
                    Notes
                  </Link>
                  <Link className="rounded-md border border-slate-700 px-2 py-1 text-slate-200" href={`/member/workouts/builder`}>
                    Workouts
                  </Link>
                  <Link className="rounded-md border border-slate-700 px-2 py-1 text-slate-200" href={`/member/workouts`}>
                    Progress
                  </Link>
                </div>
              </div>
            ))}
            {clients.length === 0 ? <p className="text-sm text-slate-400">No clients assigned yet.</p> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function TrainerClientsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrainerClientsView />
    </QueryClientProvider>
  );
}
