import type { TenantAuthorizationAuditEntry } from '@enterprise-platform/contracts-identity';
import {
  buildHistoryItems,
  DELETED_ACTOR_LABEL,
  DELETED_ROLE_LABEL,
  describeEntry,
  diffLists,
} from './history-model';

const names = new Map([
  ['r1', 'Kế toán'],
  ['r2', 'Nhân sự'],
]);

function entry(
  partial: Partial<TenantAuthorizationAuditEntry>,
): TenantAuthorizationAuditEntry {
  return {
    id: 'e1',
    operation: 'user.roles.replace',
    actorId: 'a1',
    actorName: 'Admin',
    createdAt: '2026-10-01T08:00:00.000Z',
    before: { roleIds: [] },
    after: { roleIds: [] },
    ...partial,
  };
}

describe('diffLists', () => {
  it('tách phần thêm và phần gỡ', () => {
    expect(diffLists(['a', 'b'], ['b', 'c'])).toEqual({
      added: ['c'],
      removed: ['a'],
    });
  });
});

describe('describeEntry', () => {
  it('mô tả thêm và gỡ vai trò theo tên', () => {
    const item = describeEntry(
      entry({ before: { roleIds: ['r1'] }, after: { roleIds: ['r2'] } }),
      names,
    );
    expect(item.operation).toBe('roles');
    expect(item.changes).toEqual([
      { kind: 'added', text: 'Thêm vai trò Nhân sự' },
      { kind: 'removed', text: 'Gỡ vai trò Kế toán' },
    ]);
  });

  it('vai trò không còn tồn tại hiện "Vai trò đã xóa"', () => {
    const item = describeEntry(entry({ after: { roleIds: ['gone'] } }), names);
    expect(item.changes[0].text).toBe(`Thêm vai trò ${DELETED_ROLE_LABEL}`);
  });

  it('mô tả quyền bổ sung bằng nhãn trong danh mục, khóa lạ giữ nguyên', () => {
    const item = describeEntry(
      entry({
        operation: 'user.permissions.replace',
        before: { actionKeys: ['x.unknown'] },
        after: { actionKeys: ['core.users.read'] },
      }),
      names,
    );
    expect(item.operation).toBe('permissions');
    expect(item.changes).toHaveLength(2);
    expect(item.changes[0].kind).toBe('added');
    expect(item.changes[0].text).not.toContain('core.users.read');
    expect(item.changes[1].text).toBe('Gỡ quyền bổ sung x.unknown');
  });

  it('chịu được before/after sai dạng và người thao tác đã xóa', () => {
    const item = describeEntry(
      entry({ before: null, after: 'x', actorName: null }),
      names,
    );
    expect(item.changes).toEqual([]);
    expect(item.actorName).toBe(DELETED_ACTOR_LABEL);
  });

  it('thao tác lạ không có thay đổi chi tiết', () => {
    expect(
      describeEntry(entry({ operation: 'other.op' }), names).operation,
    ).toBe('other');
  });
});

describe('buildHistoryItems', () => {
  it('sắp mới nhất trước', () => {
    const items = buildHistoryItems(
      [
        entry({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
        entry({ id: 'new', createdAt: '2026-06-01T00:00:00Z' }),
      ],
      names,
    );
    expect(items.map((i) => i.id)).toEqual(['new', 'old']);
  });
});
