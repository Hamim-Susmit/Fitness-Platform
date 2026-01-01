import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "./supabase-browser";
import { callEdgeFunction } from "./api";
import type { MemberProfile } from "./types";

type PricingPlan = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval: "monthly" | "yearly";
  active: boolean;
};

type Subscription = {
  id: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "unpaid";
  current_period_end: string | null;
  pricing_plan_id: string;
  pricing_plans?: { name: string; price_cents: number; interval: string } | null;
};

export function useMemberProfile(userId?: string) {
  return useQuery<MemberProfile | null>({
    queryKey: ["member-profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("members")
        .select("id, user_id, gym_id, status")
        .eq("user_id", userId ?? "")
        .maybeSingle();
      return (data ?? null) as MemberProfile | null;
    },
  });
}

export function usePricingPlans() {
  return useQuery<PricingPlan[]>({
    queryKey: ["pricing-plans"],
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("pricing_plans")
        .select("id, name, description, price_cents, currency, interval, active")
        .eq("active", true)
        .order("price_cents", { ascending: true });
      return (data ?? []) as PricingPlan[];
    },
  });
}

export function useMemberSubscription(memberId?: string) {
  return useQuery<Subscription | null>({
    queryKey: ["member-subscription", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("subscriptions")
        .select("id, status, current_period_end, pricing_plan_id, pricing_plans(name, price_cents, interval)")
        .eq("member_id", memberId ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as Subscription | null;
    },
  });
}

export function useCheckoutSession() {
  return useMutation({
    mutationFn: async (pricingPlanId: string) => {
      const response = await callEdgeFunction<{ checkout_url: string }>("create_checkout_session", {
        body: { pricing_plan_id: pricingPlanId },
      });
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to start checkout");
      }
      return response.data.checkout_url;
    },
  });
}

export function usePortalSession() {
  return useMutation({
    mutationFn: async () => {
      const response = await callEdgeFunction<{ portal_url: string }>("create_customer_portal_session");
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to open billing portal");
      }
      return response.data.portal_url;
    },
  });
}

export function useRefreshSubscription() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["member-subscription"] });
  };
}
