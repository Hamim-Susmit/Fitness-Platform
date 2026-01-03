import { supabaseBrowser } from "../supabase-browser";

const REFERRER_POINTS = 500;
const REFERRED_POINTS = 250;

async function issueReward(params: {
  referrerMemberId: string;
  referredMemberId: string | null;
  rewardType: "FREE_MONTH" | "CREDITS" | "POINTS" | "DISCOUNT_TOKEN";
  rewardValue: number | null;
  referralId: string;
  role: "referrer" | "referred";
}) {
  const { data: existing } = await supabaseBrowser
    .from("referral_rewards")
    .select("id")
    .contains("context_json", { referral_id: params.referralId, role: params.role })
    .eq("reward_type", params.rewardType)
    .eq("referrer_member_id", params.referrerMemberId)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabaseBrowser.from("referral_rewards").insert({
    referrer_member_id: params.referrerMemberId,
    referred_member_id: params.referredMemberId,
    reward_type: params.rewardType,
    reward_value: params.rewardValue,
    status: "ISSUED",
    context_json: { referral_id: params.referralId, role: params.role },
  });

  return !error;
}

export async function evaluateReferralReward(referralId: string) {
  const { data: referral } = await supabaseBrowser
    .from("referrals")
    .select("id, referrer_member_id, referred_member_id, status")
    .eq("id", referralId)
    .maybeSingle();

  if (!referral || referral.status !== "ACTIVATED") {
    return { ok: false, error: "not_activated" };
  }

  await issueReward({
    referrerMemberId: referral.referrer_member_id,
    referredMemberId: referral.referred_member_id,
    rewardType: "POINTS",
    rewardValue: REFERRER_POINTS,
    referralId: referral.id,
    role: "referrer",
  });

  if (referral.referred_member_id) {
    await issueReward({
      referrerMemberId: referral.referrer_member_id,
      referredMemberId: referral.referred_member_id,
      rewardType: "POINTS",
      rewardValue: REFERRED_POINTS,
      referralId: referral.id,
      role: "referred",
    });
  }

  await supabaseBrowser
    .from("referrals")
    .update({ status: "REWARDED" })
    .eq("id", referral.id);

  return { ok: true };
}

export async function markRewardRedeemed(rewardId: string) {
  const { error } = await supabaseBrowser
    .from("referral_rewards")
    .update({ status: "REDEEMED", redeemed_at: new Date().toISOString() })
    .eq("id", rewardId);

  return { ok: !error };
}
