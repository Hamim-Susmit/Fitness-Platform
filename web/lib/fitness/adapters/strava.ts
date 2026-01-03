import type {
  FitnessAdapter,
  FitnessAccountConnection,
  FitnessDailyMetric,
  FitnessSyncRange,
} from "./baseAdapter";

// MVP stub: Strava OAuth + daily activity summary endpoints.
export const stravaAdapter: FitnessAdapter = {
  provider: "STRAVA",
  async connectAccount(memberId: string): Promise<FitnessAccountConnection> {
    return {
      externalUserId: `strava:${memberId}`,
      accessToken: "strava_token_placeholder",
      refreshToken: "strava_refresh_placeholder",
      tokenExpiresAt: null,
      status: "CONNECTED",
    };
  },
  async refreshTokenIfNeeded(account: FitnessAccountConnection): Promise<FitnessAccountConnection> {
    return account;
  },
  async fetchDailyMetrics(_range: FitnessSyncRange, _account: FitnessAccountConnection): Promise<unknown[]> {
    // TODO: Fetch daily activity summaries from Strava API.
    return [];
  },
  async normalizeMetrics(rawData: unknown[], _range: FitnessSyncRange): Promise<FitnessDailyMetric[]> {
    return rawData as FitnessDailyMetric[];
  },
};
