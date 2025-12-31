"use client";

import type { BillingHistoryItem } from "../lib/useBillingHistory";
import { formatTime } from "../lib/time";

type BillingHistoryTableProps = {
  items: BillingHistoryItem[];
};

const formatPrice = (amountCents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);

const statusStyles: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-300",
  failed: "bg-rose-500/10 text-rose-300",
  refunded: "bg-amber-500/10 text-amber-300",
  pending: "bg-slate-500/10 text-slate-300",
};

export default function BillingHistoryTable({ items }: BillingHistoryTableProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-950/60 text-slate-400">
          <tr>
            <th className="text-left px-4 py-3">Date</th>
            <th className="text-left px-4 py-3">Description</th>
            <th className="text-left px-4 py-3">Amount</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.invoice_id} className="border-t border-slate-800">
              <td className="px-4 py-3 text-slate-300">{formatTime(item.created_at)}</td>
              <td className="px-4 py-3">
                <p className="text-white">Subscription</p>
                <p className="text-xs text-slate-500">
                  {item.period_start ? new Date(item.period_start).toLocaleDateString() : ""}
                  {item.period_end ? ` → ${new Date(item.period_end).toLocaleDateString()}` : ""}
                </p>
              </td>
              <td className="px-4 py-3 text-slate-300">{formatPrice(item.amount_cents, item.currency)}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-xs ${
                    statusStyles[item.status] ?? statusStyles.pending
                  }`}
                >
                  {item.status}
                </span>
                {item.status === "failed" ? (
                  <p className="text-xs text-rose-300 mt-1">Payment failed. Retry in billing portal.</p>
                ) : null}
              </td>
              <td className="px-4 py-3 space-x-2">
                {item.hosted_invoice_url ? (
                  <a
                    className="text-cyan-300 hover:text-cyan-200"
                    href={item.hosted_invoice_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                ) : (
                  <span className="text-slate-600">View</span>
                )}
                {item.pdf_url ? (
                  <a
                    className="text-cyan-300 hover:text-cyan-200"
                    href={item.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PDF
                  </a>
                ) : (
                  <span className="text-slate-600">PDF</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
