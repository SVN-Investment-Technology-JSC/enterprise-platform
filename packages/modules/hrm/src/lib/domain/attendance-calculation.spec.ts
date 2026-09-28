import {
  calculateAttendance,
  distanceMeters,
  type ShiftWindow,
} from './attendance-calculation';

const shift: ShiftWindow = {
  start: '2026-09-26T01:00:00Z',
  end: '2026-09-26T10:00:00Z',
  breakStart: '2026-09-26T05:00:00Z',
  breakEnd: '2026-09-26T06:00:00Z',
  breakMinutes: 60,
  graceLateMinutes: 5,
  graceEarlyMinutes: 5,
};
const punches = (times: string[]) =>
  times.map((at, i) => ({
    id: String(i),
    kind: (i % 2 ? 'OUT' : 'IN') as 'IN' | 'OUT',
    at: `2026-09-26T${at}:00Z`,
  }));
describe('attendance calculation', () => {
  it('sums sessions without double deducting a break or paying gaps', () => {
    const result = calculateAttendance(
      punches(['01:00', '03:00', '04:00', '05:00', '06:00', '10:00']),
      shift,
    );
    expect(result.workedMinutes).toBe(420);
    expect(result.scheduledMinutes).toBe(480);
    expect(result.anomalies).toEqual([]);
  });
  it('clips early arrival and overtime to the assigned shift', () => {
    expect(
      calculateAttendance(punches(['00:30', '12:00']), shift).workedMinutes,
    ).toBe(480);
  });
  it('does not fabricate work from missing punches or missing shifts', () => {
    expect(calculateAttendance(punches(['01:00']), shift)).toMatchObject({
      workedMinutes: 0,
      openSession: true,
      anomalies: ['MISSING_OUT'],
    });
    expect(
      calculateAttendance(punches(['01:00', '10:00']), null),
    ).toMatchObject({ workedMinutes: 0, anomalies: ['NO_SHIFT'] });
  });
  it('calculates overnight sessions and both late and early minutes', () => {
    const result = calculateAttendance(
      [
        { id: '1', kind: 'IN', at: '2026-09-26T15:15:00Z' },
        { id: '2', kind: 'OUT', at: '2026-09-26T22:50:00Z' },
      ],
      {
        start: '2026-09-26T15:00:00Z',
        end: '2026-09-26T23:00:00Z',
        breakMinutes: 0,
        graceLateMinutes: 5,
        graceEarlyMinutes: 5,
      },
    );
    expect(result).toMatchObject({
      workedMinutes: 455,
      scheduledMinutes: 480,
      lateMinutes: 15,
      earlyMinutes: 10,
    });
  });
  it('flags contradictory events instead of silently overwriting raw punches', () => {
    expect(
      calculateAttendance(
        [
          { id: '1', kind: 'OUT', at: shift.start },
          { id: '2', kind: 'IN', at: shift.end },
          { id: '3', kind: 'IN', at: '2026-09-26T11:00:00Z' },
        ],
        shift,
      ).anomalies,
    ).toEqual(['OUT_WITHOUT_IN', 'DUPLICATE_IN', 'MISSING_OUT']);
  });
  it('measures a GPS radius in meters', () => {
    expect(
      distanceMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toBe(0);
    expect(
      distanceMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 0.001, longitude: 0 },
      ),
    ).toBeCloseTo(111.19, 1);
  });
});
