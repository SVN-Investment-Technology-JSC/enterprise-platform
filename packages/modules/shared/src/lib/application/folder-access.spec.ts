import {
  canSee,
  folderRoles,
  shareActive,
  shareMatches,
  vietnamToday,
  type AccessFolder,
  type ShareRecord,
} from './folder-access.js';
import { membershipNodes, nodePath, type OrganizationSnapshot } from './organization.port.js';
import type { SharedActor } from './shared-actor.js';

const folder = (id: string, parentId?: string, createdBy = 'admin'): AccessFolder => ({
  id,
  parentId,
  name: id,
  createdBy,
  isActive: true,
});

const share = (folderId: string, grant: Partial<ShareRecord>): ShareRecord => ({
  folderId,
  principalType: 'everyone',
  role: 'viewer',
  updatedBy: 'admin',
  updatedAt: '2026-10-16T00:00:00.000Z',
  ...grant,
});

const subject = (userId: string, ...nodeIds: string[]) => ({ userId, nodeIds: new Set(nodeIds) });

describe('folderRoles', () => {
  // A ─ B ─ C ; D
  const tree = [folder('A'), folder('B', 'A'), folder('C', 'B'), folder('D')];

  it('quyền ở thư mục cha áp xuống mọi thư mục con, không lan sang nhánh khác', () => {
    const roles = folderRoles(tree, [share('A', { principalType: 'unit', principalId: 'lab', role: 'editor' })], subject('u', 'lab'), '2026-10-16');
    expect(Object.fromEntries(roles)).toEqual({ A: 'editor', B: 'editor', C: 'editor' });
  });

  it('lấy mức cao nhất giữa quyền của thư mục cha và quyền đặt ở thư mục con', () => {
    const roles = folderRoles(
      tree,
      [
        share('A', { principalType: 'everyone', role: 'viewer' }),
        share('B', { principalType: 'user', principalId: 'u', role: 'manager' }),
        share('B', { principalType: 'position', principalId: 'engineer', role: 'editor' }),
      ],
      subject('u', 'engineer'),
      '2026-10-16',
    );
    expect(Object.fromEntries(roles)).toEqual({ A: 'viewer', B: 'manager', C: 'manager' });
  });

  it('chủ sở hữu là Quản lý ở thư mục của mình và các thư mục con', () => {
    const roles = folderRoles([...tree, folder('E', 'C', 'u')], [], subject('u'), '2026-10-16');
    expect(Object.fromEntries(roles)).toEqual({ E: 'manager' });
  });

  it('dòng chia sẻ quá hạn hay không khớp người thì không cho quyền', () => {
    const roles = folderRoles(
      tree,
      [
        share('A', { principalType: 'user', principalId: 'u', role: 'editor', expiresOn: '2026-10-15' }),
        share('D', { principalType: 'unit', principalId: 'sales', role: 'editor' }),
      ],
      subject('u', 'lab'),
      '2026-10-16',
    );
    expect(roles.size).toBe(0);
  });

  it('dữ liệu cây hỏng (vòng lặp) không treo', () => {
    const loop = [folder('X', 'Y'), folder('Y', 'X')];
    const roles = folderRoles(loop, [share('X', { role: 'viewer' })], subject('u'), '2026-10-16');
    expect(roles.get('X')).toBe('viewer');
  });
});

describe('Dòng chia sẻ', () => {
  it('còn hiệu lực tới hết ngày hết hạn', () => {
    expect(shareActive({}, '2026-10-16')).toBe(true);
    expect(shareActive({ expiresOn: '2026-10-16' }, '2026-10-16')).toBe(true);
    expect(shareActive({ expiresOn: '2026-10-15' }, '2026-10-16')).toBe(false);
  });

  it('khớp theo người, theo node tổ chức, hoặc mọi người', () => {
    const me = subject('u', 'lab', 'engineer');
    expect(shareMatches({ principalType: 'everyone' }, me)).toBe(true);
    expect(shareMatches({ principalType: 'user', principalId: 'u' }, me)).toBe(true);
    expect(shareMatches({ principalType: 'user', principalId: 'v' }, me)).toBe(false);
    expect(shareMatches({ principalType: 'unit', principalId: 'lab' }, me)).toBe(true);
    expect(shareMatches({ principalType: 'position', principalId: 'engineer' }, me)).toBe(true);
    expect(shareMatches({ principalType: 'unit', principalId: 'sales' }, me)).toBe(false);
    expect(shareMatches({ principalType: 'unit' }, me)).toBe(false);
  });

  it('ngày hôm nay tính theo giờ Việt Nam', () => {
    // 17:30 UTC ngày 15 là 00:30 ngày 16 ở Việt Nam.
    expect(vietnamToday(new Date('2026-10-15T17:30:00Z'))).toBe('2026-10-16');
    expect(vietnamToday(new Date('2026-10-15T16:30:00Z'))).toBe('2026-10-15');
  });
});

describe('Sơ đồ tổ chức', () => {
  const snapshot: OrganizationSnapshot = {
    nodes: [
      { id: 'company', name: 'Công ty', kind: 'unit' },
      { id: 'lab', name: 'Khối thí nghiệm', parentId: 'company', kind: 'unit' },
      { id: 'room', name: 'Phòng TN điện', parentId: 'lab', kind: 'unit' },
      { id: 'engineer', name: 'Kỹ sư', parentId: 'room', kind: 'position' },
    ],
    assignments: [{ userId: 'u', nodeId: 'engineer' }],
    degraded: false,
  };

  it('người thuộc node được bổ nhiệm và mọi node cha của nó', () => {
    expect([...membershipNodes(snapshot, 'u')]).toEqual(['engineer', 'room', 'lab', 'company']);
    expect(membershipNodes(snapshot, 'v').size).toBe(0);
  });

  it('đường dẫn node là tên các node cha từ gốc xuống', () => {
    const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    expect(nodePath(nodes, 'engineer')).toBe('Công ty › Khối thí nghiệm › Phòng TN điện');
    expect(nodePath(nodes, 'company')).toBe('');
  });
});

describe('canSee', () => {
  const base: SharedActor = {
    tenantId: 't',
    userId: 'u',
    displayName: 'U',
    isTenantAdmin: false,
    canManage: false,
    canWriteDocuments: true,
    canDeleteDocuments: false,
  };
  const doc = (confidentiality: 'internal' | 'restricted' | 'confidential', createdBy = 'x') => ({
    confidentiality,
    createdBy,
  });

  it('không vào được thư mục thì không thấy gì, kể cả tài liệu mình tạo', () => {
    expect(canSee(base, doc('internal', 'u'), undefined)).toBe(false);
  });

  it('Nội bộ cần Xem, Hạn chế cần Sửa, Mật cần Quản lý hoặc là người tạo', () => {
    expect(canSee(base, doc('internal'), 'viewer')).toBe(true);
    expect(canSee(base, doc('restricted'), 'viewer')).toBe(false);
    expect(canSee(base, doc('restricted'), 'editor')).toBe(true);
    expect(canSee(base, doc('confidential'), 'editor')).toBe(false);
    expect(canSee(base, doc('confidential'), 'manager')).toBe(true);
    expect(canSee(base, doc('confidential', 'u'), 'viewer')).toBe(true);
  });

  it('quản trị kho thấy hết', () => {
    expect(canSee({ ...base, canManage: true }, doc('confidential'), undefined)).toBe(true);
  });
});
