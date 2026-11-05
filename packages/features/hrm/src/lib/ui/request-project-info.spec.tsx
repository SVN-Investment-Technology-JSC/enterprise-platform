import { render, screen } from '@testing-library/react';
import { RequestProjectField, RequestProjectInfo, resolveRequestProject } from './request-project-info';

const PROJECTS = [{ id: 'p1', code: 'EVN', name: 'Điện lực Miền Trung', status: 'active' }];

describe('RequestProjectInfo', () => {
  it('đơn không gắn dự án: không hiện thẻ', () => {
    const { container } = render(<RequestProjectInfo details={{ id: 'r1' }} projects={PROJECTS} />);
    expect(container.firstChild).toBeNull();
  });

  it('đơn chỉ lưu mã dự án: lấy mã, tên và trạng thái từ danh sách dự án', () => {
    render(<RequestProjectInfo details={{ projectId: 'p1' }} projects={PROJECTS} />);
    expect(screen.getByText('EVN - Điện lực Miền Trung')).toBeTruthy();
    expect(screen.getByText('Mã dự án:')).toBeTruthy();
    expect(screen.getByText('Đang triển khai')).toBeTruthy();
  });

  it('đơn làm thêm giờ: đọc tên dự án trong attributes', () => {
    render(
      <RequestProjectInfo
        details={{ attributes: { projectCode: 'ABC', projectName: 'Kho Bình Dương' } }}
        projects={[]}
      />,
    );
    expect(screen.getByText('ABC - Kho Bình Dương')).toBeTruthy();
    expect(screen.queryByText('Trạng thái dự án:')).toBeNull();
  });

  it('đơn công tác: hiện mã đơn trong dự án khi Workspace đã ghi nhận', () => {
    render(
      <RequestProjectInfo
        details={{
          projectLink: {
            projectId: 'p1',
            projectCode: 'EVN',
            projectName: 'Điện lực Miền Trung',
            status: 'REGISTERED',
            projectRequestCode: 'DT-0042',
          },
        }}
        projects={PROJECTS}
      />,
    );
    expect(screen.getByText('DT-0042')).toBeTruthy();
    expect(screen.getByText('Đã ghi nhận')).toBeTruthy();
  });

  it('Workspace từ chối: hiện lý do', () => {
    render(
      <RequestProjectInfo
        details={{
          projectLink: { projectId: 'p1', status: 'REJECTED', rejectionReason: 'Bạn không tham gia dự án' },
        }}
        projects={PROJECTS}
      />,
    );
    expect(screen.getByText('Workspace từ chối')).toBeTruthy();
    expect(screen.getByText('Bạn không tham gia dự án')).toBeTruthy();
  });

  it('chỉ có mã định danh mà không tra được dự án: vẫn hiện mã định danh', () => {
    const view = resolveRequestProject({ projectId: 'zzz' }, []);
    expect(view?.id).toBe('zzz');
    render(<RequestProjectInfo details={{ projectId: 'zzz' }} projects={[]} />);
    expect(screen.getByText('zzz')).toBeTruthy();
  });

  it('khung chi tiết đơn: chỉ hiện tên dự án, không kèm mã, trạng thái hay mã đơn', () => {
    render(
      <RequestProjectField
        details={{
          projectId: 'p1',
          projectLink: { projectId: 'p1', projectCode: 'EVN', status: 'REGISTERED', projectRequestCode: 'DT001' },
        }}
        projects={PROJECTS}
      />,
    );
    expect(screen.getByTestId('card-project').textContent).toBe('Điện lực Miền Trung');
  });

  it('khung chi tiết đơn: đơn không có dự án thì không thêm dòng', () => {
    const { container } = render(<RequestProjectField details={{ id: 'r1' }} projects={PROJECTS} />);
    expect(container.firstChild).toBeNull();
  });
});
