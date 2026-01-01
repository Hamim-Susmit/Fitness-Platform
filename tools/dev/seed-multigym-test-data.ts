// DEV-ONLY: Do NOT run in production

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

async function createAuthUser(email: string) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true,
  });

  if (error || !data.user) {
    throw error ?? new Error("Unable to create auth user");
  }

  return data.user;
}

async function createAppUser(userId: string, role: "owner" | "staff" | "member", fullName: string) {
  const { error } = await supabase.from("users").insert({
    id: userId,
    role,
    full_name: fullName,
  });

  if (error) {
    throw error;
  }
}

async function run() {
  const ownerAuthUser = await createAuthUser("owner_multigym@example.com");
  await createAppUser(ownerAuthUser.id, "owner", "MultiGym Owner");

  // Create chain and regions
  const { data: chain, error: chainError } = await supabase
    .from("gym_chains")
    .insert({ name: "Atlas Fitness" })
    .select("id")
    .maybeSingle();
  if (chainError || !chain) throw chainError ?? new Error("Failed to create chain");

  const { data: regions } = await supabase
    .from("regions")
    .insert([
      { chain_id: chain.id, name: "North" },
      { chain_id: chain.id, name: "South" },
    ])
    .select("id, name");

  const [northRegion, southRegion] = regions ?? [];

  // Create gyms
  const { data: gyms, error: gymError } = await supabase
    .from("gyms")
    .insert([
      { owner_id: ownerAuthUser.id, name: "Atlas Gym A", chain_id: chain.id, region_id: northRegion?.id ?? null },
      { owner_id: ownerAuthUser.id, name: "Atlas Gym B", chain_id: chain.id, region_id: northRegion?.id ?? null },
      { owner_id: ownerAuthUser.id, name: "Atlas Gym C", chain_id: chain.id, region_id: southRegion?.id ?? null },
    ])
    .select("id, name");

  if (gymError || !gyms) throw gymError ?? new Error("Failed to create gyms");

  const [gymA, gymB, gymC] = gyms;

  // Create membership plans
  const { data: plans, error: planError } = await supabase
    .from("membership_plans")
    .insert([
      {
        gym_id: gymA.id,
        chain_id: chain.id,
        name: "Single Gym",
        description: "Access to one location",
        billing_period: "MONTHLY",
        base_price_cents: 9900,
        currency: "usd",
        access_scope: "SINGLE_GYM",
        is_active: true,
      },
      {
        gym_id: gymA.id,
        chain_id: chain.id,
        name: "Regional",
        description: "Access to regional gyms",
        billing_period: "MONTHLY",
        base_price_cents: 12900,
        currency: "usd",
        access_scope: "REGION",
        is_active: true,
      },
      {
        gym_id: gymA.id,
        chain_id: chain.id,
        name: "All Access",
        description: "Access to all locations",
        billing_period: "MONTHLY",
        base_price_cents: 15900,
        currency: "usd",
        access_scope: "ALL_LOCATIONS",
        is_active: true,
      },
    ])
    .select("id, access_scope");

  if (planError || !plans) throw planError ?? new Error("Failed to create plans");

  const sampleMembers: string[] = [];

  for (let i = 0; i < 60; i += 1) {
    const user = await createAuthUser(`multigym_member_${i}@example.com`);
    await createAppUser(user.id, "member", `Member ${i}`);
    const homeGym = [gymA, gymB, gymC][randomInt(0, 2)];
    const { data: member, error: memberError } = await supabase
      .from("members")
      .insert({
        user_id: user.id,
        gym_id: homeGym.id,
        status: "active",
      })
      .select("id")
      .maybeSingle();

    if (memberError || !member) throw memberError ?? new Error("Failed to create member");
    sampleMembers.push(member.id);

    const plan = plans[randomInt(0, plans.length - 1)];
    await supabase.from("member_subscriptions").insert({
      member_id: member.id,
      plan_id: plan.id,
      home_gym_id: homeGym.id,
      access_scope: plan.access_scope,
      status: "ACTIVE",
      started_at: new Date().toISOString(),
    });

    await supabase.from("member_gym_access").insert({
      member_id: member.id,
      gym_id: homeGym.id,
      access_type: "HOME",
      status: "ACTIVE",
      access_source: "PLAN",
    });

    // Create a handful of cross-gym checkins for diagnostics.
    const crossGym = [gymA.id, gymB.id, gymC.id][randomInt(0, 2)];
    await supabase.from("checkins").insert({
      member_id: member.id,
      gym_id: crossGym,
      checked_in_at: new Date().toISOString(),
      source: "manual",
    });
  }

  // Intentionally inconsistent data for diagnostics.
  await supabase.from("member_gym_access").insert({
    member_id: sampleMembers[0],
    gym_id: "00000000-0000-0000-0000-000000000000",
    access_type: "SECONDARY",
    status: "ACTIVE",
    access_source: "PLAN",
  });

  console.log("Seed complete.");
  console.log("Gyms:", gyms.map((gym) => gym.name).join(", "));
  console.log("Sample member IDs:", sampleMembers.slice(0, 5));
}

run().catch((error) => {
  console.error("Seed failed", error);
  process.exit(1);
});
