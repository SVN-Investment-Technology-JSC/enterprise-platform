/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HrmEmployeeProfile } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { EmployeeLifecycleActions } from './hrm-lifecycle-actions';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.employee.manage'],
    loading: false,
    error: '',
    displayName: '',
    can: () => true,
    any: () => true,
  }),
}));

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const employee = {
  employeeId: 'e1',
  employeeCode: 'NV001',
  fullName: 'Nguyễn Văn An',
  email: 'an@example.com',
  joinDate: '2024-03-01',
  employmentStatus: 'OFFICIAL',
  updatedAt: '2024-03-01T00:00:00Z',
} as unknown as HrmEmployeeProfile;

describe('EmployeeLifecycleActions - cập nhật hồ sơ', () => {
  it('không có ô họ tên/email và PATCH không gửi fullName, workEmail', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ data: {} } as never);
    const onChanged = jest.fn(async () => undefined);
    render(<EmployeeLifecycleActions employee={employee} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    await screen.findByText(/Họ tên và email do Core quản lý/);
    expect(screen.queryByText('Họ và tên')).toBeNull();
    expect(screen.queryByText('Email công việc')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/employees/e1/profile');
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty('fullName');
    expect(body).not.toHaveProperty('workEmail');
    expect(body.expectedUpdatedAt).toBe(employee.updatedAt);
  });
});
