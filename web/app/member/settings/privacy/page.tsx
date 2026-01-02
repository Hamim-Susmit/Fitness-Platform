"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { roleRedirectPath } from "../../../../lib/roles";
import { FeedVisibility, setDefaultFeedVisibility } from "../../../../lib/social/events";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function PrivacySettingsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [visibility, setVisibility] = useState<FeedVisibility>("FRIENDS_ONLY");

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  const saveVisibility = (value: FeedVisibility) => {
    setVisibility(value);
    setDefaultFeedVisibility(value);
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Privacy Settings</h1>
          <p className="text-sm text-slate-400">Control who can see your activity feed.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <label className="text-xs text-slate-400">Default feed visibility</label>
          <select
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            value={visibility}
            onChange={(event) => saveVisibility(event.target.value as FeedVisibility)}
          >
            <option value="PUBLIC">Public</option>
            <option value="FRIENDS_ONLY">Friends only</option>
            <option value="PRIVATE">Private</option>
          </select>
          <p className="text-xs text-slate-500">Applies to new activity events unless overridden per post.</p>
        </section>
      </main>
    </div>
  );
}

export default function PrivacySettingsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <PrivacySettingsView />
    </QueryClientProvider>
  );
}
