const MAX_SENIORITY_YEARS = 60;

/**
 * Phép thâm niên theo MỘT chu kỳ duy nhất: mỗi N năm cộng thêm X ngày (cộng dồn).
 * VD N=5, X=1: 5 năm +1, 10 năm +2, 15 năm +3... Sinh ra các mốc để dùng với chính sách hiện có.
 */
export function buildSeniorityTiers(cycleYears: number, cycleDays: number) {
  const tiers: { minYears: number; bonusDays: number }[] = [];
  if (!(cycleYears > 0)) return tiers;
  for (let k = 1; k * cycleYears <= MAX_SENIORITY_YEARS; k++)
    tiers.push({ minYears: k * cycleYears, bonusDays: k * cycleDays });
  return tiers;
}

/** Nhận diện mốc thâm niên theo chu kỳ (mốc đầu = chu kỳ, các mốc sau là bội số). */
export function detectSeniorityCycle(
  tiers: readonly { minYears: number; bonusDays: number }[],
): { cycleYears: number; cycleDays: number } | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.minYears - b.minYears);
  return { cycleYears: sorted[0].minYears, cycleDays: sorted[0].bonusDays };
}
