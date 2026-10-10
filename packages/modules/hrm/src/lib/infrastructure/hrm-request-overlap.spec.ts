import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertNoRequestOverlap, requestTimeWindow } from './hrm-request-overlap';

/** Dòng do truy vấn trả về: các đơn đã bị lọc theo giờ chồng nhau ở phía SQL. */
const row = (kind: string, status = 'PENDING', allow_ot = false) => ({
  kind,
  status,
  has_times: false,
  allow_ot,
  s: '2026-10-01T00:00',
  e: '2026-10-03T00:00', // đơn cả ngày được lưu đến 00:00 ngày kế
});
const timed = (kind: string, s: string, e: string, status = 'PENDING') => ({
  kind,
  status,
  has_times: true,
  allow_ot: false,
  s,
  e,
});
const dbWith = (rows: unknown[]) => ({ query: jest.fn().mockResolvedValue({ rows }) });
const check = (
  rows: unknown[],
  input: Parameters<typeof assertNoRequestOverlap>[3],
) => assertNoRequestOverlap(dbWith(rows) as never, 't', 'e', input);
const range = { fromDate: '2026-10-01', toDate: '2026-10-01' };

describe('assertNoRequestOverlap', () => {
  it('không có đơn chồng: cho qua', async () => {
    await expect(check([], { kind: 'leave', ...range })).resolves.toBeUndefined();
  });
  it.each([
    ['leave', 'leave'],
    ['leave', 'business_trip'],
    ['leave', 'ot'],
    ['business_trip', 'leave'],
    ['business_trip', 'business_trip'],
    ['business_trip', 'ot'],
    ['ot', 'leave'],
    ['ot', 'business_trip'],
  ] as const)('tạo %s khi đã có %s chờ duyệt: chặn kèm khoảng ngày', async (created, existing) => {
    await expect(check([row(existing)], { kind: created, ...range })).rejects.toThrow(
      /đang chờ duyệt \(01\/10\/2026 - 02\/10\/2026\)/,
    );
    await expect(check([row(existing, 'APPROVED')], { kind: created, ...range })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('OT với OT: để kiểm tra trùng giờ lo, không chặn', async () => {
    await expect(check([row('ot')], { kind: 'ot', ...range })).resolves.toBeUndefined();
  });
  it('allow_ot không còn miễn trừ: OT và công tác chồng giờ luôn bị chặn', async () => {
    await expect(check([row('business_trip', 'APPROVED', true)], { kind: 'ot', ...range })).rejects.toThrow(/công tác/);
    await expect(check([row('ot')], { kind: 'business_trip', ...range })).rejects.toThrow(/làm thêm giờ/);
    await expect(check([row('leave')], { kind: 'business_trip', ...range })).rejects.toThrow(/nghỉ phép/);
  });
  it('báo kèm giờ khi đơn trùng có giờ cụ thể trong cùng ngày', async () => {
    await expect(
      check([timed('leave', '2026-10-01T07:30', '2026-10-01T11:30')], { kind: 'ot', ...range, startTime: '09:00', endTime: '10:00' }),
    ).rejects.toThrow(/\(01\/10\/2026 07:30 - 11:30\) trùng thời gian/);
  });
  it('đơn nhiều ngày có giờ: báo ngày và giờ hai đầu', async () => {
    await expect(
      check([timed('business_trip', '2026-10-01T08:00', '2026-10-03T17:00')], { kind: 'leave', ...range }),
    ).rejects.toThrow(/\(01\/10\/2026 08:00 - 03\/10\/2026 17:00\)/);
  });
  it('truyền giờ bắt đầu / kết thúc xuống truy vấn; không truyền thì xét cả ngày', async () => {
    const db = dbWith([]);
    await assertNoRequestOverlap(db as never, 't', 'e', { kind: 'ot', fromDate: '2026-10-01', toDate: '2026-10-01', startTime: '18:00', endTime: '20:00' });
    expect(db.query.mock.calls[0][1]).toEqual(['t', 'e', '2026-10-01', '2026-10-01', '18:00', '20:00']);
    await assertNoRequestOverlap(db as never, 't', 'e', { kind: 'leave', ...range });
    expect(db.query.mock.calls[1][1]).toEqual(['t', 'e', '2026-10-01', '2026-10-01', null, null]);
  });
});

describe('requestTimeWindow', () => {
  const base = { fromDate: '2026-10-01', toDate: '2026-10-01' };
  it('bỏ trống: cả ngày', () => {
    expect(requestTimeWindow(base)).toEqual({ startTime: null, endTime: null });
    expect(requestTimeWindow({ ...base, startTime: '', endTime: null })).toEqual({ startTime: null, endTime: null });
  });
  it('chuẩn hoá HH:mm:ss về HH:mm', () => {
    expect(requestTimeWindow({ ...base, startTime: '07:30:00', endTime: '11:30' })).toEqual({ startTime: '07:30', endTime: '11:30' });
  });
  it('định dạng sai: 400', () => {
    expect(() => requestTimeWindow({ ...base, startTime: '7h30' })).toThrow(BadRequestException);
    expect(() => requestTimeWindow({ ...base, endTime: '25:00' })).toThrow(/Giờ kết thúc/);
  });
  it('một ngày mà giờ kết thúc không sau giờ bắt đầu: 400; nhiều ngày thì được', () => {
    expect(() => requestTimeWindow({ ...base, startTime: '11:00', endTime: '11:00' })).toThrow(/sau giờ bắt đầu/);
    expect(requestTimeWindow({ fromDate: '2026-10-01', toDate: '2026-10-02', startTime: '17:00', endTime: '09:00' })).toEqual({
      startTime: '17:00',
      endTime: '09:00',
    });
  });
});
