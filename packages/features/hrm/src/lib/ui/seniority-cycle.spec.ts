import { buildSeniorityTiers, detectSeniorityCycle } from './seniority-cycle';

describe('seniority-cycle', () => {
  it('sinh mốc theo một chu kỳ: 5 năm +1, 10 năm +2, 15 năm +3...', () => {
    const tiers = buildSeniorityTiers(5, 1);
    expect(tiers.slice(0, 3)).toEqual([
      { minYears: 5, bonusDays: 1 },
      { minYears: 10, bonusDays: 2 },
      { minYears: 15, bonusDays: 3 },
    ]);
    expect(tiers).toHaveLength(12);
    expect(buildSeniorityTiers(0, 1)).toEqual([]);
  });

  it('nhận diện chu kỳ từ mốc đầu tiên, không phụ thuộc thứ tự', () => {
    expect(detectSeniorityCycle([])).toBeNull();
    expect(detectSeniorityCycle(buildSeniorityTiers(3, 0.5))).toEqual({
      cycleYears: 3,
      cycleDays: 0.5,
    });
    expect(
      detectSeniorityCycle([
        { minYears: 10, bonusDays: 2 },
        { minYears: 5, bonusDays: 1 },
      ]),
    ).toEqual({ cycleYears: 5, cycleDays: 1 });
  });
});
