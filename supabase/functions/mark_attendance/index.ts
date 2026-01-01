import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type AttendanceRequest = {
  booking_id?: string;
  status?: "checked_in" | "no_show" | "excused";
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

  let payload: AttendanceRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.booking_id || !payload.status) {
    return jsonResponse(400, { error: "missing_parameters" });
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

  const { data: staff } = await userClient
    .from("staff")
    .select("gym_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!staff) {
    return jsonResponse(403, { error: "staff_only" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: booking } = await serviceClient
    .from("class_bookings")
    .select("id, member_id, class_instance_id, status, attendance_status")
    .eq("id", payload.booking_id)
    .maybeSingle();

  if (!booking) {
    return jsonResponse(404, { error: "booking_not_found" });
  }

  const { data: instance } = await serviceClient
    .from("class_instances")
    .select("id, gym_id, start_at, checkin_method")
    .eq("id", booking.class_instance_id)
    .maybeSingle();

  if (!instance || instance.gym_id !== staff.gym_id) {
    return jsonResponse(403, { error: "gym_mismatch" });
  }

  const startAt = new Date(instance.start_at);
  const allowedAt = startAt.getTime() - 30 * 60 * 1000;
  if (Date.now() < allowedAt) {
    return jsonResponse(400, { error: "too_early" });
  }

  // TODO: allow QR-based attendance with member QR token validation.
  // TODO: prevent non-booked members from QR check-in.

  const newStatus = payload.status;
  const now = new Date().toISOString();

  const { data: updated, error: updateError } = await serviceClient
    .from("class_bookings")
    .update({
      attendance_status: newStatus,
      attendance_marked_at: now,
      attendance_marked_by: user.id,
      status: newStatus === "checked_in" ? "attended" : booking.status,
    })
    .eq("id", booking.id)
    .select("id, attendance_status")
    .maybeSingle();

  if (updateError) {
    console.log("attendance_update_failed", { error: updateError.message });
    return jsonResponse(500, { error: "attendance_update_failed" });
  }

  console.log("attendance_marked", {
    booking_id: booking.id,
    class_instance_id: booking.class_instance_id,
    marked_by: user.id,
    previous_status: booking.attendance_status,
    new_status: newStatus,
  });

  return jsonResponse(200, {
    booking_id: booking.id,
    attendance_status: updated?.attendance_status ?? newStatus,
  });
});
