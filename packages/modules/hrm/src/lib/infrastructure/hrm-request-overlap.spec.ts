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

    describe('công tác nhiều ngày và OT: chỉ bận trong khoảng giờ công tác của từng ngày', () => {
      const trip3 = (status = 'PENDING') => ({
        kind: 'business_trip',
        from_date: '2026-10-12',
        to_date: '2026-10-14',
        status,
        allow_ot: false,
        from_at: new Date('2026-10-12T07:30:00+07:00').toISOString(),
        to_at: new Date('2026-10-14T17:00:00+07:00').toISOString(),
      });
      const otOn = (date: string, from: string, to: string) => ({
        kind: 'ot' as const,
        fromDate: date,
        toDate: date,
        fromAt: new Date(`${date}T${from}:00+07:00`).toISOString(),
        toAt: new Date(`${date}T${to}:00+07:00`).toISOString(),
      });

      it('OT buổi tối cùng ngày công tác (đầu, giữa, cuối): cho qua', async () => {
        for (const d of ['2026-10-12', '2026-10-13', '2026-10-14'])
          await expect(check([trip3()], otOn(d, '18:00', '20:00'))).resolves.toBeUndefined();
      });
      it('OT sáng sớm trước giờ công tác ngày giữa: cho qua', async () => {
        await expect(check([trip3()], otOn('2026-10-13', '05:00', '07:00'))).resolves.toBeUndefined();
      });
      it('OT trùng giờ công tác ở bất kỳ ngày nào: chặn', async () => {
        await expect(check([trip3('APPROVED')], otOn('2026-10-13', '16:00', '19:00'))).rejects.toThrow(/công tác/);
        await expect(check([trip3()], otOn('2026-10-12', '08:00', '10:00'))).rejects.toBeInstanceOf(ConflictException);
      });
      it('tạo công tác nhiều ngày khi đã có OT buổi tối: cho qua; OT trong giờ công tác: chặn', async () => {
        const trip = { kind: 'business_trip' as const, fromDate: '2026-10-12', toDate: '2026-10-14', fromAt: trip3().from_at, toAt: trip3().to_at };
        const otRow = (from: string, to: string) => ({
          kind: 'ot',
          from_date: '2026-10-13',
          to_date: '2026-10-13',
          status: 'PENDING',
          allow_ot: false,
          from_at: new Date(`2026-10-13T${from}:00+07:00`).toISOString(),
          to_at: new Date(`2026-10-13T${to}:00+07:00`).toISOString(),
        });
        await expect(check([otRow('18:00', '20:00')], trip)).resolves.toBeUndefined();
        await expect(check([otRow('09:00', '11:00')], trip)).rejects.toThrow(/làm thêm giờ/);
      });
      it('công tác không có giờ cụ thể: cả ngày bận, OT vẫn bị chặn', async () => {
        const noTime = { ...trip3(), from_at: null, to_at: null };
        await expect(check([noTime], otOn('2026-10-13', '18:00', '20:00'))).rejects.toBeInstanceOf(ConflictException);
      });
      it('nghỉ phép nhiều ngày vẫn chặn OT (không đổi quy tắc)', async () => {
        const leave = { ...trip3(), kind: 'leave' };
        await expect(check([leave], otOn('2026-10-13', '18:00', '20:00'))).rejects.toBeInstanceOf(ConflictException);
      });
    });

    describe('Chủ nhật hay ngày nghỉ: OT trùng giờ công tác vẫn bị chặn', () => {
      // 2026-10-09 (T6) đến 2026-10-12 (T2); 2026-10-11 là Chủ nhật.
      const trip = () => ({
        kind: 'business_trip',
        from_date: '2026-10-09',
        to_date: '2026-10-12',
        status: 'PENDING',
        allow_ot: false,
        from_at: new Date('2026-10-09T07:30:00+07:00').toISOString(),
        to_at: new Date('2026-10-12T17:00:00+07:00').toISOString(),
      });
      const otOn = (date: string, from: string, to: string) => ({
        kind: 'ot' as const,
        fromDate: date,
        toDate: date,
        fromAt: new Date(`${date}T${from}:00+07:00`).toISOString(),
        toAt: new Date(`${date}T${to}:00+07:00`).toISOString(),
      });

      it('OT Chủ nhật trùng giờ công tác: chặn', async () => {
        await expect(check([trip()], otOn('2026-10-11', '08:00', '12:00'))).rejects.toBeInstanceOf(ConflictException);
      });
      it('OT Chủ nhật khác giờ công tác (buổi tối): cho qua', async () => {
        await expect(check([trip()], otOn('2026-10-11', '18:00', '20:00'))).resolves.toBeUndefined();
      });
      it('tạo công tác qua Chủ nhật khi đã có OT Chủ nhật trùng giờ: chặn', async () => {
        const otRow = {
          kind: 'ot',
          from_date: '2026-10-11',
          to_date: '2026-10-11',
          status: 'PENDING',
          allow_ot: false,
          from_at: new Date('2026-10-11T08:00:00+07:00').toISOString(),
          to_at: new Date('2026-10-11T12:00:00+07:00').toISOString(),
        };
        const input = { kind: 'business_trip' as const, fromDate: '2026-10-09', toDate: '2026-10-12', fromAt: trip().from_at, toAt: trip().to_at };
        await expect(check([otRow], input)).rejects.toBeInstanceOf(ConflictException);
      });
    });

    it('thiếu giờ ở đơn cũ hoặc đơn mới: giữ quy tắc theo ngày (chồng ngày là chặn)', async () => {
      await expect(check([row('leave')], input('leave', '13:00', '17:00'))).rejects.toBeInstanceOf(ConflictException);
      await expect(
        check([timed('leave', at('08:00'), at('12:00'))], { kind: 'leave', fromDate: '2026-10-12', toDate: '2026-10-12' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
