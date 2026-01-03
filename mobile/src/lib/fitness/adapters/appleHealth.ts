import type {
  FitnessAdapter,
  FitnessAccountConnection,
  FitnessDailyMetric,
  FitnessSyncRange,
} from "./baseAdapter";

// MVP stub: local Apple Health access would use HealthKit via native modules.
export const appleHealthAdapter: FitnessAdapter = {
  provider: "APPLE_HEALTH",
  async connectAccount(memberId: string): Promise<FitnessAccountConnection> {
    return {
      externalUserId: `apple-health:${memberId}`,
      accessToken: "local_healthkit_token_placeholder",
      refreshToken: null,
      tokenExpiresAt: null,
      status: "CONNECTED",
    };
  },
  async refreshTokenIfNeeded(account: FitnessAccountConnection): Promise<FitnessAccountConnection> {
    return account;
  },
  async fetchDailyMetrics(_range: FitnessSyncRange, _account: FitnessAccountConnection): Promise<unknown[]> {
    // TODO: Replace with HealthKit fetch and local aggregation.
    return [];
  },
  async normalizeMetrics(rawData: unknown[], range: FitnessSyncRange): Promise<FitnessDailyMetric[]> {
    // Apple Health data should already be aggregated locally to daily summaries.
    if (!rawData.length) {
      return [
        {
          metricDate: range.startDate,
          steps: null,
          distanceKm: null,
          activeMinutes: null,
          caloriesActive: null,
          avgHeartRate: null,
          maxHeartRate: null,
          sourcePayload: { note: "apple_health_stub" },
        },
      ];
    }
    return rawData as FitnessDailyMetric[];
  },
};
