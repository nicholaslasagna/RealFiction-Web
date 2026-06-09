/**
 * Seasonal site treatments.
 *
 * The US Independence Day window runs July 1–7 so the fireworks + greeting cover
 * the whole holiday weekend regardless of which weekday the 4th lands on. Kept as
 * a pure function so it's trivial to test and reuse.
 */
export function isIndependenceDayWindow(now: Date = new Date()): boolean {
  // getMonth() is 0-based, so July === 6.
  return now.getMonth() === 6 && now.getDate() >= 1 && now.getDate() <= 7
}
