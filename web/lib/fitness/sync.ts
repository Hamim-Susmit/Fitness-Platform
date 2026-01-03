import { supabaseBrowser } from "../supabase-browser";
import type { FitnessDailyMetric, FitnessProvider, FitnessSyncRange } from "./adapters/baseAdapter";
import { fitbitAdapter } from "./adapters/fitbit";
import { stravaAdapter } from "./adapters/strava";

const adapterRegistry = {
  FITBIT: fitbitAdapter,
  STRAVA: stravaAdapter,
} as const;

const PROVIDERS_WITH_WEB_SUPPORT: FitnessProvider[] = ["FITBIT", "STRAVA"];

export function detectOverlapAndMerge(
  existing: FitnessDailyMetric | null,
  incoming: FitnessDailyMetric
): FitnessDailyMetric {
  if (!existing) return incoming;
  return {
    metricDate: incoming.metricDate,
    steps: incoming.steps ?? existing.steps ?? null,
    distanceKm: incoming.distanceKm ?? existing.distanceKm ?? null,
    activeMinutes: incoming.activeMinutes ?? existing.activeMinutes ?? null,
    caloriesActive: incoming.caloriesActive ?? existing.caloriesActive ?? null,
    avgHeartRate: incoming.avgHeartRate ?? existing.avgHeartRate ?? null,
    maxHeartRate: incoming.maxHeartRate ?? existing.maxHeartRate ?? null,
    sourcePayload: incoming.sourcePayload ?? existing.sourcePayload ?? null,
  };
}

export async function upsertDailyMetrics(
  memberId: string,
  provider: FitnessProvider,
  normalizedRecords: FitnessDailyMetric[]
) {
  if (!normalizedRecords.length) return;

  const metricDates = normalizedRecords.map((record) => record.metricDate);
  const { data: existingRows } = await supabaseBrowser
    .from("fitness_daily_metrics")
    .select("metric_date, steps, distance_km, active_minutes, calories_active, avg_heart_rate, max_heart_rate")
    .eq("member_id", memberId)
    .eq("provider", provider)
    .in("metric_date", metricDates);

  const existingMap = new Map(
    (existingRows ?? []).map((row) => [
      row.metric_date,
      {
        metricDate: row.metric_date,
        steps: row.steps,
        distanceKm: row.distance_km,
        activeMinutes: row.active_minutes,
        caloriesActive: row.calories_active,
        avgHeartRate: row.avg_heart_rate,
        maxHeartRate: row.max_heart_rate,
      } satisfies FitnessDailyMetric,
    ])
  );

  const payload = normalizedRecords.map((record) => {
    const merged = detectOverlapAndMerge(existingMap.get(record.metricDate) ?? null, record);
    return {
      member_id: memberId,
      provider,
      metric_date: merged.metricDate,
      steps: merged.steps,
      distance_km: merged.distanceKm,
      active_minutes: merged.activeMinutes,
      calories_active: merged.caloriesActive,
      avg_heart_rate: merged.avgHeartRate,
      max_heart_rate: merged.maxHeartRate,
      source_payload: merged.sourcePayload ?? {},
    };
  });

  await supabaseBrowser
    .from("fitness_daily_metrics")
    .upsert(payload, { onConflict: "member_id,provider,metric_date" });
}

export async function syncProviderForMember(
  memberId: string,
  provider: FitnessProvider,
  range: FitnessSyncRange
) {
  if (!PROVIDERS_WITH_WEB_SUPPORT.includes(provider)) {
    throw new Error("provider_not_supported_on_web");
  }

  const adapter = adapterRegistry[provider as keyof typeof adapterRegistry];
  const connection = await adapter.connectAccount(memberId);
  const refreshed = await adapter.refreshTokenIfNeeded(connection);
  const rawData = await adapter.fetchDailyMetrics(range, refreshed);
  const normalized = await adapter.normalizeMetrics(rawData, range);

  await upsertDailyMetrics(memberId, provider, normalized);

  return { status: "ok", provider } as const;
}

// Non-functional notes:
// - Integrations are optional; core app must not break without connected providers.
// - Partial data per provider is acceptable and expected.
// - Sync is idempotent; never delete historical records.
// - Avoid high-frequency biometric data in this phase.

// QA checklist:
// - Member connects/disconnects successfully.
// - Daily data imports without duplicates.
// - Missing values handled safely.
// - Trainer access is limited to assigned clients.
// - Sync does not overwrite older valid records.
