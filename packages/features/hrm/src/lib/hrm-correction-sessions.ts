// ---------------------------------------------------------------------------
// Giải trình công: mỗi đơn chỉ khai báo MỘT mốc giờ, là giờ vào hoặc giờ ra.
// Ngày của mốc giờ luôn là "Ngày phát sinh điều chỉnh" của đơn (không nhập ngày riêng), nên hai ngày không thể lệch nhau.
// ---------------------------------------------------------------------------

export type CorrectionPunchKind = 'IN' | 'OUT';

export interface CorrectionPunchRow {
  /** Rỗng khi người dùng chưa chọn loại. */
  kind: CorrectionPunchKind | '';
  /** 'YYYY-MM-DDTHH:mm' theo giờ máy người dùng. */
  at: string;
}

export const CORRECTION_PUNCH_LABEL: Record<CorrectionPunchKind, string> = {
  IN: 'Giờ vào',
  OUT: 'Giờ ra',
};

/** Giờ gợi ý theo loại: vào 08:00, ra 17:00. */
export const CORRECTION_DEFAULT_TIME: Record<CorrectionPunchKind, string> = {
  IN: '08:00',
  OUT: '17:00',
};

/** Giờ gợi ý khi thêm một mốc: vào 08:00, ra 17:00 của ngày đang giải trình. */
export function suggestPunchRow(date: string, kind: CorrectionPunchKind): CorrectionPunchRow {
  return { kind, at: date ? `${date}T${CORRECTION_DEFAULT_TIME[kind]}` : '' };
}

/** Ghép ngày phát sinh điều chỉnh với giờ đã nhập thành 'YYYY-MM-DDTHH:mm' (rỗng nếu thiếu một trong hai). */
export function correctionPunchAt(date: string, time: string): string {
  return date && time ? `${date}T${time.slice(0, 5)}` : '';
}

/**
 * Kiểm tra mốc giờ và dựng nội dung gửi (ISO). Đúng một mốc: đã chọn loại, đã nhập giờ. Lỗi bằng tiếng Việt.
 */
export function correctionPunchPayload(
  rows: readonly CorrectionPunchRow[],
): { kind: CorrectionPunchKind; at: string }[] {
  if (rows.length !== 1) throw new Error('Mỗi đơn giải trình chỉ khai báo một giờ vào hoặc một giờ ra.');
  const [row] = rows;
  if (row.kind !== 'IN' && row.kind !== 'OUT') throw new Error('Chọn đây là giờ vào hay giờ ra.');
  const date = new Date(row.at);
  if (!row.at || !Number.isFinite(date.getTime()))
    throw new Error(`${CORRECTION_PUNCH_LABEL[row.kind]}: nhập đầy đủ giờ.`);
  return [{ kind: row.kind, at: date.toISOString() }];
}
