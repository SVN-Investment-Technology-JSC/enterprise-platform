/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HrmApiError, hrmFetch } from '../hrm-api';
import HrmProfilePage from './profile-screen';

const mockActions = new Set<string>(['hrm.self.request', 'hrm.self.profile.write']);
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: [...mockActions],
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.has(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.has(p)),
  }),
}));

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});

const hrmFetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const profile = {
  employeeId: 'e1',
  fullName: 'Nguyễn Văn An',
  employeeCode: 'NV001',
  employmentStatus: 'OFFICIAL',
  gender: 'MALE',
  dateOfBirth: '1990-05-20',
  identityCardNumber: '012345678901',
  identityCardIssuedDate: '2021-03-04',
  identityCardIssuedPlace: 'Cục Cảnh sát QLHC',
  personalEmail: 'an@example.com',
  phone: '0900000000',
  permanentAddress: 'Hà Nội',
  currentAddress: 'Hà Nội',
  emergencyContactName: 'Lan',
  emergencyContactRelationship: 'Vợ',
  emergencyContactPhone: '0911111111',
  taxCode: null,
  bankAccountNumber: null,
  socialInsuranceNumber: null,
};

// Các panel con dùng bảng antd (cần matchMedia/ResizeObserver) không thuộc phạm vi kiểm thử này.
jest.mock('../ui/hrm-family-panel', () => ({ HrmFamilyPanel: () => null }));
jest.mock('../ui/hrm-contract-panel', () => ({ HrmContractPanel: () => null }));
jest.mock('../ui/hrm-profile-documents-panel', () => ({
  HrmProfileDocumentsPanel: () => null,
}));

let patchBodies: Record<string, unknown>[] = [];
let postBodies: { path: string; body: Record<string, unknown> }[] = [];
let patchError: unknown = null;

beforeEach(() => {
  patchBodies = [];
  postBodies = [];
  patchError = null;
  hrmFetchMock.mockReset();
  hrmFetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (path === '/my-profile' && method === 'GET') return { data: profile };
    if (path === '/my-profile' && method === 'PATCH') {
      if (patchError) throw patchError;
      patchBodies.push(JSON.parse(String(init?.body)));
      return { data: {} };
    }
    if (method === 'POST') {
      postBodies.push({ path, body: JSON.parse(String(init?.body)) });
      return { data: { id: 'c1' } };
    }
    if (path.startsWith('/procedure-definitions/binding')) return { data: null };
    return { data: [] };
  }) as never);
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response),
  ) as never;
});

async function renderLoaded() {
  render(<HrmProfilePage />);
  await waitFor(() =>
    expect((screen.getByLabelText('Họ và tên') as HTMLInputElement).value).toBe(
      'Nguyễn Văn An',
    ),
  );
}

describe('Hồ sơ của tôi', () => {
  it('họ tên (do Core quản lý), ngày sinh, CCCD, ngày cấp, nơi cấp chỉ đọc và có hai nút đính chính', async () => {
    await renderLoaded();
    expect(screen.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeTruthy();
    for (const [label, value] of [
      ['Họ và tên', 'Nguyễn Văn An'],
      ['Ngày sinh', '20/05/1990'],
      ['Số CCCD / CMND', '012345678901'],
      ['Ngày cấp', '04/03/2021'],
      ['Nơi cấp', 'Cục Cảnh sát QLHC'],
    ]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.readOnly).toBe(true);
      expect(input.value).toBe(value);
    }
    expect(screen.getAllByRole('button', { name: 'Đề nghị đính chính' })).toHaveLength(2);
    expect(screen.getByText(/Do Core quản lý/)).toBeTruthy();
    expect(screen.queryByText(/Đổi tài khoản nhận lương/)).toBeNull();
  });

  it('dialog đính chính gửi đúng trường, giá trị cũ và mới tới /profile-corrections', async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đề nghị đính chính' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Đề nghị đính chính hồ sơ' });
    expect(dialog).toBeTruthy();
    expect(screen.queryByLabelText('Họ và tên đề xuất')).toBeNull();
    fireEvent.change(screen.getByLabelText('Ngày sinh đề xuất'), {
      target: { value: '21/06/1990' },
    });
    fireEvent.change(screen.getByLabelText(/Lý do đính chính/), {
      target: { value: 'Sai chính tả theo giấy khai sinh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đề nghị' }));
    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0].path).toBe('/profile-corrections');
    expect(postBodies[0].body.changes).toEqual({ dateOfBirth: '1990-06-21' });
    expect(Object.keys(postBodies[0].body.changes as object)).not.toContain('fullName');
    expect(postBodies[0].body.attributes).toEqual({});
    const reason = String(postBodies[0].body.reason);
    expect(reason).toContain('Ngày sinh: "20/05/1990" -> "21/06/1990"');
    expect(reason).toContain('Lý do điều chỉnh: Sai chính tả theo giấy khai sinh');
  });

  it('dialog đính chính không gửi khi chưa đổi giá trị nào', async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đề nghị đính chính' })[1]);
    await screen.findByRole('dialog', { name: 'Đề nghị đính chính hồ sơ' });
    fireEvent.change(screen.getByLabelText(/Lý do đính chính/), {
      target: { value: 'Kiểm tra' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đề nghị' }));
    expect((await screen.findByRole('alert')).textContent).toContain('chưa nhập giá trị đề xuất');
    expect(postBodies).toHaveLength(0);
  });

  it('PATCH /my-profile chỉ gửi trường liên lạc đã đổi, không gửi trường định danh', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByPlaceholderText('Chưa cập nhật số điện thoại'), {
      target: { value: '0988888888' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thông tin liên lạc/ }));
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ phone: '0988888888' });
    for (const key of [
      'fullName',
      'dateOfBirth',
      'identityCardNumber',
      'identityCardIssuedDate',
      'identityCardIssuedPlace',
    ]) {
      expect(Object.keys(patchBodies[0])).not.toContain(key);
    }
  });

  it('hiển thị lỗi HRM_PROFILE_CHANGE_REQUIRES_APPROVAL với danh sách trường và nút đính chính', async () => {
    patchError = new HrmApiError(
      'Cần gửi đơn đính chính',
      400,
      'HRM_PROFILE_CHANGE_REQUIRES_APPROVAL',
      { fields: ['dateOfBirth', 'identityCardNumber'] },
    );
    await renderLoaded();
    fireEvent.change(screen.getByPlaceholderText('Chưa cập nhật số điện thoại'), {
      target: { value: '0977777777' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thông tin liên lạc/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Ngày sinh, Số CCCD / CMND');
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đề nghị đính chính' }));
    await screen.findByRole('dialog', { name: 'Đề nghị đính chính hồ sơ' });
    expect(screen.queryByLabelText('Họ và tên đề xuất')).toBeNull();
    expect(screen.getByLabelText('Ngày sinh đề xuất')).toBeTruthy();
    expect(screen.getByLabelText('Số CCCD / CMND đề xuất')).toBeTruthy();
  });

  it('hiển thị message của API khi hồ sơ HRM chưa được khởi tạo (HRM_PROFILE_NOT_INITIALIZED)', async () => {
    const message = 'Bạn chưa có hồ sơ HRM. Vui lòng liên hệ bộ phận Nhân sự để khởi tạo.';
    hrmFetchMock.mockImplementation((async (path: string) => {
      if (path === '/my-profile')
        throw new HrmApiError(message, 404, 'HRM_PROFILE_NOT_INITIALIZED', {});
      return { data: [] };
    }) as never);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<HrmProfilePage />);
    expect((await screen.findByRole('alert')).textContent).toContain(message);
  });

  it('trường nhạy cảm null không làm hỏng màn hình', async () => {
    await renderLoaded();
    expect(screen.getAllByText('----').length).toBeGreaterThan(0);
  });
});
