import { CrmOrganizationUnavailableError } from '../domain/crm.error.js';
import { HttpOrganizationScope, parseReportingLines } from './http-organization-scope.js';

const PAYLOAD = {
  units: [
    { id: 'phong', typeCategory: 'unit' },
    { id: 'TP', typeCategory: 'position', reportsToPositionId: null },
    { id: 'NV', typeCategory: 'position', reportsToPositionId: 'TP' },
  ],
  positions: [{ id: 'NV', reportsToPositionId: 'TP' }],
  members: [
    { userId: 'truong-phong', unitId: 'phong', positionId: 'TP' },
    { userId: 'nhan-vien', unitId: 'phong', positionId: 'NV', reportsToPositionOverrideId: 'TP' },
    { userId: 'du-lieu-cu', unitId: 'NV' },
    { userId: '', positionId: 'NV' },
  ],
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('parseReportingLines', () => {
  it('lấy node, quan hệ báo cáo và phân công; bỏ dòng thiếu dữ liệu', () => {
    const snapshot = parseReportingLines(PAYLOAD);
    expect(snapshot.positions).toEqual([
      { id: 'phong', reportsToPositionId: null },
      { id: 'TP', reportsToPositionId: null },
      { id: 'NV', reportsToPositionId: 'TP' },
    ]);
    expect(snapshot.assignments).toEqual([
      { userId: 'truong-phong', positionId: 'TP', reportsToOverrideId: null },
      { userId: 'nhan-vien', positionId: 'NV', reportsToOverrideId: 'TP' },
      { userId: 'du-lieu-cu', positionId: 'NV', reportsToOverrideId: null },
    ]);
  });

  it('payload lạ thì rỗng chứ không vỡ', () => {
    expect(parseReportingLines(null)).toEqual({ positions: [], assignments: [] });
    expect(parseReportingLines({ units: 'x', members: 1 })).toEqual({ positions: [], assignments: [] });
  });
});

describe('HttpOrganizationScope', () => {
  let clock = 1_000_000;
  const now = () => clock;
  beforeEach(() => {
    clock = 1_000_000;
  });

  it('gọi Tenant Core với service token và giữ kết quả 60 giây', async () => {
    const fetcher = jest.fn().mockResolvedValue(ok(PAYLOAD));
    const reader = new HttpOrganizationScope('http://core/ctx', 'bi-mat', fetcher, now);
    await reader.snapshot('t 1');
    expect(fetcher).toHaveBeenCalledWith(
      'http://core/ctx/t%201',
      expect.objectContaining({ headers: { 'x-service-token': 'bi-mat' } }),
    );
    clock += 59_000;
    await reader.snapshot('t 1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 2_000;
    await reader.snapshot('t 1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('Tenant Core lỗi và chưa có bản nào thì 503', async () => {
    const reader = new HttpOrganizationScope('http://core/ctx', 'x', jest.fn().mockRejectedValue(new Error('down')), now);
    await expect(reader.snapshot('t1')).rejects.toBeInstanceOf(CrmOrganizationUnavailableError);
    const notOk = new HttpOrganizationScope(
      'http://core/ctx',
      'x',
      jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response),
      now,
    );
    await expect(notOk.snapshot('t1')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('Tenant Core lỗi mà còn bản cũ thì dùng bản cũ, 15 giây sau mới hỏi lại', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(ok(PAYLOAD)).mockRejectedValue(new Error('down'));
    const reader = new HttpOrganizationScope('http://core/ctx', 'x', fetcher, now);
    const first = await reader.snapshot('t1');
    clock += 61_000;
    await expect(reader.snapshot('t1')).resolves.toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock += 10_000;
    await reader.snapshot('t1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bộ đệm tách theo tenant', async () => {
    const fetcher = jest.fn().mockResolvedValue(ok(PAYLOAD));
    const reader = new HttpOrganizationScope('http://core/ctx', 'x', fetcher, now);
    await reader.snapshot('t1');
    await reader.snapshot('t2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('parsePeople', () => {
  it('một dòng mỗi người, tên rơi về email rồi id, sắp theo tên', async () => {
    const { parsePeople } = await import('./http-organization-scope.js');
    expect(
      parsePeople({
        members: [
          { userId: 'u2', displayName: 'Trần B', unitId: 'p1' },
          { userId: 'u1', displayName: 'Nguyễn A', unitId: 'p1' },
          { userId: 'u1', displayName: 'Nguyễn A', unitId: 'p2' },
          { userId: 'u3', email: 'c@x.vn' },
          { displayName: 'Không id' },
        ],
      }),
    ).toEqual([
      { userId: 'u3', displayName: 'c@x.vn' },
      { userId: 'u1', displayName: 'Nguyễn A' },
      { userId: 'u2', displayName: 'Trần B' },
    ]);
  });
});
