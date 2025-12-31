export function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function secondsUntil(expiresAt: string | null, nowMs: number) {
  if (!expiresAt) return null;
  const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000));
  return diff;
}
