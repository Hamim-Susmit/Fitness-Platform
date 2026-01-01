import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callEdgeFunction } from "./api";

export function useSubscriptionActions() {
  const queryClient = useQueryClient();

  const changePlan = useMutation({
    mutationFn: async (pricingPlanId: string) => {
      const response = await callEdgeFunction<{ pricing_plan_id: string; status: string }>(
        "change_subscription_plan",
        {
          body: { pricing_plan_id: pricingPlanId },
        }
      );
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to change plan");
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["pricing-plans"] });
    },
  });

  return { changePlan };
}
