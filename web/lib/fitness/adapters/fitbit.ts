import type {
  FitnessAdapter,
  FitnessAccountConnection,
  FitnessDailyMetric,
  FitnessSyncRange,
} from "./baseAdapter";

// MVP stub: Fitbit OAuth + daily summary endpoints.
export const fitbitAdapter: FitnessAdapter = {
  provider: "FITBIT",
  async connectAccount(memberId: string): Promise<FitnessAccountConnection> {
    return {
      externalUserId: `fitbit:${memberId}`,
      accessToken: "fitbit_token_placeholder",
      refreshToken: "fitbit_refresh_placeholder",
      tokenExpiresAt: null,
      status: "CONNECTED",
    };
  },
  async refreshTokenIfNeeded(account: FitnessAccountConnection): Promise<FitnessAccountConnection> {
    return account;
  },
  async fetchDailyMetrics(_range: FitnessSyncRange, _account: FitnessAccountConnection): Promise<unknown[]> {
    // TODO: Fetch daily activity summaries from Fitbit API.
    return [];
  },
  async normalizeMetrics(rawData: unknown[], _range: FitnessSyncRange): Promise<FitnessDailyMetric[]> {
    return rawData as FitnessDailyMetric[];
  },
};
