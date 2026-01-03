const DEFAULT_APP_URL = "https://app.yourgym.com";

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function toCode(value: number) {
  return value.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

// Deterministic referral code per member (URL-safe).
export function getOrCreateReferralCode(memberId: string) {
  return toCode(hashString(memberId));
}

export function formatReferralLink(code: string) {
  const baseUrl = process.env.EXPO_PUBLIC_APP_URL ?? DEFAULT_APP_URL;
  return `${baseUrl}/signup?ref=${encodeURIComponent(code)}`;
}
