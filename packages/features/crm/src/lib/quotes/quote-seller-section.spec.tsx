import type { SalesOrganization } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QuoteSellerSection, SAVE_ORGANIZATION_TEXT } from './quote-seller-section';
import { EMPTY_SELLER_TEXTS, MANUAL_ORGANIZATION, type SellerState } from './quote-seller.model';

const mockCreate = jest.fn();
const mockToast = { success: jest.fn(), error: jest.fn() };
let mockCapabilities = { isTenantAdmin: false, canManage: true };

jest.mock('../crm-api', () => ({
  ...jest.requireActual('../crm-api'),
  createSalesOrganization: (...args: unknown[]) => mockCreate(...args),
}));
jest.mock('../crm-context', () => ({ useCrm: () => ({ capabilities: mockCapabilities }) }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({ options, value }: { options: { value: string; label: string }[]; value: string }) => (
    <div data-testid="org-select" data-value={value}>
      {options.map((option) => option.label).join('|')}
    </div>
  ),
  toast: { success: (...args: unknown[]) => mockToast.success(...args), error: (...args: unknown[]) => mockToast.error(...args) },
}));

const FILLED = {
  ...EMPTY_SELLER_TEXTS,
  name: 'Công ty CP Giải pháp Miền Nam',
  address: '12 Nguyễn Huệ, Quận 1',
  taxCode: '0309990002-001',
  phone: '028 3999 0002',
  email: 'sales@miennam.local',
};

const created: SalesOrganization = {
  id: 'org-new',
  code: null,
  name: FILLED.name,
  shortName: null,
  address: FILLED.address,
  taxCode: FILLED.taxCode,
  phone: FILLED.phone,
  email: FILLED.email,
  website: null,
  bankAccount: null,
  bankName: null,
  representative: null,
  representativeTitle: null,
  hasLogo: false,
  logo: null,
  isDefault: false,
  active: true,
  sortOrder: 0,
  inUse: false,
  updatedAt: '2026-11-10T00:00:00Z',
};

let lastState: SellerState | undefined;
function Harness({ initial }: { initial: SellerState }) {
  const [value, setValue] = useState(initial);
  lastState = value;
  return (
    <QuoteSellerSection
      value={value}
      onChange={(next) => {
        lastState = next;
        setValue(next);
      }}
      editable
      organizations={[]}
    />
  );
}

/** Mục thu gọn mặc định: bấm tiêu đề để mở. */
const expand = () => fireEvent.click(screen.getByRole('button', { name: /^Tổ chức báo giá/ }));

beforeEach(() => {
  mockCreate.mockReset();
  mockToast.success.mockReset();
  mockToast.error.mockReset();
  mockCapabilities = { isTenantAdmin: false, canManage: true };
  lastState = undefined;
});

describe('QuoteSellerSection: lưu thông tin nhập thủ công thành tổ chức', () => {
  it('quản trị bán hàng: lưu thành tổ chức rồi báo giá chuyển sang chọn tổ chức đó', async () => {
    mockCreate.mockResolvedValue(created);
    render(<Harness initial={{ organizationId: MANUAL_ORGANIZATION, seller: FILLED }} />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: SAVE_ORGANIZATION_TEXT }));
    await waitFor(() => expect(lastState?.organizationId).toBe('org-new'));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: FILLED.name, taxCode: FILLED.taxCode, code: null, logo: null }));
    expect(mockToast.success).toHaveBeenCalledWith(`Đã lưu tổ chức "${FILLED.name}" để dùng lần sau.`);
    expect(screen.getByTestId('org-select').textContent).toContain(FILLED.name);
    expect(screen.queryByRole('button', { name: SAVE_ORGANIZATION_TEXT })).toBeNull();
  });

  it('thiếu trường bắt buộc của tổ chức: báo tại ô, không gọi API', () => {
    render(<Harness initial={{ organizationId: MANUAL_ORGANIZATION, seller: { ...FILLED, taxCode: '' } }} />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: SAVE_ORGANIZATION_TEXT }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Vui lòng nhập mã số thuế.')).toBeTruthy();
    expect(lastState?.organizationId).toBe(MANUAL_ORGANIZATION);
  });

  it('không có quyền quản trị bán hàng: không có nút lưu', () => {
    mockCapabilities = { isTenantAdmin: false, canManage: false };
    render(<Harness initial={{ organizationId: MANUAL_ORGANIZATION, seller: FILLED }} />);
    expand();
    expect(screen.queryByRole('button', { name: SAVE_ORGANIZATION_TEXT })).toBeNull();
  });
});

describe('QuoteSellerSection: thu gọn, mở rộng', () => {
  it('thu gọn mặc định, tiêu đề ghi tổ chức đang chọn; bấm tiêu đề để mở, bấm lại để thu', () => {
    render(<Harness initial={{ organizationId: MANUAL_ORGANIZATION, seller: FILLED }} />);
    const toggle = screen.getByRole('button', { name: /^Tổ chức báo giá/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Nhập thủ công');
    expect(screen.queryByTestId('org-select')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('org-select')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('org-select')).toBeNull();
  });
});
