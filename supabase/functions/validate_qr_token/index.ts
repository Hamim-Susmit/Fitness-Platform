import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required Supabase environment variables");
}

type ValidateRequest = {
  token?: string;
  override?: boolean;
};

type AccessDecision =
  | "ALLOWED_HOME"
  | "ALLOWED_SECONDARY"
  | "ALLOWED_ALL_ACCESS"
  | "ALLOWED_OVERRIDE"
  | "DENIED_NO_ACCESS"
  | "DENIED_EXPIRED"
  | "DENIED_SUSPENDED";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: ValidateRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.token) {
    return jsonResponse(400, { error: "token_required" });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse(401, { error: "invalid_user" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: staffRole } = await serviceClient
    .from("staff_roles")
    .select("role, gym_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: legacyStaff } = await serviceClient
    .from("staff")
    .select("id, gym_id, staff_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!staffRole && !legacyStaff) {
    return jsonResponse(403, { error: "staff_not_found" });
  }

  const { data: tokenRecord } = await serviceClient
    .from("checkin_tokens")
    .select("id, member_id, gym_id, expires_at, used")
    .eq("token", payload.token)
    .maybeSingle();

  if (!tokenRecord) {
    return jsonResponse(404, { error: "token_not_found" });
  }

  if (tokenRecord.used) {
    return jsonResponse(409, { error: "token_already_used" });
  }

  if (new Date(tokenRecord.expires_at).getTime() <= Date.now()) {
    return jsonResponse(410, { error: "token_expired" });
  }

  const staffGymId = staffRole?.gym_id ?? legacyStaff?.gym_id ?? null;
  if (staffGymId && staffGymId !== tokenRecord.gym_id) {
    return jsonResponse(403, { error: "staff_gym_mismatch" });
  }

  const { data: member } = await serviceClient
    .from("members")
    .select("id, gym_id, status, user_id")
    .eq("id", tokenRecord.member_id)
    .maybeSingle();

  if (!member) {
    return jsonResponse(404, { error: "member_not_found" });
  }

  if (member.status !== "active") {
    return jsonResponse(403, { error: "member_inactive" });
  }

  const { data: accessState } = await serviceClient
    .from("member_subscriptions")
    .select("access_state")
    .eq("member_id", member.id)
    .maybeSingle();

  if (accessState?.access_state === "restricted" || accessState?.access_state === "inactive") {
    await serviceClient.from("checkin_tokens").update({ used: true, used_at: new Date().toISOString() }).eq("id", tokenRecord.id);
    await serviceClient.from("checkins").insert({
      member_id: member.id,
      gym_id: tokenRecord.gym_id,
      checked_in_at: new Date().toISOString(),
      source: "qr",
      staff_id: legacyStaff?.id ?? null,
      access_decision: "DENIED_EXPIRED",
      decision_reason: "Subscription inactive",
    });
    return jsonResponse(403, { error: "access_restricted" });
  }

  // Access decisions rely on current member_subscriptions + derive_member_gym_access_from_subscription.
  // TODO: ensure Stripe webhooks re-run derive_member_gym_access_from_subscription on plan changes.
  const { data: accessInfo, error: accessError } = await serviceClient.rpc("resolve_member_gym_access", {
    p_member_id: member.id,
    p_gym_id: tokenRecord.gym_id,
  });

  if (accessError) {
    return jsonResponse(500, { error: "access_check_failed" });
  }

  const accessType = (accessInfo?.access_type ?? "NONE") as string;
  const accessStatus = (accessInfo?.status ?? "NONE") as string;
  const hasAccess = Boolean(accessInfo?.has_access);

  let accessDecision: AccessDecision = "DENIED_NO_ACCESS";
  let decisionReason = "No gym access";

  if (accessStatus === "SUSPENDED") {
    accessDecision = "DENIED_SUSPENDED";
    decisionReason = "Access suspended";
  } else if (accessStatus === "EXPIRED") {
    accessDecision = "DENIED_EXPIRED";
    decisionReason = "Access expired";
  } else if (hasAccess) {
    if (accessType === "HOME") {
      accessDecision = "ALLOWED_HOME";
      decisionReason = "Home gym access";
    } else if (accessType === "SECONDARY") {
      accessDecision = "ALLOWED_SECONDARY";
      decisionReason = "Secondary gym access";
    } else if (accessType === "ALL_ACCESS") {
      accessDecision = "ALLOWED_ALL_ACCESS";
      decisionReason = "All-access membership";
    }
  }

  const overrideRequested = payload.override === true;
  const overrideAllowed = staffRole?.role === "MANAGER" || staffRole?.role === "ADMIN" || legacyStaff?.staff_role === "manager";

  if (overrideRequested && overrideAllowed) {
    accessDecision = "ALLOWED_OVERRIDE";
    decisionReason = "Staff override — manual approval";

    await serviceClient.from("member_gym_access_events").insert({
      member_id: member.id,
      gym_id: tokenRecord.gym_id,
      actor_user_id: user.id,
      event_type: "CHECKIN_OVERRIDE",
      payload: { token_id: tokenRecord.id, access_type: accessType, access_status: accessStatus },
    });
  }

  await serviceClient
    .from("checkin_tokens")
    .update({ used: true, used_at: new Date().toISOString() })
    .eq("id", tokenRecord.id);

  const { data: checkinRow, error: checkinError } = await serviceClient
    .from("checkins")
    .insert({
      member_id: member.id,
      gym_id: tokenRecord.gym_id,
      checked_in_at: new Date().toISOString(),
      source: "qr",
      staff_id: legacyStaff?.id ?? null,
      access_decision: accessDecision,
      decision_reason: decisionReason,
    })
    .select("id")
    .maybeSingle();

  if (checkinError) {
    return jsonResponse(500, { error: "checkin_failed" });
  }

  if (accessDecision.startsWith("DENIED")) {
    return jsonResponse(403, { error: accessDecision, checkin_id: checkinRow?.id, decision_reason: decisionReason });
  }

  return jsonResponse(200, {
    checkin_id: checkinRow?.id,
    access_decision: accessDecision,
    decision_reason: decisionReason,
    access_type: accessType,
  });
});
