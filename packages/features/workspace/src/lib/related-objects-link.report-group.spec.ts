import type { Project } from '@enterprise-platform/contracts-workspace';
import { finishProjectCreate } from './related-objects-link';
import { pendingRelatedRow } from './related-objects.model';
import * as api from './workspace-api';

jest.mock('./workspace-api', () => ({
  addProjectRelatedObject: jest.fn(),
  updateProjectFinance: jest.fn(),
  listMembers: jest.fn(),
  setMembers: jest.fn(),
  setProjectReportGroup: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;
const project = { id: 'p1', code: 'DA-001' } as Project;

beforeEach(() => {
  jest.resetAllMocks();
});

describe('finishProjectCreate: nhóm báo cáo chọn lúc tạo', () => {
  it('gán sau khi dự án đã có, sau cả đối tượng liên quan', async () => {
    const order: string[] = [];
    mocked.addProjectRelatedObject.mockImplementation(async () => {
      order.push('related');
      return {} as Awaited<ReturnType<typeof api.addProjectRelatedObject>>;
    });
    mocked.setProjectReportGroup.mockImplementation(async () => {
      order.push('report-group');
      return project;
    });
    const warnings = await finishProjectCreate(project, {
      relatedObjects: [pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', label: 'HĐ-001' })],
      reportGroupId: 'g-dv',
    });
    expect(order).toEqual(['related', 'report-group']);
    expect(mocked.setProjectReportGroup).toHaveBeenCalledWith('p1', { reportGroupId: 'g-dv' });
    expect(warnings).toEqual([]);
  });

  it('gán lỗi chỉ thành cảnh báo, không ném', async () => {
    mocked.setProjectReportGroup.mockRejectedValue({ message: 'Nhóm báo cáo không còn trong danh mục.' });
    const warnings = await finishProjectCreate(project, { reportGroupId: 'g-x' });
    expect(warnings).toEqual([
      'Dự án DA-001 đã tạo nhưng chưa gán được nhóm báo cáo (Nhóm báo cáo không còn trong danh mục). Gán lại trong trang dự án.',
    ]);
  });

  it('không chọn nhóm thì không gọi API', async () => {
    expect(await finishProjectCreate(project, {})).toEqual([]);
    expect(mocked.setProjectReportGroup).not.toHaveBeenCalled();
  });
});
