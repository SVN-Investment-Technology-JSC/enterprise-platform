import { UnprocessableEntityException } from '@nestjs/common';
import {
  assertRequestTiming,
  fallbackMayAct,
  loadRequestTimeRule,
  NO_TIME_RULE,
  REQUEST_TOO_LATE,
  REQUEST_TOO_OLD,
  timingViolation,
  type RequestTimeRule,
} from './hrm-request-time-rules.js';

const rule = (over: Partial<RequestTimeRule>): RequestTimeRule => ({ ...NO_TIME_RULE, ...over });
// 10:00 ngày 20/10/2026 theo giờ Việt Nam.
const NOW = new Date('2026-10-20T03:00:00Z');
const range = (from: string, to = from) => ({ from, to });

describe('timingViolation', () => {
  it('chưa dùng quy tắc nào thì không chặn gì', () => {
    expect(timingViolation(NO_TIME_RULE, range('2020-01-01'), NOW)).toBeNull();
    expect(timingViolation(NO_TIME_RULE, range('2030-01-01'), NOW)).toBeNull();
  });

  it('đơn không gắn với ngày nào thì bỏ qua', () => {
    expect(timingViolation(rule({ minNoticeDays: 5, maxBackdateDays: 0 }), null, NOW)).toBeNull();
  });

  it('báo trước tối thiểu: đủ ngày thì qua, thiếu thì REQUEST_TOO_LATE', () => {
    const r = rule({ minNoticeDays: 3 });
    expect(timingViolation(r, range('2026-10-23'), NOW)).toBeNull();
    expect(timingViolation(r, range('2026-10-22'), NOW)?.code).toBe(REQUEST_TOO_LATE);
    expect(timingViolation(r, range('2026-10-22'), NOW)?.message).toContain('ít nhất 3 ngày');
  });

  it('báo trước 0 ngày nghĩa là không tạo cho ngày đã qua', () => {
    const r = rule({ minNoticeDays: 0 });
    expect(timingViolation(r, range('2026-10-20'), NOW)).toBeNull();
    expect(timingViolation(r, range('2026-10-19'), NOW)?.code).toBe(REQUEST_TOO_LATE);
  });

  it('tạo lùi tối đa: trong hạn thì qua, quá hạn thì REQUEST_TOO_OLD', () => {
    const r = rule({ maxBackdateDays: 2 });
    expect(timingViolation(r, range('2026-10-18'), NOW)).toBeNull();
    expect(timingViolation(r, range('2026-10-17'), NOW)?.code).toBe(REQUEST_TOO_OLD);
    expect(timingViolation(r, range('2026-11-01'), NOW)).toBeNull();
  });

  it('tính ngày theo giờ Việt Nam, không theo UTC', () => {
    // 20:00 UTC ngày 19/10 đã là 03:00 ngày 20/10 ở Việt Nam.
    const lateNight = new Date('2026-10-19T20:00:00Z');
    expect(timingViolation(rule({ minNoticeDays: 0 }), range('2026-10-19'), lateNight)?.code).toBe(REQUEST_TOO_LATE);
  });
});

describe('fallbackMayAct', () => {
  const created = '2026-10-10T03:00:00Z';
  it('không đặt thì dự phòng xử lý ngay như trước', () => {
    expect(fallbackMayAct(NO_TIME_RULE, created, NOW)).toBe(true);
    expect(fallbackMayAct(NO_TIME_RULE, null, NOW)).toBe(true);
  });
  it('đặt N ngày thì chỉ xử lý được khi đơn chờ đủ N ngày', () => {
    const r = rule({ escalateAfterDays: 10 });
    expect(fallbackMayAct(r, created, NOW)).toBe(true);
    expect(fallbackMayAct(r, '2026-10-11T03:00:00Z', NOW)).toBe(false);
  });
  it('thiếu hoặc sai ngày tạo thì không mở cho dự phòng', () => {
    const r = rule({ escalateAfterDays: 1 });
    expect(fallbackMayAct(r, null, NOW)).toBe(false);
    expect(fallbackMayAct(r, 'không phải ngày', NOW)).toBe(false);
  });
});

function fakeDb(row: Record<string, unknown> | null, ready = true) {
  return {
    query: async (sql: string) =>
      sql.includes('to_regclass') ? { rows: [{ ok: ready }] } : { rows: row ? [row] : [] },
  } as never;
}

describe('loadRequestTimeRule / assertRequestTiming', () => {
  it('chưa migrate hoặc chưa có dòng thì không có quy tắc', async () => {
    expect(await loadRequestTimeRule(fakeDb(null, false), 't', 'leave')).toEqual(NO_TIME_RULE);
    expect(await loadRequestTimeRule(fakeDb(null), 't', 'leave')).toEqual(NO_TIME_RULE);
  });

  it('đọc đủ ba giá trị', async () => {
    const db = fakeDb({ min_notice_days: 3, max_backdate_days: null, escalate_after_days: 5 });
    expect(await loadRequestTimeRule(db, 't', 'leave')).toEqual({
      minNoticeDays: 3,
      maxBackdateDays: null,
      escalateAfterDays: 5,
    });
  });

  it('đơn nghỉ vi phạm báo trước thì ném 422 kèm mã', async () => {
    const db = fakeDb({ min_notice_days: 365, max_backdate_days: null, escalate_after_days: null });
    const row = { from_date: '2000-01-01', to_date: '2000-01-01' };
    await expect(assertRequestTiming(db, 't', 'leave', row)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(assertRequestTiming(db, 't', 'leave', row)).rejects.toMatchObject({
      response: { code: REQUEST_TOO_LATE },
    });
  });

  it('không có quy tắc thì không ném gì', async () => {
    await expect(
      assertRequestTiming(fakeDb(null), 't', 'leave', { from_date: '2000-01-01', to_date: '2000-01-01' }),
    ).resolves.toBeUndefined();
  });
});
