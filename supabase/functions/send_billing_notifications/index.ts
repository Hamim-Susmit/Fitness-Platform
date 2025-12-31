import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type NotificationPayload = {
  event: "billing.payment_failed" | "billing.grace_period_expiring" | "billing.payment_recovered";
  member_id: string;
  grace_period_until?: string | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
const BILLING_PORTAL_URL = Deno.env.get("BILLING_PORTAL_URL") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
  throw new Error("Missing Resend configuration");
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Resend error: ${errorText}`);
  }
}

function buildEmailContent(payload: NotificationPayload, planName: string | null) {
  switch (payload.event) {
    case "billing.payment_failed":
      return {
        subject: "Payment Failed — Please Update Your Billing Details",
        html: `
          <p>We couldn't process your latest payment.</p>
          <p>Plan: ${planName ?? "Membership"}</p>
          <p>Please update your billing details to avoid any interruption.</p>
          ${BILLING_PORTAL_URL ? `<p><a href="${BILLING_PORTAL_URL}">Update billing details</a></p>` : ""}
        `,
      };
    case "billing.grace_period_expiring":
      return {
        subject: "Your Access May Be Restricted Soon",
        html: `
          <p>Your payment is still pending and your grace period will end soon.</p>
          <p>Plan: ${planName ?? "Membership"}</p>
          ${payload.grace_period_until ? `<p>Grace period ends: ${new Date(payload.grace_period_until).toLocaleDateString()}</p>` : ""}
          ${BILLING_PORTAL_URL ? `<p><a href="${BILLING_PORTAL_URL}">Update billing details</a></p>` : ""}
        `,
      };
    case "billing.payment_recovered":
      return {
        subject: "Thanks — Your Membership is Active Again",
        html: `
          <p>Your payment was successful and your membership is active again.</p>
          <p>Plan: ${planName ?? "Membership"}</p>
        `,
      };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  let payload: NotificationPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.event || !payload.member_id) {
    return jsonResponse(400, { error: "invalid_payload" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: member, error: memberError } = await serviceClient
    .from("members")
    .select("id, user_id")
    .eq("id", payload.member_id)
    .maybeSingle();

  if (memberError || !member) {
    return jsonResponse(404, { error: "member_not_found" });
  }

  const { data: user, error: userError } = await serviceClient.auth.admin.getUserById(member.user_id);

  if (userError || !user?.user?.email) {
    return jsonResponse(404, { error: "email_not_found" });
  }

  const { data: subscription } = await serviceClient
    .from("subscriptions")
    .select("pricing_plan_id")
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let planName: string | null = null;
  if (subscription?.pricing_plan_id) {
    const { data: plan } = await serviceClient
      .from("pricing_plans")
      .select("name")
      .eq("id", subscription.pricing_plan_id)
      .maybeSingle();
    planName = plan?.name ?? null;
  }

  const content = buildEmailContent(payload, planName);
  if (!content) {
    return jsonResponse(400, { error: "unsupported_event" });
  }

  await sendEmail(user.user.email, content.subject, content.html);

  return jsonResponse(200, { sent: true });
});
