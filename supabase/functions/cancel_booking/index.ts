import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_FUNCTIONS_URL = Deno.env.get("SUPABASE_FUNCTIONS_URL") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type CancelRequest = {
  booking_id?: string;
};

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

  let payload: CancelRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.booking_id) {
    return jsonResponse(400, { error: "booking_id_required" });
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

  const { data: member } = await userClient
    .from("members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return jsonResponse(403, { error: "member_not_found" });
  }

  const { data: booking } = await userClient
    .from("class_bookings")
    .select("id, class_instance_id, status")
    .eq("id", payload.booking_id)
    .eq("member_id", member.id)
    .maybeSingle();

  if (!booking) {
    return jsonResponse(404, { error: "booking_not_found" });
  }

  if (booking.status !== "booked") {
    return jsonResponse(400, { error: "booking_not_active" });
  }

  const { data: instance } = await userClient
    .from("class_instances")
    .select("start_at, late_cancel_cutoff_minutes")
    .eq("id", booking.class_instance_id)
    .maybeSingle();

  if (!instance) {
    return jsonResponse(404, { error: "class_instance_not_found" });
  }

  const startAt = new Date(instance.start_at);
  if (Date.now() >= startAt.getTime()) {
    return jsonResponse(400, { error: "class_already_started" });
  }

  const cutoffMinutes = instance.late_cancel_cutoff_minutes ?? 120;
  const cutoffTime = startAt.getTime() - cutoffMinutes * 60 * 1000;
  const isLate = Date.now() > cutoffTime;

  const { error: updateError } = await userClient
    .from("class_bookings")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      cancellation_reason: isLate ? "late_cancel" : null,
    })
    .eq("id", booking.id);

  if (updateError) {
    console.log("cancel_failed", { booking_id: booking.id, member_id: member.id });
    return jsonResponse(500, { error: "cancel_failed" });
  }

  if (SUPABASE_SERVICE_ROLE_KEY && SUPABASE_FUNCTIONS_URL) {
    fetch(`${SUPABASE_FUNCTIONS_URL}/promote_waitlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ class_instance_id: booking.class_instance_id }),
    })
      .then(() => {
        console.log("promotion_triggered", { class_instance_id: booking.class_instance_id });
      })
      .catch((error) => {
        console.log("promotion_trigger_failed", { error: error?.message });
      });
  }

  console.log("booking_canceled", {
    booking_id: booking.id,
    member_id: member.id,
    class_instance_id: booking.class_instance_id,
    late: isLate,
  });

  return jsonResponse(200, { status: "canceled", late: isLate });
});
