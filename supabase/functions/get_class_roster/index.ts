import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type RosterRequest = {
  class_instance_id?: string;
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

  let payload: RosterRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.class_instance_id) {
    return jsonResponse(400, { error: "class_instance_id_required" });
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

  const { data: instance } = await serviceClient
    .from("class_instances")
    .select("id, gym_id")
    .eq("id", payload.class_instance_id)
    .maybeSingle();

  if (!instance || instance.gym_id !== staff.gym_id) {
    return jsonResponse(403, { error: "gym_mismatch" });
  }

  const { data: roster } = await serviceClient
    .from("class_bookings")
    .select("id, member_id, status, attendance_status, members(full_name)")
    .eq("class_instance_id", instance.id)
    .order("booked_at", { ascending: true });

  return jsonResponse(200, {
    roster: (roster ?? []).map((row) => ({
      booking_id: row.id,
      member_id: row.member_id,
      member_name: row.members?.full_name ?? "Member",
      status: row.status,
      attendance_status: row.attendance_status,
    })),
  });
});
