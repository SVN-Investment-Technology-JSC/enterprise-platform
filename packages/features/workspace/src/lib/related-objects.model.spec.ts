import type { RelatedObject } from '@enterprise-platform/contracts-workspace';
import {
  attachedToLabel,
  candidateDescription,
  completedRelated,
  existingRelatedRows,
  filterRelatedObjects,
  formatRelatedFieldValue,
  groupRelatedObjects,
  NO_RELATED_FILTER,
  pendingRelatedRow,
  relatedAttachedOptions,
  RELATED_UNAVAILABLE_NOTES,
  relatedDisplayLabel,
  relatedGroupLabel,
  relatedKindOptions,
  relatedLaunchHref,
  relatedChanges,
  relatedLinkWarning,
  relatedUnlinkWarning,
  safeLaunchUrl,
} from './related-objects.model';

/** `Intl` chèn khoảng trắng không ngắt trước ký hiệu tiền; đổi về khoảng trắng thường để so sánh. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

const link = (patch: Partial<RelatedObject> = {}): RelatedObject => ({
  id: 'r1',
  entityType: 'project',
  entityId: 'p1',
  projectId: 'p1',
  kind: 'crm.contract',
  moduleKey: 'crm',
  objectId: 'c1',
  label: 'HĐ-001 · Công trình A',
  launchUrl: '/modules/crm/contracts/c1',
  kindLabel: 'Hợp đồng bán',
  moduleLabel: 'Bán hàng',
  fields: [],
  canRemove: true,
  createdBy: 'u1',
  createdAt: '2026-11-20T03:00:00.000Z',
  ...patch,
});

describe('dòng chờ gắn', () => {
  it('mỗi dòng mới có khoá riêng', () => {
    const a = pendingRelatedRow({ kind: 'crm.contract' });
    const b = pendingRelatedRow({ kind: 'crm.contract' });
    expect(a.key).not.toBe(b.key);
    expect(a).toMatchObject({ kind: 'crm.contract', objectId: '', label: '' });
  });

  it('chỉ gửi dòng đủ loại và hồ sơ, bỏ trùng', () => {
    const rows = [
      pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', label: 'HĐ-001' }),
      pendingRelatedRow({ kind: 'crm.contract' }),
      pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', label: 'HĐ-001 (lặp)' }),
      pendingRelatedRow({ kind: 'crm.quote', objectId: 'c1', label: 'BG-001' }),
    ];
    expect(completedRelated(rows).map((row) => row.label)).toEqual(['HĐ-001', 'BG-001']);
  });

});

describe('form sửa', () => {
  it('liên kết đã lưu thành dòng chỉ xem, chỉ lấy liên kết của chính đối tượng', () => {
    const rows = existingRelatedRows(
      [
        link({ id: 'r1', canRemove: true }),
        link({ id: 'r2', objectId: 'c2', entityType: 'work_item', entityId: 'w1' }),
      ],
      { type: 'project', id: 'p1' },
    );
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'crm.contract',
        objectId: 'c1',
        label: 'HĐ-001 · Công trình A',
        kindLabel: 'Hợp đồng bán',
        existingId: 'r1',
        canRemove: true,
      }),
    ]);
  });

  it('lưu: gắn dòng mới, gỡ liên kết bị bỏ, bỏ rồi thêm lại cùng hồ sơ thì không đổi', () => {
    const kept = pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', existingId: 'r1' });
    const dropped = pendingRelatedRow({ kind: 'crm.contract', objectId: 'c2', existingId: 'r2' });
    const readded = pendingRelatedRow({ kind: 'crm.quote', objectId: 'q1', existingId: 'r3' });
    const initial = [kept, dropped, readded];
    const current = [
      kept,
      pendingRelatedRow({ kind: 'crm.quote', objectId: 'q1' }),
      pendingRelatedRow({ kind: 'crm.quote', objectId: 'q2', label: 'BG-002' }),
      pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1' }),
      pendingRelatedRow({ kind: 'crm.quote' }),
    ];
    const { added, removed } = relatedChanges(initial, current);
    expect(added.map((row) => row.objectId)).toEqual(['q2']);
    expect(removed.map((row) => row.existingId)).toEqual(['r2']);
  });

  it('báo liên kết chưa gỡ được', () => {
    const item = pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', label: 'HĐ-001' });
    expect(relatedUnlinkWarning([{ item, message: 'Không có quyền.' }], 'công việc CV-001')).toBe(
      'Chưa gỡ được 1 đối tượng liên quan khỏi công việc CV-001: HĐ-001 (Không có quyền).',
    );
  });
});

describe('nhãn hiển thị', () => {
  it('ghép mã và tên, không lặp mã khi nhãn đã có sẵn', () => {
    expect(relatedDisplayLabel('HĐ-001', 'Công trình A')).toBe('HĐ-001 — Công trình A');
    expect(relatedDisplayLabel('HĐ-001', 'hđ-001 · Công trình A')).toBe('hđ-001 · Công trình A');
    expect(relatedDisplayLabel(undefined, 'Công trình A')).toBe('Công trình A');
    expect(relatedDisplayLabel('HĐ-001', '  ')).toBe('HĐ-001');
  });

  it('dòng phụ gồm gợi ý và trạng thái', () => {
    expect(candidateDescription('Công ty X', 'Hiệu lực')).toBe('Công ty X · Hiệu lực');
    expect(candidateDescription(undefined, 'Hiệu lực')).toBe('Hiệu lực');
    expect(candidateDescription()).toBeUndefined();
  });

  it('tên nhóm chỉ là tên loại, không có tên phân hệ', () => {
    expect(relatedGroupLabel(link({ kindLabel: 'Báo giá' }))).toBe('Báo giá');
    expect(relatedGroupLabel(link({ kindLabel: undefined }))).toBe('Hồ sơ khác');
    expect(Object.values(RELATED_UNAVAILABLE_NOTES).some((note) => /module|phân hệ/i.test(note))).toBe(false);
  });
});

describe('lời báo lỗi khi gắn', () => {
  it('liệt kê từng hồ sơ chưa gắn được kèm lý do', () => {
    const failures = [
      { item: pendingRelatedRow({ kind: 'crm.contract', objectId: 'c1', label: 'HĐ-001' }), message: 'Bạn không có quyền.' },
      { item: pendingRelatedRow({ kind: 'crm.quote', objectId: 'q1' }), message: '' },
    ];
    expect(relatedLinkWarning(failures, 'dự án DA-001')).toBe(
      'Chưa gắn được 2 đối tượng liên quan vào dự án DA-001: HĐ-001 (Bạn không có quyền); q1 (lỗi không rõ). Có thể gắn lại ở tab Liên quan của dự án.',
    );
    expect(relatedLinkWarning(failures.slice(0, 1), undefined, false)).toBe(
      'Chưa gắn được 1 đối tượng liên quan: HĐ-001 (Bạn không có quyền).',
    );
  });
});

describe('tab Liên quan', () => {
  it('định dạng giá trị theo kiểu', () => {
    expect(plain(formatRelatedFieldValue({ type: 'money', value: 1_200_000 }))).toBe('1.200.000 ₫');
    expect(plain(formatRelatedFieldValue({ type: 'money', value: '1200000' }))).toBe('1.200.000 ₫');
    expect(formatRelatedFieldValue({ type: 'date', value: '2026-11-05' })).toBe('05/11/2026');
    expect(formatRelatedFieldValue({ type: 'text', value: 'Hiệu lực' })).toBe('Hiệu lực');
    expect(formatRelatedFieldValue({ type: 'text', value: null })).toBe('—');
    expect(formatRelatedFieldValue({ type: 'money', value: null })).toBe('—');
  });

  it('chỉ mở đường dẫn nội bộ, và không mở khi module gốc không cho xem', () => {
    expect(safeLaunchUrl('/modules/crm/contracts/c1')).toBe('/modules/crm/contracts/c1');
    expect(safeLaunchUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeLaunchUrl('//evil.example')).toBeUndefined();
    expect(safeLaunchUrl('https://evil.example')).toBeUndefined();
    expect(relatedLaunchHref(link({ unavailableReason: 'forbidden' }))).toBeUndefined();
    expect(relatedLaunchHref(link({ unavailableReason: 'unreachable' }))).toBe('/modules/crm/contracts/c1');
    expect(relatedLaunchHref(link())).toBe('/modules/crm/contracts/c1');
  });

  it('gom theo loại, nhóm xếp theo tên', () => {
    const items = [
      link({ id: 'a', kind: 'crm.quote', kindLabel: 'Báo giá' }),
      link({ id: 'b' }),
      link({ id: 'c', kind: 'crm.quote', kindLabel: 'Báo giá' }),
    ];
    const groups = groupRelatedObjects(items);
    expect(groups.map((group) => group.label)).toEqual(['Báo giá', 'Hợp đồng bán']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('lọc theo loại và nơi gắn', () => {
    const items = [
      link({ id: 'a' }),
      link({ id: 'b', entityType: 'work_item', entityId: 'w1', entityLabel: 'CV-001 · Khảo sát' }),
      link({ id: 'c', kind: 'crm.quote', entityType: 'work_item', entityId: 'w2' }),
    ];
    expect(filterRelatedObjects(items, NO_RELATED_FILTER)).toHaveLength(3);
    expect(filterRelatedObjects(items, { kind: 'crm.contract', attached: 'all' }).map((i) => i.id)).toEqual(['a', 'b']);
    expect(filterRelatedObjects(items, { kind: 'all', attached: 'project' }).map((i) => i.id)).toEqual(['a']);
    expect(filterRelatedObjects(items, { kind: 'all', attached: 'w2' }).map((i) => i.id)).toEqual(['c']);
  });

  it('lựa chọn của hai ô lọc lấy từ danh sách đang có', () => {
    const items = [
      link({ id: 'a' }),
      link({ id: 'b', kind: 'crm.quote', kindLabel: 'Báo giá', entityType: 'work_item', entityId: 'w2' }),
      link({ id: 'c', entityType: 'work_item', entityId: 'w1', entityLabel: 'CV-001 · Khảo sát' }),
    ];
    expect(relatedKindOptions(items)).toEqual([
      { value: 'crm.quote', label: 'Báo giá' },
      { value: 'crm.contract', label: 'Hợp đồng bán' },
    ]);
    const names: Record<string, string> = { w2: 'CV-002 · Thi công' };
    expect(relatedAttachedOptions(items, (id) => names[id])).toEqual([
      { value: 'project', label: 'Dự án' },
      { value: 'w1', label: 'CV-001 · Khảo sát' },
      { value: 'w2', label: 'CV-002 · Thi công' },
    ]);
    expect(attachedToLabel(link({ entityType: 'work_item', entityId: 'w9' }))).toBe('Công việc');
  });
});
