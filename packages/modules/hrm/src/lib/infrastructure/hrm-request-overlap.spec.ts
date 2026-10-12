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

  describe('đơn có giờ cụ thể (từ ngày giờ đến ngày giờ)', () => {
    const timed = (kind: string, from: string, to: string, status = 'PENDING') => ({
      kind,
      from_date: '2026-10-12',
      to_date: '2026-10-12',
      status,
      allow_ot: false,
      from_at: from,
      to_at: to,
    });
    const at = (hm: string) => new Date(`2026-10-12T${hm}:00+07:00`).toISOString();
    const input = (kind: 'leave' | 'business_trip' | 'ot', from: string, to: string) => ({
      kind,
      fromDate: '2026-10-12',
      toDate: '2026-10-12',
      fromAt: at(from),
      toAt: at(to),
    });

    it('hai khoảng giờ không chồng nhau cùng ngày: cho qua (nghỉ sáng rồi nghỉ chiều)', async () => {
      await expect(
        check([timed('leave', at('08:00'), at('12:00'))], input('leave', '13:00', '17:00')),
      ).resolves.toBeUndefined();
      await expect(
        check([timed('leave', at('08:00'), at('12:00'))], input('ot', '18:00', '20:00')),
      ).resolves.toBeUndefined();
    });

    it('chạm nhau đúng mốc (đến 12:00, từ 12:00) không tính là chồng', async () => {
      await expect(
        check([timed('leave', at('08:00'), at('12:00'))], input('leave', '12:00', '17:00')),
      ).resolves.toBeUndefined();
    });

    it('hai khoảng giờ chồng nhau: chặn', async () => {
      await expect(
        check([timed('leave', at('08:00'), at('12:00'))], input('leave', '11:00', '15:00')),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        check([timed('business_trip', at('08:00'), at('17:00'), 'APPROVED')], input('ot', '16:00', '19:00')),
      ).rejects.toThrow(/công tác/);
    });

    it('thiếu giờ ở đơn cũ hoặc đơn mới: giữ quy tắc theo ngày (chồng ngày là chặn)', async () => {
      await expect(check([row('leave')], input('leave', '13:00', '17:00'))).rejects.toBeInstanceOf(ConflictException);
      await expect(
        check([timed('leave', at('08:00'), at('12:00'))], { kind: 'leave', fromDate: '2026-10-12', toDate: '2026-10-12' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
