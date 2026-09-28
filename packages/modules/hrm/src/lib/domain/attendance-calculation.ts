export interface Punch {
  id: string;
  kind: 'IN' | 'OUT';
  at: string;
}
export interface ShiftWindow {
  start: string;
  end: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  breakMinutes: number;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
}

/** Pure calculation: raw punches are never overwritten by a daily summary. */
export function calculateAttendance(
  punches: readonly Punch[],
  shift: ShiftWindow | null,
) {
  const events = [...punches].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );
  const anomalies = new Set<string>();
  const sessions: { start: string; end: string }[] = [];
  let open: Punch | undefined;
  for (const event of events) {
    if (!Number.isFinite(Date.parse(event.at)))
      throw new Error('Invalid punch timestamp');
    if (event.kind === 'IN') {
      if (open) anomalies.add('DUPLICATE_IN');
      else open = event;
    } else if (!open) anomalies.add('OUT_WITHOUT_IN');
    else {
      if (Date.parse(event.at) <= Date.parse(open.at))
        anomalies.add('INVALID_SESSION');
      else sessions.push({ start: open.at, end: event.at });
      open = undefined;
    }
  }
  if (open) anomalies.add('MISSING_OUT');
  if (!shift) anomalies.add('NO_SHIFT');
  const start = shift ? Date.parse(shift.start) : 0;
  const end = shift ? Date.parse(shift.end) : 0;
  if (shift && (!Number.isFinite(start) || end <= start))
    throw new Error('Invalid shift window');
  const bs = shift?.breakStart ? Date.parse(shift.breakStart) : 0;
  const be = shift?.breakEnd ? Date.parse(shift.breakEnd) : 0;
  if (shift?.breakMinutes && (!bs || be <= bs))
    anomalies.add('BREAK_WINDOW_REQUIRED');
  const overlap = (a: number, b: number, c: number, d: number) =>
    Math.max(0, Math.min(b, d) - Math.max(a, c));
  let workedMs = 0;
  for (const session of sessions) {
    const a = Math.max(Date.parse(session.start), start);
    const b = Math.min(Date.parse(session.end), end);
    if (shift && b > a)
      workedMs += b - a - (be > bs ? overlap(a, b, bs, be) : 0);
  }
  const scheduledMinutes = shift
    ? Math.max(
        0,
        Math.floor(
          (end - start - (be > bs ? overlap(start, end, bs, be) : 0)) / 60000,
        ),
      )
    : 0;
  const firstIn = events.find((e) => e.kind === 'IN')?.at ?? null;
  const lastOut = events.filter((e) => e.kind === 'OUT').at(-1)?.at ?? null;
  const late =
    shift && firstIn
      ? Math.max(0, Math.ceil((Date.parse(firstIn) - start) / 60000))
      : 0;
  const early =
    shift && lastOut && !open
      ? Math.max(0, Math.ceil((end - Date.parse(lastOut)) / 60000))
      : 0;
  const lateMinutes = shift && late > shift.graceLateMinutes ? late : 0;
  const earlyMinutes = shift && early > shift.graceEarlyMinutes ? early : 0;
  return {
    sessions,
    anomalies: [...anomalies],
    firstIn,
    lastOut,
    openSession: !!open,
    workedMinutes: Math.floor(workedMs / 60000),
    scheduledMinutes,
    lateMinutes,
    earlyMinutes,
    status: anomalies.size
      ? 'ABNORMAL'
      : lateMinutes
        ? 'LATE'
        : earlyMinutes
          ? 'EARLY_LEAVE'
          : 'VALID',
  };
}

export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
