export type FitnessProvider = "APPLE_HEALTH" | "GOOGLE_FIT" | "FITBIT" | "GARMIN" | "STRAVA";

export type FitnessAccountStatus = "CONNECTED" | "DISCONNECTED" | "ERROR";

export type FitnessDailyMetric = {
  metricDate: string;
  steps?: number | null;
  distanceKm?: number | null;
  activeMinutes?: number | null;
  caloriesActive?: number | null;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  sourcePayload?: Record<string, unknown> | null;
};

export type FitnessAccountConnection = {
  externalUserId: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
  status: FitnessAccountStatus;
};

export type FitnessSyncRange = {
  startDate: string;
  endDate: string;
};

export interface FitnessAdapter {
  provider: FitnessProvider;
  connectAccount(memberId: string): Promise<FitnessAccountConnection>;
  refreshTokenIfNeeded(account: FitnessAccountConnection): Promise<FitnessAccountConnection>;
  fetchDailyMetrics(range: FitnessSyncRange, account: FitnessAccountConnection): Promise<unknown[]>;
  normalizeMetrics(rawData: unknown[], range: FitnessSyncRange): Promise<FitnessDailyMetric[]>;
}

// NOTE: Adapters are read-only in this phase. Tokens should be stored server-side and never returned to clients.
