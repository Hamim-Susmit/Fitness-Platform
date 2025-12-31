import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type ManageAction = "UPDATE_CAPACITY" | "CANCEL_CLASS" | "RESCHEDULE";

type ManageRequest = {
  action?: ManageAction;
  instance_id?: string;
  new_capacity?: number;
  reason?: string;
  start_time?: string;
  end_time?: string;
};

type ActorContext = {
  userId: string;
  gymId: string;
  instructorId: string | null;
};

type InstanceRow = {
  id: string;
  gym_id: string;
  capacity: number;
  status: string;
  start_at: string;
  end_at: string;
  class_schedules: { id: string; instructor_id: string | null; class_types: { name: string } | null } | null;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveActor(serviceClient: ReturnType<typeof createClient>, userId: string) {
  const { data: staff } = await serviceClient
    .from("staff")
    .select("gym_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (staff?.gym_id) {
    return { userId, gymId: staff.gym_id, instructorId: null } as ActorContext;
  }

  const { data: instructor } = await serviceClient
    .from("instructors")
    .select("id, gym_id")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (instructor?.gym_id) {
    return { userId, gymId: instructor.gym_id, instructorId: instructor.id } as ActorContext;
  }

  return null;
}

async function insertEvent(
  serviceClient: ReturnType<typeof createClient>,
  instanceId: string,
  actorUserId: string,
  eventType: "CAPACITY_CHANGED" | "CLASS_CANCELLED" | "CLASS_RESCHEDULED",
  payload: Record<string, unknown>
) {
  await serviceClient.from("class_instance_events").insert({
    instance_id: instanceId,
    actor_user_id: actorUserId,
    event_type: eventType,
    payload,
  });
}

async function enqueueNotification(
  serviceClient: ReturnType<typeof createClient>,
  memberId: string,
  instance: InstanceRow,
  type: "BOOKING_CANCELLED" | "BOOKING_CONFIRMED",
  payload: Record<string, unknown>
) {
  const { data: member } = await serviceClient
    .from("members")
    .select("id, user_id")
    .eq("id", memberId)
    .maybeSingle();

  if (!member?.user_id) {
    return;
  }

  await serviceClient.from("notifications").insert({
    user_id: member.user_id,
    type,
    status: "queued",
    payload: {
      class_instance_id: instance.id,
      class_name: instance.class_schedules?.class_types?.name ?? "Class",
      ...payload,
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

  let payload: ManageRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.action || !payload.instance_id) {
    return jsonResponse(400, { error: "missing_action_or_instance" });
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

  const actor = await resolveActor(serviceClient, user.id);
  if (!actor) {
    return jsonResponse(403, { error: "actor_not_authorized" });
  }

  const { data: instance } = await serviceClient
    .from("class_instances")
    .select("id, gym_id, capacity, status, start_at, end_at, class_schedules(id, instructor_id, class_types(name))")
    .eq("id", payload.instance_id)
    .maybeSingle();

  if (!instance) {
    return jsonResponse(404, { error: "class_instance_not_found" });
  }

  const scheduleInstructorId = (instance as InstanceRow).class_schedules?.instructor_id;
  const isStaff = actor.instructorId === null && actor.gymId === instance.gym_id;
  const isInstructor = actor.instructorId !== null && actor.instructorId === scheduleInstructorId;

  if (!isStaff && !isInstructor) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  const now = Date.now();
  const instanceEnd = new Date(instance.end_at).getTime();
  if (instanceEnd < now) {
    return jsonResponse(400, { error: "class_in_past" });
  }

  if (payload.action === "UPDATE_CAPACITY") {
    const newCapacity = payload.new_capacity;
    if (!newCapacity || newCapacity <= 0) {
      return jsonResponse(400, { error: "invalid_capacity" });
    }

    const { data: bookedRows } = await serviceClient
      .from("class_bookings")
      .select("id", { count: "exact" })
      .eq("class_instance_id", instance.id)
      .eq("status", "booked");

    const bookedCount = bookedRows?.length ?? 0;
    if (newCapacity < bookedCount) {
      return jsonResponse(409, { error: "capacity_below_enrolled" });
    }

    const { error: updateError } = await serviceClient
      .from("class_instances")
      .update({ capacity: newCapacity })
      .eq("id", instance.id);

    if (updateError) {
      console.log("capacity_update_failed", updateError.message);
      return jsonResponse(500, { error: "capacity_update_failed" });
    }

    await insertEvent(serviceClient, instance.id, user.id, "CAPACITY_CHANGED", {
      previous_capacity: instance.capacity,
      new_capacity: newCapacity,
    });

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "CANCEL_CLASS") {
    if (instance.status === "canceled") {
      return jsonResponse(200, { status: "ok" });
    }

    const { error: cancelError } = await serviceClient
      .from("class_instances")
      .update({ status: "canceled" })
      .eq("id", instance.id);

    if (cancelError) {
      console.log("cancel_class_failed", cancelError.message);
      return jsonResponse(500, { error: "cancel_class_failed" });
    }

    await serviceClient
      .from("class_bookings")
      .update({
        status: "canceled",
        canceled_at: new Date().toISOString(),
        cancellation_reason: payload.reason ?? "class_canceled",
      })
      .eq("class_instance_id", instance.id)
      .eq("status", "booked");

    // TODO: auto-refund drop-in bookings when class is canceled.

    await insertEvent(serviceClient, instance.id, user.id, "CLASS_CANCELLED", {
      reason: payload.reason ?? null,
    });

    const { data: bookings } = await serviceClient
      .from("class_bookings")
      .select("member_id")
      .eq("class_instance_id", instance.id)
      .eq("status", "canceled");

    for (const booking of bookings ?? []) {
      await enqueueNotification(serviceClient, booking.member_id, instance as InstanceRow, "BOOKING_CANCELLED", {
        start_time: instance.start_at,
        reason: payload.reason ?? null,
      });
    }

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "RESCHEDULE") {
    if (!payload.start_time || !payload.end_time) {
      return jsonResponse(400, { error: "missing_times" });
    }

    const startTime = new Date(payload.start_time);
    const endTime = new Date(payload.end_time);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      return jsonResponse(400, { error: "invalid_times" });
    }

    if (endTime <= startTime) {
      return jsonResponse(400, { error: "invalid_time_range" });
    }

    if (startTime.getTime() < Date.now()) {
      return jsonResponse(400, { error: "reschedule_in_past" });
    }

    const { error: rescheduleError } = await serviceClient
      .from("class_instances")
      .update({
        start_at: startTime.toISOString(),
        end_at: endTime.toISOString(),
        class_date: startTime.toISOString().slice(0, 10),
      })
      .eq("id", instance.id);

    if (rescheduleError) {
      console.log("reschedule_failed", rescheduleError.message);
      return jsonResponse(500, { error: "reschedule_failed" });
    }

    await insertEvent(serviceClient, instance.id, user.id, "CLASS_RESCHEDULED", {
      previous_start_time: instance.start_at,
      previous_end_time: instance.end_at,
      new_start_time: startTime.toISOString(),
      new_end_time: endTime.toISOString(),
    });

    // TODO: re-validate member conflicts and update bookings accordingly.

    const { data: bookings } = await serviceClient
      .from("class_bookings")
      .select("member_id")
      .eq("class_instance_id", instance.id)
      .eq("status", "booked");

    for (const booking of bookings ?? []) {
      await enqueueNotification(serviceClient, booking.member_id, instance as InstanceRow, "BOOKING_CONFIRMED", {
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        rescheduled: true,
      });
    }

    return jsonResponse(200, { status: "ok" });
  }

  return jsonResponse(400, { error: "invalid_action" });
});
