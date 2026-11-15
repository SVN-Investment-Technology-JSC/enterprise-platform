import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import {
  INVENTORY_DASHBOARD_CARDS,
  InventoryPermissionsContext,
  MaterialForm,
  exportCatalogToExcel,
  visibleDashboardCards,
} from '@enterprise-platform/feature-inventory';

jest.mock('xlsx', () => ({
  utils: {
    json_to_sheet: jest.fn(() => ({})),
    book_new: jest.fn(() => ({})),
    book_append_sheet: jest.fn(),
  },
  writeFile: jest.fn(),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('../../../packages/shared/ui/src/lib/currency-format'),
  ...jest.requireActual('../../../packages/shared/ui/src/lib/vn-number-input'),
  ...jest.requireActual('../../../packages/shared/ui/src/lib/close-guard'),
  SearchableSelect: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

const PERMISSIONS = {
  canManage: true,
  canWriteTransactions: true,
  canWriteQuality: true,
  canApproveDocuments: true,
  canReadCost: true,
};

const material = {
  id: 'm1',
  code: 'VT-01',
  name: 'Vòng bi',
  category: 'SPARE_PART',
  unit: 'Cái',
  minStock: 0,
  maxStock: 0,
  isSerialized: false,
  isActive: true,
  kind: 'STOCK',
  purchasePrice: 1200,
} as never;

function exportedRows(showCost: boolean): Record<string, unknown>[] {
  jest.mocked(XLSX.utils.json_to_sheet).mockClear();
  exportCatalogToExcel({
    items: [{ code: 'VT-01', name: 'Vòng bi', kind: 'STOCK', available: 4 }],
    materialByCode: new Map([['VT-01', material]]),
    stockByCode: new Map([
      ['VT-01', [{ id: 's', warehouseId: 'w', materialId: 'm1', quantity: 4, quantityReserved: 0, quantityBlocked: 0, available: 4, updatedAt: '', warehouseCode: 'K1' }]],
    ]),
    showCost,
  });
  return jest.mocked(XLSX.utils.json_to_sheet).mock.calls[0][0] as Record<string, unknown>[];
}

describe('ẩn giá danh mục khi không có inventory.cost.read (ISS-BE-013)', () => {
  afterEach(cleanup);

  it('xuất Excel tồn chi tiết: có quyền thì có cột giá vốn, không quyền thì bỏ hẳn cột thay vì ghi 0', () => {
    const [withCost] = exportedRows(true);
    expect(withCost['Đơn giá vốn (VNĐ)']).toBe(1200);
    expect(withCost['Tổng giá trị tồn kho (VNĐ)']).toBe(4800);
    const [withoutCost] = exportedRows(false);
    expect(withoutCost).not.toHaveProperty('Đơn giá vốn (VNĐ)');
    expect(withoutCost).not.toHaveProperty('Tổng giá trị tồn kho (VNĐ)');
    expect(withoutCost['Tồn thực tế (On-hand)']).toBe(4);
  });

  it('thẻ Tổng giá trị kho chỉ hiện cho người có quyền xem giá', () => {
    const ids = (canReadCost: boolean) => visibleDashboardCards(INVENTORY_DASHBOARD_CARDS, canReadCost).map((card) => card.id);
    expect(ids(true)).toContain('metric.stockValue');
    expect(ids(false)).not.toContain('metric.stockValue');
    expect(ids(false)).toContain('metric.available');
  });

  it('form vật tư: không có quyền xem giá thì không có ô Đơn giá và lưu không gửi giá', async () => {
    const onSubmit = jest.fn();
    const renderForm = (canReadCost: boolean) =>
      render(
        <InventoryPermissionsContext.Provider value={{ ...PERMISSIONS, canReadCost }}>
          <MaterialForm editing={material} busy={false} onCancel={jest.fn()} onSubmit={onSubmit} />
        </InventoryPermissionsContext.Provider>,
      );
    renderForm(true);
    expect(screen.getByText(/Đơn giá/)).toBeTruthy();
    cleanup();

    const { container } = renderForm(false);
    expect(screen.queryByText(/Đơn giá/)).toBeNull();
    const form = container.querySelector('form');
    if (!form) throw new Error('missing form');
    fireEvent.submit(form);
    // Không quyền thì không gửi giá; Kho giữ giá đã khai khi trường vắng.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ code: 'VT-01', name: 'Vòng bi' });
    expect(onSubmit.mock.calls[0][0].purchasePrice).toBeUndefined();
  });
});
