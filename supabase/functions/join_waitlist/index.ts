import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type JoinWaitlistRequest = {
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

  let payload: JoinWaitlistRequest;
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

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: instance } = await serviceClient
    .from("class_instances")
    .select("id, gym_id, capacity, status")
    .eq("id", payload.class_instance_id)
    .maybeSingle();

  if (!instance) {
    return jsonResponse(404, { error: "class_instance_not_found" });
  }

  if (instance.gym_id !== member.gym_id) {
    return jsonResponse(403, { error: "gym_mismatch" });
  }

  if (instance.status !== "scheduled") {
    return jsonResponse(400, { error: "class_not_waitlistable" });
  }

  const { data: booking } = await serviceClient
    .from("class_bookings")
    .select("id")
    .eq("member_id", member.id)
    .eq("class_instance_id", instance.id)
    .eq("status", "booked")
    .maybeSingle();

  if (booking?.id) {
    return jsonResponse(409, { error: "already_booked" });
  }

  const { data: existingWaitlist } = await serviceClient
    .from("class_waitlist")
    .select("id, position")
    .eq("member_id", member.id)
    .eq("class_instance_id", instance.id)
    .maybeSingle();

  if (existingWaitlist?.id) {
    return jsonResponse(409, { error: "already_waitlisted" });
  }

  const { data: bookedRows } = await serviceClient
    .from("class_bookings")
    .select("id", { count: "exact" })
    .eq("class_instance_id", instance.id)
    .eq("status", "booked");

  const bookedCount = bookedRows?.length ?? 0;
  if (bookedCount < instance.capacity) {
    return jsonResponse(400, { error: "class_not_full" });
  }

  const { data: maxPos } = await serviceClient
    .from("class_waitlist")
    .select("position")
    .eq("class_instance_id", instance.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxPos?.position ?? 0) + 1;

  const { data: waitlistEntry, error: insertError } = await userClient
    .from("class_waitlist")
    .insert({
      member_id: member.id,
      class_instance_id: instance.id,
      gym_id: member.gym_id,
      position: nextPosition,
      status: "waiting",
    })
    .select("id, position, status")
    .maybeSingle();

  if (insertError) {
    console.log("waitlist_insert_failed", { error: insertError.message });
    return jsonResponse(500, { error: "waitlist_insert_failed" });
  }

  console.log("waitlist_joined", {
    waitlist_id: waitlistEntry?.id,
    member_id: member.id,
    class_instance_id: instance.id,
    position: waitlistEntry?.position,
  });

  return jsonResponse(200, { waitlist: waitlistEntry });
});
