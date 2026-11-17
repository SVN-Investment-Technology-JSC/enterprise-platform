import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  ICON_SLOTS,
  createDocument,
  createShape,
  type BrandSlotAssignment,
} from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { assignSlot, clearSlot, listSlots } from '../store/brand-api';
import { useBrandSettings, useIconLibrary } from '../store';
import { SlotsPage } from './slots-page';

jest.mock('../store/brand-api', () => ({
  ...jest.requireActual('../store/brand-api'),
  listSlots: jest.fn(),
  assignSlot: jest.fn(),
  clearSlot: jest.fn(),
}));

jest.mock('../store', () => ({
  useBrandSettings: jest.fn(),
  useIconLibrary: jest.fn(),
}));

const mockListSlots = jest.mocked(listSlots);
const mockAssignSlot = jest.mocked(assignSlot);
const mockClearSlot = jest.mocked(clearSlot);
const mockUseBrandSettings = jest.mocked(useBrandSettings);
const mockUseIconLibrary = jest.mocked(useIconLibrary);

const PUBLISHED_ICON = createDocument({
  id: 'icon-pub-1',
  name: 'Logo SVNDTS',
  status: 'published',
  shapes: [createShape({ type: 'rect', x: 2, y: 2, width: 20, height: 20, rx: 4 }, { fill: 'sapphire', stroke: 'none', strokeWidth: 0 })],
});

const PUBLISHED_ICON_2 = createDocument({
  id: 'icon-pub-2',
  name: 'Biểu tượng Báo cáo',
  status: 'published',
  shapes: [createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 8, ry: 8 }, { fill: 'none', stroke: 'sapphire', strokeWidth: 2 })],
});

const DRAFT_ICON = createDocument({
  id: 'icon-draft-1',
  name: 'Icon Nháp Chưa Phát Hành',
  status: 'draft',
  shapes: [createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 2 }, { fill: 'sapphire', stroke: 'none', strokeWidth: 0 })],
});

const ALL_DOCS = [PUBLISHED_ICON, PUBLISHED_ICON_2, DRAFT_ICON];

const ASSIGNED_LOGO: BrandSlotAssignment = {
  slot: 'brand.logo',
  iconId: PUBLISHED_ICON.id,
  iconName: PUBLISHED_ICON.name,
  iconSlug: PUBLISHED_ICON.id,
  iconStatus: 'published',
  publishedVersion: 2,
  currentVersion: 2,
  updatedBy: 'admin-1',
  updatedAt: '2026-11-16T08:00:00Z',
};

const ASSIGNED_MONO_DRAFT: BrandSlotAssignment = {
  slot: 'nav.reports',
  iconId: DRAFT_ICON.id,
  iconName: DRAFT_ICON.name,
  iconSlug: DRAFT_ICON.id,
  iconStatus: 'draft',
  publishedVersion: null,
  currentVersion: 3,
  updatedBy: 'admin-1',
  updatedAt: '2026-11-16T08:05:00Z',
};

const ASSIGNED_ARCHIVED: BrandSlotAssignment = {
  slot: 'module.hrm',
  iconId: 'icon-archived-99',
  iconName: 'Icon Nhân sự cũ',
  iconSlug: 'icon-nhan-su-cu',
  iconStatus: 'archived',
  publishedVersion: 1,
  currentVersion: 1,
  updatedBy: 'admin-1',
  updatedAt: '2026-11-16T08:10:00Z',
};

function setupStores() {
  mockUseBrandSettings.mockReturnValue({
    ready: true,
    palette: DEFAULT_PALETTE,
    rules: DEFAULT_RULES,
    mode: 'server',
    saving: false,
    error: null,
    setPalette: jest.fn(),
    setRules: jest.fn(),
    reset: jest.fn(),
  });

  mockUseIconLibrary.mockReturnValue({
    ready: true,
    docs: ALL_DOCS,
    archivedDocs: [],
    error: null,
    mode: 'server',
    modeReason: null,
    localOnlyCount: 0,
    loading: false,
    get: (id: string) => ALL_DOCS.find((doc) => doc.id === id),
    serverInfo: () => null,
    save: jest.fn(),
    saveMany: jest.fn(),
    remove: jest.fn(),
    removeMany: jest.fn(),
    restore: jest.fn(),
    restoreMany: jest.fn(),
    purge: jest.fn(),
    purgeMany: jest.fn(),
    duplicate: jest.fn(),
    importDocs: jest.fn(),
    resetPreset: jest.fn(),
    publish: jest.fn(),
    syncLocalToServer: jest.fn(),
    reloadFromServer: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupStores();
  mockListSlots.mockResolvedValue({ slots: [ASSIGNED_LOGO, ASSIGNED_MONO_DRAFT] });
  mockAssignSlot.mockResolvedValue({
    slot: 'module.inventory',
    iconId: PUBLISHED_ICON_2.id,
    iconName: PUBLISHED_ICON_2.name,
    iconSlug: PUBLISHED_ICON_2.id,
    iconStatus: 'published',
    publishedVersion: 1,
    currentVersion: 1,
    updatedBy: 'admin-1',
    updatedAt: '2026-11-16T09:00:00Z',
  });
  mockClearSlot.mockResolvedValue(undefined);
});

describe('SlotsPage', () => {
  it('khi chạy phía máy chủ chỉ hiện khung chờ', () => {
    expect(renderToString(<SlotsPage />)).toContain('Đang tải vị trí sử dụng');
  });

  it('tải danh sách vị trí và hiển thị đầy đủ thông tin, chế độ màu và xem trước', async () => {
    render(<SlotsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();
    });

    expect(screen.getByRole('heading', { name: 'Vị trí sử dụng' })).toBeTruthy();
    expect(screen.getByText(`2/${ICON_SLOTS.length} vị trí đã gán icon riêng`)).toBeTruthy();

    // Vị trí màu thương hiệu đã gán
    const logoRow = screen.getByTestId('slot-row-brand.logo');
    expect(within(logoRow).getByText('Màu thương hiệu')).toBeTruthy();
    expect(within(logoRow).getByTestId('slot-preview-brand-brand.logo').querySelector('svg')).toBeTruthy();
    expect(within(logoRow).getByRole('button', { name: 'Về mặc định' })).toBeTruthy();

    // Vị trí mono đã gán hiện cả thường và nền xanh
    const reportsRow = screen.getByTestId('slot-row-nav.reports');
    expect(within(reportsRow).getByText('Theo ngữ cảnh (currentColor)')).toBeTruthy();
    const monoPreview = within(reportsRow).getByTestId('slot-preview-mono-nav.reports');
    expect(within(monoPreview).getByText('Thường')).toBeTruthy();
    expect(within(monoPreview).getByText('Nền xanh')).toBeTruthy();
    expect(monoPreview.querySelectorAll('svg')).toHaveLength(2);

    // Vị trí chưa gán hiện mặc định và không có nút Về mặc định
    const inventoryRow = screen.getByTestId('slot-row-module.inventory');
    expect(within(inventoryRow).getByTestId('slot-preview-default-module.inventory')).toBeTruthy();
    expect(within(inventoryRow).queryByRole('button', { name: 'Về mặc định' })).toBeNull();
  });

  it('hiện cảnh báo rõ ràng khi icon đang gán bị gỡ phát hành hoặc lưu trữ', async () => {
    mockListSlots.mockResolvedValue({ slots: [ASSIGNED_MONO_DRAFT, ASSIGNED_ARCHIVED] });
    render(<SlotsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('slot-warning-nav.reports')).toBeTruthy();
    });

    expect(screen.getByTestId('slot-warning-nav.reports').textContent).toContain('đã bị gỡ phát hành');
    expect(screen.getByTestId('slot-warning-module.hrm').textContent).toContain('đã bị lưu trữ');
  });

  it('chỉ liệt kê icon đã phát hành trong SearchableSelect và gọi assignSlot khi chọn', async () => {
    render(<SlotsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('slot-row-module.inventory')).toBeTruthy();
    });

    const inventoryRow = screen.getByTestId('slot-row-module.inventory');
    const selectInput = within(inventoryRow).getByPlaceholderText('Chọn icon đã phát hành...');
    fireEvent.focus(selectInput);
    fireEvent.click(selectInput);

    // Chỉ có icon published trong dropdown, không có icon draft
    expect(await screen.findByText(PUBLISHED_ICON_2.name)).toBeTruthy();
    expect(screen.queryByText(DRAFT_ICON.name)).toBeNull();

    fireEvent.click(screen.getByText(PUBLISHED_ICON_2.name));

    await waitFor(() => {
      expect(mockAssignSlot).toHaveBeenCalledWith('module.inventory', PUBLISHED_ICON_2.id);
    });
    expect(screen.getByRole('status').textContent).toContain('Đã gán icon');
  });

  it('gọi clearSlot khi bấm Về mặc định và đưa vị trí về trạng thái mặc định', async () => {
    render(<SlotsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();
    });

    const logoRow = screen.getByTestId('slot-row-brand.logo');
    fireEvent.click(within(logoRow).getByRole('button', { name: 'Về mặc định' }));

    await waitFor(() => {
      expect(mockClearSlot).toHaveBeenCalledWith('brand.logo');
    });

    expect(within(logoRow).getByTestId('slot-preview-default-brand.logo')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('về mặc định');
  });

  it('tìm kiếm theo tên/mã vị trí và lọc theo nhóm, trạng thái', async () => {
    render(<SlotsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();
    });

    // Tìm theo mã vị trí
    const searchInput = screen.getByLabelText('Tìm theo tên hoặc mã vị trí');
    fireEvent.change(searchInput, { target: { value: 'module.inventory' } });
    expect(screen.getByTestId('slot-row-module.inventory')).toBeTruthy();
    expect(screen.queryByTestId('slot-row-brand.logo')).toBeNull();

    // Xoá bộ lọc
    fireEvent.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));
    expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();

    // Lọc theo trạng thái "Đã gán"
    fireEvent.click(screen.getByDisplayValue('Tất cả trạng thái'));
    fireEvent.click(await screen.findByText('Đã gán'));
    expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();
    expect(screen.getByTestId('slot-row-nav.reports')).toBeTruthy();
    expect(screen.queryByTestId('slot-row-module.inventory')).toBeNull();

    // Lọc theo nhóm "Thương hiệu"
    const groupInput = screen.getByDisplayValue('Tất cả nhóm');
    fireEvent.focus(groupInput);
    fireEvent.click(groupInput);
    const brandOptions = await screen.findAllByText('Thương hiệu');
    const brandOption = brandOptions.find((el) => !el.closest('[data-testid="slot-row-brand.logo"]'));
    expect(brandOption).toBeTruthy();
    fireEvent.click(brandOption as HTMLElement);
    expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();
    expect(screen.queryByTestId('slot-row-nav.reports')).toBeNull();
  });

  it('hiện thông báo lỗi khi tải danh sách vị trí thất bại', async () => {
    mockListSlots.mockRejectedValueOnce(new Error('Không thể tải danh sách vị trí.'));
    render(<SlotsPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Không thể tải danh sách vị trí.');
    });
  });
});
