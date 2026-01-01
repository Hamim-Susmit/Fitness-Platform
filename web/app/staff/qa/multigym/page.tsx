"use client";

import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../../lib/auth";
import { roleRedirectPath } from "../../../../lib/roles";
import { callEdgeFunction } from "../../../../lib/api";
import { getUserRoleContext, isCorporateAdmin } from "../../../../lib/permissions/gymPermissions";

type DiagnosticResponse = {
  timestamp: string;
  summary: {
    invalid_gym_refs: number;
    orphaned_member_access: number;
    inconsistent_access: number;
  };
  samples: {
    invalid_gym_refs: Array<Record<string, unknown>>;
    orphaned_member_access: Array<Record<string, unknown>>;
    inconsistent_access: Array<Record<string, unknown>>;
  };
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function DiagnosticsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { message, status } = useToastStore();

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    const resolveAccess = async () => {
      if (!session?.user.id) return;
      await getUserRoleContext(session.user.id);
      if (!isCorporateAdmin()) {
        router.replace(roleRedirectPath(role));
      }
    };
    resolveAccess();
  }, [role, router, session?.user.id]);

  const diagnostics = useQuery<DiagnosticResponse>({
    queryKey: ["multigym-diagnostics"],
    enabled: !!session,
    queryFn: async () => {
      const response = await callEdgeFunction<DiagnosticResponse>("run-multigym-diagnostics", {
        body: { scope: "ALL" },
      });
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to load diagnostics");
      }
      return response.data;
    },
  });

  if (loading || diagnostics.isLoading) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (diagnostics.isError) {
    return (
      <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
        <div className="max-w-5xl mx-auto">
          <p className="text-rose-200 text-sm">Unable to load diagnostics.</p>
        </div>
      </div>
    );
  }

  const data = diagnostics.data;

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
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
          <h1 className="text-3xl font-semibold">Multi-Gym QA Diagnostics</h1>
          <p className="text-slate-400 text-sm">Snapshot generated at {data.timestamp}.</p>
        </div>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-sm text-slate-400">Invalid gym references</div>
            <div className="text-2xl font-semibold">{data.summary.invalid_gym_refs}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-sm text-slate-400">Orphaned member access</div>
            <div className="text-2xl font-semibold">{data.summary.orphaned_member_access}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-sm text-slate-400">Access mismatches</div>
            <div className="text-2xl font-semibold">{data.summary.inconsistent_access}</div>
          </div>
        </section>

        <section className="space-y-4">
          <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" open>
            <summary className="cursor-pointer text-lg font-semibold">Invalid gym references</summary>
            <div className="mt-4 overflow-x-auto">
              <pre className="text-xs text-slate-300">{JSON.stringify(data.samples.invalid_gym_refs, null, 2)}</pre>
            </div>
          </details>
          <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <summary className="cursor-pointer text-lg font-semibold">Orphaned member access</summary>
            <div className="mt-4 overflow-x-auto">
              <pre className="text-xs text-slate-300">{JSON.stringify(data.samples.orphaned_member_access, null, 2)}</pre>
            </div>
          </details>
          <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <summary className="cursor-pointer text-lg font-semibold">Access vs subscription mismatches</summary>
            <div className="mt-4 overflow-x-auto">
              <pre className="text-xs text-slate-300">{JSON.stringify(data.samples.inconsistent_access, null, 2)}</pre>
            </div>
          </details>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <h2 className="text-lg font-semibold">Actions</h2>
          <p className="text-sm text-slate-400">
            Repairs are triggered via SQL functions. UI actions are disabled for now.
          </p>
          <div className="flex flex-wrap gap-3">
            <button className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold opacity-50" disabled>
              Run repair for all inconsistencies
            </button>
            <button className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold opacity-50" disabled>
              Export issues as CSV
            </button>
          </div>
          {/* TODO: wire repair utilities after staged validation. */}
        </section>
      </div>
    </div>
  );
}

export default function MultiGymDiagnosticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <DiagnosticsView />
    </QueryClientProvider>
  );
}
