import type { BrandSvgMode } from './api-types';

/** Nhóm vị trí sử dụng icon trong toàn hệ thống. */
export type IconSlotGroup = 'brand' | 'module' | 'nav' | 'custom' | (string & {});

export interface IconSlotMeta {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly description: string;
  /** `brand`: giữ màu thương hiệu & gradient; `mono`: dùng `currentColor` theo màu chữ. */
  readonly colorMode: BrandSvgMode;
  readonly recommendedSize: number;
  /** Đánh dấu vị trí do người dùng tự tạo; false hoặc undefined là vị trí hệ thống cố định. */
  readonly isCustom?: boolean;
  /** Chỉ vị trí có sẵn: các trường quản trị viên đã sửa so với mặc định trong code (rỗng hoặc vắng là chưa sửa). */
  readonly overriddenFields?: readonly SlotOverrideField[];
  /** Chỉ vị trí có sẵn đã sửa: giá trị mặc định trong code của đúng các trường đã sửa, để hiện và khôi phục. */
  readonly defaults?: SlotOverrideDefaults;
}

/** Các trường của vị trí có sẵn cho phép quản trị viên sửa (mã vị trí thì không). */
export const SLOT_OVERRIDE_FIELDS = ['label', 'description', 'group', 'colorMode', 'recommendedSize'] as const;
export type SlotOverrideField = (typeof SLOT_OVERRIDE_FIELDS)[number];
export type SlotOverrideDefaults = Partial<Pick<IconSlotMeta, SlotOverrideField>>;

export const SLOT_ID_PATTERN = /^[a-z][a-z0-9_.-]{1,63}$/;

export function isValidSlotId(id: unknown): id is string {
  return typeof id === 'string' && SLOT_ID_PATTERN.test(id);
}

export interface CustomSlotPayload {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
  readonly colorMode?: BrandSvgMode;
  readonly recommendedSize?: number;
}

export const ICON_SLOTS = [
  // Thương hiệu cốt lõi
  {
    id: 'brand.logo',
    group: 'brand',
    label: 'Logo chính hệ thống',
    description: 'Hiển thị ở góc trên thanh bên và đầu trang ứng dụng.',
    colorMode: 'brand',
    recommendedSize: 32,
  },

  // Biểu tượng phân hệ
  {
    id: 'module.workspace',
    group: 'module',
    label: 'Không gian làm việc (Workspace)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Workspace.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.hrm',
    group: 'module',
    label: 'Nhân sự & Chấm công (HRM)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ HRM.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.inventory',
    group: 'module',
    label: 'Kho & Vật tư (Inventory)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Kho vận.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.maintenance',
    group: 'module',
    label: 'Bảo trì thiết bị (CMMS)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Bảo trì.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.finance',
    group: 'module',
    label: 'Tài chính & Kế toán (Finance)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Tài chính.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.procedure',
    group: 'module',
    label: 'Quy trình & Phê duyệt (Procedure)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Quy trình.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.crm',
    group: 'module',
    label: 'Bán hàng & Khách hàng (CRM)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ CRM.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.shared',
    group: 'module',
    label: 'Kho tài liệu dùng chung (Shared)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Tài liệu.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.social',
    group: 'module',
    label: 'Mạng nội bộ (Social)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Mạng nội bộ.',
    colorMode: 'brand',
    recommendedSize: 24,
  },

  // Menu điều hướng thanh bên (một màu theo ngữ cảnh)
  {
    id: 'nav.dashboard',
    group: 'nav',
    label: 'Bảng điều khiển',
    description: 'Mục điều hướng Tổng quan / Bảng điều khiển.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.applications',
    group: 'nav',
    label: 'Ứng dụng phân hệ',
    description: 'Mục điều hướng danh sách ứng dụng phân hệ.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.organization',
    group: 'nav',
    label: 'Sơ đồ tổ chức',
    description: 'Mục điều hướng cơ cấu tổ chức & phòng ban.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.users',
    group: 'nav',
    label: 'Tài khoản người dùng',
    description: 'Mục điều hướng quản lý người dùng / khách hàng.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.authorization',
    group: 'nav',
    label: 'Vai trò & Phân quyền',
    description: 'Mục điều hướng thiết lập vai trò và quyền hạn.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.account',
    group: 'nav',
    label: 'Tài khoản của tôi',
    description: 'Mục điều hướng hồ sơ cá nhân người dùng.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.tenants',
    group: 'nav',
    label: 'Khách hàng (Tenants)',
    description: 'Mục điều hướng quản lý tenant trên Platform Admin.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.plans',
    group: 'nav',
    label: 'Gói dịch vụ & Hạn mức',
    description: 'Mục điều hướng cấu hình gói dịch vụ nền tảng.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.brand-studio',
    group: 'nav',
    label: 'Thư viện icon',
    description: 'Mục điều hướng Thư viện icon Brand Studio.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.brand-standards',
    group: 'nav',
    label: 'Bảng màu & Quy chuẩn',
    description: 'Mục điều hướng Bảng màu & Quy chuẩn thương hiệu.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.brand-slots',
    group: 'nav',
    label: 'Vị trí sử dụng icon',
    description: 'Mục điều hướng màn hình gán icon vào vị trí.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.data-import',
    group: 'nav',
    label: 'Nhập dữ liệu',
    description: 'Mục điều hướng nhập dữ liệu hàng loạt.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.settings',
    group: 'nav',
    label: 'Cài đặt phân hệ',
    description: 'Mục điều hướng cài đặt chung trong các phân hệ.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.reports',
    group: 'nav',
    label: 'Báo cáo & Thống kê',
    description: 'Mục điều hướng báo cáo và phân tích dữ liệu.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'header.assistant',
    group: 'header',
    label: 'Trợ lý Savina',
    description:
      'Nút mở ngăn trợ lý AI (Ctrl+/) cạnh chuông thông báo trên thanh bên hoặc thanh đầu trang, có ở mọi trang.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'header.fullscreen',
    group: 'header',
    label: 'Toàn màn hình',
    description:
      'Nút bật/tắt chế độ toàn màn hình trên thanh đầu trang của khung tối.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'header.notifications',
    group: 'header',
    label: 'Chuông thông báo',
    description:
      'Nút chuông Thông báo kèm số chưa đọc, cạnh khối người dùng ở thanh bên (khung sáng) hoặc thanh đầu trang (khung tối); thấy ở mọi trang.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'header.search',
    group: 'header',
    label: 'Tìm kiếm nhanh',
    description:
      'Nút Tìm nhanh (Ctrl+K) ở thanh bên của khung sáng (ModuleShellLight) và ô tìm kiếm trên thanh đầu trang của khung tối (ModuleShell). Hiển thị ở mọi trang của mọi phân hệ.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'shell.home',
    group: 'shell',
    label: 'Trang chủ',
    description:
      'Nút Trang chủ (quay về danh sách Ứng dụng) ở chân thanh bên và ở đầu breadcrumb của mọi trang.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'shell.logout',
    group: 'shell',
    label: 'Đăng xuất',
    description:
      'Nút Đăng xuất ở chân thanh bên và trong menu người dùng, thấy ở mọi phân hệ.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'shell.module-switcher',
    group: 'shell',
    label: 'Nút chuyển phân hệ',
    description:
      'Nút lưới 4 ô cạnh logo ở đầu thanh bên, bấm mở danh sách phân hệ để nhảy nhanh; có ở mọi phân hệ.',
    colorMode: 'mono',
    recommendedSize: 20,
  },
  {
    id: 'shell.sidebar-toggle',
    group: 'shell',
    label: 'Thu gọn/mở rộng thanh bên',
    description:
      'Nút thu gọn hoặc mở rộng thanh điều hướng trái ở chân thanh bên (khung sáng) hay mép thanh bên (khung tối).',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'module.assistant',
    group: 'module',
    label: 'Trợ lý AI (phân hệ)',
    description:
      'Phân hệ Trợ lý trong danh mục (khóa assistant), chỉ mở bằng nút trên khung, hiện trong thông báo/ứng dụng. Chưa có trong MODULE_SLOT_MAP.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.chat',
    group: 'module',
    label: 'Phân hệ Chat nội bộ',
    description:
      'Biểu tượng nhận diện Cổng chat nội bộ: nút nổi mở chat ở góc màn hình (hiện ở mọi trang của mọi phân hệ), tiêu đề khung chat và trạng thái rỗng \'Chọn một cuộc trò chuyện\'.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.correspondence',
    group: 'module',
    label: 'Công văn',
    description:
      'Phân hệ Công văn (correspondence) trên thanh chuyển đổi và trong nhóm thông báo.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'dashboard.approvals',
    group: 'dashboard',
    label: 'Thẻ Đơn từ cần duyệt',
    description:
      'Biểu tượng đầu thẻ \'Đơn từ cần bạn duyệt\' trên Bảng điều khiển của tenant, trang đầu tiên người dùng thấy sau đăng nhập.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'dashboard.low-stock',
    group: 'dashboard',
    label: 'Thẻ Vật tư dưới mức tối thiểu',
    description:
      'Biểu tượng đầu thẻ \'Vật tư dưới mức tối thiểu\' (Kho) trên Bảng điều khiển tenant.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'dashboard.maintenance-incidents',
    group: 'dashboard',
    label: 'Thẻ Sự cố bảo trì',
    description:
      'Biểu tượng đầu thẻ \'Sự cố bảo trì đang mở\' trên Bảng điều khiển tenant.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'dashboard.procedure-tasks',
    group: 'dashboard',
    label: 'Thẻ Hồ sơ cần xử lý',
    description:
      'Biểu tượng đầu thẻ \'Hồ sơ cần bạn xử lý\' (Quy trình) trên Bảng điều khiển tenant.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'dashboard.work-todo',
    group: 'dashboard',
    label: 'Thẻ Công việc cần xử lý',
    description:
      'Biểu tượng đầu thẻ \'Công việc cần xử lý\' (Không gian làm việc) trên Bảng điều khiển tenant.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.correspondence.archive',
    group: 'sidebar',
    label: 'Kho lưu trữ (menu Công văn)',
    description:
      'Mục menu sidebar trái \'Kho lưu trữ\' của phân hệ Công văn, mở cây lưu trữ công văn theo năm và nhóm.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.correspondence.incoming',
    group: 'sidebar',
    label: 'Công văn đến (menu Công văn)',
    description:
      'Mục menu sidebar trái \'Công văn đến\' của phân hệ Công văn, mở sổ công văn đến, kèm số công văn đang xử lý.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.correspondence.mine',
    group: 'sidebar',
    label: 'Cần tôi xử lý (menu Công văn)',
    description:
      'Mục menu sidebar trái \'Cần tôi xử lý\' của phân hệ Công văn, hiển thị danh sách công văn đang chờ người dùng xử lý, kèm số lượng chờ.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.correspondence.outgoing',
    group: 'sidebar',
    label: 'Công văn đi (menu Công văn)',
    description:
      'Mục menu sidebar trái \'Công văn đi\' của phân hệ Công văn, mở sổ công văn đi, kèm số công văn đang xử lý.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.correspondence.tracking',
    group: 'sidebar',
    label: 'Theo dõi đôn đốc (menu Công văn)',
    description:
      'Mục menu sidebar trái \'Theo dõi đôn đốc\' của phân hệ Công văn, dành cho người có quyền theo dõi và nhắc việc xử lý công văn.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.activities',
    group: 'sidebar',
    label: 'Hoạt động chăm sóc (menu CRM)',
    description:
      'Biểu tượng mục Hoạt động (lịch hẹn, công việc chăm sóc khách) trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.contracts',
    group: 'sidebar',
    label: 'Hợp đồng (menu CRM)',
    description:
      'Biểu tượng mục Hợp đồng trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.leads',
    group: 'sidebar',
    label: 'Khách tiềm năng (menu CRM)',
    description:
      'Biểu tượng mục Khách tiềm năng trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.opportunities',
    group: 'sidebar',
    label: 'Cơ hội bán hàng (menu CRM)',
    description:
      'Biểu tượng mục Cơ hội bán hàng trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.orders',
    group: 'sidebar',
    label: 'Đơn hàng (menu CRM)',
    description:
      'Biểu tượng mục Đơn hàng trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.quotes',
    group: 'sidebar',
    label: 'Báo giá (menu CRM)',
    description:
      'Biểu tượng mục Báo giá trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.receivables',
    group: 'sidebar',
    label: 'Công nợ phải thu (menu CRM)',
    description:
      'Biểu tượng mục Công nợ phải thu trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.tasks',
    group: 'sidebar',
    label: 'Việc cần xử lý (menu CRM)',
    description:
      'Biểu tượng mục Việc cần xử lý (kèm số việc chờ duyệt) trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.crm.warranty',
    group: 'sidebar',
    label: 'Bảo hành (menu CRM)',
    description:
      'Biểu tượng mục Bảo hành trong menu bên trái của phân hệ CRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.finance.accounts',
    group: 'sidebar',
    label: 'Tài khoản (menu Tài chính)',
    description:
      'Biểu tượng mục Tài khoản (quỹ, ngân hàng, ví) trong thanh bên trái của phân hệ Tài chính.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.finance.payments',
    group: 'sidebar',
    label: 'Phiếu chi (menu Tài chính)',
    description:
      'Biểu tượng mục Phiếu chi trong thanh bên trái của phân hệ Tài chính, nhận diện nhóm tiền ra.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.finance.receipts',
    group: 'sidebar',
    label: 'Phiếu thu (menu Tài chính)',
    description:
      'Biểu tượng mục Phiếu thu trong thanh bên trái của phân hệ Tài chính, nhận diện nhóm tiền vào.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.finance.transfers',
    group: 'sidebar',
    label: 'Chuyển tiền (menu Tài chính)',
    description:
      'Biểu tượng mục Chuyển tiền nội bộ giữa các tài khoản trong thanh bên trái của phân hệ Tài chính.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.approvals',
    group: 'sidebar',
    label: 'Đơn từ cần xử lý (menu HRM)',
    description:
      'Biểu tượng mục menu Đơn từ cần xử lý (hàng chờ duyệt) trong thanh bên trái của phân hệ Nhân sự.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.attendance-monitor',
    group: 'sidebar',
    label: 'Giám sát chấm công (menu HRM)',
    description:
      'Biểu tượng mục menu Giám sát chấm công trong thanh bên trái của phân hệ Nhân sự (nhóm Tổng quan), xuất hiện cả trong tìm nhanh HRM.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.fleet',
    group: 'sidebar',
    label: 'Lịch xe (menu HRM)',
    description:
      'Biểu tượng mục menu Lịch xe (điều xe, phương tiện, tài xế) trong thanh bên trái của phân hệ Nhân sự.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.leave',
    group: 'sidebar',
    label: 'Phép năm (menu HRM)',
    description:
      'Biểu tượng mục menu Phép năm và nghỉ bù (quỹ phép, lịch sử điều chỉnh) trong thanh bên trái của phân hệ Nhân sự.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.my-work',
    group: 'sidebar',
    label: 'Công của tôi (menu HRM)',
    description:
      'Biểu tượng mục menu Công của tôi (bảng công cá nhân) trong thanh bên trái của phân hệ Nhân sự, nhóm Cá nhân.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.payroll',
    group: 'sidebar',
    label: 'Lương và chi trả (menu HRM)',
    description:
      'Biểu tượng mục menu Lương và chi trả (bảng lương, tạm ứng, phiếu lương) trong thanh bên trái của phân hệ Nhân sự.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.profile',
    group: 'sidebar',
    label: 'Hồ sơ và lương (menu HRM)',
    description:
      'Biểu tượng mục menu Hồ sơ và lương cá nhân (hồ sơ, phiếu lương) trong thanh bên trái của phân hệ Nhân sự.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.requests',
    group: 'sidebar',
    label: 'Đơn từ của tôi (menu HRM)',
    description:
      'Biểu tượng mục menu Đơn từ của tôi (tạo và theo dõi đơn nghỉ, tăng ca, giải trình) trong thanh bên trái của phân hệ Nhân sự.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.hrm.timekeeping',
    group: 'sidebar',
    label: 'Bảng công (menu HRM)',
    description:
      'Biểu tượng mục menu Bảng công tổng hợp (quản lý chấm công toàn đơn vị) trong thanh bên trái của phân hệ Nhân sự, nhóm Quản lý.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.inventory.approvals',
    group: 'sidebar',
    label: 'Duyệt chứng từ kho (menu Kho & Vật tư)',
    description:
      'Biểu tượng mục menu Duyệt chứng từ ở sidebar trái phân hệ Kho & Vật tư.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.inventory.assets-tree',
    group: 'sidebar',
    label: 'Cây tài sản (menu Kho & Vật tư)',
    description:
      'Biểu tượng mục menu Cây tài sản (cấu trúc thiết bị và vật tư lắp đặt) ở sidebar trái phân hệ Kho & Vật tư.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.inventory.custody',
    group: 'sidebar',
    label: 'Tài sản & bàn giao (menu Kho & Vật tư)',
    description:
      'Biểu tượng mục menu Tài sản (cấp phát, bàn giao, theo dõi người giữ) ở sidebar trái phân hệ Kho & Vật tư.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.inventory.documents',
    group: 'sidebar',
    label: 'Chứng từ kho (menu Kho & Vật tư)',
    description:
      'Biểu tượng mục menu Chứng từ kho (phiếu nhập, xuất, chuyển, điều chỉnh) ở sidebar trái phân hệ Kho & Vật tư.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.inventory.issue-requests',
    group: 'sidebar',
    label: 'Yêu cầu xuất từ đơn bán (menu Kho & Vật tư)',
    description:
      'Biểu tượng mục menu Yêu cầu xuất từ đơn bán ở sidebar trái phân hệ Kho & Vật tư.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.inventory.stock',
    group: 'sidebar',
    label: 'Kho hàng (menu Kho & Vật tư)',
    description:
      'Biểu tượng mục menu Kho hàng (tồn kho, nhà kho, lịch sử xuất nhập, kiểm đếm) ở sidebar trái của phân hệ Kho & Vật tư.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.maintenance.history',
    group: 'sidebar',
    label: 'Lịch sử (menu Bảo trì)',
    description:
      'Biểu tượng mục Lịch sử bảo trì trong menu sidebar trái của phân hệ Bảo trì (nhóm Vận hành).',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.maintenance.matrix',
    group: 'sidebar',
    label: 'Ma trận bảo trì (menu Bảo trì)',
    description:
      'Biểu tượng mục Ma trận bảo trì trong menu sidebar trái của phân hệ Bảo trì (nhóm Vận hành).',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.maintenance.occurrences',
    group: 'sidebar',
    label: 'Phiếu phát sinh (menu Bảo trì)',
    description:
      'Biểu tượng mục Phiếu phát sinh (sự cố/công việc phát sinh) trong menu sidebar trái của phân hệ Bảo trì (nhóm Vận hành).',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.maintenance.schedules',
    group: 'sidebar',
    label: 'Lịch bảo trì (menu Bảo trì)',
    description:
      'Biểu tượng mục Lịch bảo trì trong menu sidebar trái của phân hệ Bảo trì (nhóm Vận hành).',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.procedure.raci',
    group: 'sidebar',
    label: 'Ma trận RCSI (menu Quy trình)',
    description:
      'Biểu tượng mục menu sidebar trái \'Ma trận RCSI\' (nhóm Thiết kế) trong phân hệ Quy trình & Phê duyệt; cũng hiển thị ở rail thu gọn.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.procedure.workspace',
    group: 'sidebar',
    label: 'Hồ sơ xử lý (menu Quy trình)',
    description:
      'Biểu tượng mục menu sidebar trái \'Hồ sơ xử lý\' (nhóm Người dùng) trong phân hệ Quy trình & Phê duyệt; cũng hiển thị ở rail thu gọn.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.shared.library',
    group: 'sidebar',
    label: 'Tài liệu công ty (menu Tài liệu)',
    description:
      'Mục menu sidebar trái \'Tài liệu công ty\' của phân hệ Kho tài liệu, mở thư viện thư mục và tài liệu dùng chung.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.shared.storage',
    group: 'sidebar',
    label: 'Dung lượng (menu Tài liệu)',
    description:
      'Mục menu sidebar trái \'Dung lượng\' của phân hệ Kho tài liệu, hiển thị mức sử dụng dung lượng lưu trữ của tenant (kèm phần trăm đã dùng).',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.social.announcements',
    group: 'sidebar',
    label: 'Thông báo công ty (menu Mạng nội bộ)',
    description:
      'Biểu tượng loa thông báo đại diện cho thông báo công ty trong Mạng nội bộ, hiển thị ở khung \'Thông báo công ty\' của bảng nhanh và nút đăng thông báo.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.social.birthday',
    group: 'sidebar',
    label: 'Sinh nhật (menu Mạng nội bộ)',
    description:
      'Biểu tượng đại diện cho sinh nhật đồng nghiệp trong Mạng nội bộ, hiển thị ở đầu trang Sinh nhật và các thẻ sinh nhật.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.social.feed',
    group: 'sidebar',
    label: 'Bảng tin (menu Mạng nội bộ)',
    description:
      'Mục menu sidebar trái duy nhất của phân hệ Mạng nội bộ (\'Mạng nội bộ\'), mở bảng tin, tường công ty, nhóm và các trang con.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.social.groups',
    group: 'sidebar',
    label: 'Nhóm, thảo luận (menu Mạng nội bộ)',
    description:
      'Biểu tượng đại diện cho nhóm và thảo luận trong Mạng nội bộ, hiển thị ở tiêu đề khung \'Nhóm của tôi\' bên cột trái bảng tin và ở trạng thái rỗng lớn của trang danh sách nhóm.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.social.saved',
    group: 'sidebar',
    label: 'Bài đã lưu (menu Mạng nội bộ)',
    description:
      'Biểu tượng đại diện cho bài đã lưu (dấu trang) trong Mạng nội bộ, hiển thị ở đầu trang \'Bài đã lưu\' và tiêu đề khung \'Bài đã lưu gần đây\' ở bảng nhanh.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.workspace.documents',
    group: 'sidebar',
    label: 'Tài liệu (menu Workspace)',
    description:
      'Biểu tượng mục \'Tài liệu\' (kho tài liệu, thư mục dự án) trong menu sidebar trái của phân hệ Workspace.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.workspace.my-work',
    group: 'sidebar',
    label: 'Công việc của tôi (menu Workspace)',
    description:
      'Biểu tượng mục \'Công việc của tôi\' trong menu sidebar trái của phân hệ Workspace (trang mặc định của nhân viên).',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.workspace.projects',
    group: 'sidebar',
    label: 'Dự án (menu Workspace)',
    description:
      'Biểu tượng mục \'Dự án\' trong menu sidebar trái của phân hệ Workspace, đồng thời dùng làm biểu tượng dự án trong tìm nhanh.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'sidebar.workspace.tasks',
    group: 'sidebar',
    label: 'Công việc khác (menu Workspace)',
    description:
      'Biểu tượng mục \'Công việc khác\' (công việc độc lập không thuộc dự án) trong menu sidebar trái của phân hệ Workspace.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
] as const;

export type BuiltInSlotId = (typeof ICON_SLOTS)[number]['id'];
export type IconSlotId = BuiltInSlotId | (string & {});

export const SLOT_GROUP_LABELS: Record<string, string> = {
  brand: 'Thương hiệu',
  module: 'Phân hệ',
  nav: 'Thanh điều hướng',
  header: 'Thanh header',
  shell: 'Khung điều hướng',
  dashboard: 'Thẻ bảng điều khiển',
  sidebar: 'Menu phân hệ',
  custom: 'Tùy chỉnh',
};

/** Nhóm có sẵn của hệ thống (cố định, không đổi tên hay xoá); thứ tự là thứ tự hiển thị. */
export const BUILT_IN_SLOT_GROUPS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'brand', label: SLOT_GROUP_LABELS.brand },
  { key: 'module', label: SLOT_GROUP_LABELS.module },
  { key: 'nav', label: SLOT_GROUP_LABELS.nav },
  { key: 'header', label: SLOT_GROUP_LABELS.header },
  { key: 'shell', label: SLOT_GROUP_LABELS.shell },
  { key: 'dashboard', label: SLOT_GROUP_LABELS.dashboard },
  { key: 'sidebar', label: SLOT_GROUP_LABELS.sidebar },
  { key: 'custom', label: SLOT_GROUP_LABELS.custom },
];

export const SLOT_GROUP_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

export function isValidSlotGroupKey(key: unknown): key is string {
  return typeof key === 'string' && SLOT_GROUP_KEY_PATTERN.test(key);
}

const SLOT_BY_ID = new Map<string, IconSlotMeta>(
  ICON_SLOTS.map((slot) => [slot.id, slot]),
);

export function isBuiltInSlotId(value: string): value is BuiltInSlotId {
  return SLOT_BY_ID.has(value);
}

export function isIconSlotId(value: string): value is IconSlotId {
  return isValidSlotId(value);
}

export function getIconSlotMeta(slot: string): IconSlotMeta | undefined {
  return SLOT_BY_ID.get(slot);
}

const MODULE_KEY_TO_SLOT: Record<string, IconSlotId> = {
  workspace: 'module.workspace',
  hrm: 'module.hrm',
  inventory: 'module.inventory',
  maintenance: 'module.maintenance',
  finance: 'module.finance',
  'procedure-engine': 'module.procedure',
  procedure: 'module.procedure',
  crm: 'module.crm',
  shared: 'module.shared',
  social: 'module.social',
  assistant: 'module.assistant',
  chat: 'module.chat',
  correspondence: 'module.correspondence',
};

/** Ánh xạ `moduleKey` sang vị trí icon tương ứng; trả undefined nếu không có slot riêng. */
export function moduleSlotId(moduleKey: string): IconSlotId | undefined {
  return MODULE_KEY_TO_SLOT[moduleKey];
}

/** Tiền tố ID an toàn cho `<defs>` / `<symbol>` của từng slot trong DOM trang. */
export function slotSymbolId(slot: IconSlotId): string {
  return `ep-slot-${slot.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
