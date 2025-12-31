import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Schedule this function in Supabase Dashboard → Edge Functions → Schedule.
// Recommended: run hourly to enforce grace period expirations.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_FUNCTIONS_URL = Deno.env.get("SUPABASE_FUNCTIONS_URL") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function notify(
  event: string,
  memberId: string,
  gracePeriodUntil?: string | null
) {
  if (!SUPABASE_FUNCTIONS_URL) return;

  await fetch(`${SUPABASE_FUNCTIONS_URL}/send_billing_notifications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ event, member_id: memberId, grace_period_until: gracePeriodUntil }),
  });
}

Deno.serve(async () => {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const nowIso = now.toISOString();
  const soonIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: expiringSoon } = await serviceClient
    .from("subscriptions")
    .select("id, member_id, grace_period_until")
    .eq("delinquency_state", "pending_retry")
    .gte("grace_period_until", nowIso)
    .lte("grace_period_until", soonIso);

  if (expiringSoon) {
    for (const sub of expiringSoon) {
      await notify("billing.grace_period_expiring", sub.member_id, sub.grace_period_until);
    }
  }

  const { data: expired } = await serviceClient
    .from("subscriptions")
    .select("id, member_id")
    .eq("delinquency_state", "pending_retry")
    .lt("grace_period_until", nowIso);

  let updated = 0;

  if (expired) {
    for (const sub of expired) {
      const { error } = await serviceClient
        .from("subscriptions")
        .update({ delinquency_state: "past_due" })
        .eq("id", sub.id);

      if (!error) {
        await serviceClient
          .from("member_subscriptions")
          .update({ access_state: "restricted" })
          .eq("member_id", sub.member_id);
        updated += 1;
      }
    }
  }

  return jsonResponse(200, {
    updated,
    expiring_soon: expiringSoon?.length ?? 0,
    processed: expired?.length ?? 0,
  });
});
