"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";

type FriendRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function FriendsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [friendRows, setFriendRows] = useState<FriendRow[]>([]);
  const [receiverId, setReceiverId] = useState("");
  const [loadingData, setLoadingData] = useState(true);

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
      const { data } = await supabaseBrowser
        .from("friends")
        .select("id, requester_id, receiver_id, status, created_at")
        .or(`requester_id.eq.${session.user.id},receiver_id.eq.${session.user.id}`)
        .order("created_at", { ascending: false });

      setFriendRows((data ?? []) as FriendRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [session?.user.id]);

  const sendRequest = async () => {
    if (!session?.user.id || !receiverId) return;
    const { data } = await supabaseBrowser
      .from("friends")
      .insert({ requester_id: session.user.id, receiver_id: receiverId, status: "PENDING" })
      .select("id, requester_id, receiver_id, status, created_at")
      .maybeSingle();

    if (data) {
      setFriendRows((prev) => [data as FriendRow, ...prev]);
      setReceiverId("");
    }
  };

  const updateStatus = async (friendId: string, status: string) => {
    const { data } = await supabaseBrowser
      .from("friends")
      .update({ status })
      .eq("id", friendId)
      .select("id, requester_id, receiver_id, status, created_at")
      .maybeSingle();

    if (data) {
      setFriendRows((prev) => prev.map((row) => (row.id === friendId ? (data as FriendRow) : row)));
    }
  };

  const pending = useMemo(() => friendRows.filter((row) => row.status === "PENDING"), [friendRows]);
  const accepted = useMemo(() => friendRows.filter((row) => row.status === "ACCEPTED"), [friendRows]);
  const blocked = useMemo(() => friendRows.filter((row) => row.status === "BLOCKED"), [friendRows]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Friends</h1>
          <p className="text-sm text-slate-400">Manage friend requests and privacy controls.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="Enter member user id"
            value={receiverId}
            onChange={(event) => setReceiverId(event.target.value)}
          />
          <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950" onClick={sendRequest}>
            Send request
          </button>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Pending</h2>
          {pending.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 flex justify-between">
              <div className="text-sm text-slate-200">Request {row.requester_id} → {row.receiver_id}</div>
              <div className="flex gap-2 text-xs">
                <button className="rounded-md border border-emerald-500/60 px-2 py-1 text-emerald-200" onClick={() => updateStatus(row.id, "ACCEPTED")}>Accept</button>
                <button className="rounded-md border border-rose-500/60 px-2 py-1 text-rose-200" onClick={() => updateStatus(row.id, "REJECTED")}>Reject</button>
                <button className="rounded-md border border-slate-700 px-2 py-1 text-slate-200" onClick={() => updateStatus(row.id, "BLOCKED")}>Block</button>
              </div>
            </div>
          ))}
          {pending.length === 0 ? <p className="text-sm text-slate-400">No pending requests.</p> : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Friends</h2>
          {accepted.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 flex justify-between">
              <div className="text-sm text-slate-200">Friendship: {row.requester_id} ↔ {row.receiver_id}</div>
              <button className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200" onClick={() => updateStatus(row.id, "BLOCKED")}>Block</button>
            </div>
          ))}
          {accepted.length === 0 ? <p className="text-sm text-slate-400">No friends yet.</p> : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Blocked</h2>
          {blocked.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 flex justify-between">
              <div className="text-sm text-slate-200">Blocked: {row.requester_id} ↔ {row.receiver_id}</div>
              <button className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200" onClick={() => updateStatus(row.id, "REJECTED")}>Unblock</button>
            </div>
          ))}
          {blocked.length === 0 ? <p className="text-sm text-slate-400">No blocked users.</p> : null}
        </section>
      </main>
    </div>
  );
}

export default function FriendsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <FriendsView />
    </QueryClientProvider>
  );
}
