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

type SessionRow = {
  id: string;
  member_id: string;
  session_start: string;
  session_end: string;
  status: string;
  location: string | null;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function TrainerSessionsView() {
  const router = useRouter();
  const { session, loading } = useAuthStore();
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
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

      const [{ data: clientRows }, { data: sessionRows }] = await Promise.all([
        supabaseBrowser
          .from("trainer_clients")
          .select("member_id, members(users(full_name))")
          .eq("trainer_id", trainerRow.id),
        supabaseBrowser
          .from("trainer_sessions")
          .select("id, member_id, session_start, session_end, status, location")
          .eq("trainer_id", trainerRow.id)
          .order("session_start", { ascending: false }),
      ]);

      setTrainer(trainerRow as TrainerRow);
      setClients((clientRows ?? []) as ClientRow[]);
      setSessions((sessionRows ?? []) as SessionRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [router, session?.user.id]);

  const clientOptions = useMemo(() => clients, [clients]);

  const createSession = async () => {
    if (!trainer || !selectedMemberId || !startTime || !endTime) return;
    const { data } = await supabaseBrowser
      .from("trainer_sessions")
      .insert({
        trainer_id: trainer.id,
        member_id: selectedMemberId,
        session_start: startTime,
        session_end: endTime,
        location: location || null,
        status: "SCHEDULED",
      })
      .select("id, member_id, session_start, session_end, status, location")
      .maybeSingle();

    if (data) {
      setSessions((prev) => [data as SessionRow, ...prev]);
    }
  };

  const updateStatus = async (sessionId: string, status: string) => {
    const { data } = await supabaseBrowser
      .from("trainer_sessions")
      .update({ status })
      .eq("id", sessionId)
      .select("id, member_id, session_start, session_end, status, location")
      .maybeSingle();

    if (data) {
      setSessions((prev) => prev.map((row) => (row.id === sessionId ? (data as SessionRow) : row)));
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Trainer Sessions</h1>
          <p className="text-sm text-slate-400">Schedule, reschedule, and track session outcomes.</p>
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
              type="datetime-local"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              type="datetime-local"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              placeholder="Location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950" onClick={createSession}>
            Create session
          </button>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="space-y-3">
            {sessions.map((sessionItem) => (
              <div key={sessionItem.id} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-3 space-y-1">
                <div className="text-sm">Member: {sessionItem.member_id}</div>
                <div className="text-xs text-slate-500">
                  {new Date(sessionItem.session_start).toLocaleString()} - {new Date(sessionItem.session_end).toLocaleString()}
                </div>
                <div className="text-xs text-slate-500">Status: {sessionItem.status}</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {[
                    { label: "Complete", value: "COMPLETED" },
                    { label: "Cancel", value: "CANCELLED" },
                    { label: "No-show", value: "NO_SHOW" },
                  ].map((action) => (
                    <button
                      key={action.value}
                      className="rounded-md border border-slate-700 px-2 py-1 text-slate-200"
                      onClick={() => updateStatus(sessionItem.id, action.value)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {sessions.length === 0 ? <p className="text-sm text-slate-400">No sessions scheduled.</p> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function TrainerSessionsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrainerSessionsView />
    </QueryClientProvider>
  );
}
