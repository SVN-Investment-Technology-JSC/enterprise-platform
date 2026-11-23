import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Asset } from '@enterprise-platform/contracts-inventory';
import {
  AssetDetail,
  InventoryPermissionsContext,
  assetLocationChain,
} from '@enterprise-platform/feature-inventory';

// Cây tài sản (ISS-UI-003): không hiện thông số, vị trí, lịch sử, chỉ số hay mã QR bịa.
const mockUpdateAsset = jest.fn();
const mockLoadHistory = jest.fn();

jest.mock('../../../packages/features/inventory/src/lib/inventory-api', () => ({
  updateAsset: (...args: unknown[]) => mockUpdateAsset(...args),
  loadMaintenanceHistoryForAsset: (...args: unknown[]) => mockLoadHistory(...args),
  createMaintenanceIncidentForAsset: jest.fn(),
  loadAssetDocuments: jest.fn(async () => []),
  loadAssetSpareParts: jest.fn(async () => []),
}));

const FABRICATED = [
  'Siemens',
  'SKF',
  'SN-2024-8892',
  '-20°C ~ +85°C',
  '100 Bar',
  'Factory (Plant 1)',
  'Khu vực Turbine T1',
  'QR-AMM-',
  'WO-2026-0412',
  'Nguyễn Văn A',
  '99.8%',
  '2.4 giờ',
  'Cấp 1 — Bảo dưỡng hàng tháng',
];

function asset(patch: Partial<Asset> = {}): Asset {
  return {
    id: 'a-22323',
    code: '22323',
    name: 'Máy bơm 22323',
    type: 'EQUIPMENT',
    status: 'OPERATING',
    criticality: 'MEDIUM',
    taskTemplate: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...patch,
  };
}

function renderDetail(props: { asset: Asset; assets?: Asset[]; canManage?: boolean }) {
  const onSaved = jest.fn();
  const view = render(
    <InventoryPermissionsContext.Provider
      value={{
        canManage: props.canManage ?? true,
        canWriteTransactions: false,
        canWriteQuality: false,
        canApproveDocuments: false,
        canCreateStocktake: false,
        canApproveStocktake: false,
      }}
    >
      <AssetDetail asset={props.asset} assets={props.assets} onSaved={onSaved} />
    </InventoryPermissionsContext.Provider>,
  );
  return { ...view, onSaved };
}

function expectNoFabricated(container: HTMLElement) {
  const text = container.textContent ?? '';
  for (const value of FABRICATED) expect(text).not.toContain(value);
}

describe('AssetDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadHistory.mockResolvedValue(undefined);
    mockUpdateAsset.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('tài sản chưa có thông số: báo "Chưa nhập thông số kỹ thuật", nút "Khai báo", không có dữ liệu bịa', async () => {
    const { container } = renderDetail({ asset: asset() });
    await waitFor(() => expect(mockLoadHistory).toHaveBeenCalledWith('22323'));
    expect(screen.getByText('Chưa nhập thông số kỹ thuật')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Khai báo' })).toBeTruthy();
    expect(screen.getByText('Chưa có vị trí')).toBeTruthy();
    expect(screen.getByText('Chưa có mã QR')).toBeTruthy();
    // Hãng, serial, năm sản xuất thiếu thì "—".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expectNoFabricated(container);
  });

  it('mở form khai báo trên tài sản rỗng rồi lưu ngay: gửi specs rỗng, không có giá trị bịa', async () => {
    renderDetail({ asset: asset() });
    fireEvent.click(screen.getByRole('button', { name: 'Khai báo' }));
    // Form mở với giá trị thật: không có dòng nào.
    expect(screen.queryAllByPlaceholderText('VD: Điện áp định mức, Công suất…')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông số' }));
    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalledTimes(1));
    expect(mockUpdateAsset).toHaveBeenCalledWith('22323', { specs: {} });
  });

  it('form sửa nạp đúng thông số thật đã khai báo', async () => {
    renderDetail({ asset: asset({ specs: { 'Công suất': '15 kW', 'Điện áp': '380 V' } }) });
    expect(screen.getByText('15 kW')).toBeTruthy();
    expect(screen.queryByText('Chưa nhập thông số kỹ thuật')).toBeNull();
    const section = screen.getByText('Thông số kỹ thuật & Đặc tính danh định').closest('section') as HTMLElement;
    fireEvent.click(within(section).getByRole('button', { name: 'Chỉnh sửa' }));
    const keys = within(section)
      .getAllByPlaceholderText('VD: Điện áp định mức, Công suất…')
      .map((input) => (input as HTMLInputElement).value);
    expect(keys).toEqual(['Công suất', 'Điện áp']);
    fireEvent.click(within(section).getByRole('button', { name: 'Lưu thông số' }));
    await waitFor(() =>
      expect(mockUpdateAsset).toHaveBeenCalledWith('22323', { specs: { 'Công suất': '15 kW', 'Điện áp': '380 V' } }),
    );
  });

  it('hiện hãng, serial, năm sản xuất, mã QR và vị trí theo chuỗi tài sản cha', async () => {
    const root = asset({ id: 'a-root', code: 'TRAM-1', name: 'Trạm biến áp Savina' });
    const parent = asset({ id: 'a-parent', code: 'MBA-1', name: 'Máy biến áp T1', parentId: 'a-root' });
    const child = asset({
      parentId: 'a-parent',
      manufacturer: 'ABB',
      serialNumber: 'SR-778',
      manufactureYear: 2019,
      qrCode: 'QR-THAT-001',
    });
    const { container } = renderDetail({ asset: child, assets: [root, parent, child] });
    await waitFor(() => expect(mockLoadHistory).toHaveBeenCalled());
    expect(screen.getByTestId('asset-location').textContent).toBe('Trạm biến áp Savina › Máy biến áp T1');
    expect(screen.getByText('ABB')).toBeTruthy();
    expect(screen.getAllByText('SR-778').length).toBeGreaterThan(0);
    expect(screen.getByText('2019')).toBeTruthy();
    expect(screen.getByText('Mã quét: QR-THAT-001')).toBeTruthy();
    expectNoFabricated(container);
  });

  it('tab lịch sử và kế hoạch bảo trì: trạng thái rỗng, MTTR và độ sẵn sàng là "—"', async () => {
    const { container } = renderDetail({ asset: asset({ code: 'AST-001' }) });
    await waitFor(() => expect(mockLoadHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: /Lịch sử vận hành/ }));
    expect(
      screen.getByText('Chưa có sự kiện hoặc nhật ký vận hành nào được ghi nhận cho thiết bị này.'),
    ).toBeTruthy();
    const availability = screen.getByText('Tỷ lệ sẵn sàng').closest('div')?.parentElement;
    expect(availability?.textContent).toContain('—');
    const mttr = screen.getByText('Chỉ số MTTR').closest('div')?.parentElement;
    expect(mttr?.textContent).toContain('—');
    expectNoFabricated(container);

    fireEvent.click(screen.getByRole('tab', { name: /Kế hoạch bảo trì/ }));
    expect(screen.getByText('Chưa có kế hoạch bảo dưỡng định kỳ nào cho thiết bị này.')).toBeTruthy();
    expectNoFabricated(container);
  });

  it('kế hoạch bảo trì lấy từ lệnh bảo dưỡng định kỳ thật của module Bảo trì', async () => {
    mockLoadHistory.mockResolvedValue({
      items: [
        {
          id: 'occ-1',
          kind: 'preventive',
          code: 'BT-0001',
          title: 'Bảo dưỡng quý IV',
          status: 'planned',
          priority: 'Normal',
          dueAt: '2026-12-01T00:00:00Z',
        },
      ],
      stats: { total: 1, completed: 0, onTimeRate: 0 },
    });
    renderDetail({ asset: asset() });
    await waitFor(() => expect(mockLoadHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: /Kế hoạch bảo trì/ }));
    expect(await screen.findByText('Bảo dưỡng quý IV')).toBeTruthy();
    expect(screen.getByText('Đã lên lịch')).toBeTruthy();
  });

  it('assetLocationChain dừng khi gặp vòng lặp hoặc cha không có trong danh sách', () => {
    const a = asset({ id: 'a', name: 'A', parentId: 'b' });
    const b = asset({ id: 'b', name: 'B', parentId: 'a' });
    expect(assetLocationChain(a, [a, b])).toEqual(['B']);
    expect(assetLocationChain(asset({ id: 'x', parentId: 'missing' }), [])).toEqual([]);
  });
});
