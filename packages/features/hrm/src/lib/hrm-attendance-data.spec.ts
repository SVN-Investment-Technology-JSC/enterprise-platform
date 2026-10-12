import {
  buildAttendanceCsv,
  buildAttendanceEventsQuery,
  buildAttendanceQuery,
  eventKindLabel,
  extractEventEvidence,
  validateAttendanceRange,
  type AttendanceDataRow,
} from './hrm-attendance-data';
import { buildCsv, csvCell, safeFileName } from './hrm-csv';

const row: AttendanceDataRow = {
  id: 'a1',
  employeeId: 'e1',
  employeeCode: 'NV001',
  employeeName: 'Nguyễn "Văn", An',
  departmentName: '=Phòng HC',
  workDate: '2026-10-09',
  checkInAt: '2026-10-09T01:00:00Z',
  checkOutAt: null,
  workedMinutes: 480,
  scheduledMinutes: 480,
  lateMinutes: 0,
  earlyMinutes: 5,
  status: 'MISSING_PUNCH',
  source: 'WEB',
};

describe('hrm-csv', () => {
  it('escapes quotes and neutralises formula injection but keeps numbers', () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('x,y')).toBe('"x,y"');
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('""');
  });

  it('starts with a UTF-8 BOM and joins rows with CRLF', () => {
    const csv = buildCsv([['a', 'b'], [1, 'c']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('"a","b"\r\n1,"c"');
  });

  it('builds safe file names', () => {
    expect(safeFileName('du-lieu 2026/10')).toBe('du-lieu_2026_10');
    expect(safeFileName('///')).toBe('xuat-du-lieu');
  });
});

describe('hrm-attendance-data', () => {
  it('rejects ranges beyond 93 days with a clear message', () => {
    expect(validateAttendanceRange('2026-01-01', '2026-04-03')).toBe('');
    expect(validateAttendanceRange('2026-01-01', '2026-04-04')).toContain('tối đa 93 ngày');
    expect(validateAttendanceRange('2026-10-02', '2026-10-01')).toContain('sau hoặc bằng');
    expect(validateAttendanceRange('', '2026-10-01')).toContain('Chọn đầy đủ');
  });

  it('builds the list query forwarding status, q and page', () => {
    const query = new URLSearchParams(
      buildAttendanceQuery(
        { from: '2026-10-01', to: '2026-10-31', q: ' an ', status: 'LATE' },
        3,
      ),
    );
    expect(Object.fromEntries(query)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      page: '3',
      page_size: '50',
      q: 'an',
      status: 'LATE',
    });
    const bare = new URLSearchParams(
      buildAttendanceQuery({ from: '2026-10-01', to: '2026-10-31', q: '  ', status: '' }, 1, 200),
    );
    expect(bare.has('q')).toBe(false);
    expect(bare.has('status')).toBe(false);
    expect(bare.get('page_size')).toBe('200');
  });

  it('builds the events query for a single day', () => {
    const query = new URLSearchParams(buildAttendanceEventsQuery('e1', '2026-10-09T00:00:00.000Z'));
    expect(query.get('employee_id')).toBe('e1');
    expect(query.get('from')).toBe('2026-10-09');
    expect(query.get('to')).toBe('2026-10-09');
  });

  it('exports the filtered rows as CSV with Vietnamese labels and no formula injection', () => {
    const csv = buildAttendanceCsv([row]);
    const [header, line] = csv.slice(1).split('\r\n');
    expect(header).toContain('"Mã nhân viên"');
    expect(line).toBe(
      `"NV001","Nguyễn ""Văn"", An","'=Phòng HC","09/10/2026","08:00","",480,480,0,5,"Thiếu quẹt","WEB"`,
    );
  });

  it('extracts evidence safely', () => {
    expect(
      extractEventEvidence({
        evidence: { ip: '10.0.0.1', siteSnapshot: { name: 'Trụ sở' }, latitude: 10.5, longitude: 106.7 },
      }),
    ).toEqual({ ip: '10.0.0.1', site: 'Trụ sở', gps: '10.5, 106.7' });
    expect(extractEventEvidence({ evidence: null })).toEqual({ ip: null, site: null, gps: null });
    expect(extractEventEvidence({ evidence: { latitude: 1 } }).gps).toBeNull();
    expect(eventKindLabel('IN')).toBe('Vào');
    expect(eventKindLabel('OUT')).toBe('Ra');
  });
});
