"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Header from "../../../../../../components/Header";
import BillingHistoryTable from "../../../../../../components/BillingHistoryTable";
import { loadSessionAndRole, useAuthStore } from "../../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../../lib/roles";
import { useBillingHistory } from "../../../../../../lib/useBillingHistory";

type BillingPageProps = {
  params: { memberId: string };
};

export default function MemberBillingPage({ params }: BillingPageProps) {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const history = useBillingHistory(params.memberId);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  if (loading || !session) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  const items = history.data?.pages.flatMap((page) => page) ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-4">
        <h2 className="text-2xl font-semibold">Member Billing History</h2>
        {history.isLoading ? (
          <p className="text-sm text-slate-400">Loading billing history...</p>
        ) : history.isError ? (
          <p className="text-sm text-rose-400">Unable to load billing history.</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400">No billing history yet.</p>
        ) : (
          <>
            <BillingHistoryTable items={items} />
            {history.hasNextPage ? (
              <button
                onClick={() => history.fetchNextPage()}
                disabled={history.isFetchingNextPage}
                className="rounded-lg border border-slate-700 px-4 py-2 text-slate-200 hover:bg-slate-800"
              >
                {history.isFetchingNextPage ? "Loading..." : "Load more"}
              </button>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
