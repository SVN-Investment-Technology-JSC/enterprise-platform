import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ProjectSummary,
  RelatedObject,
  RelatedObjectKind,
} from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';
import * as api from '../workspace-api';
import { ProjectForm } from './project-form';

// Form dự án gọi nhiều API phụ trợ; ở đây chỉ cần chúng trả rỗng, trừ các API của "Đối tượng liên quan".
jest.mock('../workspace-api', () => ({
  listProjectTypes: jest.fn().mockResolvedValue({ items: [] }),
  listProjectGroups: jest.fn().mockResolvedValue({ items: [], canEdit: false }),
  listProjectReportGroups: jest.fn().mockResolvedValue({ items: [], canEdit: false }),
  setProjectReportGroup: jest.fn(),
  listCustomers: jest.fn().mockResolvedValue([]),
  loadProjectArchiveSettings: jest.fn().mockResolvedValue({
    autoArchive: false,
    defaultTasksEnabled: false,
    defaultTaskTitles: [],
    defaultProgressMethod: 'manual',
  }),
  searchCrmCustomers: jest.fn().mockResolvedValue({ enabled: false, items: [] }),
  previewProjectCode: jest.fn().mockResolvedValue({ code: 'DA-001' }),
  loadDirectory: jest.fn().mockResolvedValue({ people: [], degraded: false }),
  listProjectRoles: jest.fn().mockResolvedValue({ items: [], canEdit: false }),
  listTags: jest.fn().mockResolvedValue({ items: [] }),
  listRelatedObjectKinds: jest.fn(),
  searchRelatedObjects: jest.fn(),
  listProjectRelatedObjects: jest.fn(),
  addProjectRelatedObject: jest.fn(),
  removeRelatedObject: jest.fn(),
  linkCrmCustomer: jest.fn(),
  createCustomer: jest.fn(),
  getRelatedObjectCreateForm: jest.fn(),
  createRelatedObjectRecord: jest.fn(),
}));

jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;

const CONTRACT: RelatedObjectKind = {
  key: 'crm.contract',
  moduleKey: 'crm',
  moduleLabel: 'Bán hàng',
  label: 'Hợp đồng bán',
  prefill: true,
};

const PROJECT = {
  id: 'p1',
  code: 'DA-001',
  name: 'Lắp trạm A',
  status: 'planning',
  progressMethod: 'manual',
  tagIds: [],
  customerId: 'k1',
} as unknown as ProjectSummary;

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
  launchUrl: '/modules/crm/contracts/c1',
  kindLabel: 'Hợp đồng bán',
  moduleLabel: 'Bán hàng',
  fields: [],
  canRemove: true,
  createdBy: 'u1',
  createdAt: '2026-11-20T03:00:00.000Z',
  ...patch,
});

beforeAll(() => {
  // Ô chọn ngày của antd cần matchMedia và ResizeObserver; jsdom chưa có.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
});

beforeEach(() => {
  mocked.listCustomers.mockResolvedValue([{ id: 'k1', code: 'KH01', name: 'Công ty A' } as never]);
  mocked.listRelatedObjectKinds.mockResolvedValue({ kinds: [CONTRACT] });
  mocked.searchRelatedObjects.mockResolvedValue({
    items: [
      { kind: 'crm.contract', id: 'c1', code: 'HĐ-001', label: 'Công trình A' },
      { kind: 'crm.contract', id: 'c3', code: 'HĐ-003', label: 'Công trình C' },
    ],
  });
  mocked.addProjectRelatedObject.mockResolvedValue({} as RelatedObject);
  mocked.removeRelatedObject.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const nameInput = () => document.querySelector('input[maxlength="180"][required]') as HTMLInputElement;

/** Mở dòng chọn hồ sơ thứ `index` rồi chọn hồ sơ có nhãn `label`. */
async function pickRecord(index: number, label: RegExp) {
  await waitFor(() => expect(mocked.searchRelatedObjects).toHaveBeenCalled());
  const group = await screen.findByRole('group', { name: `Đối tượng liên quan ${index}: hồ sơ` });
  fireEvent.click(within(group).getByRole('textbox'));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

/** Chọn khách hàng đầu tiên trong ô "Khách hàng". */
async function pickCustomer() {
  fireEvent.click(await screen.findByPlaceholderText(/Chọn khách hàng/));
  fireEvent.click(await screen.findByRole('option', { name: /KH01 · Công ty A/ }));
}

describe('ProjectForm: khách hàng bắt buộc', () => {
  it('tạo dự án mà chưa chọn khách hàng thì báo lỗi và không gửi', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);
    render(<ProjectForm open onClose={jest.fn()} onCreate={onCreate} onUpdate={jest.fn()} />);
    await screen.findByPlaceholderText(/Chọn khách hàng/);
    fireEvent.change(nameInput(), { target: { value: 'Dự án mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Chọn khách hàng cho dự án.'));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('sửa dự án cũ chưa có khách hàng cũng phải chọn khách hàng mới lưu được', async () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined);
    render(
      <ProjectForm
        open
        project={{ ...PROJECT, customerId: undefined }}
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onUpdate={onUpdate}
      />,
    );
    await screen.findByPlaceholderText(/Chọn khách hàng/);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Chọn khách hàng cho dự án.'));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('ProjectForm: đối tượng liên quan', () => {
  it('form tạo không có ô "Tạo từ"; hồ sơ chọn trong khối được gửi kèm khi tạo', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);
    render(<ProjectForm open financeEnabled onClose={jest.fn()} onCreate={onCreate} onUpdate={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Đối tượng liên quan/ }));
    expect(screen.queryByText('Tạo từ')).toBeNull();
    await pickRecord(1, /HĐ-001 — Công trình A/);

    fireEvent.change(nameInput(), { target: { value: 'Dự án mới' } });
    await pickCustomer();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][3]).toEqual([expect.objectContaining({ kind: 'crm.contract', objectId: 'c1' })]);
  });

  it('form sửa: hiện liên kết đã lưu; gỡ và thêm chạy sau khi dự án đã lưu', async () => {
    mocked.listProjectRelatedObjects.mockResolvedValue({
      canAdd: true,
      degraded: false,
      items: [
        link({ id: 'r1' }),
        link({ id: 'r2', objectId: 'c2', code: 'HĐ-002', label: 'Công trình B', canRemove: false }),
        // Liên kết gắn ở công việc không thuộc form dự án.
        link({ id: 'r3', objectId: 'c9', code: 'HĐ-009', entityType: 'work_item', entityId: 'w1' }),
      ],
    });
    const order: string[] = [];
    const onUpdate = jest.fn(async () => {
      order.push('update');
    });
    mocked.removeRelatedObject.mockImplementation(async () => {
      order.push('remove');
    });
    const onRelatedChanged = jest.fn();
    render(
      <ProjectForm
        open
        project={PROJECT}
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onUpdate={onUpdate}
        onRelatedChanged={onRelatedChanged}
      />,
    );

    // Có liên kết đã lưu thì khối mở sẵn; liên kết không gỡ được thì không có nút X.
    await screen.findByText('HĐ-001 — Công trình A');
    expect(screen.getByText('HĐ-002 — Công trình B')).toBeTruthy();
    expect(screen.queryByText(/HĐ-009/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bỏ đối tượng liên quan 2' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ đối tượng liên quan 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng đối tượng liên quan' }));
    await pickRecord(2, /HĐ-003 — Công trình C/);

    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() =>
      expect(mocked.addProjectRelatedObject).toHaveBeenCalledWith('p1', { kind: 'crm.contract', objectId: 'c3' }),
    );
    expect(mocked.removeRelatedObject).toHaveBeenCalledWith('r1');
    expect(mocked.removeRelatedObject).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['update', 'remove']);
    expect(onRelatedChanged).toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('form sửa: gỡ lỗi chỉ cảnh báo, dự án vẫn lưu; không được thêm thì không có nút "+"', async () => {
    mocked.listProjectRelatedObjects.mockResolvedValue({ canAdd: false, degraded: false, items: [link({ id: 'r1' })] });
    mocked.removeRelatedObject.mockRejectedValue({ message: 'Không có quyền.' });
    const onUpdate = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<ProjectForm open project={PROJECT} onClose={onClose} onCreate={jest.fn()} onUpdate={onUpdate} />);
    // Nhãn hiện cả ở dòng tóm tắt đầu khối lẫn ở dòng liên kết.
    await screen.findAllByText('HĐ-001 — Công trình A');
    expect(screen.queryByRole('button', { name: 'Thêm dòng đối tượng liên quan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ đối tượng liên quan 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      'Chưa gỡ được 1 đối tượng liên quan khỏi dự án DA-001: HĐ-001 — Công trình A (Không có quyền).',
    );
  });

  it('không có loại nào thì không có khối đối tượng liên quan ở form tạo', async () => {
    mocked.listRelatedObjectKinds.mockResolvedValue({ kinds: [] });
    // Danh sách loại được giữ một phút cho cả trang; cho đồng hồ qua mốc đó để form hỏi lại server.
    const realNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 120_000);
    try {
      render(<ProjectForm open financeEnabled onClose={jest.fn()} onCreate={jest.fn()} onUpdate={jest.fn()} />);
      await waitFor(() => expect(mocked.listRelatedObjectKinds).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole('button', { name: /Đối tượng liên quan/ })).toBeNull());
      expect(nameInput()).toBeTruthy();
    } finally {
      clock.mockRestore();
    }
  });
});

describe('ProjectForm: tạo nhanh khách hàng ở Bán hàng', () => {
  const CUSTOMER_KIND: RelatedObjectKind = {
    key: 'crm.customer',
    moduleKey: 'crm',
    moduleLabel: 'Bán hàng',
    label: 'Khách hàng',
    prefill: true,
    create: true,
  };

  /** Danh sách loại được giữ một phút cho cả trang; mỗi ca cho đồng hồ qua xa mốc đó để form hỏi lại server. */
  function withFreshKinds(offsetMs: number) {
    const realNow = Date.now();
    return jest.spyOn(Date, 'now').mockReturnValue(realNow + offsetMs);
  }

  it('nút "+" cạnh ô khách mở form của Bán hàng; tạo xong thì gắn bản sao và chọn luôn', async () => {
    const clock = withFreshKinds(10 * 60_000);
    try {
      mocked.searchCrmCustomers.mockResolvedValue({ enabled: true, items: [] });
      mocked.listRelatedObjectKinds.mockResolvedValue({ kinds: [CONTRACT, CUSTOMER_KIND] });
      mocked.getRelatedObjectCreateForm.mockResolvedValue({
        kind: 'crm.customer',
        title: 'Thêm khách hàng',
        fields: [{ key: 'name', label: 'Tên khách hàng', type: 'text', required: true }],
      });
      mocked.createRelatedObjectRecord.mockResolvedValue({
        kind: 'crm.customer',
        id: 'crm-9',
        code: 'KH009',
        label: 'KH009 — Công ty B',
        launchUrl: '/modules/crm#customers/crm-9',
        fields: [],
        upstream: [],
      });
      mocked.linkCrmCustomer.mockResolvedValue({ id: 'k9', code: 'KH009', name: 'Công ty B', crmCustomerId: 'crm-9' } as never);
      render(<ProjectForm open onClose={jest.fn()} onCreate={jest.fn()} onUpdate={jest.fn()} />);

      await screen.findByPlaceholderText(/Chọn khách hàng từ CRM/);
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm khách hàng mới' }));
      expect(screen.queryByText('Tạo khách hàng ở CRM')).toBeNull();
      await waitFor(() => expect(mocked.getRelatedObjectCreateForm).toHaveBeenCalledWith('crm.customer'));
      fireEvent.change(await screen.findByLabelText('Tên khách hàng'), { target: { value: 'Công ty B' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));

      await waitFor(() => expect(mocked.linkCrmCustomer).toHaveBeenCalledWith('crm-9'));
      expect(mocked.createRelatedObjectRecord).toHaveBeenCalledWith('crm.customer', { values: { name: 'Công ty B' } });
      await waitFor(() =>
        expect((screen.getByPlaceholderText(/Chọn khách hàng/) as HTMLInputElement).value).toBe('KH009 · Công ty B'),
      );
    } finally {
      clock.mockRestore();
    }
  });

  it('không có quyền tạo khách ở CRM thì nút + vẫn có nhưng bị khoá', async () => {
    const clock = withFreshKinds(20 * 60_000);
    try {
      mocked.searchCrmCustomers.mockResolvedValue({ enabled: true, items: [] });
      mocked.listRelatedObjectKinds.mockResolvedValue({ kinds: [{ ...CUSTOMER_KIND, create: undefined }] });
      render(<ProjectForm open onClose={jest.fn()} onCreate={jest.fn()} onUpdate={jest.fn()} />);
      await waitFor(() => expect(mocked.listRelatedObjectKinds).toHaveBeenCalled());
      await waitFor(() =>
        expect((screen.getByRole('button', { name: 'Thêm khách hàng mới' }) as HTMLButtonElement).disabled).toBe(true),
      );
      expect(screen.queryByText('Tạo khách hàng ở CRM')).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
});

describe('ProjectForm: nhóm báo cáo', () => {
  const CATALOG = {
    items: [
      { id: 'g-dv', name: 'Dịch vụ', sortOrder: 0 },
      { id: 'g-tn', name: 'Thí nghiệm', sortOrder: 1 },
    ],
    canEdit: false,
  };

  // Khối "tạo nhanh khách hàng ở Bán hàng" bật chế độ Bán hàng cho các test sau; ở đây cần danh mục khách của Workspace.
  beforeEach(() => {
    mocked.searchCrmCustomers.mockResolvedValue({ enabled: false, items: [] });
  });

  it('tenant chưa lập danh mục thì không có ô "Nhóm báo cáo"', async () => {
    render(<ProjectForm open onClose={jest.fn()} onCreate={jest.fn()} onUpdate={jest.fn()} />);
    await screen.findByPlaceholderText(/Chọn khách hàng/);
    expect(screen.queryByRole('group', { name: 'Nhóm báo cáo' })).toBeNull();
  });

  it('form tạo: nhóm chọn được gửi kèm cho nơi gọi (tham số thứ năm)', async () => {
    mocked.listProjectReportGroups.mockResolvedValueOnce(CATALOG);
    const onCreate = jest.fn().mockResolvedValue(undefined);
    render(<ProjectForm open onClose={jest.fn()} onCreate={onCreate} onUpdate={jest.fn()} />);
    fireEvent.change(nameInput(), { target: { value: 'Dự án mới' } });
    await pickCustomer();
    const group = await screen.findByRole('group', { name: 'Nhóm báo cáo' });
    fireEvent.click(within(group).getByRole('textbox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Thí nghiệm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][4]).toBe('g-tn');
    expect(mocked.setProjectReportGroup).not.toHaveBeenCalled();
  });

  it('form sửa: chỉ gọi API nhóm báo cáo khi đổi, và trước khi lưu dự án', async () => {
    mocked.listProjectReportGroups.mockResolvedValueOnce(CATALOG);
    mocked.listProjectRelatedObjects.mockResolvedValue({ canAdd: false, degraded: false, items: [] });
    const order: string[] = [];
    mocked.setProjectReportGroup.mockImplementation(async () => {
      order.push('report-group');
      return PROJECT;
    });
    const onUpdate = jest.fn(async () => {
      order.push('update');
    });
    render(
      <ProjectForm
        open
        project={{ ...PROJECT, reportGroupId: 'g-dv' }}
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onUpdate={onUpdate}
      />,
    );
    const group = await screen.findByRole('group', { name: 'Nhóm báo cáo' });
    await within(group).findByDisplayValue('Dịch vụ');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(mocked.setProjectReportGroup).not.toHaveBeenCalled();
  });

  it('form sửa: bỏ nhóm thì gửi null trước khi lưu dự án', async () => {
    mocked.listProjectReportGroups.mockResolvedValueOnce(CATALOG);
    mocked.listProjectRelatedObjects.mockResolvedValue({ canAdd: false, degraded: false, items: [] });
    const order: string[] = [];
    mocked.setProjectReportGroup.mockImplementation(async () => {
      order.push('report-group');
      return PROJECT;
    });
    const onUpdate = jest.fn(async () => {
      order.push('update');
    });
    render(
      <ProjectForm
        open
        project={{ ...PROJECT, reportGroupId: 'g-dv' }}
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onUpdate={onUpdate}
      />,
    );
    const group = await screen.findByRole('group', { name: 'Nhóm báo cáo' });
    fireEvent.click(await within(group).findByDisplayValue('Dịch vụ'));
    fireEvent.click(await screen.findByRole('option', { name: 'Chưa có nhóm báo cáo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(mocked.setProjectReportGroup).toHaveBeenCalledWith('p1', { reportGroupId: null });
    expect(order).toEqual(['report-group', 'update']);
  });
});
