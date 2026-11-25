import { HttpProcedureStepsReader } from './http-procedure-steps.js';

describe('HttpProcedureStepsReader', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env['INTERNAL_SERVICE_TOKEN'];

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env['INTERNAL_SERVICE_TOKEN'];
    else process.env['INTERNAL_SERVICE_TOKEN'] = originalToken;
  });

  function mockFetch(status: number, body: unknown) {
    const fetchMock = jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('GET route nội bộ kèm service token và tenant, rồi ánh xạ kết quả', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    const fetchMock = mockFetch(200, {
      instanceId: 'i 1',
      instanceCode: 'HS-1',
      status: 'running',
      currentStepId: 's2',
      progress: { completed: 1, total: 3 },
      steps: [
        { id: 's1', name: 'Soạn', order: 1, status: 'completed', roleStage: 'R', assigneeLabel: 'A', completedAt: 'x' },
        { id: 's2', name: 'Duyệt', order: 2, status: 'active', assigneeLabel: 'B', slaHours: 8 },
      ],
      events: [{ id: 'e1', action: 'approve', actorName: 'A', createdAt: '2026-10-01T00:00:00.000Z', stepId: 's1' }],
    });
    const result = await new HttpProcedureStepsReader('http://proc/api/procedure').read('t1', 'i 1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://proc/api/procedure/v1/internal/instances/i%201/step-overview');
    expect(init.headers).toMatchObject({ 'x-tenant-id': 't1', 'x-service-token': 'tok' });
    expect(init.redirect).toBe('error');
    expect(result).toMatchObject({
      instanceId: 'i 1',
      instanceCode: 'HS-1',
      progress: { completed: 1, total: 3 },
      steps: [
        { id: 's1', status: 'completed', roleStage: 'R', completedAt: 'x' },
        { id: 's2', status: 'active', slaHours: 8 },
      ],
      events: [{ id: 'e1', action: 'approve', stepId: 's1' }],
    });
  });

  it('trạng thái bước lạ về pending, trường thiếu hoặc sai kiểu không làm vỡ, bỏ trường thừa', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    mockFetch(200, {
      instanceId: 'i1',
      progress: { completed: 'x' },
      steps: [
        { id: 's1', status: 'la-hoac', secret: 'khong-duoc-lo', actorId: 'u1' },
        { name: 'thiếu id' },
        null,
      ],
      events: [{ id: 'e1' }, { id: 'e2', action: 'start', comment: 'riêng tư' }, 'rác'],
    });
    const result = await new HttpProcedureStepsReader('http://p').read('t1', 'i1');
    if (result === 'unavailable' || result === undefined) throw new Error('phải có kết quả');
    expect(result.steps).toEqual([
      expect.objectContaining({ id: 's1', status: 'pending', order: 1, assigneeLabel: '' }),
    ]);
    expect(result.progress).toBeUndefined();
    expect(result.events.map((event) => event.id)).toEqual(['e2']);
    expect(JSON.stringify(result)).not.toMatch(/khong-duoc-lo|actorId|riêng tư/);
  });

  it('chuyển điểm rẽ nhánh, bỏ điểm rẽ thiếu id, giới hạn số lượng và không lộ trường thừa', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    const gateways = [
      {
        id: 'g1',
        name: 'Rẽ theo giá trị',
        afterStepId: 's1',
        chosenBranchId: 'b2',
        condition: 'khong-duoc-lo',
        branches: [
          { id: 'b1', label: 'Nhánh 1', isDefault: false, stepIds: ['s2', 7, '', 's3'], inputs: 'khong-duoc-lo' },
          { id: 'b2', label: 'Mặc định', isDefault: true, stepIds: ['s4'] },
          { label: 'thiếu id' },
        ],
      },
      { id: 'g-thieu-after', branches: [] },
      { afterStepId: 's1', branches: [] },
      'rác',
    ];
    mockFetch(200, { instanceId: 'i1', steps: [], events: [], gateways });
    const result = await new HttpProcedureStepsReader('http://p').read('t1', 'i1');
    if (result === 'unavailable' || result === undefined) throw new Error('phải có kết quả');
    expect(result.gateways).toEqual([
      {
        id: 'g1',
        name: 'Rẽ theo giá trị',
        afterStepId: 's1',
        chosenBranchId: 'b2',
        branches: [
          { id: 'b1', label: 'Nhánh 1', isDefault: false, stepIds: ['s2', 's3'] },
          { id: 'b2', label: 'Mặc định', isDefault: true, stepIds: ['s4'] },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('khong-duoc-lo');

    const many = Array.from({ length: 30 }, (_, g) => ({
      id: `g${g}`,
      afterStepId: 's1',
      branches: Array.from({ length: 30 }, (_b, b) => ({
        id: `b${b}`,
        stepIds: Array.from({ length: 150 }, (_s, s) => `s${s}`),
      })),
    }));
    mockFetch(200, { instanceId: 'i1', gateways: many });
    const capped = await new HttpProcedureStepsReader('http://p').read('t1', 'i1');
    if (capped === 'unavailable' || capped === undefined) throw new Error('phải có kết quả');
    expect(capped.gateways).toHaveLength(20);
    expect(capped.gateways?.[0].branches).toHaveLength(20);
    expect(capped.gateways?.[0].branches[0].stepIds).toHaveLength(100);
  });

  it('không có điểm rẽ thì không có trường gateways', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    mockFetch(200, { instanceId: 'i1', steps: [], events: [], gateways: 'sai-kieu' });
    const result = await new HttpProcedureStepsReader('http://p').read('t1', 'i1');
    if (result === 'unavailable' || result === undefined) throw new Error('phải có kết quả');
    expect(result.gateways).toBeUndefined();
  });

  it('404 mang mã not_found của Quy trình là không có hồ sơ', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    mockFetch(404, { statusCode: 404, error: 'not_found', message: 'Không tìm thấy hồ sơ quy trình.' });
    await expect(new HttpProcedureStepsReader('http://p').read('t1', 'i1')).resolves.toBeUndefined();
  });

  it('404 của gateway hay route chưa có là unavailable, không phải không có hồ sơ', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    mockFetch(404, { message: 'Cannot GET /api/procedure/v1/internal/instances/i1/step-overview' });
    await expect(new HttpProcedureStepsReader('http://p').read('t1', 'i1')).resolves.toBe('unavailable');
  });

  it('thiếu token, lỗi HTTP, mất kết nối, thân không phải hồ sơ đều là unavailable và không ném', async () => {
    const reader = new HttpProcedureStepsReader('http://p');
    delete process.env['INTERNAL_SERVICE_TOKEN'];
    const untouched = mockFetch(200, {});
    await expect(reader.read('t1', 'i1')).resolves.toBe('unavailable');
    expect(untouched).not.toHaveBeenCalled();

    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    mockFetch(500, {});
    await expect(reader.read('t1', 'i1')).resolves.toBe('unavailable');
    mockFetch(200, { steps: [] });
    await expect(reader.read('t1', 'i1')).resolves.toBe('unavailable');
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(reader.read('t1', 'i1')).resolves.toBe('unavailable');
  });
});
