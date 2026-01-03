export function deriveSetDisplayLabel(setNumber: number, isWarmup = false) {
  if (isWarmup) {
    return `Warm-up ${setNumber}`;
  }
  return `Set ${setNumber}`;
}
