"use client";

type BillingPlanCardProps = {
  name: string;
  description?: string | null;
  priceCents: number;
  interval: "monthly" | "yearly";
  isCurrent: boolean;
  status?: string | null;
  onSelect: () => void;
  loading: boolean;
};

const formatPrice = (priceCents: number) => `$${(priceCents / 100).toFixed(0)}`;

export default function BillingPlanCard({
  name,
  description,
  priceCents,
  interval,
  isCurrent,
  status,
  onSelect,
  loading,
}: BillingPlanCardProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{name}</h3>
          {description ? <p className="text-sm text-slate-400 mt-1">{description}</p> : null}
        </div>
        {isCurrent ? (
          <span className="text-xs uppercase tracking-wide text-emerald-400">Current</span>
        ) : null}
      </div>
      <p className="mt-4 text-2xl font-semibold text-white">
        {formatPrice(priceCents)} <span className="text-sm text-slate-400">/ {interval}</span>
      </p>
      {status && isCurrent ? (
        <p className="mt-2 text-xs text-slate-400">Status: {status}</p>
      ) : null}
      <button
        onClick={onSelect}
        disabled={loading || isCurrent}
        className="mt-4 w-full rounded-lg bg-cyan-500 text-slate-950 font-semibold py-2 hover:bg-cyan-400 disabled:opacity-60"
      >
        {isCurrent ? "Current Plan" : loading ? "Starting checkout..." : "Subscribe / Change Plan"}
      </button>
    </div>
  );
}
