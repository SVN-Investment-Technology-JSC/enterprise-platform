/** Tồn của một vật tư trong MỘT kho; cộng gộp nếu kho chia nhiều vị trí. */
export interface StockLevel {
  readonly quantity: number;
  readonly available: number;
}

export interface StockCheckLine {
  readonly materialCode: string;
  readonly quantity: number;
}

export type StockProblem =
  | { readonly kind: 'invalid_quantity'; readonly materialCode: string }
  | { readonly kind: 'missing'; readonly materialCode: string }
  | {
      readonly kind: 'insufficient';
      readonly materialCode: string;
      readonly needed: number;
      readonly available: number;
      readonly onHand: number;
    };

/**
 * Kiểm từng dòng xuất/chuyển với tồn thực của kho phiếu.
 *
 * So với `available` (tồn trừ phần giữ chỗ), không phải `quantity`: server từ chối
 * khi `quantity - quantity_reserved + delta < 0`, nên kiểm theo tồn thực thì form
 * cho qua một phiếu mà server sẽ chặn sau khi người dùng đã bấm xác nhận.
 */
export function checkOutboundLines(
  lines: readonly StockCheckLine[],
  levels: ReadonlyMap<string, StockLevel>,
): Array<StockProblem | undefined> {
  return lines.map((line) => {
    if (!(Number(line.quantity) > 0)) {
      return { kind: 'invalid_quantity', materialCode: line.materialCode };
    }
    const level = levels.get(line.materialCode);
    if (!level || level.quantity <= 0) {
      return { kind: 'missing', materialCode: line.materialCode };
    }
    if (line.quantity > level.available) {
      return {
        kind: 'insufficient',
        materialCode: line.materialCode,
        needed: line.quantity,
        available: level.available,
        onHand: level.quantity,
      };
    }
    return undefined;
  });
}

/** Gộp các dòng tồn của một kho theo mã vật tư. */
export function buildStockLevels(
  rows: ReadonlyArray<{ materialId: string; quantity: number; available: number }>,
  codeByMaterialId: ReadonlyMap<string, string>,
): Map<string, StockLevel> {
  const levels = new Map<string, StockLevel>();
  for (const row of rows) {
    const code = codeByMaterialId.get(row.materialId);
    if (!code) continue;
    const current = levels.get(code);
    levels.set(code, {
      quantity: (current?.quantity ?? 0) + Number(row.quantity),
      available: (current?.available ?? 0) + Number(row.available),
    });
  }
  return levels;
}

/** Câu báo lỗi cho người dùng; `format` là hàm định dạng số của giao diện. */
export function describeStockProblem(
  problem: StockProblem,
  warehouseCode: string,
  format: (value: number) => string,
): string {
  switch (problem.kind) {
    case 'invalid_quantity':
      return `Vật tư ${problem.materialCode} chưa nhập số lượng lớn hơn 0.`;
    case 'missing':
      return `Vật tư ${problem.materialCode} không có tồn tại kho ${warehouseCode}.`;
    case 'insufficient': {
      const reserved = problem.onHand - problem.available;
      const reservedNote = reserved > 0 ? ` (đang giữ chỗ ${format(reserved)})` : '';
      return `Vật tư ${problem.materialCode} chỉ còn ${format(problem.available)} khả dụng tại kho ${warehouseCode}${reservedNote}, phiếu cần ${format(problem.needed)}.`;
    }
  }
}
