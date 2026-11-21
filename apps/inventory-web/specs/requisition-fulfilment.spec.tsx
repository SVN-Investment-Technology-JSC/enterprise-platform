import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  BatchRequisitionModal,
  loadProcedureRequisitions,
  parseSerialText,
  type InventoryWorkspace,
  type ProcedureRequisition,
} from '@enterprise-platform/feature-inventory';

// Cấp vật tư theo yêu cầu Quy trình (ISS-BE-031): danh sách và trạng thái cấp đọc
// từ server Kho (mọi thủ kho thấy đủ), cấp bằng MỘT lời gọi; lời báo vào hồ sơ
// Quy trình do server ghi qua sự kiện, trình duyệt không gọi API trao đổi.
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';
const PARENT_B = '33333333-3333-4333-8333-333333333333';

type Call = { url: string; method: string; body?: unknown };
let calls: Call[] = [];

function mockFetch(routes: (url: string, method: string) => { status?: number; body: unknown } | undefined) {
  calls = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes(url, method) ?? { body: {} };
    const status = route.status ?? 200;
    return { ok: status < 400, status, json: async () => route.body } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('danh sách yêu cầu cấp vật tư', () => {
  it('đọc từ GET /requisitions của Kho, không gọi workspace Quy trình, không dùng localStorage', async () => {
    mockFetch((url) =>
      url === '/api/inventory/v1/requisitions'
        ? {
            body: {
              items: [
                {
                  orderCode: 'PR-B',
                  instanceId: INSTANCE_B,
                  title: 'Xin vật tư',
                  procedureStatus: 'completed',
                  createdAt: '2026-11-03T00:00:00Z',
                  parentInstanceId: PARENT_B,
                  parentCode: 'HS-1',
                  assetCode: 'TB-01',
                  lines: [{ materialCode: 'VT-01', quantity: 2 }],
                  fulfilment: { orderCode: 'PR-B', status: 'OPEN', documentCodes: [] },
                },
              ],
            },
          }
        : undefined,
    );

    const list = await loadProcedureRequisitions();

    expect(list).toEqual([
      {
        id: INSTANCE_B,
        code: 'PR-B',
        title: 'Xin vật tư',
        status: 'completed',
        startedAt: '2026-11-03T00:00:00Z',
        sourceType: 'auto_from_parent',
        sourceId: PARENT_B,
        assetCode: 'TB-01',
        kind: 'issue',
        lines: [{ materialCode: 'VT-01', quantity: 2 }],
        csvFileName: 'bang-ke-vat-tu-PR-B.csv',
        fulfilment: { orderCode: 'PR-B', status: 'OPEN', documentCodes: [] },
      },
    ]);
    expect(calls.map((call) => call.url)).toEqual(['/api/inventory/v1/requisitions']);
    expect(window.localStorage.getItem('ep:inventory:fulfilled_requisitions')).toBeNull();
  });

  it('server lỗi: ném lỗi để màn báo cho thủ kho, không trả danh sách rỗng', async () => {
    mockFetch(() => ({ status: 503, body: { message: 'Quy trình đang không khả dụng. Vui lòng thử lại sau.' } }));
    await expect(loadProcedureRequisitions()).rejects.toThrow(/Quy trình đang không khả dụng/);
  });
});

describe('BatchRequisitionModal', () => {
  const workspace = {
    warehouses: [{ id: 'w1', code: 'KHO-01', name: 'Kho chính' }],
    materials: [
      { id: 'm1', code: 'VT-01', name: 'Bu lông', isSerialized: false },
      { id: 'm2', code: 'SR-01', name: 'Bơm', isSerialized: true },
    ],
    assets: [],
    stock: [
      { materialCode: 'VT-01', warehouseCode: 'KHO-01', quantity: 10, available: 10 },
      { materialCode: 'SR-01', warehouseCode: 'KHO-01', quantity: 3, available: 3 },
    ],
  } as unknown as InventoryWorkspace;

  const req = (patch: Partial<ProcedureRequisition> = {}): ProcedureRequisition => ({
    id: INSTANCE_B,
    code: 'PR-B',
    title: 'Xin vật tư',
    status: 'completed',
    startedAt: '2026-11-03T00:00:00Z',
    kind: 'issue',
    lines: [{ materialCode: 'VT-01', quantity: 2, unit: 'Cái' }],
    csvFileName: 'bang-ke-vat-tu-PR-B.csv',
    sourceType: 'auto_from_parent',
    sourceId: PARENT_B,
    ...patch,
  });

  it('cấp bằng một lời gọi, báo thành công kèm mã chứng từ', async () => {
    mockFetch((url) =>
      url.includes('/requisitions/PR-B/fulfil')
        ? {
            status: 201,
            body: {
              orderCode: 'PR-B',
              instanceId: INSTANCE_B,
              mode: 'ISSUE',
              status: 'FULFILLED',
              documentCode: 'PX-9',
              documents: [{ id: 'd9', code: 'PX-9', status: 'POSTED' }],
              replayed: false,
            },
          }
        : { body: {} },
    );
    const onSuccess = jest.fn();
    render(<BatchRequisitionModal req={req()} workspace={workspace} onClose={jest.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByLabelText(/Xuất tiêu hao/));
    const submit = screen.getByRole('button', { name: /Xác nhận cấp 1 vật tư/ });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const fulfils = calls.filter((call) => call.url.includes('/fulfil'));
    expect(fulfils).toHaveLength(1);
    expect(fulfils[0]).toMatchObject({
      url: '/api/inventory/v1/requisitions/PR-B/fulfil',
      method: 'POST',
      body: { instanceId: INSTANCE_B, warehouseCode: 'KHO-01', lines: [{ materialCode: 'VT-01', quantity: 2 }] },
    });
    expect((fulfils[0].body as { assetCode?: string }).assetCode).toBeUndefined();
    // Lời báo vào hồ sơ Quy trình do server ghi qua sự kiện; trình duyệt không gọi API của Quy trình.
    expect(calls.some((call) => call.url.startsWith('/api/procedure/'))).toBe(false);
    expect(onSuccess.mock.calls[0][0]).toContain('PX-9');
  });

  it('server báo lỗi: hiện lời server', async () => {
    mockFetch((url) =>
      url.includes('/fulfil')
        ? { status: 409, body: { message: 'Yêu cầu PR-B chưa được duyệt xong ở Quy trình nên chưa cấp vật tư được.' } }
        : { body: {} },
    );
    render(<BatchRequisitionModal req={req()} workspace={workspace} onClose={jest.fn()} onSuccess={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/Xuất tiêu hao/));
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận cấp/ }));
    expect(await screen.findByText(/chưa được duyệt xong/)).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith('/comments'))).toBe(false);
  });

  it('hồ sơ chưa duyệt xong hoặc hàng serial chưa đủ serial: không cho cấp', () => {
    mockFetch(() => undefined);
    const { unmount } = render(
      <BatchRequisitionModal req={req({ status: 'running' })} workspace={workspace} onClose={jest.fn()} onSuccess={jest.fn()} />,
    );
    expect(screen.getByText(/chưa được duyệt xong ở Quy trình/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Xác nhận cấp/ }) as HTMLButtonElement).disabled).toBe(true);
    unmount();

    render(
      <BatchRequisitionModal
        req={req({ lines: [{ materialCode: 'SR-01', quantity: 2 }] })}
        workspace={workspace}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Xuất tiêu hao/));
    const submit = screen.getByRole('button', { name: /Xác nhận cấp/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Serial xuất của SR-01'), { target: { value: 'S-1, S-2' } });
    expect(submit.disabled).toBe(false);
    expect(parseSerialText('S-1, S-2\nS-3;')).toEqual(['S-1', 'S-2', 'S-3']);
  });
});
