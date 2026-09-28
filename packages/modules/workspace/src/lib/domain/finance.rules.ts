/**
 * Quy tắc tài chính dự án, theo mục 20, 21 và 38 của đặc tả.
 *
 * Đơn vị VND. Cột trong CSDL là `numeric(18,2)`; khi về tới đây chúng là
 * `number`, chính xác tới đồng lẻ cho mọi giá trị dưới ~90 nghìn tỷ đồng
 * (`2^53 / 100`). Hợp đồng lớn nhất trong đặc tả cỡ vài chục tỷ, còn cách xa
 * ngưỡng đó ba bậc độ lớn.
 *
 * Các giá trị dẫn xuất KHÔNG được lưu: lưu số tổng vào `projects` là tạo ra
 * nguồn sự thật thứ hai, phải đồng bộ bằng trigger mỗi khi một công việc đổi
 * chi phí.
 */

/** Số liệu thô đọc từ CSDL cho một dự án. */
export interface FinanceInputs {
  readonly contractValue: number | null;
  readonly budget: number | null;
  readonly committedCost: number;
  readonly forecastCostOverride: number | null;
  /** `SUM(actual_cost)` trên MỌI công việc của dự án, kể cả đã đóng. */
  readonly actualCost: number;
  /** `SUM(estimated_cost)` trên các công việc CHƯA đóng. */
  readonly remainingEstimate: number;
}

export interface FinanceFigures {
  readonly contractValue: number | null;
  readonly budget: number | null;
  readonly committedCost: number;
  readonly actualCost: number;
  readonly remainingEstimate: number;
  readonly forecastCost: number;
  /** Có ghi đè tay hay không; giao diện cần nói rõ con số không phải từ công thức. */
  readonly forecastOverridden: boolean;
  /** Rỗng khi chưa nhập giá trị hợp đồng — không có gì để trừ. */
  readonly profit: number | null;
  /** Phần trăm, làm tròn 1 chữ số. Rỗng khi hợp đồng rỗng hoặc bằng 0. */
  readonly profitMargin: number | null;
  /** Ngân sách còn lại so với dự kiến; âm nghĩa là sẽ vượt ngân sách. */
  readonly budgetVariance: number | null;
}

/** Làm tròn tới đồng lẻ, để lỗi dấu phẩy động không lộ ra thành `5.399999`. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Tính các chỉ số dẫn xuất.
 *
 * `forecastCost` = ghi đè tay nếu có, ngược lại
 * `actualCost + committedCost + remainingEstimate`.
 *
 * Chỉ cộng dự toán của việc **chưa đóng**: việc đã đóng thì chi phí thật đã
 * nằm trong `actualCost`, cộng thêm dự toán của nó là tính hai lần.
 */
export function computeFinance(input: FinanceInputs): FinanceFigures {
  const forecastOverridden = input.forecastCostOverride != null;
  const forecastCost = money(
    forecastOverridden
      ? (input.forecastCostOverride as number)
      : input.actualCost + input.committedCost + input.remainingEstimate,
  );

  const profit = input.contractValue == null ? null : money(input.contractValue - forecastCost);
  const profitMargin =
    profit == null || !input.contractValue
      ? null
      : Math.round((profit / input.contractValue) * 1000) / 10;

  return {
    contractValue: input.contractValue,
    budget: input.budget,
    committedCost: money(input.committedCost),
    actualCost: money(input.actualCost),
    remainingEstimate: money(input.remainingEstimate),
    forecastCost,
    forecastOverridden,
    profit,
    profitMargin,
    budgetVariance: input.budget == null ? null : money(input.budget - forecastCost),
  };
}

/**
 * Cộng dồn nhiều dự án cho khối tổng hợp ở trang Báo cáo.
 *
 * Biên lợi nhuận bình quân tính **có trọng số theo giá trị hợp đồng** —
 * tổng lợi nhuận chia tổng hợp đồng — chứ không lấy trung bình cộng các tỉ
 * lệ. Trung bình cộng để một dự án 100 triệu lãi 50% kéo lệch cả danh mục
 * 50 tỷ đang lãi 5%.
 *
 * Dự án chưa nhập hợp đồng không góp vào tổng hợp đồng và tổng lợi nhuận,
 * nhưng vẫn góp chi phí: chi phí là thật dù hợp đồng chưa ký.
 */
export function aggregateFinance(figures: readonly FinanceFigures[]): {
  readonly projectCount: number;
  readonly contractValue: number;
  readonly budget: number;
  readonly actualCost: number;
  readonly forecastCost: number;
  readonly profit: number;
  readonly profitMargin: number | null;
} {
  let contractValue = 0;
  let budget = 0;
  let actualCost = 0;
  let forecastCost = 0;
  let profit = 0;

  for (const entry of figures) {
    actualCost += entry.actualCost;
    forecastCost += entry.forecastCost;
    if (entry.budget != null) budget += entry.budget;
    if (entry.contractValue != null && entry.profit != null) {
      contractValue += entry.contractValue;
      profit += entry.profit;
    }
  }

  return {
    projectCount: figures.length,
    contractValue: money(contractValue),
    budget: money(budget),
    actualCost: money(actualCost),
    forecastCost: money(forecastCost),
    profit: money(profit),
    profitMargin: contractValue ? Math.round((profit / contractValue) * 1000) / 10 : null,
  };
}
