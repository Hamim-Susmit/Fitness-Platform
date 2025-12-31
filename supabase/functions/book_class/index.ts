import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type BookRequest = {
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

  let payload: BookRequest;
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

  const { data: member } = await userClient
    .from("members")
    .select("id, gym_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return jsonResponse(403, { error: "member_not_found" });
  }

  const { data: access } = await userClient
    .from("member_subscriptions")
    .select("access_state")
    .eq("member_id", member.id)
    .maybeSingle();

  if (access?.access_state === "restricted" || access?.access_state === "inactive") {
    return jsonResponse(403, { error: "access_restricted" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: instance } = await serviceClient
    .from("class_instances")
    .select("id, gym_id, capacity, status, start_at")
    .eq("id", payload.class_instance_id)
    .maybeSingle();

  if (!instance) {
    return jsonResponse(404, { error: "class_instance_not_found" });
  }

  if (!instance.gym_id) {
    return jsonResponse(400, { error: "class_missing_gym" });
  }

  const { data: accessInfo, error: accessError } = await serviceClient.rpc("resolve_member_gym_access", {
    p_member_id: member.id,
    p_gym_id: instance.gym_id,
  });

  if (accessError) {
    return jsonResponse(500, { error: "gym_access_check_failed" });
  }

  if (!accessInfo?.has_access || accessInfo?.status !== "ACTIVE") {
    return jsonResponse(403, { error: "no_gym_access" });
  }

  if (instance.status !== "scheduled") {
    return jsonResponse(400, { error: "class_not_bookable" });
  }

  if (new Date(instance.start_at).getTime() <= Date.now()) {
    return jsonResponse(400, { error: "class_already_started" });
  }

  const { data: existing } = await serviceClient
    .from("class_bookings")
    .select("id")
    .eq("member_id", member.id)
    .eq("class_instance_id", instance.id)
    .maybeSingle();

  if (existing?.id) {
    return jsonResponse(409, { error: "already_booked" });
  }

  const { data: countRows } = await serviceClient
    .from("class_bookings")
    .select("id", { count: "exact" })
    .eq("class_instance_id", instance.id)
    .eq("status", "booked");

  const currentCount = countRows?.length ?? 0;
  if (currentCount >= instance.capacity) {
    console.log("class_full", { class_instance_id: instance.id, member_id: member.id });
    return jsonResponse(409, { error: "class_full" });
  }

  const { data: booking, error: insertError } = await serviceClient
    .from("class_bookings")
    .insert({
      member_id: member.id,
      class_instance_id: instance.id,
      gym_id: instance.gym_id,
      status: "booked",
    })
    .select("id, class_instance_id, status")
    .maybeSingle();

  if (insertError) {
    console.log("booking_insert_failed", { error: insertError.message });
    return jsonResponse(500, { error: "booking_insert_failed" });
  }

  console.log("booking_created", {
    booking_id: booking?.id,
    member_id: member.id,
    class_instance_id: instance.id,
  });

  return jsonResponse(200, {
    booking,
    class_instance: instance,
  });
});
