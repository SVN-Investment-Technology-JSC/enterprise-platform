export type CorrectionSessionRow = { start: string; end: string };

function localInput(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function correctionDraftRows(
  payload: Record<string, unknown>,
): CorrectionSessionRow[] {
  const sessions = Array.isArray(payload.sessions)
    ? payload.sessions
    : [{ start: payload.newCheckInAt, end: payload.newCheckOutAt }];
  return sessions.map((s) => ({
    start: localInput(s.start),
    end: localInput(s.end),
  }));
}
export function correctionPayload(rows: CorrectionSessionRow[]) {
  if (!rows.length || rows.length > 12)
    throw new Error('Cần từ 1 đến 12 phiên vào–ra.');
  let previousEnd = 0;
  return rows.map((row) => {
    if (!row.start || !row.end)
      throw new Error('Nhập đầy đủ ngày và giờ của từng phiên vào–ra.');
    const start = new Date(row.start),
      end = new Date(row.end);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start ||
      end.getTime() - start.getTime() > 86400000
    )
      throw new Error(
        'Phiên vào–ra phải có giờ kết thúc sau giờ bắt đầu và không quá 24 giờ.',
      );
    if (start.getTime() < previousEnd)
      throw new Error('Các phiên phải theo thứ tự và không chồng lấn.');
    previousEnd = end.getTime();
    return { start: start.toISOString(), end: end.toISOString() };
  });
}

// ---------------------------------------------------------------------------
// Giải trình theo từng mốc giờ: mỗi dòng chọn rõ là giờ vào hoặc giờ ra
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

/** Giờ gợi ý khi thêm một mốc: vào 08:00, ra 17:00 của ngày đang giải trình. */
export function suggestPunchRow(date: string, kind: CorrectionPunchKind): CorrectionPunchRow {
  return { kind, at: date ? `${date}T${kind === 'IN' ? '08:00' : '17:00'}` : '' };
}

/** Loại còn có thể thêm: tối đa một giờ vào và một giờ ra. */
export function nextPunchKind(rows: readonly CorrectionPunchRow[]): CorrectionPunchKind | null {
  if (!rows.some((r) => r.kind === 'IN')) return 'IN';
  if (!rows.some((r) => r.kind === 'OUT')) return 'OUT';
  return null;
}

/** Dòng mốc giờ từ nội dung bản nháp đã lưu; không có thì dùng giờ vào / ra cũ nếu có. */
export function correctionDraftPunches(payload: Record<string, unknown>): CorrectionPunchRow[] {
  if (Array.isArray(payload.punches))
    return payload.punches.map((p: { kind?: string; at?: unknown }) => ({
      kind: p.kind === 'IN' || p.kind === 'OUT' ? p.kind : '',
      at: localInput(p.at).slice(0, 16),
    }));
  return [];
}

/**
 * Kiểm tra các mốc giờ và dựng nội dung gửi (ISO). Lỗi bằng tiếng Việt: chưa chọn loại, chưa nhập giờ, trùng loại,
 * giờ ra không sau giờ vào.
 */
export function correctionPunchPayload(
  rows: readonly CorrectionPunchRow[],
): { kind: CorrectionPunchKind; at: string }[] {
  if (rows.length < 1 || rows.length > 2)
    throw new Error('Cần khai báo giờ vào và/hoặc giờ ra (tối đa một giờ vào và một giờ ra).');
  const out: { kind: CorrectionPunchKind; at: string }[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== 'IN' && row.kind !== 'OUT')
      throw new Error(`Dòng ${index + 1}: chọn đây là giờ vào hay giờ ra.`);
    const date = new Date(row.at);
    if (!row.at || !Number.isFinite(date.getTime()))
      throw new Error(`${CORRECTION_PUNCH_LABEL[row.kind]}: nhập đầy đủ ngày và giờ.`);
    if (out.some((p) => p.kind === row.kind))
      throw new Error(row.kind === 'IN' ? 'Chỉ được khai báo một giờ vào.' : 'Chỉ được khai báo một giờ ra.');
    out.push({ kind: row.kind, at: date.toISOString() });
  });
  const inAt = out.find((p) => p.kind === 'IN');
  const outAt = out.find((p) => p.kind === 'OUT');
  if (inAt && outAt) {
    const span = Date.parse(outAt.at) - Date.parse(inAt.at);
    if (span <= 0) throw new Error('Giờ ra phải sau giờ vào.');
    if (span > 86_400_000) throw new Error('Giờ vào và giờ ra cách nhau tối đa 24 giờ.');
  }
  return out;
}
