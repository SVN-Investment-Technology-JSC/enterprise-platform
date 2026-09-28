import type {
  CreateProcedureStepInput,
  ProcedureDefinition,
  ProcedureStepDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import { addStepToBranch, branchLetters, flowRowInfo } from './flow-edit';

const step = (id: string, order: number): ProcedureStepDefinition => ({
  id,
  key: id.toUpperCase(),
  order,
  name: id,
  assignments: [],
});

const toInput = (item: ProcedureStepDefinition): CreateProcedureStepInput => ({
  key: item.key,
  order: item.order,
  name: item.name,
  assignments: [],
});

/** Giống quy trình Thanh lý hợp đồng: 1 bước lập, 3 nhánh (3 bước, 2 bước, 1 bước), rồi bước hợp. */
function definition(): ProcedureDefinition {
  return {
    id: 'def',
    code: 'THANH-LY',
    name: 'Thanh lý',
    kind: 'process',
    status: 'draft',
    steps: ['lap', 'a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'ky'].map((id, index) => step(id, index + 1)),
    gateways: [
      {
        id: 'g1',
        key: 'G1',
        name: 'Theo công nợ',
        type: 'exclusive',
        afterStepId: 'lap',
        branches: [
          { id: 'n1', key: 'N1', label: 'Còn nợ trên 100tr', isDefault: false, stepIds: ['a1', 'a2', 'a3'] },
          { id: 'n2', key: 'N2', label: 'Còn nợ', isDefault: false, stepIds: ['b1', 'b2'] },
          { id: 'n3', key: 'N3', label: 'Không công nợ', isDefault: true, stepIds: ['c1'] },
        ],
      },
    ],
  } as unknown as ProcedureDefinition;
}

describe('flowRowInfo — số hiển thị', () => {
  it('trục chính đếm liên tục bỏ qua bước trong nhánh; bước nhánh là chữ + vị trí', () => {
    const info = flowRowInfo(definition());
    const labels = ['lap', 'a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'ky'].map((id) => info.get(id)?.label);
    expect(labels).toEqual(['1', 'A1', 'A2', 'A3', 'B1', 'B2', 'C1', '2']);
  });

  it('đánh dấu bước cuối của mỗi nhánh', () => {
    const info = flowRowInfo(definition());
    expect(['a3', 'b2', 'c1'].every((id) => info.get(id)?.branch?.isLast)).toBe(true);
    expect(info.get('a1')?.branch?.isLast).toBe(false);
  });

  it('chữ nhánh chạy tiếp qua điểm rẽ nhánh thứ hai', () => {
    const base = definition();
    const second = {
      ...base,
      steps: [...base.steps, step('d1', 9), step('e1', 10), step('ket', 11)],
      gateways: [
        ...(base.gateways ?? []),
        {
          id: 'g2',
          key: 'G2',
          name: 'Theo hình thức',
          type: 'exclusive' as const,
          afterStepId: 'ky',
          branches: [
            { id: 'm1', key: 'M1', label: 'Online', isDefault: false, stepIds: ['d1'] },
            { id: 'm2', key: 'M2', label: 'Ngược lại', isDefault: true, stepIds: ['e1'] },
          ],
        },
      ],
    } as ProcedureDefinition;
    expect([...branchLetters(second).values()]).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(flowRowInfo(second).get('ket')?.label).toBe('3');
  });
});

describe('addStepToBranch', () => {
  it('thêm bước vào cuối nhánh, tham chiếu bằng key, order vẫn liền mạch theo cấu trúc', () => {
    const change = addStepToBranch(definition(), { gatewayId: 'g1', branchId: 'n2' }, 'Kế toán xác nhận', toInput);
    const added = change.steps.find((item) => item.name === 'Kế toán xác nhận');
    expect(added).toBeDefined();
    expect(change.gateways[0].branches[1].stepIds).toEqual(['b1', 'b2', added?.key]);
    const orderOf = (key: string) => change.steps.find((item) => item.key === key)?.order;
    expect(orderOf(added?.key ?? '')).toBe((orderOf('B2') ?? 0) + 1);
    expect(orderOf('KY')).toBe(change.steps.length);
  });

  it('thêm được vào nhánh rỗng', () => {
    const base = definition();
    const empty = {
      ...base,
      gateways: base.gateways?.map((gateway) => ({
        ...gateway,
        branches: gateway.branches.map((branch) => (branch.id === 'n3' ? { ...branch, stepIds: [] } : branch)),
      })),
    } as ProcedureDefinition;
    const change = addStepToBranch(empty, { gatewayId: 'g1', branchId: 'n3' }, 'Bước C1', toInput);
    expect(change.gateways[0].branches[2].stepIds).toHaveLength(1);
  });
});
