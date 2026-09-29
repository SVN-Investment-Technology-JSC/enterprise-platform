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
