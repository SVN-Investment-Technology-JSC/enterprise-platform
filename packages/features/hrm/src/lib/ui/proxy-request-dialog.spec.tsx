/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { ProxyRequestDialog } from './proxy-request-dialog';

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});
// Form tạo đơn rất lớn: chỉ cần biết dialog dựng nó với dữ liệu của nhân viên được tạo hộ.
const mockFormProps = jest.fn();
jest.mock('./create-request-form', () => ({
  CreateRequestForm: (props: Record<string, unknown>) => {
    mockFormProps(props);
    return <div data-testid="create-form">{String(props['title'])}</div>;
  },
}));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const CANDIDATES = [
  { employeeId: 'e1', employeeCode: 'NV001', fullName: 'Nguyễn Văn An' },
  { employeeId: 'e2', employeeCode: 'NV002', fullName: 'Trần Thị Bình' },
];

function setup(candidates: unknown = CANDIDATES) {
  fetchMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/request-proxy/candidates')) {
      if (candidates instanceof Error) throw candidates;
      return { data: candidates };
    }
    if (path === '/employees/e1/leave-balances') return { data: [] };
    throw new Error(`Unexpected request ${path}`);
  }) as never);
  const onSubmitted = jest.fn();
  const onAbandoned = jest.fn();
  const onOpenChange = jest.fn();
  render(
    <ProxyRequestDialog
      open
      onOpenChange={onOpenChange}
      leaveTypes={[]}
      shifts={[]}
      projects={[]}
      onSubmitted={onSubmitted}
      onAbandoned={onAbandoned}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  fetchMock.mockReset();
  mockFormProps.mockReset();
});

/** Chọn một mục của SearchableSelect nằm trong ô có nhãn `label`. */
async function choose(label: RegExp, option: string) {
  const field = screen.getByText(label).closest('label') as HTMLElement;
  fireEvent.click(within(field).getByRole('textbox'));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('ProxyRequestDialog', () => {
  it('tải danh sách nhân viên được tạo hộ theo loại đơn đang chọn', async () => {
    setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toBe('/request-proxy/candidates?kind=leave&q=');
    expect(screen.getByText('Tạo đơn hộ nhân viên')).toBeTruthy();
  });

  it('nút Tiếp tục bị khóa cho đến khi chọn nhân viên và nhập lý do', async () => {
    setup();
    const next = (await screen.findByRole('button', { name: /Tiếp tục/ })) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Lý do tạo hộ'), { target: { value: 'Nhân viên báo ốm qua điện thoại' } });
    // Chưa chọn nhân viên nên vẫn khóa.
    expect(next.disabled).toBe(true);
  });

  it('chọn nhân viên và nhập lý do rồi Tiếp tục: dựng form theo nhân viên được tạo hộ kèm quỹ phép của họ', async () => {
    setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await choose(/Tạo cho/, 'NV001 · Nguyễn Văn An');
    fireEvent.change(screen.getByLabelText('Lý do tạo hộ'), { target: { value: '  Nhân viên báo ốm qua điện thoại  ' } });
    const next = screen.getByRole('button', { name: /Tiếp tục/ }) as HTMLButtonElement;
    await waitFor(() => expect(next.disabled).toBe(false));
    fireEvent.click(next);
    expect(await screen.findByTestId('create-form')).toBeTruthy();
    const props = mockFormProps.mock.calls.at(-1)?.[0] as { kind: string; title: string; data: Record<string, unknown> };
    expect(props.kind).toBe('leave');
    expect(props.title).toBe('Đơn nghỉ phép hộ Nguyễn Văn An');
    expect(props.data['employeeId']).toBe('e1');
    expect(props.data['onBehalf']).toEqual({ reason: 'Nhân viên báo ốm qua điện thoại', employeeName: 'Nguyễn Văn An (NV001)' });
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/employees/e1/leave-balances')).toBe(true));
  });

  it('đổi loại đơn thì tải lại danh sách theo phạm vi của loại đó và bỏ nhân viên đã chọn', async () => {
    setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await choose(/Loại đơn/, 'Tăng ca');
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/request-proxy/candidates?kind=ot&q=')).toBe(true));
  });

  it('báo lỗi khi không có quyền tạo hộ (máy chủ trả 403)', async () => {
    setup(new Error('Bạn không có quyền tạo đơn hộ nhân viên.'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Bạn không có quyền tạo đơn hộ nhân viên.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Tiếp tục/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('có thể hủy từ bước chọn', async () => {
    const { onOpenChange } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
