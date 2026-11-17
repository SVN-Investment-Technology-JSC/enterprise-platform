import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  ICON_SLOTS,
  createDocument,
  createShape,
  BUILT_IN_SLOT_GROUPS,
  type BrandSlotAssignment,
  type BrandSlotGroup,
} from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import {
  assignSlot,
  clearSlot,
  createCustomSlot,
  createSlotGroup,
  deleteCustomSlot,
  deleteSlotGroup,
  listSlotGroups,
  listSlots,
  resetSlotOverride,
  updateCustomSlot,
  updateSlotGroup,
} from '../store/brand-api';
import { useBrandSettings, useIconLibrary } from '../store';
import { toast } from '@/components/ui/sonner';
import { SlotsPage } from './slots-page';

jest.mock('@/components/ui/sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('../store/brand-api', () => ({
  ...jest.requireActual('../store/brand-api'),
  listSlots: jest.fn(),
  assignSlot: jest.fn(),
  clearSlot: jest.fn(),
  createCustomSlot: jest.fn(),
  updateCustomSlot: jest.fn(),
  resetSlotOverride: jest.fn(),
  deleteCustomSlot: jest.fn(),
  listSlotGroups: jest.fn(),
  createSlotGroup: jest.fn(),
  updateSlotGroup: jest.fn(),
  deleteSlotGroup: jest.fn(),
}));

jest.mock('../store', () => ({
  useBrandSettings: jest.fn(),
  useIconLibrary: jest.fn(),
}));

const showAllSlots = async () => {
  const sizeInput = (await screen.findByTestId('pager-bar')).querySelector('input[type="text"]') as HTMLInputElement;
  fireEvent.focus(sizeInput);
  fireEvent.click(sizeInput);
  fireEvent.click(await screen.findByText('50'));
};

const mockListSlots = jest.mocked(listSlots);
const mockAssignSlot = jest.mocked(assignSlot);
const mockClearSlot = jest.mocked(clearSlot);
const mockCreateCustomSlot = jest.mocked(createCustomSlot);
const mockUpdateCustomSlot = jest.mocked(updateCustomSlot);
const mockResetSlotOverride = jest.mocked(resetSlotOverride);
const mockDeleteCustomSlot = jest.mocked(deleteCustomSlot);
const mockCreateSlotGroup = jest.mocked(createSlotGroup);
const mockUpdateSlotGroup = jest.mocked(updateSlotGroup);
const mockDeleteSlotGroup = jest.mocked(deleteSlotGroup);
const mockListSlotGroups = jest.mocked(listSlotGroups);
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

const BUILT_IN_GROUPS: readonly BrandSlotGroup[] = BUILT_IN_SLOT_GROUPS.map((group) => ({
  ...group,
  isBuiltIn: true,
  slotCount: 3,
}));
const HELP_GROUP: BrandSlotGroup = { key: 'help', label: 'Trợ giúp', isBuiltIn: false, slotCount: 0 };
const BUSY_GROUP: BrandSlotGroup = { key: 'busy', label: 'Đang dùng', isBuiltIn: false, slotCount: 2 };

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
  mockListSlots.mockResolvedValue({ slots: [ASSIGNED_LOGO, ASSIGNED_MONO_DRAFT], groups: [...BUILT_IN_GROUPS, HELP_GROUP, BUSY_GROUP] });
  mockListSlotGroups.mockResolvedValue({ groups: [...BUILT_IN_GROUPS, HELP_GROUP, BUSY_GROUP] });
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

    // Vị trí mono đã gán hiện cả thường và nền xanh (nằm ở trang sau nên hiện tất cả trước)
    await showAllSlots();
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

  it('phân trang danh sách vị trí: 10 vị trí mỗi trang, chuyển trang và đổi cỡ trang bằng ô chọn', async () => {
    render(<SlotsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();
    });

    expect(screen.getByTestId('pager-bar').textContent).toContain(`1–10 / ${ICON_SLOTS.length} vị trí`);
    expect(screen.getAllByTestId(/^slot-row-/)).toHaveLength(10);

    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }));
    expect(screen.queryByTestId('slot-row-brand.logo')).toBeNull();
    expect(screen.getByTestId('pager-bar').textContent).toContain(`11–20 / ${ICON_SLOTS.length} vị trí`);

    // Đổi bộ lọc/ô tìm thì về trang 1
    fireEvent.change(screen.getByLabelText('Tìm theo tên hoặc mã vị trí'), { target: { value: 'brand.logo' } });
    expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();
    expect(screen.getAllByTestId(/^slot-row-/)).toHaveLength(1);
  });

  it('hiện cảnh báo rõ ràng khi icon đang gán bị gỡ phát hành hoặc lưu trữ', async () => {
    mockListSlots.mockResolvedValue({ slots: [ASSIGNED_MONO_DRAFT, ASSIGNED_ARCHIVED] });
    render(<SlotsPage />);
    await showAllSlots();

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
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Đã gán icon'));
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
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('về mặc định'));
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

    // Mở nút Bộ lọc (chứa chọn nhóm, trạng thái và nút xoá bộ lọc), rồi xoá bộ lọc
    fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
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

  it('hỗ trợ tạo, chỉnh sửa và xoá vị trí tuỳ chỉnh trên UI', async () => {
    mockCreateCustomSlot.mockResolvedValueOnce({
      id: 'custom.promo-banner',
      label: 'Banner Khuyến Mãi',
      description: 'Banner hiển thị ưu đãi',
      group: 'custom',
      colorMode: 'brand',
      recommendedSize: 32,
      isCustom: true,
    });
    mockDeleteCustomSlot.mockResolvedValueOnce({ id: 'custom.promo-banner', deleted: true });

    render(<SlotsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('add-custom-slot-btn')).toBeTruthy();
    });

    // Mở modal thêm vị trí
    fireEvent.click(screen.getByTestId('add-custom-slot-btn'));
    expect(screen.getByText('Thêm vị trí icon mới')).toBeTruthy();

    // Điền form
    fireEvent.change(screen.getByLabelText(/Mã vị trí \(ID\)/), {
      target: { value: 'custom.promo-banner' },
    });
    fireEvent.change(screen.getByLabelText(/Tên hiển thị/), {
      target: { value: 'Banner Khuyến Mãi' },
    });

    // Submit form tạo
    fireEvent.click(screen.getByTestId('create-slot-submit-btn'));

    await waitFor(() => {
      expect(mockCreateCustomSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'custom.promo-banner',
          label: 'Banner Khuyến Mãi',
        }),
      );
    });

    // Kiểm tra hàng vị trí mới xuất hiện với huy hiệu Tùy chỉnh và các nút hành động (nằm cuối danh sách dài nhiều trang nên tìm theo mã)
    fireEvent.change(screen.getByLabelText('Tìm theo tên hoặc mã vị trí'), { target: { value: 'custom.promo-banner' } });
    await waitFor(() => {
      expect(screen.getByTestId('slot-row-custom.promo-banner')).toBeTruthy();
      expect(screen.getByTestId('slot-edit-btn-custom.promo-banner')).toBeTruthy();
      expect(screen.getByTestId('slot-delete-btn-custom.promo-banner')).toBeTruthy();
    });

    // Bấm nút xoá
    fireEvent.click(screen.getByTestId('slot-delete-btn-custom.promo-banner'));
    expect(screen.getByText('Xác nhận xoá vị trí tùy chỉnh')).toBeTruthy();

    // Xác nhận xoá
    fireEvent.click(screen.getByTestId('delete-slot-confirm-btn'));
    await waitFor(() => {
      expect(mockDeleteCustomSlot).toHaveBeenCalledWith('custom.promo-banner');
      expect(screen.queryByTestId('slot-row-custom.promo-banner')).toBeNull();
    });
  });
  it('thêm nhóm mới ngay trong ô Nhóm vị trí và tự chọn nhóm vừa tạo', async () => {
    const created: BrandSlotGroup = { key: 'trung-tam-tro-giup', label: 'Trung tâm trợ giúp', isBuiltIn: false, slotCount: 0 };
    mockCreateSlotGroup.mockResolvedValueOnce(created);
    mockListSlotGroups.mockResolvedValue({ groups: [...BUILT_IN_GROUPS, HELP_GROUP, BUSY_GROUP, created] });
    render(<SlotsPage />);
    await waitFor(() => expect(screen.getByTestId('add-custom-slot-btn')).toBeTruthy());

    fireEvent.click(screen.getByTestId('add-custom-slot-btn'));
    const groupInput = screen.getByDisplayValue('Tùy chỉnh');
    fireEvent.focus(groupInput);
    fireEvent.click(groupInput);
    fireEvent.click(await screen.findByTestId('custom-slot-group-add-group'));
    fireEvent.change(await screen.findByLabelText('Tên nhóm'), { target: { value: 'Trung tâm trợ giúp' } });
    fireEvent.keyDown(screen.getByLabelText('Tên nhóm'), { key: 'Enter' });

    await waitFor(() => expect(mockCreateSlotGroup).toHaveBeenCalledWith('Trung tâm trợ giúp'));
    await waitFor(() => expect(screen.getByDisplayValue('Trung tâm trợ giúp')).toBeTruthy());
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Trung tâm trợ giúp'));
    // Hộp thoại thêm vị trí vẫn mở
    expect(screen.getByText('Thêm vị trí icon mới')).toBeTruthy();
  });

  it('popup Nhóm vị trí: nhóm có sẵn chỉ đọc, nhóm đang dùng bị khoá xoá', async () => {
    render(<SlotsPage />);
    await waitFor(() => expect(screen.getByTestId('manage-slot-groups-btn')).toBeTruthy());
    fireEvent.click(screen.getByTestId('manage-slot-groups-btn'));

    const brandRow = await screen.findByTestId('slot-group-row-brand');
    expect(within(brandRow).getByText('Có sẵn')).toBeTruthy();
    expect(within(brandRow).getByText('Cố định')).toBeTruthy();
    expect(screen.queryByTestId('slot-group-edit-brand')).toBeNull();
    expect(screen.queryByTestId('slot-group-delete-brand')).toBeNull();

    const busyDelete = screen.getByTestId('slot-group-delete-busy') as HTMLButtonElement;
    expect(busyDelete.disabled).toBe(true);
    expect(screen.getByTestId('slot-group-delete-help')).toBeTruthy();
    expect((screen.getByTestId('slot-group-delete-help') as HTMLButtonElement).disabled).toBe(false);
  });

  it('popup Nhóm vị trí: thêm, đổi tên và xoá nhóm rỗng', async () => {
    const created: BrandSlotGroup = { key: 'moi', label: 'Nhóm mới', isBuiltIn: false, slotCount: 0 };
    mockCreateSlotGroup.mockResolvedValueOnce(created);
    mockListSlotGroups.mockResolvedValue({ groups: [...BUILT_IN_GROUPS, HELP_GROUP, BUSY_GROUP, created] });
    mockUpdateSlotGroup.mockResolvedValueOnce({ ...HELP_GROUP, label: 'Trợ giúp 2' });
    mockDeleteSlotGroup.mockResolvedValueOnce({ key: 'help', deleted: true });
    render(<SlotsPage />);
    await waitFor(() => expect(screen.getByTestId('manage-slot-groups-btn')).toBeTruthy());
    fireEvent.click(screen.getByTestId('manage-slot-groups-btn'));

    // Thêm
    fireEvent.change(await screen.findByLabelText('Tên nhóm mới'), { target: { value: 'Nhóm mới' } });
    fireEvent.click(screen.getByTestId('slot-group-add-btn'));
    await waitFor(() => expect(mockCreateSlotGroup).toHaveBeenCalledWith('Nhóm mới'));
    expect(await screen.findByTestId('slot-group-row-moi')).toBeTruthy();

    // Đổi tên
    fireEvent.click(screen.getByTestId('slot-group-edit-help'));
    const editInput = screen.getByLabelText('Tên nhóm help');
    fireEvent.change(editInput, { target: { value: 'Trợ giúp 2' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });
    await waitFor(() => expect(mockUpdateSlotGroup).toHaveBeenCalledWith('help', 'Trợ giúp 2'));
    expect(await within(screen.getByTestId('slot-group-row-help')).findByText('Trợ giúp 2')).toBeTruthy();

    // Xoá có xác nhận
    fireEvent.click(screen.getByTestId('slot-group-delete-help'));
    fireEvent.click(screen.getByTestId('slot-group-confirm-delete-help'));
    await waitFor(() => expect(mockDeleteSlotGroup).toHaveBeenCalledWith('help'));
    await waitFor(() => expect(screen.queryByTestId('slot-group-row-help')).toBeNull());
  });

  describe('chỉnh sửa vị trí có sẵn', () => {
    const LOGO = ICON_SLOTS.find((slot) => slot.id === 'brand.logo');
    if (!LOGO) throw new Error('Thiếu vị trí brand.logo');
    const OVERRIDDEN_LOGO = {
      ...LOGO,
      label: 'Logo của tôi',
      colorMode: 'mono' as const,
      overriddenFields: ['label', 'colorMode'] as const,
      defaults: { label: LOGO.label, colorMode: LOGO.colorMode },
    };

    const withDefinitions = (logo: typeof LOGO | typeof OVERRIDDEN_LOGO) => {
      mockListSlots.mockResolvedValue({
        slots: [],
        groups: [...BUILT_IN_GROUPS],
        definitions: ICON_SLOTS.map((slot) => (slot.id === 'brand.logo' ? logo : slot)),
      });
    };

    const openLogoEdit = async () => {
      render(<SlotsPage />);
      fireEvent.click(await screen.findByTestId('slot-edit-btn-brand.logo'));
      await screen.findByText(/Chỉnh sửa vị trí$/);
    };

    const pickColorMode = async (current: string, optionLabel: string) => {
      const input = screen.getByDisplayValue(current);
      fireEvent.focus(input);
      fireEvent.click(input);
      const options = await screen.findAllByRole('option');
      const option = options.find((item) => item.textContent?.includes(optionLabel));
      if (!option) throw new Error(`Không thấy lựa chọn ${optionLabel}`);
      fireEvent.click(option);
    };

    it('vị trí có sẵn có nút sửa nhưng không có nút xoá, chưa sửa thì không có nhãn Đã chỉnh sửa', async () => {
      withDefinitions(LOGO);
      render(<SlotsPage />);
      await screen.findByTestId('slot-row-brand.logo');
      expect(screen.getByTestId('slot-edit-btn-brand.logo')).toBeTruthy();
      expect(screen.queryByTestId('slot-delete-btn-brand.logo')).toBeNull();
      expect(screen.queryByTestId('slot-overridden-brand.logo')).toBeNull();
    });

    it('sửa tên chỉ gửi trường đã đổi, không cảnh báo màu và cập nhật hàng', async () => {
      withDefinitions(LOGO);
      mockUpdateCustomSlot.mockResolvedValueOnce({
        ...LOGO,
        label: 'Logo mới',
        overriddenFields: ['label'],
        defaults: { label: LOGO.label },
      });
      await openLogoEdit();

      expect((screen.getByLabelText(/Mã vị trí \(ID\)/) as HTMLInputElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText(/Tên hiển thị/), { target: { value: 'Logo mới' } });
      expect(screen.queryByTestId('slot-color-warning')).toBeNull();
      fireEvent.click(screen.getByTestId('edit-slot-submit-btn'));

      await waitFor(() => expect(mockUpdateCustomSlot).toHaveBeenCalledWith('brand.logo', { label: 'Logo mới' }));
      expect(await screen.findByTestId('slot-overridden-brand.logo')).toBeTruthy();
      expect(within(screen.getByTestId('slot-row-brand.logo')).getByText('Logo mới')).toBeTruthy();
      expect(mockListSlotGroups).toHaveBeenCalled();
    });

    it('đổi chế độ màu thì hiện cảnh báo, đổi lại như cũ thì ẩn, và chỉ lưu khi bấm Lưu', async () => {
      withDefinitions(LOGO);
      await openLogoEdit();

      await pickColorMode('Màu thương hiệu / Gradient', 'Theo ngữ cảnh (currentColor)');
      const warning = await screen.findByTestId('slot-color-warning');
      expect(warning.getAttribute('role')).toBe('alert');
      expect(warning.textContent).toContain('thay đổi cách icon được vẽ ở mọi nơi dùng vị trí này');
      expect(mockUpdateCustomSlot).not.toHaveBeenCalled();

      await pickColorMode('Theo ngữ cảnh (currentColor)', 'Màu thương hiệu / Gradient');
      await waitFor(() => expect(screen.queryByTestId('slot-color-warning')).toBeNull());
    });

    it('hàng đã sửa có nhãn, hộp thoại hiện mặc định và khôi phục từng trường gửi null', async () => {
      withDefinitions(OVERRIDDEN_LOGO);
      mockUpdateCustomSlot.mockResolvedValueOnce({
        ...OVERRIDDEN_LOGO,
        label: LOGO.label,
        overriddenFields: ['colorMode'],
        defaults: { colorMode: LOGO.colorMode },
      });
      render(<SlotsPage />);
      expect(await screen.findByTestId('slot-overridden-brand.logo')).toBeTruthy();
      fireEvent.click(screen.getByTestId('slot-edit-btn-brand.logo'));

      expect(screen.getByTestId('slot-default-label').textContent).toContain(LOGO.label);
      fireEvent.click(screen.getByTestId('slot-reset-field-label'));
      expect((screen.getByLabelText(/Tên hiển thị/) as HTMLInputElement).value).toBe(LOGO.label);
      expect(mockUpdateCustomSlot).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('edit-slot-submit-btn'));

      await waitFor(() => expect(mockUpdateCustomSlot).toHaveBeenCalledWith('brand.logo', { label: null }));
    });

    it('Khôi phục mặc định xoá mọi ghi đè và bỏ nhãn Đã chỉnh sửa', async () => {
      withDefinitions(OVERRIDDEN_LOGO);
      mockResetSlotOverride.mockResolvedValueOnce(LOGO);
      render(<SlotsPage />);
      fireEvent.click(await screen.findByTestId('slot-edit-btn-brand.logo'));
      fireEvent.click(screen.getByTestId('slot-reset-btn-brand.logo'));

      await waitFor(() => expect(mockResetSlotOverride).toHaveBeenCalledWith('brand.logo'));
      await waitFor(() => expect(screen.queryByTestId('slot-overridden-brand.logo')).toBeNull());
      expect(within(screen.getByTestId('slot-row-brand.logo')).getByText(LOGO.label)).toBeTruthy();
    });

    it('vị trí chưa sửa không có nút Khôi phục mặc định trong hộp thoại', async () => {
      withDefinitions(LOGO);
      await openLogoEdit();
      expect(screen.queryByTestId('slot-reset-btn-brand.logo')).toBeNull();
    });

    it('tìm theo tên mới vẫn lọc đúng', async () => {
      withDefinitions(OVERRIDDEN_LOGO);
      render(<SlotsPage />);
      await screen.findByTestId('slot-row-brand.logo');
      fireEvent.change(screen.getByLabelText('Tìm theo tên hoặc mã vị trí'), { target: { value: 'logo cua toi' } });
      await waitFor(() => expect(screen.queryAllByTestId(/^slot-row-/)).toHaveLength(1));
      expect(screen.getByTestId('slot-row-brand.logo')).toBeTruthy();
    });
  });
});
