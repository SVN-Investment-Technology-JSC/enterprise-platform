import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as api from '../workspace-api';
import { ProjectReportGroupSettings, reportGroupDraftError } from './project-report-group-settings';

jest.mock('../workspace-api', () => ({
  listProjectReportGroups: jest.fn(),
  saveProjectReportGroups: jest.fn(),
}));

jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;

const items = [
  { id: 'g-dv', name: 'Dịch vụ', sortOrder: 0 },
  { id: 'g-tn', name: 'Thí nghiệm', sortOrder: 1 },
];

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const saveButton = () => screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;

describe('ProjectReportGroupSettings', () => {
  it('người không phải quản trị chỉ xem danh sách, không có ô sửa và nút Lưu', async () => {
    mocked.listProjectReportGroups.mockResolvedValue({ items, canEdit: false });
    render(<ProjectReportGroupSettings />);
    expect(await screen.findByText('Dịch vụ')).toBeTruthy();
    expect(screen.getByText('Thí nghiệm')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
    expect(screen.getByText('Chỉ quản trị viên được thêm hoặc sửa nhóm báo cáo.')).toBeTruthy();
  });

  it('quản trị: thêm, đổi tên, đổi thứ tự, xoá rồi Lưu gửi cả danh sách theo thứ tự, giữ id nhóm cũ', async () => {
    mocked.listProjectReportGroups.mockResolvedValue({ items, canEdit: true });
    mocked.saveProjectReportGroups.mockResolvedValue({
      items: [
        { id: 'g-tn', name: 'Thí nghiệm điện', sortOrder: 0 },
        { id: 'g-new', name: 'O&M', sortOrder: 1 },
      ],
      canEdit: true,
    });
    render(<ProjectReportGroupSettings />);
    await screen.findByDisplayValue('Dịch vụ');
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Tên nhóm báo cáo 2'), { target: { value: 'Thí nghiệm điện' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đưa nhóm 2 lên trên' }));
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhóm/ }));
    fireEvent.change(screen.getByLabelText('Tên nhóm báo cáo 3'), { target: { value: 'O&M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xoá nhóm 2' }));
    expect(screen.getByText(/1 nhóm bị xoá/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocked.saveProjectReportGroups).toHaveBeenCalledWith({
      items: [{ id: 'g-tn', name: 'Thí nghiệm điện' }, { name: 'O&M' }],
    });
    expect(screen.getByDisplayValue('O&M')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('tên trống hay trùng thì báo ngay và khoá nút Lưu', async () => {
    mocked.listProjectReportGroups.mockResolvedValue({ items, canEdit: true });
    render(<ProjectReportGroupSettings />);
    await screen.findByDisplayValue('Dịch vụ');
    fireEvent.change(screen.getByLabelText('Tên nhóm báo cáo 2'), { target: { value: ' dịch  VỤ ' } });
    expect(screen.getByRole('alert').textContent).toContain('Trùng tên nhóm báo cáo');
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Tên nhóm báo cáo 2'), { target: { value: '   ' } });
    expect(screen.getByRole('alert').textContent).toContain('không được để trống');
    expect(mocked.saveProjectReportGroups).not.toHaveBeenCalled();
  });
});

describe('reportGroupDraftError', () => {
  it('cùng luật với server: trống, quá 80 ký tự, trùng, quá 30 nhóm', () => {
    expect(reportGroupDraftError([{ name: 'Dịch vụ' }, { name: 'O&M' }])).toBeUndefined();
    expect(reportGroupDraftError([{ name: ' ' }])).toContain('để trống');
    expect(reportGroupDraftError([{ name: 'a'.repeat(81) }])).toContain('80 ký tự');
    expect(reportGroupDraftError([{ name: 'Bán hàng' }, { name: 'BÁN HÀNG' }])).toContain('Trùng');
    expect(reportGroupDraftError(Array.from({ length: 31 }, (_, index) => ({ name: `N${index}` })))).toContain(
      'Tối đa 30',
    );
  });
});
