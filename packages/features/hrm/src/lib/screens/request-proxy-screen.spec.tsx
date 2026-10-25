/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import RequestProxyScreen, { describeScope, proxyDraftError, type ProxyRuleView } from './request-proxy-screen';

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const employeesMock = hrmEmployeeOptions as jest.MockedFunction<typeof hrmEmployeeOptions>;

const UNITS = [
  { id: 'u1', parentId: null, code: 'KD', name: 'Phòng Kinh doanh' },
  { id: 'u2', parentId: 'u1', code: 'KD1', name: 'Nhóm Bán lẻ' },
];
const RULE: ProxyRuleView = {
  id: 'r1',
  name: 'Trưởng phòng kinh doanh',
  granteeUserId: 'user-1',
  granteeEmployeeId: 'e1',
  granteeName: 'Bùi Hữu Vân',
  requestKinds: ['leave', 'ot'],
  scopeType: 'UNIT_LIST',
  unitIds: ['u1'],
  employeeIds: [],
  active: true,
};

beforeEach(() => {
  fetchMock.mockReset();
  employeesMock.mockReset();
  employeesMock.mockResolvedValue([{ value: 'e1', label: 'SVN-003 · Bùi Hữu Vân', department: '' }] as never);
});

describe('hàm thuần của màn cấu hình', () => {
  it('proxyDraftError chặn bản nháp thiếu thông tin', () => {
    const base = { id: null, name: 'A', granteeEmployeeId: '', requestKinds: ['leave' as const], scopeType: 'SUBORDINATES' as const, unitIds: [], employeeIds: [], active: true };
    expect(proxyDraftError(base)).toBeNull();
    expect(proxyDraftError({ ...base, name: '  ' })).toMatch(/tên/i);
    expect(proxyDraftError({ ...base, requestKinds: [] })).toMatch(/loại đơn/);
    expect(proxyDraftError({ ...base, scopeType: 'UNIT_LIST' })).toMatch(/đơn vị/);
    expect(proxyDraftError({ ...base, scopeType: 'EMPLOYEE_LIST' })).toMatch(/nhân viên/);
  });

  it('describeScope ghi rõ đơn vị hoặc nhân viên được chọn', () => {
    expect(describeScope(RULE, UNITS, new Map())).toBe('Các đơn vị chỉ định (gồm đơn vị con): Phòng Kinh doanh');
    expect(describeScope({ ...RULE, scopeType: 'EMPLOYEE_LIST', employeeIds: ['e1'] }, UNITS, new Map([['e1', 'Bùi Hữu Vân']]))).toContain('Bùi Hữu Vân');
    expect(describeScope({ ...RULE, scopeType: 'SUBORDINATES' }, UNITS, new Map())).toBe('Cấp dưới theo sơ đồ tổ chức');
  });
});

describe('RequestProxyScreen', () => {
  it('liệt kê cấu hình hiện có', async () => {
    fetchMock.mockResolvedValue({ data: [RULE], units: UNITS } as never);
    render(<RequestProxyScreen />);
    expect(await screen.findByText('Trưởng phòng kinh doanh')).toBeTruthy();
    expect(screen.getByText('Bùi Hữu Vân')).toBeTruthy();
    expect(screen.getByText('Nghỉ phép, Tăng ca')).toBeTruthy();
  });

  it('chưa có cấu hình thì nói rõ phạm vi mặc định', async () => {
    fetchMock.mockResolvedValue({ data: [], units: UNITS } as never);
    render(<RequestProxyScreen />);
    expect(await screen.findByText(/chỉ tạo hộ cho cấp dưới/)).toBeTruthy();
  });

  it('thêm cấu hình: gửi đúng nội dung lên máy chủ rồi tải lại', async () => {
    fetchMock.mockResolvedValue({ data: [], units: UNITS } as never);
    render(<RequestProxyScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Thêm cấu hình/ }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /Lưu cấu hình/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Tên cấu hình'), { target: { value: 'Mặc định cho trưởng nhóm' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(String(post?.[0])).toBe('/request-proxy/rules');
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
        name: 'Mặc định cho trưởng nhóm',
        requestKinds: ['leave', 'ot', 'business_trip', 'correction'],
        scopeType: 'SUBORDINATES',
        granteeEmployeeId: null,
        active: true,
      });
    });
  }, 15000);

  it('không gửi được khi bỏ hết loại đơn', async () => {
    fetchMock.mockResolvedValue({ data: [], units: UNITS } as never);
    render(<RequestProxyScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Thêm cấu hình/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Tên cấu hình'), { target: { value: 'A' } });
    for (const label of ['Nghỉ phép', 'Tăng ca', 'Công tác', 'Giải trình công']) fireEvent.click(within(dialog).getByLabelText(label));
    expect((within(dialog).getByRole('button', { name: /Lưu cấu hình/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByRole('alert').textContent).toMatch(/loại đơn/);
  });
});
