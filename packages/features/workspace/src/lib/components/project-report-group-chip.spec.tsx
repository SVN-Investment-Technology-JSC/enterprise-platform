import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../workspace-api';
import { ProjectReportGroupChip } from './project-report-group-chip';

jest.mock('../workspace-api', () => ({
  listProjectReportGroups: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

const CATALOG = {
  items: [
    { id: 'g-dv', name: 'Dịch vụ', sortOrder: 0 },
    { id: 'g-tn', name: 'Thí nghiệm', sortOrder: 1 },
  ],
  canEdit: false,
};

beforeEach(() => {
  mocked.listProjectReportGroups.mockResolvedValue(CATALOG);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe('ProjectReportGroupChip', () => {
  it('hiện tên nhóm của dự án; chưa gán hoặc id của nhóm đã xoá thì hiện "Chưa có nhóm báo cáo"', async () => {
    const { rerender } = render(<ProjectReportGroupChip reportGroupId="g-tn" />);
    expect(await screen.findByText('Nhóm báo cáo: Thí nghiệm')).toBeTruthy();
    rerender(<ProjectReportGroupChip reportGroupId={null} />);
    expect(screen.getByText('Chưa có nhóm báo cáo')).toBeTruthy();
    rerender(<ProjectReportGroupChip reportGroupId="g-da-xoa" />);
    expect(screen.getByText('Chưa có nhóm báo cáo')).toBeTruthy();
  });

  it('không được sửa thì chỉ là chữ, không có nút mở hộp chọn', async () => {
    render(<ProjectReportGroupChip reportGroupId="g-dv" onChange={jest.fn()} />);
    await screen.findByText('Nhóm báo cáo: Dịch vụ');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('tenant chưa lập danh mục: chip vẫn hiện, mở ra chỉ đường tới Cài đặt > Nhóm báo cáo', async () => {
    mocked.listProjectReportGroups.mockResolvedValue({ items: [], canEdit: false });
    render(<ProjectReportGroupChip reportGroupId={null} canEdit onChange={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Chưa có nhóm báo cáo/ }));
    const link = await screen.findByRole('link', { name: 'Cài đặt > Nhóm báo cáo' });
    expect(link.getAttribute('href')).toBe('#settings/project-report-groups');
  });

  it('được sửa: bấm chip mở hộp chọn, chọn nhóm khác thì lưu rồi đóng', async () => {
    const onChange = jest.fn().mockResolvedValue(undefined);
    render(<ProjectReportGroupChip reportGroupId="g-dv" canEdit onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /Nhóm báo cáo: Dịch vụ/ }));
    expect(await screen.findByRole('dialog', { name: 'Chọn nhóm báo cáo' })).toBeTruthy();
    // Mở lại hộp thì nạp lại danh mục (để thấy nhóm vừa thêm ở Cài đặt).
    await waitFor(() => expect(mocked.listProjectReportGroups).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByDisplayValue('Dịch vụ'));
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Thí nghiệm' }));
    });
    expect(onChange).toHaveBeenCalledWith('g-tn');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('chọn "Chưa có nhóm báo cáo" là bỏ nhóm (null)', async () => {
    const onChange = jest.fn().mockResolvedValue(undefined);
    render(<ProjectReportGroupChip reportGroupId="g-dv" canEdit onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /Nhóm báo cáo: Dịch vụ/ }));
    fireEvent.click(await screen.findByDisplayValue('Dịch vụ'));
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Chưa có nhóm báo cáo' }));
    });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('lưu lỗi thì hộp chọn giữ nguyên và hiện lời lỗi', async () => {
    const onChange = jest.fn().mockRejectedValue({ message: 'Bạn không có quyền truy cập dự án này.' });
    render(<ProjectReportGroupChip reportGroupId={null} canEdit onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /Chưa có nhóm báo cáo/ }));
    fireEvent.click(await screen.findByDisplayValue('Chưa có nhóm báo cáo'));
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Dịch vụ' }));
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Bạn không có quyền truy cập dự án này.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
