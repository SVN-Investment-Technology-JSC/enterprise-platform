/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { BulkInitializeEmployeesDialog } from './bulk-initialize-employees-dialog';
import { toast } from './toast';

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});

jest.mock('./toast', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const toastSuccess = toast.success as jest.Mock;

const people = [
  {
    employeeId: 'emp-1',
    userId: null,
    fullName: 'Nguyễn Văn An',
    email: 'an@example.com',
    source: 'employee',
  },
  {
    employeeId: null,
    userId: 'usr-2',
    fullName: 'Trần Thị Bình',
    email: null,
    source: 'user',
  },
  {
    employeeId: 'emp-3',
    userId: null,
    fullName: 'Lê Văn Cường',
    email: 'cuong@example.com',
    source: 'employee',
  },
];

let postBodies: { items: Record<string, unknown>[] }[] = [];

function mockApi(list: unknown[]) {
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/employees/core-people') return { data: list };
    if (path === '/employees/initialize-bulk' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      postBodies.push(body);
      return {
        data: { created: body.items.length, employeeIds: [] },
      };
    }
    return { data: [] };
  }) as never);
}

async function renderDialog(
  props: { onClose?: () => void; onDone?: () => Promise<void> } = {},
) {
  const onClose = props.onClose ?? jest.fn();
  const onDone = props.onDone ?? jest.fn(async () => undefined);
  render(<BulkInitializeEmployeesDialog open onClose={onClose} onDone={onDone} />);
  await screen.findByText('Nguyễn Văn An');
  return { onClose, onDone };
}

function setCommonDate() {
  fireEvent.change(screen.getByLabelText('Ngày vào làm chung'), {
    target: { value: '01/09/2026' },
  });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /^Khởi tạo \d+ hồ sơ$/ }));
}

beforeEach(() => {
  postBodies = [];
  fetchMock.mockReset();
  toastSuccess.mockReset();
});

describe('BulkInitializeEmployeesDialog (khởi tạo hàng loạt từ Core)', () => {
  it('mặc định chọn tất cả và gửi đúng body với mã NV001, NV002...', async () => {
    mockApi(people);
    const { onDone, onClose } = await renderDialog();
    expect(screen.getByTestId('bulk-selected-count').textContent).toBe('Đã chọn 3 / 3');
    setCommonDate();
    submit();
    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0].items).toEqual([
      {
        employeeCode: 'NV001',
        joinDate: '2026-09-01',
        employmentStatus: 'OFFICIAL',
        employeeId: 'emp-1',
      },
      {
        employeeCode: 'NV002',
        joinDate: '2026-09-01',
        employmentStatus: 'OFFICIAL',
        userId: 'usr-2',
      },
      {
        employeeCode: 'NV003',
        joinDate: '2026-09-01',
        employmentStatus: 'OFFICIAL',
        employeeId: 'emp-3',
      },
    ]);
    for (const item of postBodies[0].items) {
      expect(item).not.toHaveProperty('fullName');
      expect(item).not.toHaveProperty('workEmail');
    }
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('đổi tiền tố, số bắt đầu và độ rộng thì sinh lại mã chưa sửa tay', async () => {
    mockApi(people);
    await renderDialog();
    setCommonDate();
    fireEvent.change(screen.getByLabelText('Mã nhân viên của Trần Thị Bình'), {
      target: { value: 'KHAC-9' },
    });
    fireEvent.change(screen.getByLabelText('Tiền tố mã nhân viên'), {
      target: { value: 'SV' },
    });
    fireEvent.change(screen.getByLabelText('Số bắt đầu'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Độ rộng số'), { target: { value: '4' } });
    submit();
    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0].items.map((item) => item.employeeCode)).toEqual([
      'SV0010',
      'KHAC-9',
      'SV0012',
    ]);
  });

  it('bỏ chọn một dòng thì không gửi dòng đó và mã đánh lại liên tục', async () => {
    mockApi(people);
    await renderDialog();
    setCommonDate();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Trần Thị Bình' }));
    expect(screen.getByTestId('bulk-selected-count').textContent).toBe('Đã chọn 2 / 3');
    submit();
    await waitFor(() => expect(postBodies).toHaveLength(1));
    const items = postBodies[0].items;
    expect(items).toHaveLength(2);
    expect(items.some((item) => item.userId === 'usr-2')).toBe(false);
    expect(items.map((item) => item.employeeCode)).toEqual(['NV001', 'NV002']);
  });

  it('sửa tay mã trùng thì báo lỗi và không gọi POST', async () => {
    mockApi(people);
    await renderDialog();
    setCommonDate();
    fireEvent.change(screen.getByLabelText('Mã nhân viên của Lê Văn Cường'), {
      target: { value: 'NV001' },
    });
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('NV001');
    expect(alert.textContent).toContain('trùng');
    expect(postBodies).toHaveLength(0);
  });

  it('thiếu ngày vào làm chung thì báo lỗi và không gọi POST', async () => {
    mockApi(people);
    await renderDialog();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ngày vào làm');
    expect(postBodies).toHaveLength(0);
  });

  it('danh sách rỗng thì hiện thông báo và khoá nút gửi', async () => {
    mockApi([]);
    render(
      <BulkInitializeEmployeesDialog open onClose={jest.fn()} onDone={jest.fn()} />,
    );
    expect(
      await screen.findByText(/Mọi người đã khai báo ở Core đều đã có hồ sơ HRM/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Người dùng' }).getAttribute('href')).toBe(
      '/users',
    );
    expect(screen.getByText('Nạp nhân sự từ Core', { selector: 'h2' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /^Khởi tạo \d+ hồ sơ$/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
