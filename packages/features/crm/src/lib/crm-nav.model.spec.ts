import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CRM_ACCESS_DENIED_MESSAGE,
  CRM_DEFAULT_SECTION,
  CRM_DEFAULT_VIEW,
  CRM_PAGES,
  CRM_SECTIONS,
  CRM_VIEWS,
  activeCrmSection,
  firstViewOfSection,
  inventoryButtonState,
  resolveCrmView,
  sectionOfView,
  viewsInSection,
  visibleCrmSections,
  crmCapabilityLabels,
  crmScopeLabel,
  isCrmAccessDenied,
  visibleCrmPages,
} from './crm-nav.model';

const ids = (capabilities = CRM_NO_CAPABILITIES) => visibleCrmPages(capabilities).map((page) => page.id);

describe('menu Bán hàng', () => {
  it('mỗi trang có đúng một mục và cùng thứ tự với danh sách view', () => {
    expect(CRM_PAGES.map((page) => page.id)).toEqual(CRM_VIEWS);
  });

  it('người chỉ có crm.read không thấy Báo cáo, Cấu hình', () => {
    expect(ids()).not.toContain('reports');
    expect(ids()).not.toContain('settings');
    expect(ids()).toContain('customers');
  });

  it('crm.report.read thấy Báo cáo; crm.manage và quản trị tenant thấy Cấu hình', () => {
    expect(ids({ ...CRM_NO_CAPABILITIES, canReadReport: true })).toContain('reports');
    expect(ids({ ...CRM_NO_CAPABILITIES, canManage: true })).toContain('settings');
    expect(ids({ ...CRM_NO_CAPABILITIES, isTenantAdmin: true })).toEqual(CRM_VIEWS);
  });

  it('nhãn phạm vi và quyền tiếng Việt', () => {
    expect(crmScopeLabel(CRM_NO_CAPABILITIES)).toContain('cấp dưới');
    expect(crmScopeLabel({ ...CRM_NO_CAPABILITIES, canReadAll: true })).toBe('Toàn bộ dữ liệu CRM');
    expect(crmCapabilityLabels(CRM_NO_CAPABILITIES)).toEqual(['Chỉ xem']);
    expect(crmCapabilityLabels({ ...CRM_NO_CAPABILITIES, canWriteQuote: true })).toEqual(['Lập báo giá']);
  });

  it('thẻ Tổng quan có mô tả thật, không còn nhãn giai đoạn hay chữ giữ chỗ', () => {
    for (const page of CRM_PAGES) {
      expect(page.summary.length).toBeGreaterThan(20);
      expect(page).not.toHaveProperty('phase');
      expect(page.summary).not.toMatch(/giai đoạn \d|đang được xây dựng/i);
    }
  });

  it('chưa có quyền crm.* (403) là trạng thái riêng, lỗi khác vẫn là lỗi', () => {
    expect(isCrmAccessDenied({ statusCode: 403, message: 'Không được phép truy cập CRM.' })).toBe(true);
    expect(isCrmAccessDenied({ statusCode: 500 })).toBe(false);
    expect(isCrmAccessDenied(undefined)).toBe(false);
    expect(isCrmAccessDenied(new Error('mạng'))).toBe(false);
    expect(CRM_ACCESS_DENIED_MESSAGE).toBe(
      'Bạn chưa được cấp quyền dùng phân hệ CRM. Liên hệ quản trị để được cấp quyền.',
    );
  });
});

describe('hai phần Quản lý khách hàng và Bán hàng (TC-NAV-01, TC-NAV-02)', () => {
  it('mặc định vào phần Quản lý khách hàng, trang Khách hàng', () => {
    expect(CRM_DEFAULT_SECTION).toBe('care');
    expect(CRM_DEFAULT_VIEW).toBe('customers');
    expect(sectionOfView(CRM_DEFAULT_VIEW)).toBe('care');
    expect(CRM_SECTIONS[0].label).toBe('Quản lý khách hàng');
  });

  it('phân trang đúng hai phần, mỗi trang đúng một phần, Cài đặt dùng chung', () => {
    const label = (view: string) => CRM_PAGES.find((page) => page.id === view)?.label;
    expect(CRM_SECTIONS.map((section) => section.label)).toEqual(['Quản lý khách hàng', 'Bán hàng']);
    expect(CRM_SECTIONS[0].views.map(label)).toEqual(['Khách hàng', 'Lead', 'Hoạt động chăm sóc']);
    expect(CRM_SECTIONS[1].views.map(label)).toEqual([
      'Tổng quan',
      'Việc cần xử lý',
      'Dự án bán hàng',
      'Báo giá',
      'Hợp đồng',
      'Đơn bán',
      'Công nợ',
      'Bảo hành',
      'Báo cáo',
    ]);
    const all = CRM_SECTIONS.flatMap((section) => section.views);
    expect(new Set(all).size).toBe(all.length);
    expect([...all, 'settings'].sort()).toEqual([...CRM_VIEWS].sort());
    expect(sectionOfView('settings')).toBeUndefined();
    expect(viewsInSection('care')).toEqual(['customers', 'leads', 'activities', 'settings']);
    expect(viewsInSection('sales')).toContain('settings');
    expect(viewsInSection(undefined)).toEqual([]);
  });

  it('bộ chuyển phần dẫn tới trang đầu của phần', () => {
    expect(firstViewOfSection('care', CRM_NO_CAPABILITIES)).toBe('customers');
    expect(firstViewOfSection('sales', CRM_NO_CAPABILITIES)).toBe('overview');
  });
});

describe('trang Việc cần xử lý (TC-TSK-13)', () => {
  it('ở nhóm Bán hàng, ai có crm.read cũng thấy; hash #tasks mở đúng trang', () => {
    const page = CRM_PAGES.find((entry) => entry.id === 'tasks');
    expect(page).toMatchObject({ label: 'Việc cần xử lý', group: 'Bán hàng' });
    expect(page?.visible).toBeUndefined();
    expect(ids()).toContain('tasks');
    expect(sectionOfView('tasks')).toBe('sales');
    expect(resolveCrmView('tasks', CRM_NO_CAPABILITIES)).toBe('tasks');
  });
});

describe('id hash cũ giữ nguyên (TC-NAV-03)', () => {
  it('mọi id cũ vẫn là trang hợp lệ và tự chọn đúng phần chứa trang', () => {
    const legacy = [
      'overview', 'customers', 'leads', 'opportunities', 'activities', 'quotes',
      'contracts', 'orders', 'receivables', 'warranty', 'reports', 'settings',
    ] as const;
    // Trang mới (Việc cần xử lý, P3C7-06) chỉ thêm, không đổi id cũ.
    expect(CRM_VIEWS).toEqual(expect.arrayContaining([...legacy]));
    expect(CRM_VIEWS.filter((view) => !(legacy as readonly string[]).includes(view))).toEqual(['tasks']);
    const admin = { ...CRM_NO_CAPABILITIES, isTenantAdmin: true };
    for (const view of legacy) expect(resolveCrmView(view, admin)).toBe(view);
    expect(activeCrmSection('quotes', undefined, CRM_NO_CAPABILITIES)).toBe('sales');
    expect(activeCrmSection('overview', 'care', CRM_NO_CAPABILITIES)).toBe('sales');
    expect(activeCrmSection('customers', 'sales', CRM_NO_CAPABILITIES)).toBe('care');
  });

  it('trang Cài đặt giữ phần đang ở; mở thẳng thì lấy phần đầu', () => {
    const admin = { ...CRM_NO_CAPABILITIES, isTenantAdmin: true };
    expect(activeCrmSection('settings', 'sales', admin)).toBe('sales');
    expect(activeCrmSection('settings', undefined, admin)).toBe('care');
  });

  it('trang bị ẩn do thiếu quyền thì rơi về Khách hàng, không mở trang cấm', () => {
    expect(resolveCrmView('reports', CRM_NO_CAPABILITIES)).toBe('customers');
    expect(resolveCrmView('settings', CRM_NO_CAPABILITIES)).toBe('customers');
  });
});

describe('phần không có trang nào được phép thì ẩn (TC-NAV-04)', () => {
  const caps = CRM_NO_CAPABILITIES;
  const never = () => false;
  const only = (...views: string[]) =>
    CRM_PAGES.map((page) => ({ ...page, visible: views.includes(page.id) ? undefined : never }));

  it('mặc định ai có crm.read cũng thấy cả hai phần', () => {
    expect(visibleCrmSections(caps).map((section) => section.id)).toEqual(['care', 'sales']);
  });

  it('chỉ có quyền ở trang khách hàng thì chỉ còn phần Quản lý khách hàng', () => {
    const pages = only('customers');
    expect(visibleCrmSections(caps, pages).map((section) => section.id)).toEqual(['care']);
    expect(firstViewOfSection('sales', caps, pages)).toBeUndefined();
    expect(activeCrmSection('quotes', undefined, caps, pages)).toBe('care');
    expect(resolveCrmView('quotes', caps, pages)).toBe('customers');
  });

  it('chỉ có quyền báo cáo thì chỉ còn phần Bán hàng, mở vào trang báo cáo', () => {
    const pages = only('reports');
    expect(visibleCrmSections(caps, pages).map((section) => section.id)).toEqual(['sales']);
    expect(resolveCrmView('customers', caps, pages)).toBe('reports');
    expect(activeCrmSection('reports', undefined, caps, pages)).toBe('sales');
  });
});

describe('nút Kho (TC-FB-10, TC-FB-11, TC-FB-12, TC-FB-14)', () => {
  it('ẩn khi tenant chưa mua Kho, kể cả có quyền', () => {
    expect(inventoryButtonState({ inventoryEntitled: false, canAccessInventory: true })).toBe('hidden');
    expect(inventoryButtonState({ inventoryEntitled: false, canAccessInventory: false })).toBe('hidden');
  });

  it('bấm được khi đã mua và có quyền; mờ khi đã mua nhưng không có quyền', () => {
    expect(inventoryButtonState({ inventoryEntitled: true, canAccessInventory: true })).toBe('enabled');
    expect(inventoryButtonState({ inventoryEntitled: true, canAccessInventory: false })).toBe('disabled');
  });

  it('chưa có status, thiếu cờ hoặc cờ sai kiểu thì không mở nút bấm được', () => {
    expect(inventoryButtonState(undefined)).toBe('hidden');
    expect(inventoryButtonState({})).toBe('hidden');
    expect(inventoryButtonState({ inventoryEntitled: true })).toBe('disabled');
    expect(inventoryButtonState({ inventoryEntitled: 'true', canAccessInventory: 'true' } as never)).toBe('hidden');
  });
});

describe('nhãn "Dự án bán hàng" (TC-NAV-07, giả định Q-P2-8)', () => {
  const CODE = /^\s*(\/\/|\*|\/\*)/;
  /** Dòng không phải chú thích, chứa chữ "Cơ hội" hiển thị cho người dùng. */
  function legacyLabels(file: string): string[] {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !CODE.test(line) && /cơ hội/i.test(line));
  }

  it('model điều hướng không còn nhãn Cơ hội; id và đường dẫn API giữ nguyên', () => {
    const page = CRM_PAGES.find((entry) => entry.id === 'opportunities');
    expect(page?.label).toBe('Dự án bán hàng');
    for (const entry of CRM_PAGES) {
      expect(`${entry.label} ${entry.summary} ${entry.group}`).not.toMatch(/cơ hội/i);
    }
    expect(CRM_VIEWS).toContain('opportunities');
    expect(readFileSync(join(__dirname, 'crm-api.ts'), 'utf8')).toContain('/opportunities');
  });

  it('các màn dự án, tổng quan, lead không còn chữ Cơ hội trên giao diện', () => {
    const dirs = ['opportunities', 'dashboard', 'leads'];
    const files = dirs.flatMap((dir) =>
      readdirSync(join(__dirname, dir))
        .filter((name) => /\.tsx?$/.test(name) && !/\.spec\./.test(name))
        .map((name) => join(__dirname, dir, name)),
    );
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) expect({ file, lines: legacyLabels(file) }).toEqual({ file, lines: [] });
  });
});
