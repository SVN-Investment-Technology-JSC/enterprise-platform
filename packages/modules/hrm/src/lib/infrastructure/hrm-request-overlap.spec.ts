import { ConflictException } from '@nestjs/common';
import { assertNoRequestOverlap, tripBusyWindowsByShift, type ShiftWindowOf } from './hrm-request-overlap';

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

describe('công tác tính theo giờ phân ca', () => {
  const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+07:00`).getTime();
  // Ca hành chính 07:30 đến 17:00 vào các ngày thứ Hai đến thứ Sáu; thứ Bảy và Chủ nhật không có ca.
  const weekdayShift: ShiftWindowOf = async (date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6 ? null : { from: at(date, '07:30'), to: at(date, '17:00') };
  };
  // 2026-10-02 (T6) đến 2026-10-06 (T3): ngày 03 là thứ Bảy, 04 là Chủ nhật.
  const trip = {
    kind: 'business_trip',
    from_date: '2026-10-02',
    to_date: '2026-10-06',
    status: 'APPROVED',
    allow_ot: false,
    from_at: new Date('2026-10-02T07:30:00+07:00').toISOString(),
    to_at: new Date('2026-10-06T17:00:00+07:00').toISOString(),
  };
  const ot = (date: string, from: string, to: string, toDate = date) => ({
    kind: 'ot' as const,
    fromDate: date,
    toDate,
    fromAt: new Date(`${date}T${from}:00+07:00`).toISOString(),
    toAt: new Date(`${toDate}T${to}:00+07:00`).toISOString(),
  });
  const run = (rows: unknown[], input: Parameters<typeof assertNoRequestOverlap>[3]) =>
    assertNoRequestOverlap(dbWith(rows) as never, 't', 'e', input, { shiftOf: weekdayShift });

  it('công tác chỉ bận trong giờ ca: ngày thường chỉ có ca, cuối tuần không bận', async () => {
    const busy = await tripBusyWindowsByShift(trip, weekdayShift);
    expect(busy.map((w) => w.date)).toEqual(['2026-10-02', '2026-10-05', '2026-10-06']);
  });

  it('ngày đầu bắt đầu từ giờ của đơn, ngày cuối kết thúc ở giờ của đơn', async () => {
    const late = { ...trip, from_at: new Date('2026-10-02T13:00:00+07:00').toISOString(), to_at: new Date('2026-10-06T11:30:00+07:00').toISOString() };
    const busy = await tripBusyWindowsByShift(late, weekdayShift);
    expect(busy[0]).toMatchObject({ date: '2026-10-02', from: at('2026-10-02', '13:00'), to: at('2026-10-02', '17:00') });
    expect(busy.at(-1)).toMatchObject({ date: '2026-10-06', from: at('2026-10-06', '07:30'), to: at('2026-10-06', '11:30') });
  });

  it('OT cuối tuần trong chuyến công tác được nhận cả ngày (ngày không có ca)', async () => {
    await expect(run([trip], ot('2026-10-03', '12:00', '18:00'))).resolves.toBeUndefined();
    await expect(run([trip], ot('2026-10-04', '07:00', '18:00'))).resolves.toBeUndefined();
  });

  it('OT bắt đầu sau khi hết ca ngày thường được nhận, OT chồng giờ ca bị chặn', async () => {
    await expect(run([trip], ot('2026-10-05', '17:00', '23:00'))).resolves.toBeUndefined();
    await expect(run([trip], ot('2026-10-05', '18:00', '04:00', '2026-10-06'))).resolves.toBeUndefined();
    await expect(run([trip], ot('2026-10-05', '16:00', '19:00'))).rejects.toThrow(/công tác/);
  });

  it('OT sáng ngày cuối: chỉ chặn phần chồng giờ ca còn trong thời gian công tác', async () => {
    const endsNoon = { ...trip, to_at: new Date('2026-10-06T11:30:00+07:00').toISOString() };
    await expect(run([endsNoon], ot('2026-10-06', '13:00', '15:00'))).resolves.toBeUndefined();
    await expect(run([endsNoon], ot('2026-10-06', '09:00', '10:00'))).rejects.toThrow(/công tác/);
  });

  it('tạo công tác khi đã có OT cuối tuần: cho qua; OT trong giờ ca: chặn', async () => {
    const tripInput = { kind: 'business_trip' as const, fromDate: '2026-10-02', toDate: '2026-10-06', fromAt: trip.from_at, toAt: trip.to_at };
    const otRow = (date: string, from: string, to: string) => ({
      kind: 'ot', from_date: date, to_date: date, status: 'PENDING', allow_ot: false,
      from_at: new Date(`${date}T${from}:00+07:00`).toISOString(), to_at: new Date(`${date}T${to}:00+07:00`).toISOString(),
    });
    await expect(run([otRow('2026-10-03', '12:00', '18:00')], tripInput)).resolves.toBeUndefined();
    await expect(run([otRow('2026-10-05', '09:00', '11:00')], tripInput)).rejects.toThrow(/làm thêm giờ/);
  });

  it('nghỉ phép vẫn chặn OT như cũ', async () => {
    await expect(run([{ ...trip, kind: 'leave' }], ot('2026-10-05', '18:00', '20:00'))).rejects.toBeInstanceOf(ConflictException);
  });
});
