import type { Project } from '@enterprise-platform/contracts-workspace';
import {
  finishProjectCreate,
  linkRelatedObjects,
  loadEntityRelatedRows,
  saveRelatedChanges,
} from './related-objects-link';
import { pendingRelatedRow } from './related-objects.model';
import * as api from './workspace-api';

jest.mock('./workspace-api', () => ({
  addProjectRelatedObject: jest.fn(),
  addWorkItemRelatedObject: jest.fn(),
  updateProjectFinance: jest.fn(),
  listMembers: jest.fn(),
  setMembers: jest.fn(),
  listProjectRelatedObjects: jest.fn(),
  listWorkItemRelatedObjects: jest.fn(),
  removeRelatedObject: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

const project = { id: 'p1', code: 'DA-001' } as Project;
const contract = pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', label: 'HĐ-001' });
const quote = pendingRelatedRow({ kind: 'crm.quote', objectId: 'q1', label: 'BG-010' });

beforeEach(() => {
  jest.resetAllMocks();
});

describe('linkRelatedObjects', () => {
  it('gắn lần lượt, dòng lỗi được ghi lại và các dòng sau vẫn chạy', async () => {
    mocked.addWorkItemRelatedObject
      .mockRejectedValueOnce({ code: 'RELATED_OBJECT_FORBIDDEN', message: 'Bạn không có quyền.' })
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof api.addWorkItemRelatedObject>>);
    const failures = await linkRelatedObjects({ type: 'work_item', id: 'w1' }, [
      contract,
      pendingRelatedRow({ kind: 'crm.quote' }),
      quote,
    ]);
    expect(mocked.addWorkItemRelatedObject.mock.calls).toEqual([
      ['w1', { kind: 'crm.contract', objectId: 'c1' }],
      ['w1', { kind: 'crm.quote', objectId: 'q1' }],
    ]);
    expect(failures).toEqual([{ item: contract, message: 'Bạn không có quyền.' }]);
  });
});

describe('finishProjectCreate', () => {
  it('giá trị hợp đồng và thành viên chạy trước như cũ; liên kết chạy sau cùng, lỗi chỉ thành cảnh báo', async () => {
    const order: string[] = [];
    mocked.updateProjectFinance.mockImplementation(async () => {
      order.push('finance');
      return {} as Awaited<ReturnType<typeof api.updateProjectFinance>>;
    });
    mocked.listMembers.mockResolvedValue({ items: [] });
    mocked.setMembers.mockImplementation(async () => {
      order.push('members');
      return { items: [] };
    });
    mocked.addProjectRelatedObject
      .mockImplementationOnce(async () => {
        order.push('related');
        return {} as Awaited<ReturnType<typeof api.addProjectRelatedObject>>;
      })
      .mockRejectedValueOnce({ message: 'Hồ sơ không còn.' });

    const warnings = await finishProjectCreate(project, {
      contractValue: 120_000_000,
      members: [{ userId: 'u2', role: 'member' }],
      relatedObjects: [contract, quote],
    });

    expect(order).toEqual(['finance', 'members', 'related']);
    expect(mocked.updateProjectFinance).toHaveBeenCalledWith('p1', { contractValue: 120_000_000 });
    expect(mocked.setMembers).toHaveBeenCalledWith('p1', { members: [{ userId: 'u2', role: 'member' }] });
    expect(warnings).toEqual([
      'Chưa gắn được 1 đối tượng liên quan vào dự án DA-001: BG-010 (Hồ sơ không còn). Có thể gắn lại ở tab Liên quan của dự án.',
    ]);
  });

  it('lỗi ghi giá trị hợp đồng vẫn ném ra như trước khi có tính năng này', async () => {
    mocked.updateProjectFinance.mockRejectedValue({ message: 'Không có quyền ghi tài chính.' });
    await expect(finishProjectCreate(project, { contractValue: 1, relatedObjects: [contract] })).rejects.toEqual({
      message: 'Không có quyền ghi tài chính.',
    });
    expect(mocked.addProjectRelatedObject).not.toHaveBeenCalled();
  });

  it('không có gì đi kèm thì không gọi API nào và không cảnh báo', async () => {
    expect(await finishProjectCreate(project, {})).toEqual([]);
    expect(mocked.updateProjectFinance).not.toHaveBeenCalled();
    expect(mocked.addProjectRelatedObject).not.toHaveBeenCalled();
    expect(mocked.listMembers).not.toHaveBeenCalled();
  });
});

describe('form sửa', () => {
  it('đọc liên kết của chính dự án (bỏ liên kết gắn ở công việc) kèm quyền thêm', async () => {
    const base = {
      projectId: 'p1',
      kind: 'crm.contract',
      moduleKey: 'crm',
      label: 'HĐ-001',
      launchUrl: '/modules/crm',
      fields: [],
      canRemove: false,
      createdBy: 'u1',
      createdAt: '2026-11-20T03:00:00.000Z',
    };
    mocked.listProjectRelatedObjects.mockResolvedValue({
      canAdd: true,
      degraded: false,
      items: [
        { ...base, id: 'r1', entityType: 'project', entityId: 'p1', objectId: 'c1' },
        { ...base, id: 'r2', entityType: 'work_item', entityId: 'w1', objectId: 'c2' },
      ],
    });
    const result = await loadEntityRelatedRows({ type: 'project', id: 'p1' });
    expect(result.canAdd).toBe(true);
    expect(result.rows.map((row) => row.existingId)).toEqual(['r1']);
  });

  it('lưu: gỡ liên kết bị bỏ, gắn dòng mới; lỗi chỉ thành cảnh báo', async () => {
    mocked.removeRelatedObject.mockRejectedValue({ message: 'Không có quyền gỡ.' });
    mocked.addWorkItemRelatedObject.mockResolvedValue({} as Awaited<ReturnType<typeof api.addWorkItemRelatedObject>>);
    const old = pendingRelatedRow({ kind: 'crm.contract', objectId: 'c9', label: 'HĐ-009', existingId: 'r9' });
    const result = await saveRelatedChanges({ type: 'work_item', id: 'w1' }, [old], [quote], 'công việc CV-001');
    expect(mocked.removeRelatedObject).toHaveBeenCalledWith('r9');
    expect(mocked.addWorkItemRelatedObject).toHaveBeenCalledWith('w1', { kind: 'crm.quote', objectId: 'q1' });
    expect(result.changed).toBe(true);
    expect(result.warnings).toEqual([
      'Chưa gỡ được 1 đối tượng liên quan khỏi công việc CV-001: HĐ-009 (Không có quyền gỡ).',
    ]);
  });

  it('không đổi gì thì không gọi API', async () => {
    const kept = pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', existingId: 'r1' });
    expect(await saveRelatedChanges({ type: 'project', id: 'p1' }, [kept], [kept], 'dự án')).toEqual({
      warnings: [],
      changed: false,
    });
    expect(mocked.removeRelatedObject).not.toHaveBeenCalled();
    expect(mocked.addProjectRelatedObject).not.toHaveBeenCalled();
  });
});
