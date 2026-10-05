import { canRelink, rulesNeedingDirect } from './operations-screen';
import { reconcileDependentValues } from '../ui/hrm-action-dialog';

describe('gắn quy trình trong màn vận hành', () => {
  it('chỉ gắn lại được liên kết FAILED, hoặc CONFLICT chưa có instance', () => {
    expect(
      canRelink({ status: 'FAILED', instance_id: '', related_instances: [] }),
    ).toBe(true);
    expect(
      canRelink({ status: 'CONFLICT', instance_id: '', related_instances: [] }),
    ).toBe(true);
    expect(
      canRelink({
        status: 'CONFLICT',
        instance_id: '',
        related_instances: [
          { instanceId: 'i', sourceType: 's', sourceId: 'x' },
        ],
      }),
    ).toBe(false);
    expect(
      canRelink({ status: 'RUNNING', instance_id: 'i', related_instances: [] }),
    ).toBe(false);
  });

  it('chỉ cảnh báo binding PROCEDURE khi Procedure không khả dụng', () => {
    const rules = [
      { id: '1', mode: 'PROCEDURE' as const },
      { id: '2', mode: 'DIRECT' as const },
    ];
    expect(rulesNeedingDirect(rules, false).map((r) => r.id)).toEqual(['1']);
    expect(rulesNeedingDirect(rules, true)).toEqual([]);
    expect(rulesNeedingDirect(rules, undefined)).toEqual([]);
  });

  it('xóa mã loại con khi đổi loại đơn làm lựa chọn không còn hợp lệ', () => {
    const catalog: Record<string, { value: string; label: string }[]> = {
      LEAVE: [{ value: 'AL', label: 'AL' }],
      OT: [{ value: 'NIGHT', label: 'Ca đêm' }],
    };
    const fields = [
      { key: 'requestKind', label: 'Loại đơn' },
      {
        key: 'subTypeCode',
        label: 'Mã loại con',
        optionsFor: (v: Record<string, string>) => catalog[v.requestKind] ?? [],
      },
    ];
    expect(
      reconcileDependentValues(fields, { requestKind: 'OT', subTypeCode: 'AL' })
        .subTypeCode,
    ).toBe('');
    expect(
      reconcileDependentValues(fields, {
        requestKind: 'LEAVE',
        subTypeCode: 'AL',
      }).subTypeCode,
    ).toBe('AL');
  });
});
