import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RelatedObject, RelatedObjectKind, RelatedObjectList } from '@enterprise-platform/contracts-workspace';
import { listProjectRelatedObjects, listWorkItemRelatedObjects, removeRelatedObject } from '../workspace-api';
import { RelatedObjectsPanel, TabRelated } from './tab-related';

jest.mock('../workspace-api', () => ({
  listProjectRelatedObjects: jest.fn(),
  listWorkItemRelatedObjects: jest.fn(),
  removeRelatedObject: jest.fn(),
  addProjectRelatedObject: jest.fn(),
  addWorkItemRelatedObject: jest.fn(),
  searchRelatedObjects: jest.fn().mockResolvedValue({ items: [] }),
  loadDirectory: jest.fn().mockResolvedValue({ people: [], degraded: false }),
}));

jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

const list = listProjectRelatedObjects as jest.Mock;
const remove = removeRelatedObject as jest.Mock;

const CONTRACT: RelatedObjectKind = {
  key: 'crm.contract',
  moduleKey: 'crm',
  moduleLabel: 'Bán hàng',
  label: 'Hợp đồng bán',
  prefill: true,
};

const link = (patch: Partial<RelatedObject>): RelatedObject => ({
  id: 'r1',
  entityType: 'project',
  entityId: 'p1',
  projectId: 'p1',
  kind: 'crm.contract',
  moduleKey: 'crm',
  objectId: 'c1',
  code: 'HĐ-001',
  label: 'Công trình A',
  status: 'Hiệu lực',
  launchUrl: '/modules/crm/contracts/c1',
  kindLabel: 'Hợp đồng bán',
  moduleLabel: 'Bán hàng',
  fields: [],
  canRemove: false,
  createdBy: 'u1',
  createdByName: 'Nguyễn Văn A',
  createdAt: '2026-11-20T03:00:00.000Z',
  ...patch,
});

const DATA: RelatedObjectList = {
  canAdd: true,
  degraded: true,
  items: [
    link({
      id: 'r1',
      canRemove: true,
      fields: [
        { key: 'value', label: 'Giá trị', type: 'money', value: 1_200_000 },
        { key: 'signed', label: 'Ngày ký', type: 'date', value: '2026-11-05' },
        { key: 'note', label: 'Ghi chú', type: 'text', value: null },
      ],
    }),
    link({
      id: 'r2',
      objectId: 'q1',
      kind: 'crm.quote',
      kindLabel: 'Báo giá',
      code: 'BG-010',
      label: 'Báo giá điện',
      status: undefined,
      entityType: 'work_item',
      entityId: 'w1',
      entityLabel: 'CV-001 · Khảo sát',
      unavailableReason: 'forbidden',
    }),
  ],
};

beforeEach(() => {
  list.mockReset();
  remove.mockReset();
  list.mockResolvedValue(DATA);
  remove.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

const plain = (text: string | null) => (text ?? '').replace(/\u00a0/g, ' ');

describe('TabRelated', () => {
  it('gom theo tên loại, hiện thông tin đầy đủ và báo khi chưa tải đủ', async () => {
    const onCount = jest.fn();
    render(<TabRelated projectId="p1" items={[]} kinds={[CONTRACT]} onCount={onCount} />);

    await screen.findByText('Một số thông tin tạm thời chưa tải được, đang hiện thông tin đã lưu.');
    expect(onCount).toHaveBeenCalledWith(2);
    expect(screen.getByRole('heading', { name: /^Hợp đồng bán/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Báo giá/ })).toBeTruthy();
    expect(screen.queryByText(/Bán hàng/)).toBeNull();

    const open = screen.getByRole('link', { name: /HĐ-001 — Công trình A/ });
    expect(open.getAttribute('href')).toBe('/modules/crm/contracts/c1');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(plain(screen.getByText(/1\.200\.000/).textContent)).toBe('1.200.000 ₫');
    expect(screen.getByText('05/11/2026')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText(/^Gắn vào Dự án · /)).toBeTruthy();
    expect(screen.getByText(/^Gắn vào CV-001 · Khảo sát · /)).toBeTruthy();
    // Giờ phụ thuộc múi giờ máy chạy test: chỉ so phần ngày.
    expect(screen.getAllByText(/Nguyễn Văn A · 20\/11\/2026/)).toHaveLength(2);
  });

  it('không có quyền xem thì chỉ hiện nhãn đã lưu, không mở được, không có nút gỡ', async () => {
    render(<TabRelated projectId="p1" items={[]} kinds={[CONTRACT]} />);
    await screen.findByText('Bạn không có quyền xem chi tiết');
    expect(screen.queryByRole('link', { name: /BG-010/ })).toBeNull();
    expect(screen.getByText('BG-010 — Báo giá điện')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Gỡ liên kết/ })).toHaveLength(1);
  });

  it('gỡ liên kết qua hộp xác nhận rồi tải lại danh sách', async () => {
    render(<TabRelated projectId="p1" items={[]} kinds={[CONTRACT]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ liên kết HĐ-001 — Công trình A' }));
    expect(screen.getByText('Hồ sơ gốc không bị ảnh hưởng.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('báo trống khi chưa có liên kết, không có nút thêm khi không được thêm', async () => {
    list.mockResolvedValue({ items: [], canAdd: false, degraded: false });
    render(<TabRelated projectId="p1" items={[]} kinds={[CONTRACT]} />);
    await screen.findByText('Chưa có đối tượng liên quan.');
    expect(screen.queryByRole('button', { name: /Thêm liên kết/ })).toBeNull();
  });

  it('danh sách của một công việc: đọc liên kết của việc đó, không có ô lọc "Gắn vào"', async () => {
    const workItemList = listWorkItemRelatedObjects as jest.Mock;
    workItemList.mockResolvedValue({
      canAdd: true,
      degraded: false,
      items: [link({ id: 'r5', entityType: 'work_item', entityId: 'w1', entityLabel: 'CV-001 · Khảo sát' })],
    });
    const onCount = jest.fn();
    render(<RelatedObjectsPanel target={{ type: 'work_item', id: 'w1' }} items={[]} kinds={[CONTRACT]} onCount={onCount} />);
    await screen.findByRole('link', { name: /HĐ-001 — Công trình A/ });
    expect(workItemList).toHaveBeenCalledWith('w1');
    expect(list).not.toHaveBeenCalled();
    expect(onCount).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('group', { name: 'Lọc theo nơi gắn' })).toBeNull();
    expect(screen.queryByText(/Gắn vào/)).toBeNull();
  });
});
