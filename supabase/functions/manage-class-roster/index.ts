import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type ManageAction = "GET_ROSTER" | "MARK_ATTENDED" | "REMOVE_MEMBER" | "MOVE_FROM_WAITLIST";

type ManageRequest = {
  action?: ManageAction;
  instance_id?: string;
  booking_id?: string;
  waitlist_id?: string;
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
  eventType: "MEMBER_REMOVED" | "ROSTER_EDITED",
  payload: Record<string, unknown>
) {
  await serviceClient.from("class_instance_events").insert({
    instance_id: instanceId,
    actor_user_id: actorUserId,
    event_type: eventType,
    payload,
  });
}

async function enqueueWaitlistPromotion(
  serviceClient: ReturnType<typeof createClient>,
  memberId: string,
  instance: InstanceRow
) {
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

async function loadRoster(serviceClient: ReturnType<typeof createClient>, instance: InstanceRow) {
  const { data: bookings } = await serviceClient
    .from("class_bookings")
    .select(
      "id, member_id, status, attendance_status, attendance_marked_at, members(id, user_id, users(full_name)), booked_at"
    )
    .eq("class_instance_id", instance.id)
    .neq("status", "canceled");

  const memberIds = Array.from(new Set((bookings ?? []).map((booking) => booking.member_id)));

  const { data: subscriptions } = await serviceClient
    .from("member_subscriptions")
    .select("member_id, status, access_state")
    .in("member_id", memberIds);

  const subscriptionMap = new Map<string, { status: string; access_state: string }>();
  subscriptions?.forEach((entry) => subscriptionMap.set(entry.member_id, entry));

  const roster = (bookings ?? []).map((booking) => {
    const member = booking.members as { user_id: string; users: { full_name: string | null } | null } | null;
    const subscription = subscriptionMap.get(booking.member_id);
    const bookingType = subscription?.status === "active" && subscription.access_state !== "inactive" ? "plan" : "drop-in";

    return {
      booking_id: booking.id,
      member_id: booking.member_id,
      member_name: member?.users?.full_name ?? "Member",
      status: booking.status,
      attendance_status: booking.attendance_status,
      attendance_marked_at: booking.attendance_marked_at,
      booking_type: bookingType,
    };
  });

  const { data: waitlist } = await serviceClient
    .from("class_waitlist")
    .select("id, member_id, status, position, members(id, user_id, users(full_name))")
    .eq("class_instance_id", instance.id)
    .eq("status", "waiting")
    .order("position", { ascending: true });

  const waitlisted = (waitlist ?? []).map((entry) => {
    const member = entry.members as { user_id: string; users: { full_name: string | null } | null } | null;
    return {
      waitlist_id: entry.id,
      member_id: entry.member_id,
      member_name: member?.users?.full_name ?? "Member",
      status: entry.status,
      position: entry.position,
    };
  });

  return { roster, waitlisted };
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

  if (payload.action === "GET_ROSTER") {
    const { roster, waitlisted } = await loadRoster(serviceClient, instance as InstanceRow);
    return jsonResponse(200, {
      instance,
      roster,
      waitlist: waitlisted,
    });
  }

  if (payload.action === "MARK_ATTENDED") {
    if (!payload.booking_id) {
      return jsonResponse(400, { error: "booking_id_required" });
    }

    const { data: booking } = await serviceClient
      .from("class_bookings")
      .select("id, class_instance_id, attendance_status")
      .eq("id", payload.booking_id)
      .maybeSingle();

    if (!booking || booking.class_instance_id !== instance.id) {
      return jsonResponse(404, { error: "booking_not_found" });
    }

    const { error: updateError } = await serviceClient
      .from("class_bookings")
      .update({
        attendance_status: "checked_in",
        attendance_marked_at: new Date().toISOString(),
        attendance_marked_by: user.id,
      })
      .eq("id", booking.id);

    if (updateError) {
      console.log("mark_attended_failed", updateError.message);
      return jsonResponse(500, { error: "mark_attended_failed" });
    }

    await insertEvent(serviceClient, instance.id, user.id, "ROSTER_EDITED", {
      action: "MARK_ATTENDED",
      booking_id: booking.id,
      previous_status: booking.attendance_status,
    });

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "REMOVE_MEMBER") {
    if (!payload.booking_id) {
      return jsonResponse(400, { error: "booking_id_required" });
    }

    const { data: booking } = await serviceClient
      .from("class_bookings")
      .select("id, class_instance_id, member_id")
      .eq("id", payload.booking_id)
      .maybeSingle();

    if (!booking || booking.class_instance_id !== instance.id) {
      return jsonResponse(404, { error: "booking_not_found" });
    }

    const { error: removeError } = await serviceClient
      .from("class_bookings")
      .update({
        status: "canceled",
        canceled_at: new Date().toISOString(),
        cancellation_reason: "removed_by_staff",
      })
      .eq("id", booking.id);

    if (removeError) {
      console.log("remove_member_failed", removeError.message);
      return jsonResponse(500, { error: "remove_member_failed" });
    }

    await insertEvent(serviceClient, instance.id, user.id, "MEMBER_REMOVED", {
      action: "REMOVE_MEMBER",
      booking_id: booking.id,
      member_id: booking.member_id,
    });

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "MOVE_FROM_WAITLIST") {
    if (!payload.waitlist_id) {
      return jsonResponse(400, { error: "waitlist_id_required" });
    }

    const { data: bookedRows } = await serviceClient
      .from("class_bookings")
      .select("id", { count: "exact" })
      .eq("class_instance_id", instance.id)
      .eq("status", "booked");

    const bookedCount = bookedRows?.length ?? 0;
    if (bookedCount >= instance.capacity) {
      return jsonResponse(409, { error: "class_full" });
    }

    const { data: waitlistEntry } = await serviceClient
      .from("class_waitlist")
      .select("id, member_id, class_instance_id, status")
      .eq("id", payload.waitlist_id)
      .maybeSingle();

    if (!waitlistEntry || waitlistEntry.class_instance_id !== instance.id) {
      return jsonResponse(404, { error: "waitlist_entry_not_found" });
    }

    if (waitlistEntry.status !== "waiting") {
      return jsonResponse(400, { error: "waitlist_not_active" });
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
      await insertEvent(serviceClient, instance.id, user.id, "ROSTER_EDITED", {
        action: "MOVE_FROM_WAITLIST",
        waitlist_id: waitlistEntry.id,
        existing_booking: true,
      });

      return jsonResponse(200, { promoted: true, existing: true });
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
      console.log("promote_from_waitlist_failed", bookingError.message);
      return jsonResponse(500, { error: "promotion_failed" });
    }

    await serviceClient
      .from("class_waitlist")
      .update({ status: "promoted", promoted_at: new Date().toISOString() })
      .eq("id", waitlistEntry.id);

    await enqueueWaitlistPromotion(serviceClient, waitlistEntry.member_id, instance as InstanceRow);
    await insertEvent(serviceClient, instance.id, user.id, "ROSTER_EDITED", {
      action: "MOVE_FROM_WAITLIST",
      waitlist_id: waitlistEntry.id,
      booking_id: booking?.id,
    });

    return jsonResponse(200, { promoted: true, booking_id: booking?.id });
  }

  return jsonResponse(400, { error: "invalid_action" });
});
