import { punchBlockReason } from './punch-block';

/** Ca 07:30 - 16:30 (giờ Việt Nam) = 00:30 - 09:30 UTC. */
const WINDOW = { start: '2026-11-02T00:30:00.000Z', end: '2026-11-02T09:30:00.000Z' };
const TZ = 'Asia/Ho_Chi_Minh';
const at = (hhmm: string) => Date.parse(`2026-11-02T${hhmm}:00+07:00`);
const limits = { lateInMinutes: 30, earlyOutMinutes: null };

describe('chặn chấm vào muộn trong giờ ca', () => {
  it('ca 7:30 chặn 30 phút: 7:45 và 8:00 còn chấm được, 8:01 và 8:30 thì không', () => {
    expect(punchBlockReason('IN', at('07:45'), WINDOW, limits, TZ)).toBeNull();
    expect(punchBlockReason('IN', at('08:00'), WINDOW, limits, TZ)).toBeNull();
    expect(punchBlockReason('IN', at('08:01'), WINDOW, limits, TZ)).toMatch(/muộn nhất 08:00/);
    expect(punchBlockReason('IN', at('08:30'), WINDOW, limits, TZ)).not.toBeNull();
  });

  it('chấm vào sớm bao nhiêu cũng được', () => {
    expect(punchBlockReason('IN', at('03:00'), WINDOW, limits, TZ)).toBeNull();
  });

  it('không cấu hình (null) thì không chặn', () => {
    expect(punchBlockReason('IN', at('12:00'), WINDOW, { lateInMinutes: null, earlyOutMinutes: null }, TZ)).toBeNull();
  });

  it('chặn 0 phút: chỉ chấm vào được đến đúng giờ bắt đầu', () => {
    const zero = { lateInMinutes: 0, earlyOutMinutes: null };
    expect(punchBlockReason('IN', at('07:30'), WINDOW, zero, TZ)).toBeNull();
    expect(punchBlockReason('IN', at('07:31'), WINDOW, zero, TZ)).not.toBeNull();
  });

  it('giới hạn chấm vào không ảnh hưởng lượt chấm ra', () => {
    expect(punchBlockReason('OUT', at('09:00'), WINDOW, limits, TZ)).toBeNull();
  });
});

describe('chặn chấm ra sớm trong giờ ca', () => {
  const out = { lateInMinutes: null, earlyOutMinutes: 15 };
  it('ca kết thúc 16:30 chặn 15 phút: 16:15 chấm ra được, 16:14 thì không', () => {
    expect(punchBlockReason('OUT', at('16:15'), WINDOW, out, TZ)).toBeNull();
    expect(punchBlockReason('OUT', at('16:14'), WINDOW, out, TZ)).toMatch(/sớm nhất 16:15/);
    expect(punchBlockReason('OUT', at('17:00'), WINDOW, out, TZ)).toBeNull();
  });

  it('giới hạn chấm ra không ảnh hưởng lượt chấm vào', () => {
    expect(punchBlockReason('IN', at('12:00'), WINDOW, out, TZ)).toBeNull();
  });
});
