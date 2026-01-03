import { supabase } from "../supabase";

function normalizeEmail(email: string) {
  const lower = email.trim().toLowerCase();
  const [local, domain] = lower.split("@");
  if (!domain) return lower;
  const cleanedLocal = local.split("+")[0].replace(/\./g, "");
  return `${cleanedLocal}@${domain}`;
}

// Create a referral invite (member-initiated). Duplicate emails are blocked per referrer.
export async function createReferralInvite(referrerId: string, referredEmail: string, referralCode: string) {
  const normalized = normalizeEmail(referredEmail);

  const { data: existing } = await supabase
    .from("referrals")
    .select("id")
    .eq("referrer_member_id", referrerId)
    .eq("referred_email", normalized)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "duplicate_referral" };
  }

  const { data, error } = await supabase
    .from("referrals")
    .insert({
      referrer_member_id: referrerId,
      referred_email: normalized,
      referral_code: referralCode,
      status: "INVITED",
    })
    .select("id, referrer_member_id, referred_email, status, created_at")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data };
}

// Mark referral signup. Should be called from a server/service context.
export async function markReferralSignup(referralCode: string, memberId: string, referredEmail?: string) {
  const normalized = referredEmail ? normalizeEmail(referredEmail) : null;

  let query = supabase
    .from("referrals")
    .select("id, status")
    .eq("referral_code", referralCode)
    .in("status", ["INVITED", "SIGNED_UP"])
    .is("referred_member_id", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (normalized) {
    query = query.eq("referred_email", normalized);
  }

  const { data: referral } = await query.maybeSingle();
  if (!referral) return { ok: false, error: "referral_not_found" };

  const { data, error } = await supabase
    .from("referrals")
    .update({ referred_member_id: memberId, status: "SIGNED_UP" })
    .eq("id", referral.id)
    .select("id, status")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data };
}

// Mark activation; reward evaluation is triggered in service layer.
export async function markReferralActivated(memberId: string) {
  const { data: referral } = await supabase
    .from("referrals")
    .select("id, status")
    .eq("referred_member_id", memberId)
    .eq("status", "SIGNED_UP")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!referral) return { ok: false, error: "referral_not_found" };

  const { data, error } = await supabase
    .from("referrals")
    .update({ status: "ACTIVATED" })
    .eq("id", referral.id)
    .select("id, status")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data };
}
