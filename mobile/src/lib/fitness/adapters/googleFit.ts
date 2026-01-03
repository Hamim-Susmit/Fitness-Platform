import type {
  FitnessAdapter,
  FitnessAccountConnection,
  FitnessDailyMetric,
  FitnessSyncRange,
} from "./baseAdapter";

// MVP stub: local Google Fit access would use Google Fit APIs via native modules.
export const googleFitAdapter: FitnessAdapter = {
  provider: "GOOGLE_FIT",
  async connectAccount(memberId: string): Promise<FitnessAccountConnection> {
    return {
      externalUserId: `google-fit:${memberId}`,
      accessToken: "local_google_fit_token_placeholder",
      refreshToken: null,
      tokenExpiresAt: null,
      status: "CONNECTED",
    };
  },
  async refreshTokenIfNeeded(account: FitnessAccountConnection): Promise<FitnessAccountConnection> {
    return account;
  },
  async fetchDailyMetrics(_range: FitnessSyncRange, _account: FitnessAccountConnection): Promise<unknown[]> {
    // TODO: Replace with Google Fit fetch and local aggregation.
    return [];
  },
  async normalizeMetrics(rawData: unknown[], range: FitnessSyncRange): Promise<FitnessDailyMetric[]> {
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
          sourcePayload: { note: "google_fit_stub" },
        },
      ];
    }
    return rawData as FitnessDailyMetric[];
  },
};
