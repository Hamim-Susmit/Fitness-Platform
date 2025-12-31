import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type PromoteRequest = {
  class_instance_id?: string;
};

type InstanceRow = {
  id: string;
  gym_id: string;
  capacity: number;
  status: string;
  start_at: string;
  class_schedules: { class_types: { name: string } | null } | null;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function enqueueWaitlistPromotion(serviceClient: ReturnType<typeof createClient>, memberId: string, instance: InstanceRow) {
  const { data: member } = await serviceClient
    .from("members")
    .select("id, user_id")
    .eq("id", memberId)
    .maybeSingle();

  if (!member?.user_id) {
    return;
  }

  const { data: preferences } = await serviceClient
    .from("notification_preferences")
    .select("waitlist_notifications_enabled")
    .eq("user_id", member.user_id)
    .maybeSingle();

  if (preferences?.waitlist_notifications_enabled === false) {
    return;
  }

  await serviceClient.from("notifications").insert({
    user_id: member.user_id,
    type: "WAITLIST_PROMOTED",
    status: "queued",
    payload: {
      class_instance_id: instance.id,
      start_time: instance.start_at,
      class_name: instance.class_schedules?.class_types?.name ?? "Class",
    },
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

  let payload: PromoteRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.class_instance_id) {
    return jsonResponse(400, { error: "class_instance_id_required" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: instance } = await serviceClient
    .from("class_instances")
    .select("id, gym_id, capacity, status, start_at, class_schedules(class_types(name))")
    .eq("id", payload.class_instance_id)
    .maybeSingle();

  if (!instance) {
    return jsonResponse(404, { error: "class_instance_not_found" });
  }

  if (instance.status !== "scheduled") {
    return jsonResponse(400, { error: "class_not_bookable" });
  }

  const { data: bookedRows } = await serviceClient
    .from("class_bookings")
    .select("id", { count: "exact" })
    .eq("class_instance_id", instance.id)
    .eq("status", "booked");

  const bookedCount = bookedRows?.length ?? 0;
  const remaining = instance.capacity - bookedCount;

  if (remaining <= 0) {
    return jsonResponse(200, { promoted: false, remaining: 0 });
  }

  const { data: waitlistEntries } = await serviceClient
    .from("class_waitlist")
    .select("id, member_id, position, joined_at")
    .eq("class_instance_id", instance.id)
    .eq("status", "waiting")
    .order("position", { ascending: true })
    .order("joined_at", { ascending: true })
    .limit(10);

  let waitlistEntry: typeof waitlistEntries[number] | undefined;

  if (!waitlistEntries?.length) {
    return jsonResponse(200, { promoted: false });
  }

  // TODO: add waitlist expiry windows and member confirmation windows
  // TODO: priority tiers / loyalty weighting

  for (const entry of waitlistEntries ?? []) {
    const { data: accessInfo, error: accessError } = await serviceClient.rpc("resolve_member_gym_access", {
      p_member_id: entry.member_id,
      p_gym_id: instance.gym_id,
    });

    if (accessError || !accessInfo?.has_access || accessInfo?.status !== "ACTIVE") {
      await serviceClient
        .from("class_waitlist")
        .update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("id", entry.id);
      continue;
    }

    waitlistEntry = entry;
    break;
  }

  if (!waitlistEntry) {
    return jsonResponse(200, { promoted: false });
  }

  const { data: access } = await serviceClient
    .from("member_subscriptions")
    .select("access_state")
    .eq("member_id", waitlistEntry.member_id)
    .maybeSingle();

  if (access?.access_state === "restricted" || access?.access_state === "inactive") {
    await serviceClient
      .from("class_waitlist")
      .update({ status: "removed", removed_at: new Date().toISOString() })
      .eq("id", waitlistEntry.id);
    return jsonResponse(200, { promoted: false, removed: true });
  }

  const { data: existingBooking } = await serviceClient
    .from("class_bookings")
    .select("id")
    .eq("member_id", waitlistEntry.member_id)
    .eq("class_instance_id", instance.id)
    .maybeSingle();

  if (existingBooking?.id) {
    await serviceClient
      .from("class_waitlist")
      .update({ status: "promoted", promoted_at: new Date().toISOString() })
      .eq("id", waitlistEntry.id);

    await enqueueWaitlistPromotion(serviceClient, waitlistEntry.member_id, instance as InstanceRow);

    return jsonResponse(200, { promoted: true, member_id: waitlistEntry.member_id, existing: true });
  }

  const { data: booking, error: bookingError } = await serviceClient
    .from("class_bookings")
    .insert({
      member_id: waitlistEntry.member_id,
      class_instance_id: instance.id,
      gym_id: instance.gym_id,
      status: "booked",
    })
    .select("id")
    .maybeSingle();

  if (bookingError) {
    console.log("promotion_booking_failed", { error: bookingError.message });
    return jsonResponse(500, { error: "promotion_booking_failed" });
  }

  await serviceClient
    .from("class_waitlist")
    .update({ status: "promoted", promoted_at: new Date().toISOString() })
    .eq("id", waitlistEntry.id);

  await enqueueWaitlistPromotion(serviceClient, waitlistEntry.member_id, instance as InstanceRow);

  console.log("waitlist_promoted", {
    member_id: waitlistEntry.member_id,
    class_instance_id: instance.id,
    waitlist_id: waitlistEntry.id,
  });

  return jsonResponse(200, { promoted: true, member_id: waitlistEntry.member_id, booking_id: booking?.id });
});
