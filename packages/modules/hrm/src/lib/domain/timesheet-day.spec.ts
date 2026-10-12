import {
  coveredMinutesOf,
  resolveDayOutcome,
  type DayOutcomeInput,
  type DayShiftBounds,
} from './timesheet-day';

const H = 3600000;
const D0 = Date.UTC(2026, 9, 12, 1, 0, 0); // 08:00 giờ Việt Nam
const at = (hour: number) => D0 + (hour - 8) * H;

/** Ca 08:00-17:00, nghỉ trưa 12:00-13:00 (480 phút), ân hạn 5 phút. */
const shift: DayShiftBounds = {
  startMs: at(8),
  endMs: at(17),
  breakStartMs: at(12),
  breakEndMs: at(13),
  graceLateMinutes: 5,
  graceEarlyMinutes: 5,
};

const base = (over: Partial<DayOutcomeInput> = {}): DayOutcomeInput => ({
  off: false,
  holiday: false,
  holidayPaid: false,
  shift,
  scheduledMinutes: 480,
  workedMinutes: 480,
  lateMinutes: 0,
  earlyMinutes: 0,
  firstInMs: at(8),
  lastOutMs: at(17),
  anomalies: [],
  leaves: [],
  trips: [],
  ...over,
});

describe('resolveDayOutcome', () => {
  it('ngày đi làm bình thường: đủ công, không bất thường', () => {
    const r = resolveDayOutcome(base());
    expect(r).toMatchObject({ paidMinutes: 480, issues: [], fullyCovered: false });
  });

  it('ngày OFF không có công; ngày lễ có lương trả theo ca, không lương trả 0', () => {
    expect(resolveDayOutcome(base({ off: true })).paidMinutes).toBe(0);
    expect(resolveDayOutcome(base({ holiday: true, holidayPaid: true, workedMinutes: 0 })).paidMinutes).toBe(480);
    expect(resolveDayOutcome(base({ holiday: true, holidayPaid: false, workedMinutes: 0 })).paidMinutes).toBe(0);
  });

  it('nghỉ cả ngày che lỗi chấm công, đi trễ về sớm về 0', () => {
    const r = resolveDayOutcome(
      base({
        workedMinutes: 0,
        lateMinutes: 90,
        earlyMinutes: 30,
        anomalies: ['MISSING_OUT'],
        leaves: [{ days: 1, paidMinutes: 480, interval: { startMs: at(8), endMs: at(17) } }],
      }),
    );
    expect(r).toMatchObject({ paidMinutes: 480, issues: [], lateMinutes: 0, earlyMinutes: 0, fullyCovered: true });
  });

  it('nghỉ cả ngày không lương cũng che lỗi chấm công nhưng không trả công', () => {
    const r = resolveDayOutcome(
      base({
        workedMinutes: 0,
        anomalies: ['MISSING_OUT'],
        leaves: [{ days: 1, paidMinutes: 0, interval: { startMs: at(8), endMs: at(17) } }],
      }),
    );
    expect(r).toMatchObject({ paidMinutes: 0, issues: [], fullyCovered: true });
  });

  it('nghỉ sáng + đi làm chiều: không bị tính đi trễ; thiếu OUT buổi chiều vẫn là bất thường', () => {
    const morningLeave = { days: 0.5, paidMinutes: 240, interval: { startMs: at(8), endMs: at(12) } };
    const ok = resolveDayOutcome(
      base({
        workedMinutes: 240,
        lateMinutes: 300,
        firstInMs: at(13),
        leaves: [morningLeave],
      }),
    );
    expect(ok).toMatchObject({ paidMinutes: 480, lateMinutes: 0, earlyMinutes: 0, issues: [] });
    const late = resolveDayOutcome(
      base({ workedMinutes: 210, lateMinutes: 330, firstInMs: at(13) + 30 * 60000, leaves: [morningLeave] }),
    );
    // Ca chỉ còn 13:00-17:00, vào 13:30 là trễ 30 phút.
    expect(late.lateMinutes).toBe(30);
    const missing = resolveDayOutcome(
      base({ workedMinutes: 0, anomalies: ['MISSING_OUT'], firstInMs: at(13), lastOutMs: null, leaves: [morningLeave] }),
    );
    expect(missing.issues).toEqual(['MISSING_OUT']);
  });

  it('nghỉ chiều + về sớm: về trước giờ nghỉ mới là sớm, ân hạn áp dụng', () => {
    const afternoon = { days: 0.5, paidMinutes: 240, interval: { startMs: at(13), endMs: at(17) } };
    expect(
      resolveDayOutcome(base({ workedMinutes: 240, earlyMinutes: 300, lastOutMs: at(12), leaves: [afternoon] })).earlyMinutes,
    ).toBe(0);
    expect(
      resolveDayOutcome(
        base({ workedMinutes: 220, earlyMinutes: 320, lastOutMs: at(12) - 20 * 60000, leaves: [afternoon] }),
      ).earlyMinutes,
    ).toBe(20);
  });

  it('đơn nghỉ cũ không có giờ: một ngày coi như cả ca, nửa ngày giữ nguyên số trễ', () => {
    const full = resolveDayOutcome(
      base({ workedMinutes: 0, anomalies: ['MISSING_OUT'], leaves: [{ days: 1, paidMinutes: 480, interval: null }] }),
    );
    expect(full.fullyCovered).toBe(true);
    expect(full.issues).toEqual([]);
    const half = resolveDayOutcome(
      base({ workedMinutes: 240, lateMinutes: 40, leaves: [{ days: 0.5, paidMinutes: 240, interval: null }] }),
    );
    expect(half.lateMinutes).toBe(40);
    expect(half.fullyCovered).toBe(false);
  });

  it('công tác không giờ bao cả ca; công tác theo giờ chỉ trả phần giao với ca', () => {
    const whole = resolveDayOutcome(base({ workedMinutes: 0, anomalies: ['MISSING_OUT'], trips: [{ interval: null }] }));
    expect(whole).toMatchObject({ paidMinutes: 480, issues: [], fullyCovered: true });
    const part = resolveDayOutcome(
      base({ workedMinutes: 240, trips: [{ interval: { startMs: at(8), endMs: at(12) } }], firstInMs: at(13) }),
    );
    expect(part.paidMinutes).toBe(480);
    const partOnly = resolveDayOutcome(
      base({ workedMinutes: 0, trips: [{ interval: { startMs: at(8), endMs: at(12) } }], firstInMs: null, lastOutMs: null }),
    );
    expect(partOnly.paidMinutes).toBe(240);
  });

  it('công tác theo giờ: từ 4 giờ trở xuống là 0,5 ngày, trên 4 giờ là 1 ngày, đơn cũ không giờ là 1 ngày', () => {
    const trip = (hours: number) => ({
      interval: { startMs: at(8), endMs: at(8) + hours * H },
      dayMinutes: hours * 60,
    });
    const run = (t: { interval: { startMs: number; endMs: number } | null; dayMinutes?: number }) =>
      resolveDayOutcome(base({ workedMinutes: 0, firstInMs: null, lastOutMs: null, trips: [t] }));
    expect(run(trip(3)).paidMinutes).toBe(240);
    expect(run(trip(4)).paidMinutes).toBe(240);
    expect(run(trip(4)).fullyCovered).toBe(false);
    expect(run(trip(5)).paidMinutes).toBe(480);
    expect(run(trip(9)).paidMinutes).toBe(480);
    expect(run(trip(9)).fullyCovered).toBe(true);
    expect(run({ interval: null }).paidMinutes).toBe(480);
  });

  it('công tác nửa ngày: nửa còn lại vẫn chấm công, thiếu chấm thì thiếu công; đủ thì đủ công', () => {
    const half = { interval: { startMs: at(8), endMs: at(12) }, dayMinutes: 240 };
    expect(resolveDayOutcome(base({ workedMinutes: 0, firstInMs: null, lastOutMs: null, trips: [half] })).paidMinutes).toBe(240);
    expect(resolveDayOutcome(base({ workedMinutes: 240, firstInMs: at(13), trips: [half] })).paidMinutes).toBe(480);
    // Thiếu chấm ra buổi chiều vẫn là bất thường vì công tác chỉ phủ nửa ngày.
    expect(
      resolveDayOutcome(base({ workedMinutes: 0, anomalies: ['MISSING_OUT'], firstInMs: at(13), lastOutMs: null, trips: [half] })).issues,
    ).toEqual(['MISSING_OUT']);
  });

  it('ngày có công tác hoặc tăng ca đã duyệt: không tính đi trễ về sớm', () => {
    // Công tác buổi sáng, vào chiều 13:00 (công tác nửa ngày): không bị tính trễ.
    const trip = resolveDayOutcome(
      base({
        workedMinutes: 240,
        lateMinutes: 300,
        earlyMinutes: 20,
        firstInMs: at(13),
        trips: [{ interval: { startMs: at(8), endMs: at(11) }, dayMinutes: 180 }],
      }),
    );
    expect(trip).toMatchObject({ lateMinutes: 0, earlyMinutes: 0, paidMinutes: 480 });
    // Có đơn tăng ca: đi trễ ca thường cũng không bị tính (tăng ca theo số giờ của đơn).
    expect(resolveDayOutcome(base({ lateMinutes: 40, earlyMinutes: 10, hasOt: true }))).toMatchObject({
      lateMinutes: 0,
      earlyMinutes: 0,
    });
    expect(resolveDayOutcome(base({ lateMinutes: 40 }))).toMatchObject({ lateMinutes: 40 });
  });

  it('nghỉ chồng công tác bị đánh dấu bất thường; đơn nghỉ cũ cần rà soát', () => {
    const r = resolveDayOutcome(
      base({
        leaves: [{ days: 1, paidMinutes: 480, interval: null, legacy: true }],
        trips: [{ interval: null }],
      }),
    );
    expect(r.issues).toEqual(['LEGACY_LEAVE_REQUIRES_REVIEW', 'LEAVE_TRIP_OVERLAP']);
  });

  it('ngày chưa có ca: NO_SHIFT là bất thường trừ ngày OFF hoặc lễ không lương; công tác không che', () => {
    const noShift = base({ shift: null, scheduledMinutes: 0, workedMinutes: 0, anomalies: ['NO_SHIFT'] });
    expect(resolveDayOutcome(noShift).issues).toEqual(['NO_SHIFT']);
    expect(resolveDayOutcome({ ...noShift, off: true }).issues).toEqual([]);
    expect(resolveDayOutcome({ ...noShift, holiday: true, holidayPaid: false }).issues).toEqual([]);
    expect(resolveDayOutcome({ ...noShift, trips: [{ interval: null }] }).issues).toEqual(['NO_SHIFT']);
  });
});

describe('coveredMinutesOf', () => {
  it('hợp các khoảng chồng nhau, không tính trùng và không vượt ca', () => {
    const r = coveredMinutesOf(
      shift,
      480,
      [
        { days: 0.5, paidMinutes: 240, interval: { startMs: at(8), endMs: at(11) } },
        { days: 0.5, paidMinutes: 240, interval: { startMs: at(10), endMs: at(12) } },
      ],
      [],
    );
    expect(r.minutes).toBe(240);
  });
});
