/** @jest-environment jsdom */
import {
  deliverAssistantAction,
  setAssistantResultSink,
} from '@enterprise-platform/feature-module-shell';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MaintenanceAssistantFormPage } from './maintenance-assistant-form';
import {
  createMaintenanceIncident,
  loadAssistantActionKeys,
  loadMaintenanceMatrix,
  loadTenantMembers,
  uploadOccurrenceAttachment,
} from './maintenance-api';

jest.mock('./maintenance-api', () => ({
  ...jest.requireActual('./maintenance-api'),
  createMaintenanceIncident: jest.fn(),
  loadAssistantActionKeys: jest.fn(),
  loadMaintenanceMatrix: jest.fn(),
  loadTenantMembers: jest.fn(),
  uploadOccurrenceAttachment: jest.fn(),
}));

const KEY = 'maintenance.incident.create';

const MATRIX = {
  availableAssets: [],
  rows: [
    {
      asset: { code: 'WTG-01', name: 'Tua bin số 1', type: 'WTG' },
      cells: {},
      priority: 'Normal',
    },
  ],
  procedureCatalog: [
    {
      definitionId: 'def-1',
      code: 'QT-SC',
      name: 'Xử lý sự cố',
      versionNumber: 1,
      status: 'published',
      synchronizedAt: '2026-10-01T00:00:00Z',
    },
  ],
  assetDirectoryAvailable: true,
};

type Result = Parameters<NonNullable<Parameters<typeof setAssistantResultSink>[0]>>[0];

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock;

let results: Result[];
let sequence = 0;

/** Card gửi bản nháp cho trang form nhúng (lần đầu, hoặc sửa tiếp cùng `requestId`). */
function deliver(draft: Record<string, unknown>, requestId = `incident-${++sequence}`): string {
  act(() => deliverAssistantAction({ key: KEY, requestId, draft }));
  return requestId;
}

beforeEach(() => {
  jest.clearAllMocks();
  results = [];
  setAssistantResultSink((result) => results.push(result));
  mocked(loadMaintenanceMatrix).mockResolvedValue(MATRIX);
  mocked(loadTenantMembers).mockResolvedValue([{ userId: 'u-1', displayName: 'Nguyễn Văn Bình' }]);
  mocked(loadAssistantActionKeys).mockResolvedValue(new Set([KEY]));
});

afterEach(() => setAssistantResultSink(undefined));

describe('MaintenanceAssistantFormPage', () => {
  it('shows the incident form inline in the card, filled from the draft', async () => {
    render(<MaintenanceAssistantFormPage />);
    deliver({
      assetCode: 'wtg-01',
      title: 'Tua bin dừng đột ngột',
      priority: 'low',
      assigneeId: 'u-1',
    });

    expect(await screen.findByRole('heading', { name: 'Tạo sự cố bảo trì' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByDisplayValue('Tua bin dừng đột ngột')).toBeTruthy();
    expect(screen.getByText('Tua bin số 1')).toBeTruthy();
    // Ô chọn hiện nhãn của giá trị sau khi render xong (effect của SearchableSelect).
    expect(await screen.findByDisplayValue('Thấp')).toBeTruthy();
    expect(await screen.findByDisplayValue('Nguyễn Văn Bình')).toBeTruthy();
    expect(results).toEqual([]);
  });

  it('applies a follow-up draft only to the fields it carries', async () => {
    render(<MaintenanceAssistantFormPage />);
    const requestId = deliver({ title: 'Tua bin dừng', description: 'Lúc 9 giờ' });
    fireEvent.change(await screen.findByDisplayValue('Tua bin dừng'), {
      target: { value: 'Tua bin dừng do mất lưới' },
    });

    deliver({ description: 'Lúc 9 giờ 15' }, requestId);

    expect(await screen.findByDisplayValue('Lúc 9 giờ 15')).toBeTruthy();
    expect(screen.getByDisplayValue('Tua bin dừng do mất lưới')).toBeTruthy();
  });

  it('validates like the main form before calling the API', async () => {
    render(<MaintenanceAssistantFormPage />);
    deliver({ title: 'Tua bin dừng' });
    await screen.findByDisplayValue('Tua bin dừng');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo sự cố' }));

    expect(await screen.findByText('Vui lòng chọn thiết bị phát sinh sự cố')).toBeTruthy();
    expect(createMaintenanceIncident).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('saves with the Maintenance API, uploads the files, then reports the new incident', async () => {
    const order: string[] = [];
    mocked(createMaintenanceIncident).mockResolvedValue({
      id: 'occ-1',
      code: 'INC-0042',
      title: 'Tua bin dừng',
    });
    mocked(uploadOccurrenceAttachment).mockImplementation(async () => {
      order.push('upload');
      return {};
    });
    setAssistantResultSink((result) => {
      order.push('report');
      results.push(result);
    });
    render(<MaintenanceAssistantFormPage />);
    const requestId = deliver({ assetCode: 'WTG-01', title: 'Tua bin dừng' });
    await screen.findByDisplayValue('Tua bin dừng');
    const file = new File(['x'], 'hien-truong.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Tải tệp lên'), { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Tạo sự cố' }));

    await waitFor(() => expect(results).toHaveLength(1));
    expect(createMaintenanceIncident).toHaveBeenCalledWith(
      expect.objectContaining({ assetCode: 'WTG-01', title: 'Tua bin dừng', priority: 'High' }),
    );
    expect(uploadOccurrenceAttachment).toHaveBeenCalledWith('occ-1', file);
    expect(order).toEqual(['upload', 'report']);
    expect(results[0]).toEqual({
      requestId,
      key: KEY,
      outcome: 'saved',
      id: 'occ-1',
      label: 'INC-0042 · Tua bin dừng',
      href: '/modules/maintenance#history/occ-1',
    });
  });

  it('keeps the form open with the API error so the user can fix and retry', async () => {
    mocked(createMaintenanceIncident).mockRejectedValueOnce(
      new Error('Không tìm thấy thiết bị “WTG-01” trong Kho.'),
    );
    render(<MaintenanceAssistantFormPage />);
    deliver({ assetCode: 'WTG-01', title: 'Tua bin dừng' });
    await screen.findByDisplayValue('Tua bin dừng');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo sự cố' }));

    expect(await screen.findByText('Không tìm thấy thiết bị “WTG-01” trong Kho.')).toBeTruthy();
    expect(screen.getByDisplayValue('Tua bin dừng')).toBeTruthy();
    expect(results).toEqual([]);
  });

  it('reports cancelled when the user closes the form', async () => {
    render(<MaintenanceAssistantFormPage />);
    const requestId = deliver({ title: 'Tua bin dừng' });
    await screen.findByDisplayValue('Tua bin dừng');

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(results).toEqual([{ requestId, key: KEY, outcome: 'cancelled' }]);
    expect(screen.queryByRole('heading', { name: 'Tạo sự cố bảo trì' })).toBeNull();
  });

  it('reports unavailable instead of opening the form without the permission', async () => {
    mocked(loadAssistantActionKeys).mockResolvedValue(new Set());
    render(<MaintenanceAssistantFormPage />);
    const requestId = deliver({ title: 'Tua bin dừng' });

    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toEqual({
      requestId,
      key: KEY,
      outcome: 'unavailable',
      message: 'Bạn không có quyền tạo sự cố bảo trì.',
    });
    expect(screen.queryByRole('heading', { name: 'Tạo sự cố bảo trì' })).toBeNull();
  });
});
