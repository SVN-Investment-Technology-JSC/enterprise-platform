import { ConflictException } from '@nestjs/common';
import { assertNoRequestOverlap } from './hrm-request-overlap';

const row = (kind: string, status = 'PENDING', allow_ot = false) => ({
  kind,
  from_date: '2026-10-01',
  to_date: '2026-10-02',
  status,
  allow_ot,
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
  it('OT với OT: để kiểm tra trùng giờ lo, không chặn theo ngày', async () => {
    await expect(check([row('ot')], { kind: 'ot', ...range })).resolves.toBeUndefined();
  });
  it('allow_ot không còn miễn trừ: OT và công tác chồng ngày luôn bị chặn', async () => {
    await expect(check([row('business_trip', 'APPROVED', true)], { kind: 'ot', ...range })).rejects.toThrow(/công tác/);
    await expect(check([row('ot')], { kind: 'business_trip', ...range })).rejects.toThrow(/làm thêm giờ/);
    await expect(check([row('leave')], { kind: 'business_trip', ...range })).rejects.toThrow(/nghỉ phép/);
  });
});
