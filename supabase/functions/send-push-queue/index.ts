import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type NotificationRow = {
  id: string;
  user_id: string;
  type: "CLASS_REMINDER" | "BOOKING_CONFIRMED" | "BOOKING_CANCELLED" | "WAITLIST_PROMOTED";
  payload: Record<string, unknown>;
};

type PushTokenRow = {
  user_id: string;
  token: string;
  platform: "ios" | "android" | "web";
};

// TODO: Add SMS reminders.
// TODO: Add email confirmations.
// TODO: Add smart reminder timing based on user behavior.
// TODO: Add quiet hours settings.
// TODO: Add digest mode for batch notifications.
// TODO: Add per-class reminder overrides.

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getMessageContent(notification: NotificationRow) {
  const payload = notification.payload ?? {};
  switch (notification.type) {
    case "CLASS_REMINDER": {
      const className = String(payload.class_name ?? "Class");
      const startTime = String(payload.start_time ?? "");
      const reminderMinutes = String(payload.reminder_minutes ?? "");
      return {
        title: `${className} starts soon`,
        body: reminderMinutes ? `Starts in ${reminderMinutes} minutes • ${startTime}` : `Starts at ${startTime}`,
      };
    }
    case "BOOKING_CONFIRMED": {
      return {
        title: "Booking confirmed",
        body: String(payload.class_name ?? "Your class is booked."),
      };
    }
    case "BOOKING_CANCELLED": {
      return {
        title: "Booking cancelled",
        body: String(payload.class_name ?? "Your class was cancelled."),
      };
    }
    case "WAITLIST_PROMOTED": {
      return {
        title: "Waitlist promoted",
        body: String(payload.class_name ?? "A spot opened up. You are booked!"),
      };
    }
    default:
      return { title: "Gym update", body: "Open the app for details." };
  }
}

async function sendExpo(messages: Array<Record<string, unknown>>) {
  if (!messages.length) {
    return [];
  }

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "expo_push_failed");
  }

  const result = await response.json();
  return result.data ?? [];
}

Deno.serve(async () => {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: queued } = await serviceClient
    .from("notifications")
    .select("id, user_id, type, payload")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(50);

  if (!queued?.length) {
    return jsonResponse(200, { sent: 0 });
  }

  const userIds = Array.from(new Set(queued.map((row) => row.user_id)));
  const { data: tokens } = await serviceClient
    .from("push_tokens")
    .select("user_id, token, platform")
    .in("user_id", userIds);

  const tokenMap = new Map<string, PushTokenRow[]>();
  tokens?.forEach((token) => {
    const existing = tokenMap.get(token.user_id) ?? [];
    existing.push(token as PushTokenRow);
    tokenMap.set(token.user_id, existing);
  });

  let sentCount = 0;

  for (const notification of queued as NotificationRow[]) {
    const userTokens = tokenMap.get(notification.user_id) ?? [];

    if (!userTokens.length) {
      await serviceClient
        .from("notifications")
        .update({ status: "failed" })
        .eq("id", notification.id);
      continue;
    }

    const messageContent = getMessageContent(notification);
    const payload = { ...notification.payload, notification_type: notification.type };

    const messages = userTokens.map((token) => ({
      to: token.token,
      title: messageContent.title,
      body: messageContent.body,
      data: payload,
      sound: "default",
    }));

    try {
      const result = await sendExpo(messages);
      const hasError = result.some((entry: { status: string }) => entry.status !== "ok");

      if (hasError) {
        await serviceClient
          .from("notifications")
          .update({ status: "failed" })
          .eq("id", notification.id);
        continue;
      }

      await serviceClient
        .from("notifications")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", notification.id);

      sentCount += 1;
    } catch (error) {
      console.log("push_send_error", { notification_id: notification.id, error: error instanceof Error ? error.message : error });
      await serviceClient
        .from("notifications")
        .update({ status: "failed" })
        .eq("id", notification.id);
    }
  }

  return jsonResponse(200, { sent: sentCount });
});
