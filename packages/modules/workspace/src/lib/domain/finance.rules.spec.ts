import { aggregateFinance, computeFinance, type FinanceInputs } from './finance.rules.js';

/**
 * Tỷ đồng → đồng, làm tròn về số nguyên.
 *
 * Không viết `20.1 * 1e9`: 20,1 không biểu diễn chính xác được trong số
 * thực, và tích có thể lệch vài phần triệu đồng — đủ để `toBe` thất bại dù
 * phép tính đúng.
 */
const ty = (billions: number) => Math.round(billions * 1_000_000_000);

/**
 * Đúng ví dụ ở mục 38 của đặc tả: hợp đồng 25,5 tỷ — thực tế 14,8 — cam kết
 * 3,2 — dự toán còn lại 2,1. Tài liệu kết luận lợi nhuận 5,4 tỷ, biên 21,2%.
 */
const SPEC_EXAMPLE: FinanceInputs = {
  contractValue: ty(25.5),
  budget: ty(22),
  committedCost: ty(3.2),
  forecastCostOverride: null,
  actualCost: ty(14.8),
  remainingEstimate: ty(2.1),
};

describe('computeFinance — ví dụ của đặc tả', () => {
  const result = computeFinance(SPEC_EXAMPLE);

  it('chi phí dự kiến là 20,1 tỷ', () => {
    expect(result.forecastCost).toBe(ty(20.1));
  });

  it('lợi nhuận đúng 5,4 tỷ', () => {
    expect(result.profit).toBe(ty(5.4));
  });

  it('biên lợi nhuận đúng 21,2%', () => {
    // 5,4 / 25,5 = 21,176…% → làm tròn một chữ số.
    expect(result.profitMargin).toBe(21.2);
  });

  it('ngân sách còn dư 1,9 tỷ so với dự kiến', () => {
    expect(result.budgetVariance).toBe(ty(1.9));
  });

  it('không phải số ghi đè tay', () => {
    expect(result.forecastOverridden).toBe(false);
  });
});

describe('computeFinance — các ca biên', () => {
  it('ghi đè tay thắng công thức', () => {
    const result = computeFinance({ ...SPEC_EXAMPLE, forecastCostOverride: ty(24) });
    expect(result.forecastCost).toBe(ty(24));
    expect(result.forecastOverridden).toBe(true);
    expect(result.profit).toBe(ty(1.5));
  });

  it('ghi đè bằng 0 vẫn là ghi đè, không bị coi là "chưa nhập"', () => {
    // `0 ?? x` giữ 0; `0 || x` thì không — đây là chỗ dễ viết sai.
    const result = computeFinance({ ...SPEC_EXAMPLE, forecastCostOverride: 0 });
    expect(result.forecastCost).toBe(0);
    expect(result.forecastOverridden).toBe(true);
  });

  it('chưa nhập hợp đồng thì lợi nhuận và biên đều rỗng, không phải số âm', () => {
    const result = computeFinance({ ...SPEC_EXAMPLE, contractValue: null });
    expect(result.profit).toBeNull();
    expect(result.profitMargin).toBeNull();
  });

  it('hợp đồng bằng 0 thì biên rỗng thay vì chia cho 0', () => {
    const result = computeFinance({ ...SPEC_EXAMPLE, contractValue: 0 });
    expect(result.profitMargin).toBeNull();
    expect(result.profit).toBe(-ty(20.1));
  });

  it('chưa nhập ngân sách thì chênh lệch ngân sách rỗng', () => {
    expect(computeFinance({ ...SPEC_EXAMPLE, budget: null }).budgetVariance).toBeNull();
  });

  it('vượt ngân sách cho chênh lệch âm', () => {
    expect(computeFinance({ ...SPEC_EXAMPLE, budget: ty(18) }).budgetVariance).toBe(
      -ty(2.1),
    );
  });

  it('lỗi dấu phẩy động không lộ ra', () => {
    // 0,1 + 0,2 ≠ 0,3 trong số thực; tiền phải làm tròn về đồng lẻ.
    const result = computeFinance({
      contractValue: null,
      budget: null,
      committedCost: 0.1,
      forecastCostOverride: null,
      actualCost: 0.2,
      remainingEstimate: 0,
    });
    expect(result.forecastCost).toBe(0.3);
  });
});

describe('aggregateFinance', () => {
  it('biên bình quân có trọng số theo hợp đồng, không phải trung bình cộng', () => {
    // Dự án lớn lãi 10%, dự án nhỏ lãi 50%. Trung bình cộng ra 30% — sai.
    // Có trọng số: (5 + 0,05) / (50 + 0,1) = 10,08…% ≈ 10,1%.
    const big = computeFinance({
      contractValue: ty(50),
      budget: null,
      committedCost: 0,
      forecastCostOverride: ty(45),
      actualCost: 0,
      remainingEstimate: 0,
    });
    const small = computeFinance({
      contractValue: ty(0.1),
      budget: null,
      committedCost: 0,
      forecastCostOverride: ty(0.05),
      actualCost: 0,
      remainingEstimate: 0,
    });
    expect(aggregateFinance([big, small]).profitMargin).toBe(10.1);
  });

  it('dự án chưa có hợp đồng vẫn góp chi phí nhưng không góp lợi nhuận', () => {
    const withContract = computeFinance(SPEC_EXAMPLE);
    const withoutContract = computeFinance({ ...SPEC_EXAMPLE, contractValue: null });
    const total = aggregateFinance([withContract, withoutContract]);
    expect(total.contractValue).toBe(ty(25.5));
    expect(total.profit).toBe(ty(5.4));
    expect(total.actualCost).toBe(ty(29.6));
  });

  it('danh mục rỗng cho biên rỗng', () => {
    expect(aggregateFinance([]).profitMargin).toBeNull();
  });
});
