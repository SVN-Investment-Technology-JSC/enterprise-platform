import { procedureNameFor, workspaceWorkItemUrl } from './workspace-api';

describe('procedureNameFor', () => {
  it('ghép mã dự án, mã công việc bỏ gạch nối và tên', () => {
    expect(procedureNameFor('EVN', 'CV-013', 'Mua cáp Anten')).toBe('EVN-CV013-Mua cáp Anten');
  });

  it('giữ nguyên mã công việc đã không có gạch nối', () => {
    expect(procedureNameFor('EVN', 'CV012', 'Thanh toán chi phí lắp đặt')).toBe(
      'EVN-CV012-Thanh toán chi phí lắp đặt',
    );
  });
});

describe('workspaceWorkItemUrl', () => {
  it('mở thẳng công việc trong trang Dự án của Workspace', () => {
    expect(workspaceWorkItemUrl('p-1', 'w-9')).toBe(
      '/modules/workspace?project=p-1#projects/work-item/w-9',
    );
  });
});
