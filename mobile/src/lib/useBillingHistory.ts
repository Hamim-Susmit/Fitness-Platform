import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type BillingHistoryItem = {
  member_id: string;
  subscription_id: string;
  invoice_id: string;
  transaction_id: string | null;
  period_start: string | null;
  period_end: string | null;
  amount_cents: number;
  currency: string;
  status: "paid" | "failed" | "refunded" | "pending";
  hosted_invoice_url: string | null;
  pdf_url: string | null;
  created_at: string;
};

const PAGE_SIZE = 10;

export function useBillingHistory(memberId?: string) {
  return useInfiniteQuery({
    queryKey: ["billing-history", memberId],
    enabled: !!memberId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("billing_history_view")
        .select(
          "member_id, subscription_id, invoice_id, transaction_id, period_start, period_end, amount_cents, currency, status, hosted_invoice_url, pdf_url, created_at"
        )
        .eq("member_id", memberId ?? "")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        throw error;
      }

      return data as BillingHistoryItem[];
    },
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return pages.length;
    },
  });
}
