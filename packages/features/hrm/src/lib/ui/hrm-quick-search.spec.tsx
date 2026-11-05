/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HrmQuickSearch, fold } from './hrm-quick-search';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';

jest.mock('../hrm-permissions', () => ({
  ATTENDANCE_MONITOR_PERMISSIONS: ['hrm.attendance.read'],
  useHrmPermissions: () => ({
    actions: ['hrm.self.read', 'hrm.employee.read', 'hrm.leave.manage'],
    loading: false,
    error: '',
    displayName: 'Nguyễn Văn A',
    can: (p: string) =>
      ['hrm.self.read', 'hrm.employee.read', 'hrm.leave.manage'].includes(p),
    any: (list: readonly string[]) =>
      list.some((p) =>
        ['hrm.self.read', 'hrm.employee.read', 'hrm.leave.manage'].includes(p),
      ),
  }),
}));

jest.mock('../hrm-api', () => ({
  hrmEmployeeOptions: jest.fn(),
  hrmFetch: jest.fn(),
}));

const mockHrmEmployeeOptions = hrmEmployeeOptions as jest.MockedFunction<
  typeof hrmEmployeeOptions
>;
const mockHrmFetch = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

describe('HrmQuickSearch', () => {
  beforeAll(() => {
    // jsdom không cài scrollIntoView
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockHrmEmployeeOptions.mockResolvedValue([
      { value: 'emp-1', label: 'NV001 · Nguyễn Văn A', department: 'Kỹ thuật' },
      { value: 'emp-2', label: 'NV002 · Trần Thị B', department: 'Kế toán' },
    ]);
    mockHrmFetch.mockImplementation(async (path: string) => {
      if (path === '/request-types') {
        return {
          data: [
            { id: 'rt-1', code: 'LEAVE', name: 'Nghỉ phép năm' },
            { id: 'rt-2', code: 'OT', name: 'Làm thêm giờ' },
          ],
        };
      }
      if (path.startsWith('/employees?search=')) {
        return {
          data: [
            {
              employeeId: 'emp-1',
              employeeCode: 'NV001',
              fullName: 'Nguyễn Văn A',
              departmentName: 'Phòng Kỹ thuật',
              positionName: 'Kỹ sư phần mềm',
            },
          ],
        };
      }
      if (path.startsWith('/positions?search=')) {
        return {
          data: [
            {
              position_id: 'pos-1',
              position_code: 'KS',
              position_name: 'Kỹ sư phần mềm',
              unit_name: 'Phòng Kỹ thuật',
              active_employee_count: 5,
            },
          ],
        };
      }
      return { data: [] };
    });
  });

  describe('fold helper', () => {
    it('bỏ dấu và chuyển chữ hoa thành chữ thường chuẩn tiếng Việt', () => {
      expect(fold('Nhân sự')).toBe('nhan su');
      expect(fold('Đơn từ & Chấm công')).toBe('don tu & cham cong');
      expect(fold('ĐẶNG THỊ NGỌC')).toBe('dang thi ngoc');
    });
  });

  it('không hiển thị khi open = false', () => {
    render(<HrmQuickSearch open={false} onClose={jest.fn()} onPick={jest.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hiển thị hộp thoại, ô tìm kiếm và danh sách trang mặc định khi open = true', async () => {
    render(<HrmQuickSearch open={true} onClose={jest.fn()} onPick={jest.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Tìm nhanh' })).toBeTruthy();
    expect(
      screen.getByPlaceholderText('Tìm nhân sự, đơn từ, chức năng, ca làm việc…'),
    ).toBeTruthy();

    // Mặc định hiện danh sách trang và thao tác nhanh
    expect(screen.getByText('Bàn làm việc')).toBeTruthy();
    expect(screen.getByText('Tạo đơn xin nghỉ phép')).toBeTruthy();
    expect(screen.getByText(/để chọn/)).toBeTruthy();
  });

  it('lọc danh sách trang và thao tác nhanh theo từ khoá không dấu', async () => {
    render(<HrmQuickSearch open={true} onClose={jest.fn()} onPick={jest.fn()} />);

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'nghi phep' } });

    await waitFor(() => {
      expect(screen.getByText('Tạo đơn xin nghỉ phép')).toBeTruthy();
    });
  });

  it('tìm kiếm nhân sự và chức danh từ server khi gõ từ 2 ký tự', async () => {
    render(<HrmQuickSearch open={true} onClose={jest.fn()} onPick={jest.fn()} />);

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'Nguyen' } });

    await waitFor(() => {
      expect(screen.getByText('NV001 · Nguyễn Văn A')).toBeTruthy();
    });
  });

  it('gọi onPick và onClose khi người dùng nhấn Enter trên kết quả đang chọn', async () => {
    const onPick = jest.fn();
    const onClose = jest.fn();

    render(<HrmQuickSearch open={true} onClose={onClose} onPick={onPick} />);

    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('đóng hộp thoại khi người dùng nhấn Escape hoặc bấm vào vùng nền overlay', () => {
    const onClose = jest.fn();
    render(<HrmQuickSearch open={true} onClose={onClose} onPick={jest.fn()} />);

    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const overlay = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('di chuyển lựa chọn bằng phím mũi tên lên/xuống', () => {
    render(<HrmQuickSearch open={true} onClose={jest.fn()} onPick={jest.fn()} />);

    const input = screen.getByRole('searchbox');
    const option0 = screen.getByRole('option', { selected: true });
    expect(option0.getAttribute('id')).toBe('hrm-quick-search-0');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const option1 = screen.getByRole('option', { selected: true });
    expect(option1.getAttribute('id')).toBe('hrm-quick-search-1');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const optionBack = screen.getByRole('option', { selected: true });
    expect(optionBack.getAttribute('id')).toBe('hrm-quick-search-0');
  });

  it('hiển thị thông báo khi không tìm thấy kết quả nào', async () => {
    render(<HrmQuickSearch open={true} onClose={jest.fn()} onPick={jest.fn()} />);

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'xyz_khong_ton_tai_12345' } });

    await waitFor(() => {
      expect(
        screen.getByText('Không tìm thấy trang, nhân sự hoặc chức năng nào khớp.'),
      ).toBeTruthy();
    });
  });
});
